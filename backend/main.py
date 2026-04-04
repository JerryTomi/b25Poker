import asyncio
import json
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import models
from config import settings, validate_settings
from database import SessionLocal, engine
from tournament_manager import TournamentManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("poker.api")

models.Base.metadata.create_all(bind=engine)
tournament_manager = TournamentManager()


def log_event(message: str, **fields):
    logger.info("%s %s", message, json.dumps(fields, default=str))


class DemoSessionRequest(BaseModel):
    display_name: Optional[str] = None
    reconnect_token: Optional[str] = None
    wallet_address: Optional[str] = None


class JoinTournamentRequest(BaseModel):
    player_id: str
    reconnect_token: str


class LeaveTournamentRequest(BaseModel):
    player_id: str
    reconnect_token: str


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[dict]] = {}

    async def connect(self, websocket: WebSocket, tournament_id: str, player_id: str):
        await websocket.accept()
        self.active_connections.setdefault(tournament_id, []).append({"ws": websocket, "player_id": player_id})

    def disconnect(self, websocket: WebSocket, tournament_id: str):
        if tournament_id in self.active_connections:
            self.active_connections[tournament_id] = [
                conn for conn in self.active_connections[tournament_id] if conn["ws"] != websocket
            ]
            if not self.active_connections[tournament_id]:
                del self.active_connections[tournament_id]

    async def send_event(self, websocket: WebSocket, event_type: str, data: dict):
        await websocket.send_text(json.dumps({"type": event_type, "data": data}))

    async def broadcast_table_state(self, runtime):
        tournament_id = runtime.tournament_id
        for conn in self.active_connections.get(tournament_id, [])[:]:
            try:
                viewer_state = runtime.to_table_state(viewer_id=conn["player_id"])
                await conn["ws"].send_text(json.dumps({"type": "table_state", "data": viewer_state}))
            except Exception:
                self.disconnect(conn["ws"], tournament_id)

    async def broadcast_event(self, tournament_id: str, event_type: str, data: dict):
        for conn in self.active_connections.get(tournament_id, [])[:]:
            try:
                await conn["ws"].send_text(json.dumps({"type": event_type, "data": data}))
            except Exception:
                self.disconnect(conn["ws"], tournament_id)


manager = ConnectionManager()


def get_player_by_token(db, player_id: str, reconnect_token: str):
    return (
        db.query(models.PlayerDB)
        .filter(models.PlayerDB.id == player_id, models.PlayerDB.reconnect_token == reconnect_token)
        .first()
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    issues = validate_settings()
    for issue in issues:
        logger.warning("Config issue: %s", issue)
    tournament_manager.ensure_seed_data()
    tournament_manager.start_background_task()
    broadcast_task = asyncio.create_task(periodic_state_broadcast())
    yield
    broadcast_task.cancel()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def periodic_state_broadcast():
    while True:
        try:
            for runtime in list(tournament_manager.runtimes.values()):
                await manager.broadcast_table_state(runtime)
        except Exception:
            logger.exception("Periodic broadcast failed")
        await asyncio.sleep(1)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "demo_mode": settings.demo_mode,
        "wallet_connect": settings.enable_wallet_connect,
        "onchain_payout": settings.enable_onchain_payout,
    }


@app.post("/api/demo/session")
async def create_demo_session(payload: DemoSessionRequest):
    db = SessionLocal()
    try:
        if payload.reconnect_token:
            player = (
                db.query(models.PlayerDB)
                .filter(models.PlayerDB.reconnect_token == payload.reconnect_token)
                .first()
            )
            if player:
                if payload.wallet_address:
                    player.wallet_address = payload.wallet_address.lower()
                if payload.display_name:
                    player.display_name = payload.display_name.strip()[:24]
                db.commit()
                return {
                    "player_id": player.id,
                    "display_name": player.display_name,
                    "chip_balance": player.chip_balance,
                    "reconnect_token": player.reconnect_token,
                    "wallet_address": player.wallet_address,
                }

        display_name = (payload.display_name or "Guest").strip()[:24] or "Guest"
        player = models.PlayerDB(
            id=f"player_{uuid.uuid4().hex[:8]}",
            display_name=display_name,
            reconnect_token=secrets.token_urlsafe(24),
            chip_balance=10000,
            wallet_address=payload.wallet_address.lower() if payload.wallet_address else None,
        )
        db.add(player)
        db.commit()
        return {
            "player_id": player.id,
            "display_name": player.display_name,
            "chip_balance": player.chip_balance,
            "reconnect_token": player.reconnect_token,
            "wallet_address": player.wallet_address,
        }
    finally:
        db.close()


