import asyncio
import json
import logging
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import models
from config import settings, validate_settings
from database import SessionLocal, engine
from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError
from tournament_manager import TournamentManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("poker.api")

tournament_manager = TournamentManager()
startup_state = {
    "bootstrap_ok": False,
    "bootstrap_error": None,
}


def log_event(message: str, **fields):
    logger.info("%s %s", message, json.dumps(fields, default=str))


class CreateTournamentRequest(BaseModel):
    title: str
    desc: str = ""
    buy_in_chips: int
    starting_stack: Optional[int] = None
    category: str = "tournament"
    mode: str = "tournament_scheduled"
    min_players: Optional[int] = None
    max_seats: Optional[int] = None
    blind_level_duration_sec: Optional[int] = None
    blind_schedule: Optional[List[Dict[str, int]]] = None
    asset_symbol: str = "S"
    asset_address: Optional[str] = None
    creator_player_id: Optional[str] = None
    creator_wallet_address: Optional[str] = None
    creator_nft_contract: Optional[str] = None
    required_nft: Optional[str] = None
    registration_opens_at: Optional[str] = None
    scheduled_start_at: Optional[str] = None
    late_registration_ends_at: Optional[str] = None
    is_recurring: bool = False
    recurrence_rule: Optional[str] = None
    admin_secret: str


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
        # Anti-collusion IP tracking (blocks multiple accounts accessing the same table from identical IPs)
        forwarded = websocket.headers.get("x-forwarded-for")
        client_ip = forwarded.split(",")[0] if forwarded else (websocket.client.host if websocket.client else "unknown")
        
        for conn in self.active_connections.get(tournament_id, []):
            if conn.get("ip") == client_ip and conn["player_id"] != player_id and client_ip not in ("unknown", "127.0.0.1", "localhost", "::1"):
                await websocket.accept()
                await self.send_event(websocket, "error", {"message": "Anti-collusion: Multiple accounts from identical IPs are blocked."})
                await websocket.close(code=1008)
                return False

        await websocket.accept()
        self.active_connections.setdefault(tournament_id, []).append({"ws": websocket, "player_id": player_id, "ip": client_ip})
        return True

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


def probe_database() -> tuple[bool, str | None]:
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:
        return False, str(exc)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    issues = validate_settings()
    for issue in issues:
        logger.warning("Config issue: %s", issue)
    broadcast_task = None
    startup_state["bootstrap_ok"] = False
    startup_state["bootstrap_error"] = None
    try:
        models.Base.metadata.create_all(bind=engine)

        # Quick auto-migration for MVP SQLite
        try:
            with engine.begin() as conn:
                alter_statements = [
                    "ALTER TABLE tournaments ADD COLUMN required_nft VARCHAR",
                    "ALTER TABLE tournaments ADD COLUMN creator_player_id VARCHAR",
                    "ALTER TABLE tournaments ADD COLUMN creator_wallet_address VARCHAR",
                    "ALTER TABLE tournaments ADD COLUMN creator_nft_contract VARCHAR",
                    "ALTER TABLE tournaments ADD COLUMN access_policy VARCHAR DEFAULT 'open'",
                    "ALTER TABLE tournaments ADD COLUMN asset_symbol VARCHAR DEFAULT 'S'",
                    "ALTER TABLE tournaments ADD COLUMN asset_address VARCHAR",
                    "ALTER TABLE tournaments ADD COLUMN asset_decimals INTEGER DEFAULT 0",
                    "ALTER TABLE asset_whitelist ADD COLUMN creator_nft_contract VARCHAR",
                ]
                for stmt in alter_statements:
                    try:
                        conn.execute(text(stmt))
                    except Exception:
                        pass
        except Exception as e:
            logger.warning(f"Auto-migration skipped or failed: {e}")

        tournament_manager.ensure_seed_data()
        tournament_manager.start_background_task()
        startup_state["bootstrap_ok"] = True
    except Exception as exc:
        startup_state["bootstrap_error"] = str(exc)
        logger.exception("Application bootstrap failed")
    broadcast_task = asyncio.create_task(periodic_state_broadcast())
    yield
    if broadcast_task:
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
    db_ok, db_error = probe_database()
    status = "ok" if startup_state["bootstrap_ok"] and db_ok else "degraded"
    return {
        "status": status,
        "bootstrap_ok": startup_state["bootstrap_ok"],
        "bootstrap_error": startup_state["bootstrap_error"],
        "database_ok": db_ok,
        "database_error": db_error,
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


@app.get("/api/assets")
async def list_assets():
    return {"items": tournament_manager.list_assets()}


@app.post("/api/tournaments")
async def create_tournament_endpoint(payload: CreateTournamentRequest):
    if payload.admin_secret != os.getenv("ADMIN_SECRET", "supersecret"):
        raise HTTPException(status_code=403, detail="Invalid admin secret")

    new_id = f"custom-sng-{uuid.uuid4().hex[:6]}"
    try:
        registration_opens_at = datetime.fromisoformat(payload.registration_opens_at) if payload.registration_opens_at else None
        scheduled_start_at = datetime.fromisoformat(payload.scheduled_start_at) if payload.scheduled_start_at else None
        late_registration_ends_at = (
            datetime.fromisoformat(payload.late_registration_ends_at) if payload.late_registration_ends_at else None
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid datetime format: {exc}")

    try:
        new_tournament = tournament_manager.create_tournament(
            {
                "id": new_id,
                "title": payload.title,
                "desc": payload.desc,
                "category": payload.category,
                "mode": payload.mode,
                "state": "scheduled" if scheduled_start_at and registration_opens_at and registration_opens_at > datetime.utcnow() else "registering",
                "buy_in_chips": payload.buy_in_chips,
                "starting_stack": payload.starting_stack or payload.buy_in_chips,
                "min_players": payload.min_players or settings.min_players_to_start,
                "max_seats": payload.max_seats or settings.max_seats,
                "blind_level_duration_sec": payload.blind_level_duration_sec or 300,
                "blind_schedule": payload.blind_schedule,
                "asset_symbol": payload.asset_symbol,
                "required_nft": payload.required_nft,
                "creator_player_id": payload.creator_player_id,
                "creator_wallet_address": payload.creator_wallet_address.lower() if payload.creator_wallet_address else None,
                "creator_nft_contract": payload.creator_nft_contract,
                "registration_opens_at": registration_opens_at,
                "scheduled_start_at": scheduled_start_at,
                "late_registration_ends_at": late_registration_ends_at,
                "is_recurring": payload.is_recurring,
                "recurrence_rule": payload.recurrence_rule,
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if settings.enable_onchain_payout and payload.asset_symbol.upper() == "USDC":
        import blockchain

        success = blockchain.create_tournament(
            table_id=new_id,
            title=payload.title,
            desc=payload.desc,
            buy_in_usdc=payload.buy_in_chips,
            required_nft=payload.required_nft,
        )
        if not success:
            raise HTTPException(status_code=500, detail="Blockchain transaction failed. Check Server balance/RPC.")

    return {
        "ok": True,
        "tournament_id": new_id,
        "title": payload.title,
        "summary": tournament_manager.get_or_create_runtime(new_tournament.id).to_summary(),
    }


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

    success = await manager.connect(websocket, tournament_id, player_id)
    if not success:
        return
        
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
