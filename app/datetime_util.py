"""Belgrade local time — used for all dates shown in the app."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

APP_TIMEZONE = ZoneInfo("Europe/Belgrade")


def now_local() -> str:
    """Current time in Belgrade as YYYY-MM-DD HH:MM:SS."""
    return datetime.now(APP_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S")


def parse_local_dt(dt_str: str) -> datetime:
    dt = datetime.fromisoformat(dt_str.replace(" ", "T"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=APP_TIMEZONE)
    return dt.astimezone(APP_TIMEZONE)


def local_date(dt_str: str | None) -> str | None:
    """YYYY-MM-DD in Belgrade for a stored timestamp string."""
    if not dt_str:
        return None
    return parse_local_dt(dt_str).strftime("%Y-%m-%d")


def add_days_local(days: int, *, from_dt: datetime | None = None) -> str:
    """Return Belgrade local timestamp `days` after `from_dt` (default: now)."""
    base = from_dt or datetime.now(APP_TIMEZONE)
    return (base + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def days_until(dt_str: str | None) -> int | None:
    """Whole days remaining until `dt_str`, or 0 if past. None if no date."""
    if not dt_str:
        return None
    delta = parse_local_dt(dt_str) - datetime.now(APP_TIMEZONE)
    if delta.total_seconds() <= 0:
        return 0
    return delta.days + (1 if delta.seconds or delta.microseconds else 0)


def utc_naive_to_local_str(dt_str: str) -> str:
    """Convert legacy UTC naive SQLite timestamps to Belgrade local."""
    dt = datetime.fromisoformat(dt_str.replace(" ", "T")).replace(tzinfo=timezone.utc)
    return dt.astimezone(APP_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S")
