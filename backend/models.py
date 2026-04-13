from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from database import Base


def utcnow():
    return datetime.utcnow()


class PlayerDB(Base):
    __tablename__ = "players"

    id = Column(String, primary_key=True, index=True)
    display_name = Column(String, nullable=False)
    reconnect_token = Column(String, nullable=False, unique=True, index=True)
    chip_balance = Column(Integer, default=10000, nullable=False)
    wallet_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class TournamentDB(Base):
    __tablename__ = "tournaments"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    desc = Column(Text, nullable=True)
    category = Column(String, nullable=False, default="tournament")
    mode = Column(String, nullable=False, default="tournament_sng")
    state = Column(String, nullable=False, default="registering")
    access_policy = Column(String, nullable=False, default="open")
    buy_in_chips = Column(Integer, nullable=False, default=1000)
    starting_stack = Column(Integer, nullable=False, default=1000)
    max_seats = Column(Integer, nullable=False, default=6)
    min_players = Column(Integer, nullable=False, default=2)
    blind_level_duration_sec = Column(Integer, nullable=False, default=300)
    blind_schedule_json = Column(Text, nullable=True)
    required_nft = Column(String, nullable=True)
    creator_player_id = Column(String, nullable=True)
    creator_wallet_address = Column(String, nullable=True)
    creator_nft_contract = Column(String, nullable=True)
    asset_symbol = Column(String, nullable=False, default="S")
    asset_address = Column(String, nullable=True)
    asset_decimals = Column(Integer, nullable=False, default=0)
    scheduled_start_at = Column(DateTime, nullable=True)
    registration_opens_at = Column(DateTime, nullable=True)
    late_registration_ends_at = Column(DateTime, nullable=True)
    is_recurring = Column(Boolean, nullable=False, default=False)
    recurrence_rule = Column(String, nullable=True)
    winner_player_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)


class TournamentEntryDB(Base):
    __tablename__ = "tournament_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tournament_id = Column(String, index=True, nullable=False)
    player_id = Column(String, index=True, nullable=False)
    seat_index = Column(Integer, nullable=True)
    status = Column(String, nullable=False, default="joined")
    stack = Column(Integer, nullable=False, default=0)
    finish_position = Column(Integer, nullable=True)
    joined_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class ActionLogDB(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tournament_id = Column(String, index=True, nullable=False)
    player_id = Column(String, nullable=True)
    event_type = Column(String, nullable=False)
    payload = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class TournamentPresenceDB(Base):
    __tablename__ = "tournament_presence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tournament_id = Column(String, index=True, nullable=False)
    player_id = Column(String, index=True, nullable=False)
    connected = Column(Boolean, default=False, nullable=False)
    last_seen_at = Column(DateTime, default=utcnow, nullable=False)


class AssetWhitelistDB(Base):
    __tablename__ = "asset_whitelist"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String, nullable=False, unique=True, index=True)
    asset_address = Column(String, nullable=True)
    chain_id = Column(Integer, nullable=True)
    decimals = Column(Integer, nullable=False, default=0)
    enabled = Column(Boolean, nullable=False, default=True)
    creator_nft_contract = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
