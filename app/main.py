import json
import logging
import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, File, HTTPException, Header, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.auth import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.database import get_connection, init_db
from app.parser import (
    parse_leads_text, parse_leads_text_detailed, parse_lead_block, normalize_parsed_lead,
    lead_fingerprint, name_fingerprint, ParsedLead, clean_field_value,
)
from app.places_rs import resolve_address
from app.scheduler import refresh_lead_tracking, start_scheduler, stop_scheduler
from app.telegram_bot import notify_user_tracking_run
from app.status import MANUAL_STATUSES, STATUS_LABELS, display_status, is_trackable_lead, label_for
from app.aks_client import reset_session
from app.finance import campaign_stats, eur_to_rsd, return_fee_eur
from app.finance_db import (
    add_ledger_entry,
    apply_aks_settlement,
    deduct_stock_for_order,
    delete_ledger_entry,
    ensure_stock_deducted_for_order,
    get_finance_config,
    get_stock,
    ledger_balance,
    payment_summary,
    preview_aks_settlement,
    restore_stock_for_order,
    set_stock,
    sync_stock_on_tracking_update,
    cleanup_stock_ledger_noise,
    clear_stock_purchase_history,
    lead_stock_deduct_units,
    update_ledger_entry,
)
from app.aks_settlement import parse_settlement_file
from app.datetime_util import local_date, now_local
from app.deps import User, get_current_user
from app.platform_db import ensure_default_product, product_pricing, set_initial_subscription, user_platform_row
from app.security import (
    SecurityHeadersMiddleware,
    check_auth_rate_limit,
    registration_allowed,
    require_strong_secret,
)
from app.routers import admin as admin_router
from app.routers import products as products_router
from app.routers import telegram as telegram_router
from app.username import normalize_username, validate_username
from app.validators import validate_order_id

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("posta")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    require_strong_secret()
    if os.environ.get("POSTA_SECRET", "posta-dev-secret-change-in-production") == "posta-dev-secret-change-in-production":
        logger.warning("POSTA_SECRET is not set — use a strong random secret in production (.env).")
    init_db()
    start_scheduler()
    from app.telegram_bot import bot_configured, setup_webhook
    if bot_configured() and os.environ.get("PAKETO_HTTPS", "").strip() in ("1", "true", "yes"):
        domain = os.environ.get("PAKETO_PUBLIC_URL", "https://paketo.online").strip()
        setup_webhook(domain)
    yield
    stop_scheduler()


app = FastAPI(title="Paketo", lifespan=lifespan)
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(admin_router.router)
app.include_router(products_router.router)
app.include_router(telegram_router.router)
init_db()
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
LEGACY_STATIC = BASE_DIR / "static"


def _user_row(row) -> dict:
    return user_platform_row(row)


def _insert_user(conn, username: str, password_hash: str, name: str) -> int:
    from app.database import _column_exists

    if _column_exists(conn, "users", "email"):
        cursor = conn.execute(
            "INSERT INTO users (username, email, password_hash, name) VALUES (?, ?, ?, ?)",
            (username, username, password_hash, name),
        )
    else:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, name) VALUES (?, ?, ?)",
            (username, password_hash, name),
        )
    return cursor.lastrowid


# Auth dependency lives in app.deps (get_current_user / User)


# ── Request models ───────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str


class CreateBatchRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    leads_text: str = Field(min_length=1)
    ad_spend_usd: float | None = Field(default=None, ge=0)
    boost_days: int | None = Field(default=None, ge=0)
    skip_duplicates: bool = False
    product_id: int | None = None


class FinanceTransactionRequest(BaseModel):
    amount: float = Field(gt=0)
    currency: Literal["EUR", "USD", "RSD"] = "EUR"
    direction: Literal["expense", "income"] = "expense"
    category: Literal["stock", "ads", "other", "adjustment"] = "other"
    note: str = Field(default="", max_length=500)
    batch_id: int | None = None
    stock_pieces: int | None = Field(default=None, ge=0)


class FinanceTransactionUpdateRequest(BaseModel):
    amount: float = Field(gt=0)
    currency: Literal["EUR", "USD", "RSD"] = "EUR"
    direction: Literal["expense", "income"] = "expense"
    category: Literal["stock", "ads", "other", "adjustment"] = "other"
    note: str = Field(default="", max_length=500)
    stock_pieces: int | None = Field(default=None, ge=0)


class FinanceConfigRequest(BaseModel):
    sale_price_rsd: float | None = Field(default=None, gt=0)
    product_cost_eur: float | None = Field(default=None, ge=0)
    shipping_cost_usd: float | None = Field(default=None, ge=0)
    return_fee_rsd: float | None = Field(default=None, ge=0)
    units_per_order: int | None = Field(default=None, ge=1)
    eur_rsd: float | None = Field(default=None, gt=0)
    usd_rsd: float | None = Field(default=None, gt=0)


class StockSetRequest(BaseModel):
    quantity: int = Field(ge=0)


class UpdateBatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    ad_spend_usd: float | None = Field(default=None, ge=0)
    boost_days: int | None = Field(default=None, ge=0)
    product_id: int | None = Field(default=None, ge=1)


class UpdateOrderIdRequest(BaseModel):
    order_id: str = Field(default="")


class UpdateLeadRequest(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    street: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=80)
    postal_code: str | None = Field(default=None, max_length=10)
    phone: str | None = Field(default=None, min_length=9, max_length=20)
    notes: str | None = Field(default=None, max_length=500)
    stock_units: int | None = Field(default=None, ge=0, le=200)
    bundle_count: int | None = Field(default=None, ge=1, le=50)
    sale_product_rsd: int | None = Field(default=None, ge=0)


class BulkLeadActionRequest(BaseModel):
    lead_ids: list[int] = Field(min_length=1)
    action: Literal["delete", "mark_sent", "set_status", "reparse"]
    status: str | None = None


class LeadsTextRequest(BaseModel):
    leads_text: str = Field(min_length=1)
    skip_duplicates: bool = False


class ParsePreviewRequest(BaseModel):
    leads_text: str = Field(min_length=1)
    batch_id: int | None = None


class BulkOrderIdsRequest(BaseModel):
    text: str = Field(min_length=1)


# ── Serializers ──────────────────────────────────────────────────

def _lead_row(row) -> dict[str, Any]:
    history = json.loads(row["tracking_history"]) if row["tracking_history"] else []
    lifecycle = row["lifecycle_status"] or "registered"
    order_id = row["order_id"] or ""
    ui_status, ui_label = display_status(order_id, lifecycle)
    trackable = is_trackable_lead(order_id, lifecycle)
    first_name = clean_field_value(row["first_name"])
    last_name = clean_field_value(row["last_name"])
    street = clean_field_value(row["street"])
    city = clean_field_value(row["city"])
    postal = (row["postal_code"] or "").strip()
    street, city, postal = resolve_address(street, city, postal)
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "sort_order": row["sort_order"],
        "first_name": first_name,
        "last_name": last_name,
        "full_name": f"{first_name} {last_name}".strip(),
        "street": street,
        "city": city,
        "postal_code": postal,
        "phone": row["phone"],
        "notes": (row["notes"] or "") if "notes" in row.keys() else "",
        "bundle_count": max(1, int(row["bundle_count"] or 1)) if "bundle_count" in row.keys() else 1,
        "stock_units": max(0, int(row["stock_units"] or 0)) if "stock_units" in row.keys() else 0,
        "sale_product_rsd": max(0, int(row["sale_product_rsd"] or 0)) if "sale_product_rsd" in row.keys() else 0,
        "display_stock_units": (
            max(0, int(row["stock_units"] or 0))
            if "stock_units" in row.keys() and int(row["stock_units"] or 0) > 0
            else max(1, int(row["bundle_count"] or 1) if "bundle_count" in row.keys() else 1) * 2
        ),
        "order_id": row["order_id"],
        "lifecycle_status": lifecycle,
        "lifecycle_label": label_for(lifecycle),
        "display_status": ui_status,
        "display_label": ui_label,
        "is_trackable": trackable,
        "tracking_status": row["tracking_status"] if trackable else None,
        "tracking_location": row["tracking_location"] if trackable else None,
        "tracking_updated_at": row["tracking_updated_at"] if trackable else None,
        "tracking_history": history if trackable else [],
        "payment_received_at": (
            row["payment_received_at"] if "payment_received_at" in row.keys() else None
        ),
        "payment_amount_rsd": (
            round(float(row["payment_amount_rsd"] or 0), 2)
            if "payment_amount_rsd" in row.keys() and row["payment_amount_rsd"] is not None
            else None
        ),
        "is_paid": bool(
            row["payment_received_at"] if "payment_received_at" in row.keys() else None
        ),
    }


