"""Belgrade local time — used for all dates shown in the app."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

APP_TIMEZONE = ZoneInfo("Europe/Belgrade")


def now_local() -> str:
    """Current time in Belgrade as YYYY-MM-DD HH:MM:SS."""
    return datetime.now(APP_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S")


def local_date(dt_str: str | None) -> str | None:
    """YYYY-MM-DD in Belgrade for a stored timestamp string."""
    if not dt_str:
        return None
    dt = datetime.fromisoformat(dt_str.replace(" ", "T"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=APP_TIMEZONE)
    return dt.astimezone(APP_TIMEZONE).strftime("%Y-%m-%d")


def utc_naive_to_local_str(dt_str: str) -> str:
    """Convert legacy UTC naive SQLite timestamps to Belgrade local."""
    dt = datetime.fromisoformat(dt_str.replace(" ", "T")).replace(tzinfo=timezone.utc)
    return dt.astimezone(APP_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S")
