"""Admin API: user management and platform stats."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.auth import hash_password
from app.database import get_connection
from app.datetime_util import now_local
from app.deps import Admin
from app.platform_db import (
    SUBSCRIPTION_STATUSES,
    ensure_default_product,
    extend_subscription,
    set_initial_subscription,
    sync_subscription_expiry,
    user_platform_row,
)
from app.username import normalize_username, validate_username

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminCreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8)
    name: str = Field(default="", max_length=80)
    store_name: str = Field(default="", max_length=120)
    subscription_days: int = Field(default=30, ge=1, le=3650)


class AdminUpdateUserRequest(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    store_name: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, min_length=8)
    is_active: bool | None = None
    subscription_status: Literal["active", "trial", "expired", "suspended"] | None = None
    add_subscription_days: int | None = Field(default=None, ge=1, le=3650)
    role: Literal["admin", "user"] | None = None


class AddSubscriptionRequest(BaseModel):
    days: int = Field(ge=1, le=3650)


@router.get("/stats")
def admin_stats(_admin: Admin):
    with get_connection() as conn:
        users = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        active = conn.execute(
            "SELECT COUNT(*) AS c FROM users WHERE is_active = 1"
        ).fetchone()["c"]
        batches = conn.execute("SELECT COUNT(*) AS c FROM batches").fetchone()["c"]
        leads = conn.execute("SELECT COUNT(*) AS c FROM leads").fetchone()["c"]
        paid = conn.execute(
            "SELECT COUNT(*) AS c FROM leads WHERE payment_received_at IS NOT NULL"
        ).fetchone()["c"]
        subs = conn.execute(
            """
            SELECT subscription_status, COUNT(*) AS c FROM users
            GROUP BY subscription_status
            """
        ).fetchall()
    return {
        "users_total": users,
        "users_active": active,
        "batches_total": batches,
        "leads_total": leads,
        "orders_paid": paid,
        "subscriptions": {r["subscription_status"]: r["c"] for r in subs},
    }


@router.get("/users")
def admin_list_users(_admin: Admin):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users ORDER BY id ASC
            """
        ).fetchall()
        for row in rows:
            sync_subscription_expiry(conn, row["id"])
        rows = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users ORDER BY id ASC
            """
        ).fetchall()
    return {"users": [user_platform_row(r) for r in rows]}


@router.post("/users")
def admin_create_user(body: AdminCreateUserRequest, admin: Admin):
    username = normalize_username(body.username)
    error = validate_username(username)
    if error:
        raise HTTPException(status_code=400, detail=error)

    with get_connection() as conn:
        if conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
            raise HTTPException(status_code=400, detail="Username is already taken.")

        ts = now_local()
        cursor = conn.execute(
            """
            INSERT INTO users (
                username, password_hash, name, role, is_active,
                subscription_status, subscription_expires_at, store_name, created_at
            ) VALUES (?, ?, ?, 'user', 1, 'active', NULL, ?, ?)
            """,
            (
                username,
                hash_password(body.password),
                body.name.strip() or username,
                body.store_name.strip(),
                ts,
            ),
        )
        user_id = cursor.lastrowid
        set_initial_subscription(conn, user_id, body.subscription_days)
        ensure_default_product(conn, user_id)
        row = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    return {"user": user_platform_row(row)}


@router.post("/users/{user_id}/subscription/add")
def admin_add_subscription(user_id: int, body: AddSubscriptionRequest, admin: Admin):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id, role FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found.")
        if row["role"] == "admin":
            raise HTTPException(status_code=400, detail="Admins have unlimited access.")
        try:
            extend_subscription(conn, user_id, body.days)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        updated = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    return {"user": user_platform_row(updated)}


@router.patch("/users/{user_id}")
def admin_update_user(user_id: int, body: AdminUpdateUserRequest, admin: Admin):
    if user_id == admin["id"] and body.is_active is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")
    if user_id == admin["id"] and body.role == "user":
        raise HTTPException(status_code=400, detail="You cannot remove your own admin role.")

    with get_connection() as conn:
        row = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found.")

        updates = []
        params: list = []
        if body.name is not None:
            updates.append("name = ?")
            params.append(body.name.strip())
        if body.store_name is not None:
            updates.append("store_name = ?")
            params.append(body.store_name.strip())
        if body.is_active is not None:
            updates.append("is_active = ?")
            params.append(1 if body.is_active else 0)
        if body.subscription_status is not None:
            if body.subscription_status not in SUBSCRIPTION_STATUSES:
                raise HTTPException(status_code=400, detail="Invalid subscription status.")
            updates.append("subscription_status = ?")
            params.append(body.subscription_status)
        if body.add_subscription_days is not None:
            try:
                extend_subscription(conn, user_id, body.add_subscription_days)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        if body.role is not None:
            updates.append("role = ?")
            params.append(body.role)
        if body.password:
            updates.append("password_hash = ?")
            params.append(hash_password(body.password))

        if not updates and body.add_subscription_days is None:
            raise HTTPException(status_code=400, detail="No changes provided.")

        if updates:
            params.append(user_id)
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)

        sync_subscription_expiry(conn, user_id)

        updated = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    return {"user": user_platform_row(updated)}