def _batch_row(row, lead_count: int, linked_count: int, product: dict | None = None) -> dict[str, Any]:
    imported_date = local_date(row["created_at"])
    sent_date = local_date(row["sent_at"])
    result = {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "imported_date": imported_date,
        "sent_at": row["sent_at"],
        "sent_date": sent_date,
        "status": row["status"],
        "lead_count": lead_count,
        "linked_count": linked_count,
        "ad_spend_usd": row["ad_spend_usd"] if "ad_spend_usd" in row.keys() else None,
        "boost_days": row["boost_days"] if "boost_days" in row.keys() else None,
        "product_id": row["product_id"] if "product_id" in row.keys() else None,
    }
    if product:
        result["product"] = product
    return result


def _batch_product(conn, user_id: int, batch_row) -> dict | None:
    product_id = batch_row["product_id"] if "product_id" in batch_row.keys() else None
    if not product_id:
        from app.platform_db import get_default_product
        return get_default_product(conn, user_id)
    from app.platform_db import get_product, product_row
    row = get_product(conn, user_id, product_id)
    return product_row(row) if row else None


def _batch_counts(conn, batch_id: int) -> tuple[int, int]:
    lead_count = conn.execute(
        "SELECT COUNT(*) FROM leads WHERE batch_id = ?", (batch_id,)
    ).fetchone()[0]
    linked_count = conn.execute(
        "SELECT COUNT(*) FROM leads WHERE batch_id = ? AND order_id IS NOT NULL AND order_id != ''",
        (batch_id,),
    ).fetchone()[0]
    return lead_count, linked_count


def _sync_batch_courier_state(conn, batch_id: int) -> None:
    """Batch is 'sent' only when at least one order has an AKS Order ID."""
    linked = conn.execute(
        """
        SELECT COUNT(*) FROM leads
        WHERE batch_id = ? AND order_id IS NOT NULL AND order_id != ''
        """,
        (batch_id,),
    ).fetchone()[0]

    if linked == 0:
        conn.execute(
            "UPDATE batches SET sent_at = NULL, status = 'linking' WHERE id = ?",
            (batch_id,),
        )
        conn.execute(
            """
            UPDATE leads SET lifecycle_status = 'registered'
            WHERE batch_id = ? AND (order_id IS NULL OR order_id = '')
              AND lifecycle_status = 'sent'
            """,
            (batch_id,),
        )
        return

    batch = conn.execute("SELECT sent_at, status FROM batches WHERE id = ?", (batch_id,)).fetchone()
    if not batch["sent_at"]:
        conn.execute(
            "UPDATE batches SET sent_at = ?, status = 'sent' WHERE id = ?",
            (now_local(), batch_id),
        )
    elif batch["status"] not in ("sent", "tracking"):
        conn.execute("UPDATE batches SET status = 'sent' WHERE id = ?", (batch_id,))


def _get_user_batch(conn, batch_id: int, user_id: int):
    batch = conn.execute(
        "SELECT * FROM batches WHERE id = ? AND user_id = ?",
        (batch_id, user_id),
    ).fetchone()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    return batch


def _renumber_leads(conn, batch_id: int) -> None:
    leads = conn.execute(
        "SELECT id FROM leads WHERE batch_id = ? ORDER BY sort_order, id",
        (batch_id,),
    ).fetchall()
    for index, lead in enumerate(leads, start=1):
        conn.execute(
            "UPDATE leads SET sort_order = ? WHERE id = ?",
            (index, lead["id"]),
        )


def _verify_lead_ids(conn, batch_id: int, user_id: int, lead_ids: list[int]) -> list[int]:
    rows = conn.execute(
        """
        SELECT l.id FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE l.batch_id = ? AND b.user_id = ? AND l.id IN ({})
        """.format(",".join("?" * len(lead_ids))),
        (batch_id, user_id, *lead_ids),
    ).fetchall()
    found = {row["id"] for row in rows}
    missing = set(lead_ids) - found
    if missing:
        raise HTTPException(status_code=404, detail="One or more leads were not found.")
    return lead_ids


def _parsed_lead_dict(lead: ParsedLead) -> dict[str, Any]:
    stock_units = int(lead.stock_units or 0)
    bundle_count = max(1, int(lead.bundle_count or 1))
    return {
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "full_name": f"{lead.first_name} {lead.last_name}".strip(),
        "street": lead.street,
        "city": lead.city,
        "postal_code": lead.postal_code,
        "phone": lead.phone,
        "notes": lead.notes or "",
        "bundle_count": bundle_count,
        "stock_units": stock_units,
        "sale_product_rsd": int(lead.sale_product_rsd or 0),
        "display_stock_units": stock_units or bundle_count * 2,
    }


def _lead_block_lines(row) -> list[str]:
    name = f"{row['first_name'] or ''} {row['last_name'] or ''}".strip()
    street = (row["street"] or "").strip()
    postal = (row["postal_code"] or "").strip()
    city = (row["city"] or "").strip()
    city_line = f"{postal} {city}".strip() if postal or city else ""
    phone = (row["phone"] or "").strip()
    lines = [name, street]
    if city_line:
        lines.append(city_line)
    if phone:
        lines.append(phone)
    return [ln for ln in lines if ln]


def _get_user_lead(conn, lead_id: int, user_id: int):
    lead = conn.execute(
        """
        SELECT l.* FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE l.id = ? AND b.user_id = ?
        """,
        (lead_id, user_id),
    ).fetchone()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found.")
    return lead


def _insert_leads(conn, batch_id: int, leads: list[ParsedLead], start_sort: int = 1) -> int:
    ts = now_local()
    for index, lead in enumerate(leads, start=start_sort):
        conn.execute(
            """
            INSERT INTO leads (
                batch_id, sort_order, first_name, last_name,
                street, city, postal_code, phone,
                notes, bundle_count, stock_units, sale_product_rsd,
                lifecycle_status, imported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?)
            """,
            (
                batch_id, index,
                lead.first_name, lead.last_name,
                lead.street, lead.city, lead.postal_code, lead.phone,
                lead.notes or "",
                max(1, int(lead.bundle_count or 1)),
                max(0, int(lead.stock_units or 0)),
                max(0, int(lead.sale_product_rsd or 0)),
                ts,
            ),
        )
    return len(leads)


