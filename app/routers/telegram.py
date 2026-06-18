"""Telegram bot settings and webhook."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.database import get_connection
from app.deps import User
from app.telegram_bot import (
    bot_configured,
    generate_link_token,
    get_bot_username,
    process_webhook_update,
    send_message,
    telegram_settings,
    unlink_telegram,
    webhook_secret,
)

router = APIRouter(prefix="/api", tags=["telegram"])


class TelegramEnableRequest(BaseModel):
    enabled: bool


@router.get("/settings/telegram")
def get_telegram_settings(user: User):
    with get_connection() as conn:
        return telegram_settings(conn, user["id"])


@router.post("/settings/telegram/link")
def create_telegram_link(user: User):
    if not bot_configured():
        raise HTTPException(
            status_code=503,
            detail="Telegram bot is not configured on this server (TELEGRAM_BOT_TOKEN).",
        )
    with get_connection() as conn:
        token = generate_link_token(conn, user["id"])
    username = get_bot_username()
    link = f"https://t.me/{username}?start={token}" if username else None
    return {
        "token": token,
        "bot_username": username,
        "link": link,
        "expires_minutes": 30,
    }


@router.post("/settings/telegram/unlink")
def disconnect_telegram(user: User):
    with get_connection() as conn:
        unlink_telegram(conn, user["id"])
    return {"ok": True, "linked": False}


@router.patch("/settings/telegram")
def update_telegram_prefs(user: User, body: TelegramEnableRequest):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT telegram_chat_id FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()
        if not row or not row["telegram_chat_id"]:
            raise HTTPException(status_code=400, detail="Telegram is not linked yet.")
        conn.execute(
            "UPDATE users SET telegram_enabled = ? WHERE id = ?",
            (1 if body.enabled else 0, user["id"]),
        )
    return {"enabled": body.enabled}


@router.post("/settings/telegram/test")
def test_telegram(user: User):
    if not bot_configured():
        raise HTTPException(status_code=503, detail="Telegram bot not configured.")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT telegram_chat_id, telegram_enabled FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()
        if not row or not row["telegram_chat_id"]:
            raise HTTPException(status_code=400, detail="Link Telegram first.")
        ok = send_message(
            row["telegram_chat_id"],
            "Paketo test — SnapPaketo notifications are working.",
        )
    if not ok:
        raise HTTPException(status_code=502, detail="Could not send Telegram message.")
    return {"ok": True}


@router.post("/telegram/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request):
    if secret != webhook_secret():
        raise HTTPException(status_code=403, detail="Invalid webhook secret.")
    if not bot_configured():
        raise HTTPException(status_code=503, detail="Bot not configured.")
    update = await request.json()
    process_webhook_update(update)
    return {"ok": True}
