import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

import blockchain
import models
from config import settings
from database import SessionLocal
from engine import PokerEngine

logger = logging.getLogger("poker.tournament")


def utcnow() -> datetime:
    return datetime.utcnow()


def default_blind_schedule() -> list[dict]:
    return [
        {"small_blind": 20, "big_blind": 40},
        {"small_blind": 30, "big_blind": 60},
        {"small_blind": 40, "big_blind": 80},
        {"small_blind": 60, "big_blind": 120},
        {"small_blind": 80, "big_blind": 160},
        {"small_blind": 100, "big_blind": 200},
        {"small_blind": 150, "big_blind": 300},
        {"small_blind": 200, "big_blind": 400},
    ]


def normalize_blind_schedule(blind_schedule_json: Optional[str]) -> list[dict]:
    if not blind_schedule_json:
        return default_blind_schedule()
    try:
        parsed = json.loads(blind_schedule_json)
        schedule = []
        for level in parsed:
            small_blind = max(1, int(level.get("small_blind", 0)))
            big_blind = max(small_blind, int(level.get("big_blind", small_blind * 2)))
            schedule.append(
                {
                    "small_blind": small_blind,
                    "big_blind": big_blind,
                    "ante": max(0, int(level.get("ante", 0))),
                }
            )
        return schedule or default_blind_schedule()
    except (TypeError, ValueError, json.JSONDecodeError):
        return default_blind_schedule()


def serialize_blind_schedule(blind_schedule: Optional[list[dict]]) -> str:
    return json.dumps(blind_schedule or default_blind_schedule())


def to_timestamp(value: Optional[datetime]) -> Optional[int]:
    return int(value.timestamp()) if value else None