def _existing_lead_fingerprints(conn, user_id: int) -> dict[str, dict[str, Any]]:
    existing = conn.execute(
        """
        SELECT l.first_name, l.last_name, l.phone, l.batch_id, b.name AS batch_name
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
        """,
        (user_id,),
    ).fetchall()
    fps: dict[str, dict[str, Any]] = {}
    for row in existing:
        fp = f"{re.sub(r'\D', '', row['phone'] or '')}|{name_fingerprint(row['first_name'], row['last_name'])}"
        fps[fp] = {
            "batch_id": row["batch_id"],
            "batch_name": row["batch_name"],
            "full_name": f"{row['first_name']} {row['last_name']}".strip(),
        }
    return fps


def _filter_new_leads(
    leads: list[ParsedLead], existing_fps: dict[str, dict[str, Any]],
) -> tuple[list[ParsedLead], int]:
    """Keep first occurrence; skip matches already in DB or repeated in paste."""
    new_leads: list[ParsedLead] = []
    skipped = 0
    seen_new: set[str] = set()
    for lead in leads:
        fp = lead_fingerprint(lead)
        if fp in seen_new or fp in existing_fps:
            skipped += 1
            continue
        seen_new.add(fp)
        new_leads.append(lead)
    return new_leads, skipped


def _find_duplicate_leads(
    conn, user_id: int, leads: list[ParsedLead], batch_id: int | None = None,
) -> list[dict[str, Any]]:
    if not leads:
        return []
    existing_fps = _existing_lead_fingerprints(conn, user_id)

    duplicates = []
    seen_new: set[str] = set()
    for lead in leads:
        fp = lead_fingerprint(lead)
        if fp in seen_new:
            duplicates.append({**_parsed_lead_dict(lead), "reason": "duplicate_in_paste", "batch_name": None})
            continue
        seen_new.add(fp)
        if fp in existing_fps:
            match = existing_fps[fp]
            if batch_id and match["batch_id"] == batch_id:
                duplicates.append({**_parsed_lead_dict(lead), "reason": "duplicate_in_batch", "batch_name": match["batch_name"]})
            elif not batch_id or match["batch_id"] != batch_id:
                duplicates.append({**_parsed_lead_dict(lead), "reason": "duplicate_existing", "batch_name": match["batch_name"]})
    return duplicates


PROBLEM_STATUSES = frozenset({
    "returned_to_warehouse", "delivery_canceled", "return_pending", "rejected", "returned",
})


def _get_batch_detail(conn, batch_id: int, user_id: int) -> dict[str, Any]:
    batch = _get_user_batch(conn, batch_id, user_id)
    _sync_batch_courier_state(conn, batch_id)
    batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
    leads = conn.execute(
        "SELECT * FROM leads WHERE batch_id = ? ORDER BY sort_order",
        (batch_id,),
    ).fetchall()
    linked_count = sum(1 for lead in leads if lead["order_id"])
    product = _batch_product(conn, user_id, batch)
    return {
        **_batch_row(batch, len(leads), linked_count, product),
        "leads": [_lead_row(lead) for lead in leads],
    }


# ── Static / pages ───────────────────────────────────────────────

@app.get("/")
def index():
    index_file = FRONTEND_DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return FileResponse(LEGACY_STATIC / "index.html")


@app.get("/api/health")
def health():
    return {"ok": True, "app": "Paketo"}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")
elif LEGACY_STATIC.exists():
    app.mount("/static", StaticFiles(directory=str(LEGACY_STATIC)), name="static")


# ── Auth routes ──────────────────────────────────────────────────

@app.get("/api/auth/config")
def auth_config():
    return {"allow_register": registration_allowed()}


@app.post("/api/auth/register")
def register(body: RegisterRequest, request: Request):
    if not registration_allowed():
        raise HTTPException(status_code=403, detail="Registration is disabled.")
    check_auth_rate_limit(request)
    username = normalize_username(body.username)
    error = validate_username(username)
    if error:
        raise HTTPException(status_code=400, detail=error)

    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username is already taken.")

        user_id = _insert_user(conn, username, hash_password(body.password), username)
        set_initial_subscription(conn, user_id, 30)
        ensure_default_product(conn, user_id)
        user = conn.execute(
            """
            SELECT id, username, name, role, is_active,
                   subscription_status, subscription_expires_at,
                   store_name, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    token = create_access_token(user["id"], user["username"])
    return {"token": token, "user": _user_row(user)}


@app.post("/api/auth/login")
def login(body: LoginRequest, request: Request):
    check_auth_rate_limit(request)
    username = normalize_username(body.username)
    with get_connection() as conn:
        user = conn.execute(
            """
            SELECT id, username, name, password_hash, role, is_active,
                   subscription_status, subscription_expires_at, store_name, created_at
            FROM users WHERE username = ?
            """,
            (username,),
        ).fetchone()

    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")

    with get_connection() as conn:
        from app.platform_db import sync_subscription_expiry

        sync_subscription_expiry(conn, user["id"])
        user = conn.execute(
            """
            SELECT id, username, name, password_hash, role, is_active,
                   subscription_status, subscription_expires_at, store_name, created_at
            FROM users WHERE id = ?
            """,
            (user["id"],),
        ).fetchone()

    profile = _user_row(user)
    if not profile.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account deactivated.")
    if profile.get("role") != "admin" and profile.get("subscription_status") in (
        "expired",
        "suspended",
    ):
        raise HTTPException(status_code=403, detail="Subscription inactive.")

    token = create_access_token(user["id"], user["username"])
    return {"token": token, "user": profile}


@app.get("/api/auth/me")
def me(user: User):
    return user


# ── Search ───────────────────────────────────────────────────────

def _fold_text(value: str) -> str:
    """Lowercase ASCII-friendly form for accent-insensitive matching."""
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    stripped = "".join(c for c in normalized if not unicodedata.combining(c))
    return stripped.lower()


def _lead_matches_search(row, term: str) -> bool:
    first = row["first_name"] or ""
    last = row["last_name"] or ""
    full = f"{first} {last}".strip()
    order_id = row["order_id"] or ""
    phone = row["phone"] or ""
    batch_name = row["batch_name"] or ""

    haystack = _fold_text(f"{full} {first} {last} {order_id} {phone} {batch_name}")
    folded_term = _fold_text(term)

    if folded_term in haystack:
        return True

    words = [w for w in folded_term.split() if len(w) >= 2]
    if len(words) >= 2:
        fn, ln = _fold_text(first), _fold_text(last)
        w0, w1 = words[0], words[1]
        if (w0 in fn and w1 in ln) or (w1 in fn and w0 in ln):
            return True
        if w0 in haystack and w1 in haystack:
            return True

    return False


@app.get("/api/search")
def search_orders(user: User, q: str = ""):
    """Search leads by name, surname, full name, Order ID, phone, or batch name."""
    term = q.strip()
    if len(term) < 2:
        return []

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT l.*, b.name AS batch_name
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
            ORDER BY l.id DESC
            """,
            (user["id"],),
        ).fetchall()

    matches = [r for r in rows if _lead_matches_search(r, term)]
    return [_lead_row(r) | {"batch_name": r["batch_name"]} for r in matches[:30]]


@app.get("/api/leads")
def list_all_leads(user: User):
    """All leads for the logged-in user — used by client-side search index."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT l.*, b.name AS batch_name
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
            ORDER BY l.id DESC
            """,
            (user["id"],),
        ).fetchall()

    return [_lead_row(r) | {"batch_name": r["batch_name"]} for r in rows]


# ── Dashboard ────────────────────────────────────────────────────

