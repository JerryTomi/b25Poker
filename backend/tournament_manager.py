import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, Optional

import blockchain
import models
from config import settings
from database import SessionLocal
from engine import PokerEngine

logger = logging.getLogger("poker.tournament")


class TournamentRuntime:
    def __init__(self, tournament_id: str, title: str, required_nft: Optional[str] = None):
        self.tournament_id = tournament_id
        self.title = title
        self.required_nft = required_nft
        self.engine = PokerEngine(
            tournament_id,
            mode="tournament_sng",
            max_seats=settings.max_seats,
        )
        self.state = "registering"
        self.countdown_started_at: Optional[float] = None
        self.last_tick = time.time()
        self.player_disconnects: Dict[str, float] = {}
        self.chain_created = False

    def to_summary(self) -> dict:
        seated_players = [pid for pid in self.engine.seats if pid]
        active_count = len([pid for pid in seated_players if self.engine.players.get(pid, {}).get("stack", 0) > 0])
        countdown_remaining = 0
        if self.countdown_started_at is not None and self.state == "countdown":
            countdown_remaining = max(0, settings.countdown_seconds - int(time.time() - self.countdown_started_at))
        return {
            "id": self.tournament_id,
            "title": self.title,
            "mode": "tournament_sng",
            "state": self.state,
            "buy_in_chips": settings.buy_in_chips,
            "max_seats": settings.max_seats,
            "min_players": settings.min_players_to_start,
            "seated_count": len(seated_players),
            "active_count": active_count,
            "countdown_remaining": countdown_remaining,
            "required_nft": self.required_nft,
        }

    def to_table_state(self, viewer_id: Optional[str] = None) -> dict:
        state = self.engine.get_game_state(viewer_id=viewer_id)
        state.update(
            {
                "tournament_id": self.tournament_id,
                "title": self.title,
                "tournament_state": self.state,
                "countdown_remaining": self.to_summary()["countdown_remaining"],
                "turn_timeout_sec": settings.turn_timeout_sec,
                "buy_in_chips": settings.buy_in_chips,
            }
        )
        return state


