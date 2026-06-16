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
    list_products,
    product_row,
    update_product,
    get_product,
)

router = APIRouter(prefix="/api", tags=["store"])


class StoreUpdateRequest(BaseModel):
    store_name: str = Field(min_length=1, max_length=120)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


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
    return {
        "store_name": user.get("store_name") or "",
        "products": products,
        "finance_config": cfg,
    }


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