@app.get("/api/dashboard/dates")
def dashboard_dates(user: User, kind: str = "imported"):
    """Return dates that have batches or deliveries, for calendar picker."""
    if kind not in ("imported", "sent", "delivered"):
        raise HTTPException(status_code=400, detail="kind must be imported, sent, or delivered")

    with get_connection() as conn:
        if kind == "sent":
            rows = conn.execute(
                """
                SELECT DISTINCT date(sent_at) AS d, COUNT(*) AS cnt
                FROM batches
                WHERE user_id = ? AND sent_at IS NOT NULL
                GROUP BY date(sent_at)
                ORDER BY d DESC
                """,
                (user["id"],),
            ).fetchall()
        elif kind == "delivered":
            rows = conn.execute(
                """
                SELECT date(l.tracking_updated_at) AS d, COUNT(*) AS cnt
                FROM leads l
                JOIN batches b ON b.id = l.batch_id
                WHERE b.user_id = ?
                  AND l.lifecycle_status = 'delivered'
                  AND l.tracking_updated_at IS NOT NULL
                GROUP BY date(l.tracking_updated_at)
                ORDER BY d DESC
                """,
                (user["id"],),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT DISTINCT date(created_at) AS d, COUNT(*) AS cnt
                FROM batches
                WHERE user_id = ?
                GROUP BY date(created_at)
                ORDER BY d DESC
                """,
                (user["id"],),
            ).fetchall()

    return [{"date": r["d"], "batch_count": r["cnt"]} for r in rows]


@app.get("/api/dashboard/batches")
def dashboard_batches(
    user: User,
    date: str | None = None,
    kind: str = "imported",
):
    """List batches, optionally filtered by imported or sent date (YYYY-MM-DD)."""
    with get_connection() as conn:
        query = "SELECT * FROM batches WHERE user_id = ?"
        params: list[Any] = [user["id"]]

        if date:
            if kind == "sent":
                query += " AND date(sent_at) = ?"
            else:
                query += " AND date(created_at) = ?"
            params.append(date)

        query += " ORDER BY created_at DESC"
        batches = conn.execute(query, params).fetchall()

        result = []
        for batch in batches:
            _sync_batch_courier_state(conn, batch["id"])
            batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch["id"],)).fetchone()
            lc, linked = _batch_counts(conn, batch["id"])
            result.append(_batch_row(batch, lc, linked))

    return result


@app.get("/api/dashboard/today")
def dashboard_today(user: User):
    today = local_date(now_local())
    with get_connection() as conn:
        cleanup_stock_ledger_noise(conn, user["id"])
        imported_today = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ? AND date(l.imported_at) = ?
            """,
            (user["id"], today),
        ).fetchone()[0]

        missing_id = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND (l.order_id IS NULL OR l.order_id = '')
            """,
            (user["id"],),
        ).fetchone()[0]

        delivered = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.lifecycle_status = 'delivered'
            """,
            (user["id"],),
        ).fetchone()[0]

        delivered_today = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.lifecycle_status = 'delivered'
              AND date(l.tracking_updated_at) = ?
            """,
            (user["id"], today),
        ).fetchone()[0]

        problems = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.lifecycle_status IN ('returned_to_warehouse','delivery_canceled','return_pending','rejected','returned')
            """,
            (user["id"],),
        ).fetchone()[0]

        problem_rows = conn.execute(
            """
            SELECT l.id, l.first_name, l.last_name, l.order_id, l.lifecycle_status,
                   b.id AS batch_id, b.name AS batch_name
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.lifecycle_status IN ('returned_to_warehouse','delivery_canceled','return_pending','rejected','returned')
            ORDER BY l.tracking_updated_at DESC, l.id DESC
            LIMIT 50
            """,
            (user["id"],),
        ).fetchall()

        missing_id_rows = conn.execute(
            """
            SELECT l.id, l.first_name, l.last_name, l.order_id, l.lifecycle_status,
                   b.id AS batch_id, b.name AS batch_name
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND (l.order_id IS NULL OR l.order_id = '')
            ORDER BY b.created_at DESC, l.sort_order ASC
            LIMIT 50
            """,
            (user["id"],),
        ).fetchall()

        out_for_delivery = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ? AND l.lifecycle_status = 'out_for_delivery'
            """,
            (user["id"],),
        ).fetchone()[0]

        total_active = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
            """,
            (user["id"],),
        ).fetchone()[0]

    return {
        "date": today,
        "imported_today": imported_today,
        "missing_id": missing_id,
        "delivered": delivered,
        "delivered_today": delivered_today,
        "problems": problems,
        "out_for_delivery": out_for_delivery,
        "total_active": total_active,
        "problem_leads": [
            {
                "id": r["id"],
                "full_name": f"{r['first_name']} {r['last_name']}".strip(),
                "order_id": r["order_id"] or "",
                "lifecycle_status": r["lifecycle_status"],
                "batch_id": r["batch_id"],
                "batch_name": r["batch_name"],
            }
            for r in problem_rows
        ],
        "missing_id_leads": [
            {
                "id": r["id"],
                "full_name": f"{r['first_name']} {r['last_name']}".strip(),
                "order_id": r["order_id"] or "",
                "lifecycle_status": r["lifecycle_status"],
                "batch_id": r["batch_id"],
                "batch_name": r["batch_name"],
            }
            for r in missing_id_rows
        ],
    }


