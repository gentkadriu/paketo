"""FastAPI dependencies: auth, admin, subscription."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from app.auth import decode_token
from app.database import get_connection
from app.datetime_util import APP_TIMEZONE, parse_local_dt
from app.platform_db import sync_subscription_expiry, user_platform_row


def _fetch_user(user_id: int):
    with get_connection() as conn:
        sync_subscription_expiry(conn, user_id)
        row = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    return row


def _assert_user_access(user: dict) -> None:
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account deactivated.")
    if user.get("role") == "admin":
        return
    status = user.get("subscription_status", "active")
    if status in ("expired", "suspended"):
        raise HTTPException(
            status_code=403,
            detail="Subscription inactive. Contact your administrator.",
        )
    expires = user.get("subscription_expires_at")
    if expires and status == "active":
        if parse_local_dt(expires) <= datetime.now(APP_TIMEZONE):
            raise HTTPException(
                status_code=403,
                detail="Subscription expired. Contact your administrator.",
            )


def get_current_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not logged in.")
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")

    row = _fetch_user(int(payload["sub"]))
    if not row:
        raise HTTPException(status_code=401, detail="User not found.")

    user = user_platform_row(row)
    _assert_user_access(user)
    return user


def get_admin_user(user: Annotated[dict, Depends(get_current_user)]) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


User = Annotated[dict, Depends(get_current_user)]
Admin = Annotated[dict, Depends(get_admin_user)]