@app.get("/api/tournaments")
async def list_tournaments():
    return {"items": tournament_manager.list_tournaments()}


@app.post("/api/tournaments/{tournament_id}/join")
async def join_tournament(tournament_id: str, payload: JoinTournamentRequest):
    db = SessionLocal()
    try:
        player = get_player_by_token(db, payload.player_id, payload.reconnect_token)
        if not player:
            raise HTTPException(status_code=401, detail="Invalid session token.")
    finally:
        db.close()

    try:
        runtime, joined = tournament_manager.join_tournament(tournament_id, payload.player_id)
        log_event("player_joined", tournament_id=tournament_id, player_id=payload.player_id, seat=joined["seat_index"])
        await manager.broadcast_event(
            tournament_id,
            "table_joined",
            {"player_id": payload.player_id, "seat_index": joined["seat_index"], "tournament_id": tournament_id},
        )
        await manager.broadcast_table_state(runtime)
        return {
            **joined,
            "state": runtime.state,
            "summary": runtime.to_summary(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/tournaments/{tournament_id}/leave")
async def leave_tournament(tournament_id: str, payload: LeaveTournamentRequest):
    db = SessionLocal()
    try:
        player = get_player_by_token(db, payload.player_id, payload.reconnect_token)
        if not player:
            raise HTTPException(status_code=401, detail="Invalid session token.")
    finally:
        db.close()

    try:
        tournament_manager.leave_tournament(tournament_id, payload.player_id)
        runtime = tournament_manager.get_or_create_runtime(tournament_id)
        log_event("player_left", tournament_id=tournament_id, player_id=payload.player_id)
        await manager.broadcast_table_state(runtime)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.websocket("/ws/table/{tournament_id}")
async def websocket_endpoint(websocket: WebSocket, tournament_id: str, player_id: str, token: str):
    db = SessionLocal()
    try:
        player = get_player_by_token(db, player_id, token)
    finally:
        db.close()

    if not player:
        await websocket.accept()
        await manager.send_event(websocket, "error", {"message": "Invalid session token."})
        await websocket.close(code=1008)
        return

    try:
        runtime = tournament_manager.get_or_create_runtime(tournament_id)
    except KeyError:
        await websocket.accept()
        await manager.send_event(websocket, "error", {"message": "Tournament not found."})
        await websocket.close(code=1008)
        return

    if player_id not in runtime.engine.players:
        await websocket.accept()
        await manager.send_event(websocket, "error", {"message": "Join the tournament before connecting."})
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, tournament_id, player_id)
    tournament_manager.mark_connected(tournament_id, player_id)
    await manager.send_event(websocket, "table_joined", {"player_id": player_id, "tournament_id": tournament_id})
    await manager.broadcast_table_state(runtime)

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                await manager.send_event(websocket, "error", {"message": "Invalid JSON payload."})
                continue

            action = payload.get("action")
            amount = int(payload.get("amount", 0))
            if action not in {"fold", "check", "call", "bet", "raise", "allin"}:
                await manager.send_event(websocket, "error", {"message": "Unsupported action."})
                continue

            processed = runtime.engine.process_action(player_id, action, amount)
            if not processed:
                await manager.send_event(websocket, "error", {"message": "Action rejected by table state."})
                continue

            tournament_manager.persist_runtime(runtime)
            tournament_manager.log_event(tournament_id, player_id, "player_action", {"action": action, "amount": amount})
            if runtime.engine.result:
                await manager.broadcast_event(
                    tournament_id,
                    "hand_result",
                    runtime.engine.result,
                )
            if runtime.engine.tournament_finished():
                tournament_manager.finish_tournament(tournament_id)
                await manager.broadcast_event(
                    tournament_id,
                    "tournament_finished",
                    {"winner": runtime.engine.result["winners"][0] if runtime.engine.result else None},
                )
            await manager.broadcast_table_state(runtime)
    except WebSocketDisconnect:
        pass
    finally:
        tournament_manager.mark_disconnected(tournament_id, player_id)
        manager.disconnect(websocket, tournament_id)
        log_event("player_disconnected", tournament_id=tournament_id, player_id=player_id)


STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