@app.get("/api/statistics/timeline")
def statistics_timeline(user: User, days: int = 30):
    from datetime import timedelta

    days = max(7, min(days, 90))
    today = date.fromisoformat(local_date(now_local()))
    start = today - timedelta(days=days - 1)

    with get_connection() as conn:
        total_delivered = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ? AND l.lifecycle_status = 'delivered'
            """,
            (user["id"],),
        ).fetchone()[0]

        total_imported = conn.execute(
            """
            SELECT COUNT(*) FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
            """,
            (user["id"],),
        ).fetchone()[0]

        rows = conn.execute(
            """
            SELECT date(l.imported_at) AS d, COUNT(*) AS cnt
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.imported_at IS NOT NULL
              AND date(l.imported_at) >= ?
            GROUP BY date(l.imported_at)
            ORDER BY d ASC
            """,
            (user["id"], start.isoformat()),
        ).fetchall()

        delivered_rows = conn.execute(
            """
            SELECT date(l.tracking_updated_at) AS d, COUNT(*) AS cnt
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.lifecycle_status = 'delivered'
              AND l.tracking_updated_at IS NOT NULL
              AND date(l.tracking_updated_at) >= ?
            GROUP BY date(l.tracking_updated_at)
            ORDER BY d ASC
            """,
            (user["id"], start.isoformat()),
        ).fetchall()

    imported_by_day = {r["d"]: r["cnt"] for r in rows}
    delivered_by_day = {r["d"]: r["cnt"] for r in delivered_rows}

    timeline = []
    current = start
    while current <= today:
        d = current.isoformat()
        timeline.append({
            "date": d,
            "imported": imported_by_day.get(d, 0),
            "delivered": delivered_by_day.get(d, 0),
        })
        current += timedelta(days=1)

    delivered_in_period = sum(delivered_by_day.values())
    imported_in_period = sum(imported_by_day.values())
    active_delivery_days = sum(1 for v in delivered_by_day.values() if v > 0)
    active_import_days = sum(1 for v in imported_by_day.values() if v > 0)

    peak_date, peak_count = None, 0
    if delivered_by_day:
        peak_date, peak_count = max(delivered_by_day.items(), key=lambda x: x[1])

    return {
        "days": days,
        "timeline": timeline,
        "summary": {
            "total_delivered": total_delivered,
            "total_imported": total_imported,
            "delivered_in_period": delivered_in_period,
            "imported_in_period": imported_in_period,
            "avg_delivered_per_day": round(
                delivered_in_period / active_delivery_days, 1,
            ) if active_delivery_days else 0,
            "avg_imported_per_day": round(
                imported_in_period / active_import_days, 1,
            ) if active_import_days else 0,
            "peak_delivery_date": peak_date,
            "peak_delivery_count": peak_count,
        },
    }


@app.post("/api/leads/parse-preview")
def parse_preview(body: ParsePreviewRequest, user: User):
    parsed = parse_leads_text_detailed(body.leads_text)
    with get_connection() as conn:
        existing_fps = _existing_lead_fingerprints(conn, user["id"])
        duplicates = _find_duplicate_leads(conn, user["id"], parsed.leads, body.batch_id)
        new_leads, _ = _filter_new_leads(parsed.leads, existing_fps)
    return {
        "recognized": [_parsed_lead_dict(l) for l in parsed.leads],
        "skipped": parsed.skipped,
        "duplicates": duplicates,
        "count": len(parsed.leads),
        "new_count": len(new_leads),
        "duplicate_count": len(parsed.leads) - len(new_leads),
    }


# ── Statistics ───────────────────────────────────────────────────
@app.get("/api/statistics")
def get_statistics(
    user: User,
    date: str | None = None,
    batch_id: int | None = None,
    kind: str = "imported",
):
    return statistics(user, date=date, batch_id=batch_id, kind=kind)


def statistics(
    user: User,
    date: str | None = None,
    batch_id: int | None = None,
    kind: str = "imported",
):
    with get_connection() as conn:
        query = """
            SELECT l.lifecycle_status, COUNT(*) AS cnt
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
        """
        params: list[Any] = [user["id"]]

        if batch_id:
            query += " AND b.id = ?"
            params.append(batch_id)
        elif date:
            if kind == "delivered":
                query += " AND l.lifecycle_status = 'delivered' AND date(l.tracking_updated_at) = ?"
            else:
                query += " AND date(b.created_at) = ?"
            params.append(date)

        query += " GROUP BY l.lifecycle_status"
        rows = conn.execute(query, params).fetchall()

        total = sum(r["cnt"] for r in rows)
        breakdown = {
            r["lifecycle_status"]: r["cnt"] for r in rows
        }

    ordered_keys = [
        "registered", "sent", "in_warehouse", "in_transit",
        "out_for_delivery", "delivered", "returned_to_warehouse",
        "delivery_canceled", "return_pending", "rejected", "returned", "unknown",
    ]
    items = []
    for key in ordered_keys:
        count = breakdown.get(key, 0)
        if count or total == 0:
            items.append({
                "status": key,
                "label": label_for(key),
                "count": count,
                "percent": round(count / total * 100, 1) if total else 0,
            })

    return {
        "total": total,
        "items": items,
        "status_labels": STATUS_LABELS,
    }


# ── Finance ──────────────────────────────────────────────────────

@app.get("/api/finance/overview")
def finance_overview(user: User):
    with get_connection() as conn:
        cleanup_stock_ledger_noise(conn, user["id"])
        cfg = get_finance_config(conn, user["id"])
        balance = ledger_balance(conn, user["id"])
        stock = get_stock(conn, user["id"])
        ret = return_fee_eur(cfg)

        txns = conn.execute(
            """
            SELECT id, amount_eur, category, note, batch_id, stock_delta, created_at
            FROM finance_ledger
            WHERE user_id = ?
              AND category NOT IN ('stock_use', 'stock_return')
            ORDER BY created_at DESC, id DESC LIMIT 50
            """,
            (user["id"],),
        ).fetchall()

        batches = conn.execute(
            "SELECT * FROM batches WHERE user_id = ? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
        campaigns = []
        for batch in batches:
            leads = conn.execute(
                """
                SELECT order_id, lifecycle_status, bundle_count, sale_product_rsd,
                       payment_received_at
                FROM leads WHERE batch_id = ?
                """,
                (batch["id"],),
            ).fetchall()
            stats = campaign_stats(
                list(leads),
                batch["ad_spend_usd"] or 0,
                cfg,
            )
            campaigns.append({
                "batch_id": batch["id"],
                "batch_name": batch["name"],
                "boost_days": batch["boost_days"],
                **stats,
            })

        total_imported = 0
        weighted_net = 0.0
        for c in campaigns:
            n = c.get("imported_bundles", c.get("imported_orders", 0))
            if n > 0:
                total_imported += n
                weighted_net += c["net_profit_per_order_eur"] * n
        avg_margin_eur = round(weighted_net / total_imported, 2) if total_imported else 0.0
        payouts = payment_summary(conn, user["id"])

        committed = conn.execute(
            """
            SELECT l.id FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.order_id IS NOT NULL AND l.order_id != ''
            """,
            (user["id"],),
        ).fetchall()
        stock_committed = sum(
            lead_stock_deduct_units(conn, user["id"], row["id"]) for row in committed
        )

    return {
        "balance_eur": balance,
        "balance_rsd": round(eur_to_rsd(balance, cfg), 0),
        "stock_quantity": stock,
        "stock_committed": stock_committed,
        "units_per_order": int(cfg["units_per_order"]),
        "config": cfg,
        "average_margin_eur": avg_margin_eur,
        "average_margin_rsd": round(eur_to_rsd(avg_margin_eur, cfg), 0),
        "average_margin_orders": total_imported,
        "return_fee_eur": ret,
        "return_fee_rsd": cfg["return_fee_rsd"],
        "payment_summary": payouts,
        "transactions": [dict(t) for t in txns],
        "campaigns": campaigns,
    }


async def _read_settlement_upload(file: UploadFile):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Choose an AKS settlement file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty.")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB).")
    try:
        return parse_settlement_file(file.filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/finance/settlements/preview")
async def finance_settlement_preview(
    user: User,
    file: UploadFile = File(...),
):
    parsed = await _read_settlement_upload(file)
    with get_connection() as conn:
        cfg = get_finance_config(conn, user["id"])
        preview = preview_aks_settlement(conn, user["id"], parsed, cfg)
    return preview


@app.post("/api/finance/settlements/import")
async def finance_settlement_import(
    user: User,
    file: UploadFile = File(...),
):
    parsed = await _read_settlement_upload(file)
    with get_connection() as conn:
        cfg = get_finance_config(conn, user["id"])
        try:
            result = apply_aks_settlement(conn, user["id"], parsed, cfg)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        balance = ledger_balance(conn, user["id"])
    return {
        **result,
        "balance_eur": balance,
        "balance_rsd": round(eur_to_rsd(balance, cfg), 0),
    }


def _transaction_amount_eur(body, cfg: dict) -> float:
    from app.finance import rsd_to_eur, usd_to_eur

    amount_eur = body.amount
    if body.currency == "USD":
        amount_eur = usd_to_eur(body.amount, cfg)
    elif body.currency == "RSD":
        amount_eur = rsd_to_eur(body.amount, cfg)
    if body.direction == "expense":
        return -abs(amount_eur)
    return abs(amount_eur)


@app.post("/api/finance/transactions")
def finance_add_transaction(body: FinanceTransactionRequest, user: User):
    with get_connection() as conn:
        cfg = get_finance_config(conn, user["id"])
        amount_eur = _transaction_amount_eur(body, cfg)

        stock_delta = 0
        if body.category == "stock" and body.stock_pieces:
            stock_delta = body.stock_pieces if body.direction == "expense" else -body.stock_pieces

        entry = add_ledger_entry(
            conn,
            user["id"],
            amount_eur=amount_eur,
            category=body.category,
            note=body.note,
            batch_id=body.batch_id,
            stock_delta=stock_delta if body.category == "stock" else 0,
        )
        return {
            "entry": entry,
            "balance_eur": ledger_balance(conn, user["id"]),
            "stock_quantity": get_stock(conn, user["id"]),
        }


@app.patch("/api/finance/transactions/{txn_id}")
def finance_update_transaction(txn_id: int, body: FinanceTransactionUpdateRequest, user: User):
    with get_connection() as conn:
        cfg = get_finance_config(conn, user["id"])
        amount_eur = _transaction_amount_eur(body, cfg)
        stock_delta = 0
        if body.category == "stock" and body.stock_pieces:
            stock_delta = body.stock_pieces if body.direction == "expense" else -body.stock_pieces
        try:
            entry = update_ledger_entry(
                conn,
                user["id"],
                txn_id,
                amount_eur=amount_eur,
                category=body.category,
                note=body.note,
                stock_delta=stock_delta if body.category == "stock" else 0,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "entry": entry,
            "balance_eur": ledger_balance(conn, user["id"]),
            "stock_quantity": get_stock(conn, user["id"]),
        }


@app.delete("/api/finance/transactions/{txn_id}")
def finance_delete_transaction(txn_id: int, user: User):
    with get_connection() as conn:
        try:
            delete_ledger_entry(conn, user["id"], txn_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "ok": True,
            "balance_eur": ledger_balance(conn, user["id"]),
            "stock_quantity": get_stock(conn, user["id"]),
        }


@app.post("/api/finance/stock-entries/clear")
def finance_clear_stock_entries(user: User):
    with get_connection() as conn:
        removed = clear_stock_purchase_history(conn, user["id"])
        return {
            "ok": True,
            "removed": removed,
            "balance_eur": ledger_balance(conn, user["id"]),
            "stock_quantity": get_stock(conn, user["id"]),
        }


@app.patch("/api/finance/config")
def finance_update_config(body: FinanceConfigRequest, user: User):
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")
    with get_connection() as conn:
        get_finance_config(conn, user["id"])
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(
            f"UPDATE finance_config SET {sets} WHERE user_id = ?",
            (*fields.values(), user["id"]),
        )
        return get_finance_config(conn, user["id"])


@app.put("/api/finance/stock")
def finance_set_stock(body: StockSetRequest, user: User):
    with get_connection() as conn:
        qty = set_stock(conn, user["id"], body.quantity)
        return {"stock_quantity": qty}


# ── Batches CRUD ─────────────────────────────────────────────────

@app.get("/api/batches")
def list_batches(user: User):
    return dashboard_batches(user)


@app.post("/api/batches")
def create_batch(body: CreateBatchRequest, user: User):
    parsed = parse_leads_text_detailed(body.leads_text)
    if not parsed.leads:
        raise HTTPException(
            status_code=400,
            detail="No leads recognized. Format: Name Surname, street, city postal code, phone.",
        )

    with get_connection() as conn:
        leads = parsed.leads
        skipped_duplicates = 0
        if body.skip_duplicates:
            existing_fps = _existing_lead_fingerprints(conn, user["id"])
            leads, skipped_duplicates = _filter_new_leads(leads, existing_fps)
            if not leads:
                raise HTTPException(status_code=400, detail="All pasted orders are duplicates.")

        ad_usd = body.ad_spend_usd or 0
        pricing = product_pricing(conn, user["id"], body.product_id)
        if body.product_id and not pricing.get("product_id"):
            raise HTTPException(status_code=400, detail="Product not found.")
        product_id = pricing.get("product_id")
        cursor = conn.execute(
            """
            INSERT INTO batches (user_id, name, created_at, ad_spend_usd, boost_days, product_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"],
                body.name.strip(),
                now_local(),
                ad_usd if ad_usd else None,
                body.boost_days,
                product_id,
            ),
        )
        batch_id = cursor.lastrowid
        _insert_leads(conn, batch_id, leads)
        if ad_usd > 0:
            cfg = get_finance_config(conn, user["id"])
            from app.finance import usd_to_eur
            add_ledger_entry(
                conn,
                user["id"],
                amount_eur=-usd_to_eur(ad_usd, cfg),
                category="ads",
                note=f"Meta ads — {body.name.strip()}",
                batch_id=batch_id,
            )
        batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        product = _batch_product(conn, user["id"], batch)

    result = _batch_row(batch, len(leads), 0, product)
    result["skipped_duplicates"] = skipped_duplicates
    return result


