from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String

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
    mode = Column(String, nullable=False, default="tournament_sng")
    state = Column(String, nullable=False, default="registering")
    buy_in_chips = Column(Integer, nullable=False, default=1000)
    max_seats = Column(Integer, nullable=False, default=6)
    min_players = Column(Integer, nullable=False, default=2)
    required_nft = Column(String, nullable=True)
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
