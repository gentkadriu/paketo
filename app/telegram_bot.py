"""Telegram notifications for scheduled AKS tracking."""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import timedelta
from typing import Any

import httpx

from app.database import get_connection
from app.datetime_util import now_local, parse_local_dt
from app.status import label_for
from app.tracking_schedule import TRACKING_SCHEDULE_LABEL

logger = logging.getLogger("posta.telegram")

NOTABLE_STATUSES = frozenset({
    "delivered",
    "returned",
    "rejected",
    "return_pending",
    "returned_to_warehouse",
    "delivery_canceled",
    "out_for_delivery",
    "in_transit",
    "in_warehouse",
})
LINK_TOKEN_TTL = timedelta(minutes=30)
DEFAULT_TELEGRAM_USER = "auloni"


def bot_configured() -> bool:
    return bool(os.environ.get("TELEGRAM_BOT_TOKEN", "").strip())


def webhook_secret() -> str:
    explicit = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
    if explicit:
        return explicit
    base = os.environ.get("POSTA_SECRET", "posta-dev-secret-change-in-production")
    return hashlib.sha256(f"telegram:{base}".encode()).hexdigest()[:32]


def _api_url(method: str) -> str:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    return f"https://api.telegram.org/bot{token}/{method}"


def get_bot_username() -> str | None:
    if not bot_configured():
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(_api_url("getMe"))
            resp.raise_for_status()
            data = resp.json()
            if data.get("ok"):
                return data["result"].get("username")
    except Exception as exc:
        logger.warning("Telegram getMe failed: %s", exc)
    return None


def send_message(chat_id: int | str, text: str) -> bool:
    if not bot_configured() or not chat_id:
        return False
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                _api_url("sendMessage"),
                json={
                    "chat_id": chat_id,
                    "text": text[:4096],
                    "disable_web_page_preview": True,
                },
            )
            resp.raise_for_status()
            return bool(resp.json().get("ok"))
    except Exception as exc:
        logger.warning("Telegram send failed for chat %s: %s", chat_id, exc)
        return False


def generate_link_token(conn, user_id: int) -> str:
    token = secrets.token_urlsafe(12)
    conn.execute(
        """
        UPDATE users
        SET telegram_link_token = ?, telegram_link_token_at = ?
        WHERE id = ?
        """,
        (token, now_local(), user_id),
    )
    return token


def unlink_telegram(conn, user_id: int) -> None:
    conn.execute(
        """
        UPDATE users
        SET telegram_chat_id = NULL,
            telegram_link_token = NULL,
            telegram_link_token_at = NULL,
            telegram_enabled = 0
        WHERE id = ?
        """,
        (user_id,),
    )


def bootstrap_telegram_from_env(conn) -> None:
    """Apply TELEGRAM_CHAT_ID from server env to the configured Paketo user (default: auloni)."""
    chat_raw = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not chat_raw or not bot_configured():
        return
    try:
        chat_id = int(chat_raw)
    except ValueError:
        logger.warning("TELEGRAM_CHAT_ID is not a valid integer: %s", chat_raw)
        return
    username = os.environ.get("TELEGRAM_USER", DEFAULT_TELEGRAM_USER).strip().lower()
    cur = conn.execute(
        """
        UPDATE users
        SET telegram_chat_id = ?, telegram_enabled = 1
        WHERE lower(username) = ?
        """,
        (chat_id, username),
    )
    if cur.rowcount:
        group = os.environ.get("TELEGRAM_GROUP_NAME", "").strip()
        logger.info(
            "Telegram group %s linked to @%s (chat_id=%s)",
            group or chat_id,
            username,
            chat_id,
        )