@app.get("/api/batches/{batch_id}")
def get_batch(batch_id: int, user: User):
    with get_connection() as conn:
        return _get_batch_detail(conn, batch_id, user["id"])


@app.post("/api/batches/{batch_id}/leads")
def append_leads(batch_id: int, body: LeadsTextRequest, user: User):
    parsed = parse_leads_text_detailed(body.leads_text)
    if not parsed.leads:
        raise HTTPException(status_code=400, detail="No leads recognized in pasted text.")

    with get_connection() as conn:
        _get_user_batch(conn, batch_id, user["id"])
        leads = parsed.leads
        skipped_duplicates = 0
        if body.skip_duplicates:
            existing_fps = _existing_lead_fingerprints(conn, user["id"])
            leads, skipped_duplicates = _filter_new_leads(leads, existing_fps)
            if not leads:
                raise HTTPException(status_code=400, detail="All pasted orders are duplicates.")

        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM leads WHERE batch_id = ?",
            (batch_id,),
        ).fetchone()[0]
        added = _insert_leads(conn, batch_id, leads, start_sort=max_sort + 1)
        detail = _get_batch_detail(conn, batch_id, user["id"])
        detail["added_count"] = added
        detail["skipped_duplicates"] = skipped_duplicates
        return detail


@app.post("/api/batches/{batch_id}/bulk-order-ids")
def bulk_order_ids(batch_id: int, body: BulkOrderIdsRequest, user: User):
    raw_lines = [ln.strip() for ln in body.text.splitlines() if ln.strip()]
    order_ids = [re.sub(r"\D", "", ln)[:14] for ln in raw_lines]
    order_ids = [oid for oid in order_ids if len(oid) == 14 and oid.startswith("917")]

    if not order_ids:
        raise HTTPException(status_code=400, detail="No valid 14-digit Order IDs (917…) found.")

    with get_connection() as conn:
        _get_user_batch(conn, batch_id, user["id"])
        leads = conn.execute(
            """
            SELECT id, order_id FROM leads
            WHERE batch_id = ? AND (order_id IS NULL OR order_id = '')
            ORDER BY sort_order
            """,
            (batch_id,),
        ).fetchall()

        if not leads:
            raise HTTPException(status_code=400, detail="No orders without Order IDs in this batch.")

        applied = 0
        ts = now_local()
        for lead, oid in zip(leads, order_ids):
            conn.execute(
                """
                UPDATE leads SET order_id = ?, lifecycle_status = 'sent'
                WHERE id = ?
                """,
                (oid, lead["id"]),
            )
            deduct_stock_for_order(conn, user["id"], lead["id"])
            applied += 1

        _sync_batch_courier_state(conn, batch_id)
        stock_qty = get_stock(conn, user["id"])

        return {
            "applied": applied,
            "remaining_without_id": max(0, len(leads) - applied),
            "unused_ids": max(0, len(order_ids) - applied),
            "stock_quantity": stock_qty,
            "batch": _get_batch_detail(conn, batch_id, user["id"]),
        }