class TournamentManager:
    def __init__(self):
        self.runtimes: Dict[str, TournamentRuntime] = {}
        self._task: Optional[asyncio.Task] = None

    def ensure_seed_data(self):
        db = SessionLocal()
        try:
            defaults = [
                ("demo-sng-1", "Prototype Sit & Go"),
                ("demo-sng-2", "Second Chance Turbo"),
                ("demo-sng-3", "Night Table"),
            ]
            for tournament_id, title in defaults:
                tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
                if not tournament:
                    tournament = models.TournamentDB(
                        id=tournament_id,
                        title=title,
                        mode="tournament_sng",
                        state="registering",
                        buy_in_chips=settings.buy_in_chips,
                        max_seats=settings.max_seats,
                        min_players=settings.min_players_to_start,
                    )
                    db.add(tournament)
            db.commit()
        finally:
            db.close()

    def start_background_task(self):
        if not self._task:
            self._task = asyncio.create_task(self._ticker())

    async def _ticker(self):
        while True:
            try:
                for runtime in list(self.runtimes.values()):
                    await self.tick_runtime(runtime)
            except Exception:
                logger.exception("Tournament background tick failed")
            await asyncio.sleep(1)

    def get_or_create_runtime(self, tournament_id: str) -> TournamentRuntime:
        if tournament_id in self.runtimes:
            return self.runtimes[tournament_id]

        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            if not tournament:
                raise KeyError(tournament_id)

            runtime = TournamentRuntime(tournament.id, tournament.title, tournament.required_nft)
            runtime.state = tournament.state
            entries = (
                db.query(models.TournamentEntryDB)
                .filter(models.TournamentEntryDB.tournament_id == tournament.id)
                .order_by(models.TournamentEntryDB.seat_index.asc())
                .all()
            )
            for entry in entries:
                runtime.engine.add_player(entry.player_id, entry.stack or settings.buy_in_chips, seat_index=entry.seat_index)
                player = runtime.engine.players[entry.player_id]
                player["eliminated"] = entry.status == "eliminated"
                player["active"] = entry.status == "active"
                player["folded"] = False
                if entry.status == "eliminated":
                    player["stack"] = 0
            if tournament.state == "running":
                runtime.engine.start_hand()
            self.runtimes[tournament_id] = runtime
            return runtime
        finally:
            db.close()

    def list_tournaments(self) -> list[dict]:
        db = SessionLocal()
        try:
            tournaments = db.query(models.TournamentDB).order_by(models.TournamentDB.created_at.asc()).all()
            items = []
            for tournament in tournaments:
                runtime = self.runtimes.get(tournament.id)
                if runtime:
                    items.append(runtime.to_summary())
                else:
                    seated_count = (
                        db.query(models.TournamentEntryDB)
                        .filter(models.TournamentEntryDB.tournament_id == tournament.id)
                        .count()
                    )
                    items.append(
                        {
                            "id": tournament.id,
                            "title": tournament.title,
                            "mode": tournament.mode,
                            "state": tournament.state,
                            "buy_in_chips": tournament.buy_in_chips,
                            "max_seats": tournament.max_seats,
                            "min_players": tournament.min_players,
                            "seated_count": seated_count,
                            "active_count": seated_count,
                            "countdown_remaining": 0,
                            "required_nft": tournament.required_nft,
                        }
                    )
            return items
        finally:
            db.close()

    def join_tournament(self, tournament_id: str, player_id: str) -> tuple[TournamentRuntime, dict]:
        runtime = self.get_or_create_runtime(tournament_id)
        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            player = db.query(models.PlayerDB).filter(models.PlayerDB.id == player_id).first()
            if not tournament or not player:
                raise ValueError("Tournament or player not found.")
            if runtime.state not in {"registering", "countdown"}:
                raise ValueError("Tournament already started.")

            entry = (
                db.query(models.TournamentEntryDB)
                .filter(
                    models.TournamentEntryDB.tournament_id == tournament_id,
                    models.TournamentEntryDB.player_id == player_id,
                )
                .first()
            )

            if entry:
                return runtime, {"tournament_id": tournament_id, "player_id": player_id, "seat_index": entry.seat_index}

            if player.chip_balance < tournament.buy_in_chips:
                raise ValueError("Not enough chips to join this tournament.")

            seat_index = runtime.engine.seats.index(None) if None in runtime.engine.seats else None
            if seat_index is None:
                raise ValueError("Tournament is full.")

            player.chip_balance -= tournament.buy_in_chips
            entry = models.TournamentEntryDB(
                tournament_id=tournament_id,
                player_id=player_id,
                seat_index=seat_index,
                status="joined",
                stack=tournament.buy_in_chips,
            )
            db.add(entry)
            db.add(
                models.ActionLogDB(
                    tournament_id=tournament_id,
                    player_id=player_id,
                    event_type="join",
                    payload=json.dumps({"seat_index": seat_index}),
                )
            )
            db.commit()
            runtime.engine.add_player(player_id, tournament.buy_in_chips, seat_index=seat_index)
            runtime.player_disconnects.pop(player_id, None)
            self._maybe_start_countdown(runtime, db)
            return runtime, {"tournament_id": tournament_id, "player_id": player_id, "seat_index": seat_index}
        finally:
            db.close()

    def leave_tournament(self, tournament_id: str, player_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        if runtime.state not in {"registering", "countdown"}:
            raise ValueError("Tournament already started.")

        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            player = db.query(models.PlayerDB).filter(models.PlayerDB.id == player_id).first()
            entry = (
                db.query(models.TournamentEntryDB)
                .filter(
                    models.TournamentEntryDB.tournament_id == tournament_id,
                    models.TournamentEntryDB.player_id == player_id,
                )
                .first()
            )
            if not tournament or not player or not entry:
                raise ValueError("Seat not found.")

            player.chip_balance += tournament.buy_in_chips
            db.delete(entry)
            db.add(models.ActionLogDB(tournament_id=tournament_id, player_id=player_id, event_type="leave"))
            db.commit()
            runtime.engine.remove_player(player_id)
            self._maybe_reset_countdown(runtime, db)
        finally:
            db.close()

    async def tick_runtime(self, runtime: TournamentRuntime):
        now = time.time()
        if runtime.state == "countdown" and runtime.countdown_started_at is not None:
            if now - runtime.countdown_started_at >= settings.countdown_seconds:
                self.start_tournament(runtime.tournament_id)

        if runtime.state == "running" and runtime.engine.current_turn:
            if now - runtime.engine.current_turn_started_at >= settings.turn_timeout_sec:
                action = runtime.engine.auto_act_current_player()
                self.persist_runtime(runtime)
                self.log_event(runtime.tournament_id, runtime.engine.current_turn, "timeout_action", {"action": action})

        for player_id, disconnected_at in list(runtime.player_disconnects.items()):
            if now - disconnected_at >= settings.reconnect_grace_sec:
                runtime.player_disconnects.pop(player_id, None)
                if player_id in runtime.engine.players and runtime.state in {"running", "countdown"}:
                    runtime.engine.players[player_id]["eliminated"] = runtime.state == "running"
                    if runtime.state == "running":
                        runtime.engine.players[player_id]["stack"] = 0
                self.persist_runtime(runtime)

        if runtime.state == "running" and runtime.engine.hand_over and not runtime.engine.tournament_finished():
            runtime.engine.start_hand()
            self.persist_runtime(runtime)

        if runtime.state == "running" and runtime.engine.tournament_finished():
            self.finish_tournament(runtime.tournament_id)

    def start_tournament(self, tournament_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        if runtime.state == "running":
            return runtime
        runtime.state = "running"
        runtime.countdown_started_at = None
        runtime.engine.start_hand()

        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            tournament.state = "running"
            tournament.started_at = datetime.utcnow()
            tournament.updated_at = datetime.utcnow()
            db.add(models.ActionLogDB(tournament_id=tournament_id, event_type="tournament_started"))
        finally:
            db.close()
        self.persist_runtime(runtime)
        return runtime

    def finish_tournament(self, tournament_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        if runtime.state == "finished":
            return runtime
        runtime.state = "finished"
        winners = runtime.engine.result["winners"] if runtime.engine.result else runtime.engine.active_player_ids()
        winner_id = winners[0] if winners else None

        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            entries = db.query(models.TournamentEntryDB).filter(models.TournamentEntryDB.tournament_id == tournament_id).all()
            tournament.state = "finished"
            tournament.finished_at = datetime.utcnow()
            tournament.winner_player_id = winner_id
            tournament.updated_at = datetime.utcnow()

            ranked = sorted(
                entries,
                key=lambda entry: runtime.engine.players.get(entry.player_id, {}).get("stack", 0),
                reverse=True,
            )
            for index, entry in enumerate(ranked, start=1):
                final_stack = runtime.engine.players.get(entry.player_id, {}).get("stack", 0)
                entry.finish_position = index
                entry.stack = final_stack
                entry.status = "winner" if entry.player_id == winner_id else "eliminated"
                player = db.query(models.PlayerDB).filter(models.PlayerDB.id == entry.player_id).first()
                if player and final_stack > 0:
                    player.chip_balance += final_stack
            db.add(models.ActionLogDB(tournament_id=tournament_id, player_id=winner_id, event_type="tournament_finished"))
            db.commit()
        finally:
            db.close()

# 🔥 THE WEB3 PAYOUT TRIGGER 🔥
        if settings.enable_onchain_payout and winner_id:
            wallet_to_pay = winner_id
            
            # 1. Fetch the winner's actual MetaMask wallet address from the database
            db_payout = SessionLocal()
            try:
                winner_record = db_payout.query(models.PlayerDB).filter(models.PlayerDB.id == winner_id).first()
                if winner_record and getattr(winner_record, 'wallet_address', None):
                    wallet_to_pay = winner_record.wallet_address
            finally:
                db_payout.close()

            # 2. If they have a connected MetaMask, tell the Smart Contract to pay them!
            if wallet_to_pay and wallet_to_pay.startswith("0x"):
                blockchain.execute_onchain_payout(tournament_id, wallet_to_pay)
                
        return runtime
        
    def mark_connected(self, tournament_id: str, player_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        runtime.player_disconnects.pop(player_id, None)
        db = SessionLocal()
        try:
            presence = (
                db.query(models.TournamentPresenceDB)
                .filter(
                    models.TournamentPresenceDB.tournament_id == tournament_id,
                    models.TournamentPresenceDB.player_id == player_id,
                )
                .first()
            )
            if not presence:
                presence = models.TournamentPresenceDB(tournament_id=tournament_id, player_id=player_id, connected=True)
                db.add(presence)
            else:
                presence.connected = True
                presence.last_seen_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()

    def mark_disconnected(self, tournament_id: str, player_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        runtime.player_disconnects[player_id] = time.time()
        runtime.engine.mark_disconnected(player_id)
        db = SessionLocal()
        try:
            presence = (
                db.query(models.TournamentPresenceDB)
                .filter(
                    models.TournamentPresenceDB.tournament_id == tournament_id,
                    models.TournamentPresenceDB.player_id == player_id,
                )
                .first()
            )
            if presence:
                presence.connected = False
                presence.last_seen_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()

    def persist_runtime(self, runtime: TournamentRuntime):
        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
            if tournament:
                tournament.state = runtime.state
                tournament.updated_at = datetime.utcnow()
            entries = db.query(models.TournamentEntryDB).filter(models.TournamentEntryDB.tournament_id == runtime.tournament_id).all()
            for entry in entries:
                pdata = runtime.engine.players.get(entry.player_id)
                if pdata:
                    entry.stack = pdata["stack"]
                    entry.status = "eliminated" if pdata["eliminated"] else ("active" if runtime.state == "running" else "joined")
            db.commit()
        finally:
            db.close()

    def log_event(self, tournament_id: str, player_id: Optional[str], event_type: str, payload: Optional[dict] = None):
        db = SessionLocal()
        try:
            db.add(
                models.ActionLogDB(
                    tournament_id=tournament_id,
                    player_id=player_id,
                    event_type=event_type,
                    payload=json.dumps(payload or {}),
                )
            )
            db.commit()
        finally:
            db.close()

    def _maybe_start_countdown(self, runtime: TournamentRuntime, db):
        seated_count = len([pid for pid in runtime.engine.seats if pid])
        if seated_count >= settings.min_players_to_start and runtime.state == "registering":
            runtime.state = "countdown"
            runtime.countdown_started_at = time.time()
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
            tournament.state = "countdown"
            tournament.updated_at = datetime.utcnow()
            db.add(models.ActionLogDB(tournament_id=runtime.tournament_id, event_type="countdown_started"))
            db.commit()

    def _maybe_reset_countdown(self, runtime: TournamentRuntime, db):
        seated_count = len([pid for pid in runtime.engine.seats if pid])
        if seated_count < settings.min_players_to_start:
            runtime.state = "registering"
            runtime.countdown_started_at = None
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
            tournament.state = "registering"
            tournament.updated_at = datetime.utcnow()
            db.add(models.ActionLogDB(tournament_id=runtime.tournament_id, event_type="countdown_reset"))
            db.commit()