def telegram_settings(conn, user_id: int) -> dict[str, Any]:
    bootstrap_telegram_from_env(conn)
    row = conn.execute(
        """
        SELECT telegram_chat_id, telegram_enabled, telegram_link_token,
               telegram_link_token_at, username
        FROM users WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    if not row:
        return {"configured": bot_configured(), "linked": False, "enabled": False}
    linked = row["telegram_chat_id"] is not None
    token_valid = False
    if row["telegram_link_token"] and row["telegram_link_token_at"]:
        try:
            created = parse_local_dt(row["telegram_link_token_at"])
            token_valid = created + LINK_TOKEN_TTL >= parse_local_dt(now_local())
        except (TypeError, ValueError):
            token_valid = False
    group_name = os.environ.get("TELEGRAM_GROUP_NAME", "").strip()
    return {
        "configured": bot_configured(),
        "linked": linked,
        "enabled": bool(row["telegram_enabled"]) if linked else False,
        "bot_username": get_bot_username() if bot_configured() else None,
        "link_pending": bool(row["telegram_link_token"]) and token_valid,
        "group_name": group_name or None,
        "is_group": linked and int(row["telegram_chat_id"] or 0) < 0,
    }


def _link_token_valid(row) -> bool:
    if not row or not row["telegram_link_token"] or not row["telegram_link_token_at"]:
        return False
    try:
        created = parse_local_dt(row["telegram_link_token_at"])
        return created + LINK_TOKEN_TTL >= parse_local_dt(now_local())
    except (TypeError, ValueError):
        return False


def handle_start_command(chat_id: int, token: str | None) -> str:
    if not token:
        return (
            "Paketo tracking bot.\n\n"
            "Open Paketo → Settings → Telegram and tap Connect to get your link code."
        )
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, username, telegram_link_token, telegram_link_token_at
            FROM users
            WHERE telegram_link_token = ?
            """,
            (token.strip(),),
        ).fetchone()
        if not row or not _link_token_valid(row):
            return "Link code expired or invalid. Generate a new one in Paketo Settings."
        conn.execute(
            """
            UPDATE users
            SET telegram_chat_id = ?,
                telegram_enabled = 1,
                telegram_link_token = NULL,
                telegram_link_token_at = NULL
            WHERE id = ?
            """,
            (chat_id, row["id"]),
        )
        username = row["username"] or "user"
    send_message(chat_id, f"Connected to Paketo account @{username}.")
    return f"Linked chat {chat_id} to user {row['id']}"


def process_webhook_update(update: dict) -> None:
    message = update.get("message") or update.get("edited_message") or {}
    text = (message.get("text") or "").strip()
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not chat_id or not text.startswith("/start"):
        return
    parts = text.split(maxsplit=1)
    token = parts[1].strip() if len(parts) > 1 else None
    reply = handle_start_command(chat_id, token)
    logger.info("Telegram /start: %s", reply)


