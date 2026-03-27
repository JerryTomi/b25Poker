import os
from dataclasses import dataclass


def env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    demo_mode: bool = env_flag("DEMO_MODE", True)
    enable_wallet_connect: bool = env_flag("ENABLE_WALLET_CONNECT", True)
    enable_onchain_payout: bool = env_flag("ENABLE_ONCHAIN_PAYOUT", False)
    buy_in_chips: int = int(os.getenv("BUY_IN_CHIPS", "1000"))
    min_players_to_start: int = int(os.getenv("MIN_PLAYERS_TO_START", "2"))
    max_seats: int = int(os.getenv("MAX_SEATS", "6"))
    countdown_seconds: int = int(os.getenv("COUNTDOWN_SECONDS", "10"))
    reconnect_grace_sec: int = int(os.getenv("RECONNECT_GRACE_SEC", "45"))
    turn_timeout_sec: int = int(os.getenv("TURN_TIMEOUT_SEC", "25"))
    cors_origins_raw: str = os.getenv("CORS_ORIGINS", "*")

    @property
    def cors_origins(self) -> list[str]:
        if self.cors_origins_raw.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


settings = Settings()


def validate_settings() -> list[str]:
    issues = []
    if settings.min_players_to_start < 2:
        issues.append("MIN_PLAYERS_TO_START must be at least 2.")
    if settings.max_seats < settings.min_players_to_start:
        issues.append("MAX_SEATS must be greater than or equal to MIN_PLAYERS_TO_START.")
    if settings.buy_in_chips <= 0:
        issues.append("BUY_IN_CHIPS must be greater than 0.")
    if settings.turn_timeout_sec < 5:
        issues.append("TURN_TIMEOUT_SEC should be at least 5 seconds for a playable demo.")
    return issues