@app.patch("/api/batches/{batch_id}")
def update_batch(batch_id: int, body: UpdateBatchRequest, user: User):
    if (
        body.name is None
        and body.ad_spend_usd is None
        and body.boost_days is None
        and body.product_id is None
    ):
        raise HTTPException(status_code=400, detail="Nothing to update.")

    with get_connection() as conn:
        batch = _get_user_batch(conn, batch_id, user["id"])
        old_ad = batch["ad_spend_usd"] or 0

        if body.product_id is not None:
            pricing = product_pricing(conn, user["id"], body.product_id)
            if not pricing.get("product_id"):
                raise HTTPException(status_code=400, detail="Product not found.")
            conn.execute(
                "UPDATE batches SET product_id = ? WHERE id = ?",
                (body.product_id, batch_id),
            )

        if body.name is not None:
            conn.execute(
                "UPDATE batches SET name = ? WHERE id = ?",
                (body.name.strip(), batch_id),
            )
        if body.ad_spend_usd is not None:
            conn.execute(
                "UPDATE batches SET ad_spend_usd = ? WHERE id = ?",
                (body.ad_spend_usd, batch_id),
            )
        if body.boost_days is not None:
            conn.execute(
                "UPDATE batches SET boost_days = ? WHERE id = ?",
                (body.boost_days, batch_id),
            )

        batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if body.ad_spend_usd is not None:
            from app.finance_db import sync_batch_ad_ledger

            cfg = get_finance_config(conn, user["id"])
            sync_batch_ad_ledger(
                conn,
                user["id"],
                batch_id,
                batch["name"],
                old_ad,
                body.ad_spend_usd,
                cfg,
            )

        lc, linked = _batch_counts(conn, batch_id)
        product = _batch_product(conn, user["id"], batch)

    return _batch_row(batch, lc, linked, product)


@app.post("/api/batches/{batch_id}/leads/bulk")
def bulk_lead_action(batch_id: int, body: BulkLeadActionRequest, user: User):
    with get_connection() as conn:
        _get_user_batch(conn, batch_id, user["id"])
        lead_ids = _verify_lead_ids(conn, batch_id, user["id"], body.lead_ids)
        placeholders = ",".join("?" * len(lead_ids))

        if body.action == "delete":
            conn.execute(
                f"DELETE FROM leads WHERE batch_id = ? AND id IN ({placeholders})",
                (batch_id, *lead_ids),
            )
            _renumber_leads(conn, batch_id)

        elif body.action == "mark_sent":
            conn.execute(
                f"""
                UPDATE leads SET lifecycle_status = 'sent'
                WHERE batch_id = ? AND id IN ({placeholders})
                  AND order_id IS NOT NULL AND order_id != ''
                """,
                (batch_id, *lead_ids),
            )

        elif body.action == "set_status":
            if not body.status or body.status not in MANUAL_STATUSES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Status must be one of: {', '.join(sorted(MANUAL_STATUSES))}.",
                )
            conn.execute(
                f"""
                UPDATE leads SET lifecycle_status = ?
                WHERE batch_id = ? AND id IN ({placeholders})
                """,
                (body.status, batch_id, *lead_ids),
            )

        elif body.action == "reparse":
            for lead_id in lead_ids:
                row = conn.execute(
                    "SELECT * FROM leads WHERE batch_id = ? AND id = ?",
                    (batch_id, lead_id),
                ).fetchone()
                if not row:
                    continue
                parsed, err = parse_lead_block(_lead_block_lines(row))
                if not parsed:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Could not re-parse {row['first_name']} {row['last_name']}: {err}",
                    )
                parsed = normalize_parsed_lead(parsed)
                street, city, postal = resolve_address(parsed.street, parsed.city, parsed.postal_code)
                conn.execute(
                    """
                    UPDATE leads SET first_name = ?, last_name = ?, street = ?, city = ?,
                        postal_code = ?, phone = ?, notes = ?, bundle_count = ?,
                        stock_units = ?, sale_product_rsd = ?
                    WHERE id = ?
                    """,
                    (
                        parsed.first_name,
                        parsed.last_name,
                        street,
                        city,
                        postal,
                        parsed.phone,
                        parsed.notes,
                        parsed.bundle_count,
                        parsed.stock_units,
                        parsed.sale_product_rsd,
                        lead_id,
                    ),
                )

        _sync_batch_courier_state(conn, batch_id)
        batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        leads = conn.execute(
            "SELECT * FROM leads WHERE batch_id = ? ORDER BY sort_order",
            (batch_id,),
        ).fetchall()
        linked_count = sum(1 for lead in leads if lead["order_id"])

    return {
        **_batch_row(batch, len(leads), linked_count),
        "leads": [_lead_row(lead) for lead in leads],
    }


@app.patch("/api/leads/{lead_id}")
def update_lead(lead_id: int, body: UpdateLeadRequest, user: User):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    with get_connection() as conn:
        lead = _get_user_lead(conn, lead_id, user["id"])
        cfg = get_finance_config(conn, user["id"])
        units_per = int(cfg.get("units_per_order", 2))
        sale_unit = int(cfg.get("sale_price_rsd", 1000))

        first_name = fields.get("first_name", lead["first_name"])
        last_name = fields.get("last_name", lead["last_name"] or "")
        street = fields.get("street", lead["street"] or "")
        city = fields.get("city", lead["city"] or "")
        postal = fields.get("postal_code", lead["postal_code"] or "")
        phone = fields.get("phone", lead["phone"] or "")
        notes = fields.get("notes", lead["notes"] or "") if "notes" in fields else (lead["notes"] or "")

        bundle_count = int(lead["bundle_count"] or 1)
        stock_units = int(lead["stock_units"] or 0)
        sale_product_rsd = int(lead["sale_product_rsd"] or 0)

        if "stock_units" in fields:
            stock_units = int(fields["stock_units"] or 0)
        if "bundle_count" in fields:
            bundle_count = max(1, int(fields["bundle_count"] or 1))
        if "sale_product_rsd" in fields:
            sale_product_rsd = max(0, int(fields["sale_product_rsd"] or 0))

        if "stock_units" in fields and "bundle_count" not in fields:
            bundle_count = max(1, round(stock_units / units_per)) if stock_units else 1
        elif stock_units <= 0 and bundle_count > 0:
            stock_units = bundle_count * units_per

        if sale_product_rsd <= 0 and bundle_count > 1:
            sale_product_rsd = bundle_count * sale_unit
        elif "bundle_count" in fields and bundle_count == 1 and stock_units <= units_per:
            sale_product_rsd = 0

        street, city, postal = resolve_address(street, city, postal)
        conn.execute(
            """
            UPDATE leads SET first_name = ?, last_name = ?, street = ?, city = ?,
                postal_code = ?, phone = ?, notes = ?, bundle_count = ?,
                stock_units = ?, sale_product_rsd = ?
            WHERE id = ?
            """,
            (
                first_name,
                last_name,
                street,
                city,
                postal,
                phone,
                (notes or "").strip(),
                bundle_count,
                stock_units,
                sale_product_rsd,
                lead_id,
            ),
        )
        if (lead["order_id"] or "").strip():
            ensure_stock_deducted_for_order(conn, user["id"], lead_id)
        updated = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        stock_qty = get_stock(conn, user["id"])

    result = _lead_row(updated)
    result["stock_quantity"] = stock_qty
    return result