def setup_webhook(public_base_url: str) -> None:
    if not bot_configured():
        return
    secret = webhook_secret()
    url = f"{public_base_url.rstrip('/')}/api/telegram/webhook/{secret}"
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(
                _api_url("setWebhook"),
                json={"url": url, "allowed_updates": ["message"]},
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("ok"):
                logger.info("Telegram webhook set: %s", url)
            else:
                logger.warning("Telegram setWebhook failed: %s", data)
    except Exception as exc:
        logger.warning("Telegram webhook setup failed: %s", exc)


STATUS_EMOJI: dict[str, str] = {
    "delivered": "🟢",
    "rejected": "🔴",
    "returned": "🔴",
    "delivery_canceled": "🔴",
    "return_pending": "🟠",
    "returned_to_warehouse": "🟠",
    "out_for_delivery": "🔵",
    "in_transit": "🔵",
    "in_warehouse": "⚪",
    "sent": "⚪",
    "registered": "⚪",
    "unknown": "⚪",
}

STATUS_SUMMARY: dict[str, str] = {
    "delivered": "delivered",
    "rejected": "rejected",
    "returned": "returned",
    "delivery_canceled": "canceled",
    "return_pending": "return pending",
    "returned_to_warehouse": "warehouse",
    "out_for_delivery": "out for delivery",
    "in_transit": "in transit",
    "in_warehouse": "at warehouse",
    "sent": "sent",
    "registered": "registered",
    "unknown": "updated",
}


def _status_emoji(status: str) -> str:
    return STATUS_EMOJI.get(status, "⚪")


def _status_summary_label(status: str) -> str:
    return STATUS_SUMMARY.get(status, label_for(status).lower())


def format_change_line(change: dict) -> str:
    """One compact line: emoji + name (+ short outcome when not delivered)."""
    name = (change.get("full_name") or "Order").strip()
    new_status = change.get("new_status") or ""
    emoji = _status_emoji(new_status)
    if new_status == "delivered":
        return f"{emoji} {name}"
    return f"{emoji} {name} — {_status_summary_label(new_status)}"


def count_statuses(statuses: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for status in statuses:
        key = status or "unknown"
        counts[key] = counts.get(key, 0) + 1
    return counts


def fetch_status_counts(
    conn,
    *,
    user_id: int | None = None,
    batch_id: int | None = None,
) -> dict[str, int]:
    if batch_id is not None:
        rows = conn.execute(
            """
            SELECT lifecycle_status
            FROM leads
            WHERE batch_id = ?
              AND order_id IS NOT NULL AND order_id != ''
            """,
            (batch_id,),
        ).fetchall()
    elif user_id is not None:
        rows = conn.execute(
            """
            SELECT l.lifecycle_status
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND b.status = 'tracking'
              AND l.order_id IS NOT NULL AND l.order_id != ''
            """,
            (user_id,),
        ).fetchall()
    else:
        return {}
    return count_statuses([(row["lifecycle_status"] or "unknown") for row in rows])


def _format_status_counts(counts: dict[str, int]) -> str:
    """'🟢 38 delivered · 🔵 3 in transit · 🟠 2 warehouse'."""
    priority = (
        "delivered",
        "out_for_delivery",
        "in_transit",
        "in_warehouse",
        "returned_to_warehouse",
        "return_pending",
        "rejected",
        "returned",
        "delivery_canceled",
        "sent",
        "registered",
        "unknown",
    )
    parts: list[str] = []
    seen: set[str] = set()
    for status in priority:
        count = counts.get(status, 0)
        if count:
            parts.append(f"{_status_emoji(status)} {count} {_status_summary_label(status)}")
            seen.add(status)
    for status, count in counts.items():
        if status not in seen and count:
            parts.append(f"{_status_emoji(status)} {count} {_status_summary_label(status)}")
    return " · ".join(parts)


def _format_change_counts(notable: list[dict]) -> str:
    counts = count_statuses([c.get("new_status") or "unknown" for c in notable])
    return _format_status_counts(counts)


def format_run_message(
    changes: list[dict],
    ok: int,
    total: int,
    *,
    trigger: str = "scheduled",
    batch_name: str | None = None,
    status_counts: dict[str, int] | None = None,
) -> str:
    notable = [
        c for c in changes
        if c.get("old_status") != c.get("new_status")
    ]
    group = os.environ.get("TELEGRAM_GROUP_NAME", "").strip()
    title = f"Paketo · {group}" if group else "Paketo"
    if trigger == "manual":
        batch_label = f' "{batch_name}"' if batch_name else ""
        run_line = f"📦 Manual{batch_label} · {ok}/{total}"
    else:
        run_line = f"⏱ Scheduled ({TRACKING_SCHEDULE_LABEL}) · {ok}/{total}"
    lines = [title, run_line]

    if total == 0:
        lines.append("Nothing to track.")
        return "\n".join(lines)

    if status_counts:
        summary = _format_status_counts(status_counts)
        if summary:
            lines.append(summary)

    if not notable:
        if not status_counts:
            lines.append("✓ No changes.")
        return "\n".join(lines)

    lines.append(f"+{len(notable)} new: {_format_change_counts(notable)}")

    max_lines = 12
    if len(notable) <= max_lines:
        lines.extend(format_change_line(c) for c in notable)
    else:
        for change in notable[:max_lines]:
            lines.append(format_change_line(change))
        lines.append(f"… +{len(notable) - max_lines} more")

    return "\n".join(lines)


def _telegram_targets(conn) -> list:
    bootstrap_telegram_from_env(conn)
    return conn.execute(
        """
        SELECT id, telegram_chat_id
        FROM users
        WHERE telegram_chat_id IS NOT NULL AND telegram_enabled = 1
        """
    ).fetchall()


def notify_user_tracking_run(
    user_id: int,
    changes: list[dict],
    ok: int,
    total: int,
    *,
    trigger: str = "scheduled",
    batch_name: str | None = None,
    batch_id: int | None = None,
) -> None:
    if not bot_configured() or total == 0:
        return
    with get_connection() as conn:
        rows = _telegram_targets(conn)
        status_counts = fetch_status_counts(
            conn,
            batch_id=batch_id if trigger == "manual" else None,
            user_id=user_id if trigger != "manual" else None,
        )
    for row in rows:
        if row["id"] != user_id:
            continue
        msg = format_run_message(
            changes,
            ok,
            total,
            trigger=trigger,
            batch_name=batch_name,
            status_counts=status_counts,
        )
        send_message(row["telegram_chat_id"], msg)
        return


def notify_users_scheduled_summary(
    changes_by_user: dict[int, list[dict]],
    tracked_by_user: dict[int, int],
) -> None:
    """Send per-user summary after a scheduled tracking run."""
    if not bot_configured():
        return
    for uid, user_tracked in tracked_by_user.items():
        if user_tracked == 0:
            continue
        notify_user_tracking_run(
            uid,
            changes_by_user.get(uid, []),
            user_tracked,
            user_tracked,
            trigger="scheduled",
        )
