"""Store settings and product catalog API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.auth import hash_password, verify_password
from app.database import get_connection
from app.deps import User
from app.finance_db import get_finance_config
from app.platform_db import (
    create_product,
    delete_product,
    get_default_product,
    list_products,
    product_row,
    update_product,
    get_product,
    update_user_profile,
)
from app.username import normalize_username, validate_username

router = APIRouter(prefix="/api", tags=["store"])


class StoreUpdateRequest(BaseModel):
    store_name: str = Field(min_length=1, max_length=120)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class ProfileUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=30)
    name: str | None = Field(default=None, max_length=80)


class ProductCreateRequest(BaseModel):
    product_code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=120)
    sale_price_rsd: float = Field(gt=0)
    units_per_offer: int = Field(ge=1, le=20)
    product_cost_eur: float | None = Field(default=None, ge=0)
    delivery_fee_rsd: float = Field(default=490, ge=0)
    is_default: bool = False


class ProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    sale_price_rsd: float | None = Field(default=None, gt=0)
    units_per_offer: int | None = Field(default=None, ge=1, le=20)
    product_cost_eur: float | None = Field(default=None, ge=0)
    delivery_fee_rsd: float | None = Field(default=None, ge=0)
    is_default: bool | None = None
    is_active: bool | None = None


@router.get("/settings")
def get_settings(user: User):
    with get_connection() as conn:
        cfg = get_finance_config(conn, user["id"])
        products = list_products(conn, user["id"])
        default_product = get_default_product(conn, user["id"])
    return {
        "username": user.get("username") or "",
        "name": user.get("name") or "",
        "store_name": user.get("store_name") or "",
        "products": products,
        "default_product": default_product,
        "finance_config": cfg,
    }


@router.patch("/settings/profile")
def update_profile(body: ProfileUpdateRequest, user: User):
    if body.username is None and body.name is None:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    username = None
    if body.username is not None:
        username = normalize_username(body.username)
        error = validate_username(username)
        if error:
            raise HTTPException(status_code=400, detail=error)

    name = None
    if body.name is not None:
        cleaned = body.name.strip()
        if not cleaned:
            raise HTTPException(status_code=400, detail="Display name cannot be empty.")
        name = cleaned

    with get_connection() as conn:
        if username is not None and username != user["username"]:
            taken = conn.execute(
                "SELECT id FROM users WHERE username = ? AND id != ?",
                (username, user["id"]),
            ).fetchone()
            if taken:
                raise HTTPException(status_code=400, detail="Username is already taken.")
        update_user_profile(conn, user["id"], username=username, name=name)
        row = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users WHERE id = ?
            """,
            (user["id"],),
        ).fetchone()

    from app.platform_db import user_platform_row

    return user_platform_row(row)


@router.patch("/settings/store")
def update_store(body: StoreUpdateRequest, user: User):
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET store_name = ? WHERE id = ?",
            (body.store_name.strip(), user["id"]),
        )
    return {"store_name": body.store_name.strip()}


@router.post("/settings/password")
def change_password(body: PasswordChangeRequest, user: User):
    with get_connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE id = ?",
            (user["id"],),
        ).fetchone()
        if not row or not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect.")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
    return {"ok": True}


@router.get("/products")
def get_products(user: User):
    with get_connection() as conn:
        return {"products": list_products(conn, user["id"])}


@router.post("/products")
def post_product(body: ProductCreateRequest, user: User):
    try:
        with get_connection() as conn:
            product = create_product(
                conn,
                user["id"],
                product_code=body.product_code,
                name=body.name,
                sale_price_rsd=body.sale_price_rsd,
                units_per_offer=body.units_per_offer,
                product_cost_eur=body.product_cost_eur,
                delivery_fee_rsd=body.delivery_fee_rsd,
                is_default=body.is_default,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return product


@router.patch("/products/{product_id}")
def patch_product(product_id: int, body: ProductUpdateRequest, user: User):
    try:
        with get_connection() as conn:
            product = update_product(
                conn,
                user["id"],
                product_id,
                name=body.name,
                sale_price_rsd=body.sale_price_rsd,
                units_per_offer=body.units_per_offer,
                product_cost_eur=body.product_cost_eur,
                delivery_fee_rsd=body.delivery_fee_rsd,
                is_default=body.is_default,
                is_active=body.is_active,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return product


@router.post("/products/{product_id}/remove")
def remove_product_post(product_id: int, user: User):
    try:
        with get_connection() as conn:
            result = delete_product(conn, user["id"], product_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.delete("/products/{product_id}")
def remove_product(product_id: int, user: User):
    try:
        with get_connection() as conn:
            result = delete_product(conn, user["id"], product_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.get("/products/{product_id}")
def get_product_detail(product_id: int, user: User):
    with get_connection() as conn:
        row = get_product(conn, user["id"], product_id)
        if not row:
            raise HTTPException(status_code=404, detail="Product not found.")
        return product_row(row)