@app.patch("/api/leads/{lead_id}/order-id")
def update_order_id(lead_id: int, body: UpdateOrderIdRequest, user: User):
    order_id = body.order_id.strip()
    error = validate_order_id(order_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    with get_connection() as conn:
        lead = conn.execute(
            """
            SELECT l.* FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE l.id = ? AND b.user_id = ?
            """,
            (lead_id, user["id"]),
        ).fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found.")

        had_order_id = bool((lead["order_id"] or "").strip())

        if order_id:
            lifecycle = lead["lifecycle_status"] or "registered"
            new_lifecycle = "sent" if lifecycle == "registered" else lifecycle
            conn.execute(
                "UPDATE leads SET order_id = ?, lifecycle_status = ? WHERE id = ?",
                (order_id, new_lifecycle, lead_id),
            )
            if not had_order_id:
                deduct_stock_for_order(conn, user["id"], lead_id)
        else:
            if had_order_id:
                restore_stock_for_order(conn, user["id"], lead_id)
            conn.execute(
                """
                UPDATE leads SET
                    order_id = NULL,
                    lifecycle_status = 'registered',
                    tracking_status = NULL,
                    tracking_location = NULL,
                    tracking_updated_at = NULL,
                    tracking_history = NULL
                WHERE id = ?
                """,
                (lead_id,),
            )
        _sync_batch_courier_state(conn, lead["batch_id"])
        updated = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
        stock_qty = get_stock(conn, user["id"])

    result = _lead_row(updated)
    result["stock_quantity"] = stock_qty
    return result


@app.post("/api/batches/{batch_id}/mark-sent")
def mark_sent(batch_id: int, user: User):
    """Mark orders with Order IDs as sent; batch sent date requires at least one ID."""
    with get_connection() as conn:
        _get_user_batch(conn, batch_id, user["id"])
        conn.execute(
            """
            UPDATE leads SET lifecycle_status = 'sent'
            WHERE batch_id = ? AND order_id IS NOT NULL AND order_id != ''
              AND lifecycle_status = 'registered'
            """,
            (batch_id,),
        )
        _sync_batch_courier_state(conn, batch_id)
        updated = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        lc, linked = _batch_counts(conn, batch_id)
        if linked == 0:
            raise HTTPException(
                status_code=400,
                detail="Add at least one Order ID before marking as sent.",
            )

    return _batch_row(updated, lc, linked)


@app.post("/api/batches/{batch_id}/start-tracking")
def start_tracking(batch_id: int, user: User):
    with get_connection() as conn:
        batch = _get_user_batch(conn, batch_id, user["id"])

        trackable = conn.execute(
            """
            SELECT COUNT(*) FROM leads
            WHERE batch_id = ? AND order_id IS NOT NULL AND order_id != ''
            """,
            (batch_id,),
        ).fetchone()[0]
        if not trackable:
            raise HTTPException(
                status_code=400,
                detail="Add at least one Order ID before starting tracking.",
            )

        if not batch["sent_at"]:
            conn.execute(
                """
                UPDATE batches SET sent_at = ?, status = 'sent'
                WHERE id = ?
                """,
                (now_local(), batch_id),
            )

        conn.execute(
            """
            UPDATE leads SET lifecycle_status = 'sent'
            WHERE batch_id = ? AND order_id IS NOT NULL AND order_id != ''
              AND lifecycle_status = 'registered'
            """,
            (batch_id,),
        )

        conn.execute(
            "UPDATE batches SET status = 'tracking' WHERE id = ?",
            (batch_id,),
        )

    return {"ok": True, "status": "tracking", "trackable_count": trackable}


@app.post("/api/tracking/reset-session")
def reset_tracking_session(user: User):
    reset_session()
    return {"ok": True}


@app.post("/api/batches/{batch_id}/refresh-tracking")
def refresh_tracking(batch_id: int, user: User):
    with get_connection() as conn:
        batch = _get_user_batch(conn, batch_id, user["id"])
        batch_name = batch["name"]
        leads = conn.execute(
            """
            SELECT * FROM leads
            WHERE batch_id = ?
              AND order_id IS NOT NULL AND order_id != ''
            ORDER BY sort_order
            """,
            (batch_id,),
        ).fetchall()

    lead_rows = [dict(lead) for lead in leads]
    changes: list[dict] = []

    def _track_one(lead: dict) -> dict:
        ok, err, change = refresh_lead_tracking(lead["id"], lead["order_id"])
        if change:
            changes.append(change)
        if ok:
            with get_connection() as conn:
                updated = conn.execute(
                    "SELECT * FROM leads WHERE id = ?", (lead["id"],)
                ).fetchone()
            return {"lead_id": lead["id"], "ok": True, "lead": _lead_row(updated)}
        return {
            "lead_id": lead["id"],
            "ok": False,
            "order_id": lead["order_id"],
            "error": err or "Could not fetch status from AKS.",
        }

    results: list[dict] = []
    workers = min(8, max(1, len(lead_rows)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_track_one, lead) for lead in lead_rows]
        for fut in as_completed(futures):
            results.append(fut.result())

    results.sort(key=lambda r: next(
        (i for i, lead in enumerate(lead_rows) if lead["id"] == r["lead_id"]),
        0,
    ))
    ok_count = sum(1 for r in results if r["ok"])
    try:
        notify_user_tracking_run(
            user["id"],
            changes,
            ok_count,
            len(lead_rows),
            trigger="manual",
            batch_name=batch_name,
            batch_id=batch_id,
        )
    except Exception as exc:
        logger.warning("Telegram manual track notify failed: %s", exc)
    return {
        "results": results,
        "total": len(results),
        "ok_count": ok_count,
    }


@app.post("/api/leads/{lead_id}/refresh-tracking")
def refresh_lead_tracking_endpoint(lead_id: int, user: User):
    with get_connection() as conn:
        lead = conn.execute(
            """
            SELECT l.* FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE l.id = ? AND b.user_id = ?
            """,
            (lead_id, user["id"]),
        ).fetchone()
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found.")
        if not is_trackable_lead(lead["order_id"]):
            raise HTTPException(status_code=400, detail="This order has no Order ID yet.")

    ok, err, _ = refresh_lead_tracking(lead_id, lead["order_id"])
    with get_connection() as conn:
        updated = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()

    if not ok:
        return {
            "ok": False,
            "lead_id": lead_id,
            "order_id": lead["order_id"],
            "error": err or "Could not fetch status from AKS.",
            "lead": _lead_row(updated),
        }

    return {"ok": True, "lead_id": lead_id, "lead": _lead_row(updated)}


@app.delete("/api/batches/{batch_id}")
def delete_batch(batch_id: int, user: User):
    with get_connection() as conn:
        _get_user_batch(conn, batch_id, user["id"])
        from app.finance_db import restore_stock_for_order

        lead_ids = conn.execute(
            "SELECT id FROM leads WHERE batch_id = ?", (batch_id,)
        ).fetchall()
        for row in lead_ids:
            restore_stock_for_order(conn, user["id"], row["id"])
        conn.execute("DELETE FROM leads WHERE batch_id = ?", (batch_id,))
        conn.execute("DELETE FROM batches WHERE id = ?", (batch_id,))
    return {"ok": True}


@app.get("/{full_path:path}")
def spa_fallback(full_path: str):
    """React Router — serve index.html for client-side routes."""
    if full_path.startswith("api"):
        raise HTTPException(status_code=404)
    if FRONTEND_DIST.exists():
        asset = FRONTEND_DIST / full_path
        if asset.is_file():
            return FileResponse(asset)
        return FileResponse(FRONTEND_DIST / "index.html")
    raise HTTPException(status_code=404, detail="Frontend not built. Run: cd frontend && npm install && npm run build")