class TournamentRuntime:
    def __init__(self, tournament: models.TournamentDB):
        self.tournament_id = tournament.id
        self.title = tournament.title
        self.desc = tournament.desc or ""
        self.category = tournament.category
        self.mode = tournament.mode
        self.access_policy = tournament.access_policy
        self.required_nft = tournament.required_nft
        self.buy_in_chips = tournament.buy_in_chips
        self.starting_stack = tournament.starting_stack or tournament.buy_in_chips
        self.max_seats = tournament.max_seats
        self.min_players = tournament.min_players
        self.asset_symbol = tournament.asset_symbol or "S"
        self.asset_address = tournament.asset_address
        self.asset_decimals = tournament.asset_decimals or 0
        self.creator_player_id = tournament.creator_player_id
        self.creator_wallet_address = tournament.creator_wallet_address
        self.creator_nft_contract = tournament.creator_nft_contract
        self.scheduled_start_at = tournament.scheduled_start_at
        self.registration_opens_at = tournament.registration_opens_at
        self.late_registration_ends_at = tournament.late_registration_ends_at
        self.is_recurring = tournament.is_recurring
        self.recurrence_rule = tournament.recurrence_rule
        self.blind_level_duration_sec = max(30, tournament.blind_level_duration_sec or 300)
        self.blind_schedule = normalize_blind_schedule(tournament.blind_schedule_json)
        self.engine = PokerEngine(
            tournament.id,
            mode=tournament.mode,
            max_seats=tournament.max_seats,
            small_blind=self.blind_schedule[0]["small_blind"],
            big_blind=self.blind_schedule[0]["big_blind"],
        )
        self.engine.configure_blind_schedule(self.blind_schedule)
        self.state = tournament.state
        self.countdown_started_at: Optional[float] = None
        self.started_at: Optional[float] = tournament.started_at.timestamp() if tournament.started_at else None
        self.player_disconnects: Dict[str, float] = {}

    def registration_is_open(self) -> bool:
        return self.registration_opens_at is None or utcnow() >= self.registration_opens_at

    def scheduled_countdown_remaining(self) -> int:
        if self.scheduled_start_at is None:
            return 0
        return max(0, int((self.scheduled_start_at - utcnow()).total_seconds()))

    def countdown_remaining(self) -> int:
        if self.state != "countdown":
            return 0
        if self.scheduled_start_at is not None:
            return self.scheduled_countdown_remaining()
        if self.countdown_started_at is None:
            return 0
        return max(0, settings.countdown_seconds - int(time.time() - self.countdown_started_at))

    def next_level_in_sec(self) -> Optional[int]:
        if self.started_at is None:
            return None
        elapsed = int(time.time() - self.started_at)
        return max(0, self.blind_level_duration_sec - (elapsed % self.blind_level_duration_sec))

    def set_blind_level_from_elapsed(self):
        if self.started_at is None:
            self.engine.apply_blind_level(0)
            return
        elapsed = max(0, int(time.time() - self.started_at))
        level_index = min(elapsed // self.blind_level_duration_sec, len(self.blind_schedule) - 1)
        self.engine.apply_blind_level(level_index)

    def to_summary(self) -> dict:
        seated_players = [pid for pid in self.engine.seats if pid]
        active_count = len([pid for pid in seated_players if self.engine.players.get(pid, {}).get("stack", 0) > 0])
        return {
            "id": self.tournament_id,
            "title": self.title,
            "desc": self.desc,
            "category": self.category,
            "mode": self.mode,
            "state": self.state,
            "access_policy": self.access_policy,
            "buy_in_chips": self.buy_in_chips,
            "starting_stack": self.starting_stack,
            "max_seats": self.max_seats,
            "min_players": self.min_players,
            "seated_count": len(seated_players),
            "active_count": active_count,
            "countdown_remaining": self.countdown_remaining(),
            "required_nft": self.required_nft,
            "creator_player_id": self.creator_player_id,
            "creator_wallet_address": self.creator_wallet_address,
            "creator_nft_contract": self.creator_nft_contract,
            "asset_symbol": self.asset_symbol,
            "asset_address": self.asset_address,
            "asset_decimals": self.asset_decimals,
            "scheduled_start_at": self.scheduled_start_at.isoformat() if self.scheduled_start_at else None,
            "registration_opens_at": self.registration_opens_at.isoformat() if self.registration_opens_at else None,
            "late_registration_ends_at": self.late_registration_ends_at.isoformat() if self.late_registration_ends_at else None,
            "blind_level_duration_sec": self.blind_level_duration_sec,
            "blind_schedule": self.blind_schedule,
            "blind_level_index": self.engine.blind_level_index,
            "next_blind_in_sec": self.next_level_in_sec(),
            "is_recurring": self.is_recurring,
            "recurrence_rule": self.recurrence_rule,
        }

    def to_table_state(self, viewer_id: Optional[str] = None) -> dict:
        state = self.engine.get_game_state(viewer_id=viewer_id)
        state.update(
            {
                "tournament_id": self.tournament_id,
                "title": self.title,
                "desc": self.desc,
                "category": self.category,
                "tournament_state": self.state,
                "countdown_remaining": self.countdown_remaining(),
                "turn_timeout_sec": settings.turn_timeout_sec,
                "buy_in_chips": self.buy_in_chips,
                "starting_stack": self.starting_stack,
                "asset_symbol": self.asset_symbol,
                "asset_address": self.asset_address,
                "access_policy": self.access_policy,
                "scheduled_start_at": to_timestamp(self.scheduled_start_at),
                "late_registration_ends_at": to_timestamp(self.late_registration_ends_at),
                "blind_level_duration_sec": self.blind_level_duration_sec,
                "next_blind_in_sec": self.next_level_in_sec(),
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
            self._ensure_asset_seed_data(db)
            defaults = [
                {
                    "id": "demo-sng-1",
                    "title": "Prototype Sit & Go",
                    "desc": "Quick six-max sit-and-go with a clean blind structure.",
                    "category": "tournament",
                    "mode": "tournament_sng",
                    "state": "registering",
                    "buy_in_chips": settings.buy_in_chips,
                    "starting_stack": settings.buy_in_chips * 2,
                    "asset_symbol": "S",
                },
                {
                    "id": "demo-scheduled-1",
                    "title": "Friday Builder Cup",
                    "desc": "A scheduled tournament with a published blind ladder and fixed buy-in.",
                    "category": "tournament",
                    "mode": "tournament_scheduled",
                    "state": "scheduled",
                    "buy_in_chips": 1500,
                    "starting_stack": 3000,
                    "asset_symbol": "S",
                    "scheduled_start_at": utcnow() + timedelta(minutes=20),
                    "registration_opens_at": utcnow(),
                },
            ]
            for config in defaults:
                tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == config["id"]).first()
                if tournament:
                    continue
                db.add(
                    models.TournamentDB(
                        id=config["id"],
                        title=config["title"],
                        desc=config["desc"],
                        category=config["category"],
                        mode=config["mode"],
                        state=config["state"],
                        access_policy="open",
                        buy_in_chips=config["buy_in_chips"],
                        starting_stack=config["starting_stack"],
                        max_seats=settings.max_seats,
                        min_players=settings.min_players_to_start,
                        blind_level_duration_sec=300,
                        blind_schedule_json=serialize_blind_schedule(default_blind_schedule()),
                        asset_symbol=config["asset_symbol"],
                        scheduled_start_at=config.get("scheduled_start_at"),
                        registration_opens_at=config.get("registration_opens_at"),
                    )
                )
            db.commit()
        finally:
            db.close()

    def _ensure_asset_seed_data(self, db):
        defaults = [
            {"symbol": "S", "asset_address": None, "decimals": 0, "chain_id": None},
            {"symbol": "USDC", "asset_address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "decimals": 6, "chain_id": 84532},
        ]
        for asset in defaults:
            existing = db.query(models.AssetWhitelistDB).filter(models.AssetWhitelistDB.symbol == asset["symbol"]).first()
            if existing:
                continue
            db.add(
                models.AssetWhitelistDB(
                    symbol=asset["symbol"],
                    asset_address=asset["asset_address"],
                    decimals=asset["decimals"],
                    chain_id=asset["chain_id"],
                    enabled=True,
                )
            )
        db.commit()

    def list_assets(self) -> list[dict]:
        db = SessionLocal()
        try:
            assets = (
                db.query(models.AssetWhitelistDB)
                .filter(models.AssetWhitelistDB.enabled.is_(True))
                .order_by(models.AssetWhitelistDB.symbol.asc())
                .all()
            )
            return [
                {
                    "symbol": asset.symbol,
                    "asset_address": asset.asset_address,
                    "chain_id": asset.chain_id,
                    "decimals": asset.decimals,
                    "creator_nft_contract": asset.creator_nft_contract,
                }
                for asset in assets
            ]
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

            runtime = TournamentRuntime(tournament)
            entries = (
                db.query(models.TournamentEntryDB)
                .filter(models.TournamentEntryDB.tournament_id == tournament.id)
                .order_by(models.TournamentEntryDB.seat_index.asc())
                .all()
            )
            for entry in entries:
                runtime.engine.add_player(entry.player_id, entry.stack or runtime.starting_stack, seat_index=entry.seat_index)
                player = runtime.engine.players[entry.player_id]
                player["eliminated"] = entry.status == "eliminated"
                player["active"] = entry.status == "active"
                player["folded"] = False
                if entry.status == "eliminated":
                    player["stack"] = 0
            runtime.set_blind_level_from_elapsed()
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
                    continue
                summary_runtime = TournamentRuntime(tournament)
                seated_entries = (
                    db.query(models.TournamentEntryDB)
                    .filter(models.TournamentEntryDB.tournament_id == tournament.id)
                    .count()
                )
                summary = summary_runtime.to_summary()
                summary["seated_count"] = seated_entries
                summary["active_count"] = seated_entries
                items.append(summary)
            return items
        finally:
            db.close()

    def create_tournament(self, config: dict) -> models.TournamentDB:
        blind_schedule = config.get("blind_schedule") or default_blind_schedule()
        db = SessionLocal()
        try:
            asset = (
                db.query(models.AssetWhitelistDB)
                .filter(
                    models.AssetWhitelistDB.symbol == config["asset_symbol"],
                    models.AssetWhitelistDB.enabled.is_(True),
                )
                .first()
            )
            if not asset:
                raise ValueError(f"Asset {config['asset_symbol']} is not enabled.")

            tournament = models.TournamentDB(
                id=config["id"],
                title=config["title"],
                desc=config.get("desc"),
                category=config.get("category", "tournament"),
                mode=config.get("mode", "tournament_scheduled"),
                state=config.get("state", "registering"),
                access_policy="nft" if config.get("required_nft") else "open",
                buy_in_chips=config["buy_in_chips"],
                starting_stack=config.get("starting_stack", config["buy_in_chips"]),
                max_seats=config.get("max_seats", settings.max_seats),
                min_players=config.get("min_players", settings.min_players_to_start),
                blind_level_duration_sec=config.get("blind_level_duration_sec", 300),
                blind_schedule_json=serialize_blind_schedule(blind_schedule),
                required_nft=config.get("required_nft"),
                creator_player_id=config.get("creator_player_id"),
                creator_wallet_address=config.get("creator_wallet_address"),
                creator_nft_contract=config.get("creator_nft_contract"),
                asset_symbol=asset.symbol,
                asset_address=asset.asset_address,
                asset_decimals=asset.decimals,
                scheduled_start_at=config.get("scheduled_start_at"),
                registration_opens_at=config.get("registration_opens_at"),
                late_registration_ends_at=config.get("late_registration_ends_at"),
                is_recurring=config.get("is_recurring", False),
                recurrence_rule=config.get("recurrence_rule"),
            )
            db.add(tournament)
            db.commit()
            db.refresh(tournament)
            return tournament
        finally:
            db.close()

    async def tick_runtime(self, runtime: TournamentRuntime):
        now = time.time()
        db = SessionLocal()
        try:
            self._maybe_open_registration(runtime, db)
            self._maybe_schedule_start(runtime, db, now)
            self._update_blind_level(runtime)
        finally:
            db.close()

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

    def join_tournament(self, tournament_id: str, player_id: str) -> tuple[TournamentRuntime, dict]:
        runtime = self.get_or_create_runtime(tournament_id)
        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            player = db.query(models.PlayerDB).filter(models.PlayerDB.id == player_id).first()
            if not tournament or not player:
                raise ValueError("Tournament or player not found.")
            if runtime.state not in {"scheduled", "registering", "countdown"}:
                raise ValueError("Tournament already started.")
            if not runtime.registration_is_open():
                raise ValueError("Registration is not open yet.")

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
                stack=tournament.starting_stack,
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
            runtime.engine.add_player(player_id, tournament.starting_stack, seat_index=seat_index)
            runtime.player_disconnects.pop(player_id, None)
            self._maybe_start_countdown(runtime, db)
            return runtime, {"tournament_id": tournament_id, "player_id": player_id, "seat_index": seat_index}
        finally:
            db.close()

    def leave_tournament(self, tournament_id: str, player_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        if runtime.state not in {"scheduled", "registering", "countdown"}:
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

    def start_tournament(self, tournament_id: str):
        runtime = self.get_or_create_runtime(tournament_id)
        if runtime.state == "running":
            return runtime
        runtime.state = "running"
        runtime.countdown_started_at = None
        runtime.started_at = time.time()
        runtime.set_blind_level_from_elapsed()
        runtime.engine.start_hand()

        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == tournament_id).first()
            tournament.state = "running"
            tournament.started_at = utcnow()
            tournament.updated_at = utcnow()
            db.add(models.ActionLogDB(tournament_id=tournament_id, event_type="tournament_started"))
            db.commit()
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
            tournament.finished_at = utcnow()
            tournament.winner_player_id = winner_id
            tournament.updated_at = utcnow()

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

        if settings.enable_onchain_payout and winner_id:
            wallet_to_pay = winner_id
            db_payout = SessionLocal()
            try:
                winner_record = db_payout.query(models.PlayerDB).filter(models.PlayerDB.id == winner_id).first()
                if winner_record and getattr(winner_record, "wallet_address", None):
                    wallet_to_pay = winner_record.wallet_address
            finally:
                db_payout.close()

            if wallet_to_pay and wallet_to_pay.startswith("0x"):
                blockchain.payout_winner(tournament_id, wallet_to_pay)

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
                presence.last_seen_at = utcnow()
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
                presence.last_seen_at = utcnow()
            db.commit()
        finally:
            db.close()

    def persist_runtime(self, runtime: TournamentRuntime):
        db = SessionLocal()
        try:
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
            if tournament:
                tournament.state = runtime.state
                tournament.updated_at = utcnow()
                if runtime.started_at:
                    tournament.started_at = datetime.utcfromtimestamp(runtime.started_at)
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

    def _maybe_open_registration(self, runtime: TournamentRuntime, db):
        if runtime.state == "scheduled" and runtime.registration_is_open():
            tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
            runtime.state = "registering"
            tournament.state = "registering"
            tournament.updated_at = utcnow()
            db.add(models.ActionLogDB(tournament_id=runtime.tournament_id, event_type="registration_opened"))
            db.commit()

    def _maybe_schedule_start(self, runtime: TournamentRuntime, db, now: float):
        seated_count = len([pid for pid in runtime.engine.seats if pid])
        enough_players = seated_count >= runtime.min_players

        if runtime.scheduled_start_at is not None:
            remaining = runtime.scheduled_countdown_remaining()
            if enough_players and remaining <= settings.countdown_seconds and runtime.state in {"registering", "scheduled"}:
                runtime.state = "countdown"
                tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
                tournament.state = "countdown"
                tournament.updated_at = utcnow()
                db.commit()
            if enough_players and remaining <= 0 and runtime.state in {"countdown", "registering"}:
                self.start_tournament(runtime.tournament_id)
            return

        if runtime.state == "countdown" and runtime.countdown_started_at is not None:
            if now - runtime.countdown_started_at >= settings.countdown_seconds:
                self.start_tournament(runtime.tournament_id)

    def _maybe_start_countdown(self, runtime: TournamentRuntime, db):
        seated_count = len([pid for pid in runtime.engine.seats if pid])
        if seated_count < runtime.min_players:
            return

        tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
        if runtime.scheduled_start_at is not None:
            runtime.state = "countdown" if runtime.scheduled_countdown_remaining() <= settings.countdown_seconds else "registering"
            tournament.state = runtime.state
            tournament.updated_at = utcnow()
            db.commit()
            return

        if runtime.state == "registering":
            runtime.state = "countdown"
            runtime.countdown_started_at = time.time()
            tournament.state = "countdown"
            tournament.updated_at = utcnow()
            db.add(models.ActionLogDB(tournament_id=runtime.tournament_id, event_type="countdown_started"))
            db.commit()

    def _maybe_reset_countdown(self, runtime: TournamentRuntime, db):
        seated_count = len([pid for pid in runtime.engine.seats if pid])
        if seated_count >= runtime.min_players:
            return
        tournament = db.query(models.TournamentDB).filter(models.TournamentDB.id == runtime.tournament_id).first()
        runtime.state = "registering" if runtime.registration_is_open() else "scheduled"
        runtime.countdown_started_at = None
        tournament.state = runtime.state
        tournament.updated_at = utcnow()
        db.add(models.ActionLogDB(tournament_id=runtime.tournament_id, event_type="countdown_reset"))
        db.commit()

    def _update_blind_level(self, runtime: TournamentRuntime):
        if runtime.state != "running" or runtime.started_at is None:
            return
        elapsed = max(0, int(time.time() - runtime.started_at))
        level_index = min(elapsed // runtime.blind_level_duration_sec, len(runtime.blind_schedule) - 1)
        if level_index != runtime.engine.blind_level_index:
            runtime.engine.apply_blind_level(level_index)
