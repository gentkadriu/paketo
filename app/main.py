import json
import logging
import os
import re
import unicodedata
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Header
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
from app.parser import parse_leads_text, parse_leads_text_detailed, lead_fingerprint, ParsedLead
from app.scheduler import refresh_lead_tracking, start_scheduler, stop_scheduler
from app.status import MANUAL_STATUSES, STATUS_LABELS, display_status, is_trackable_lead, label_for
from app.aks_client import reset_session
from app.datetime_util import local_date, now_local
from app.username import normalize_username, validate_username

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("posta")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if os.environ.get("POSTA_SECRET", "posta-dev-secret-change-in-production") == "posta-dev-secret-change-in-production":
        logger.warning("POSTA_SECRET is not set — use a strong random secret in production (.env).")
    init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Paketo", lifespan=lifespan)
init_db()
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
LEGACY_STATIC = BASE_DIR / "static"


def _user_row(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"] or "",
        "name": row["name"] or "",
    }


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


# ── Auth dependency ──────────────────────────────────────────────

def get_current_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not logged in.")
    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")

    with get_connection() as conn:
        user = conn.execute(
            "SELECT id, username, name FROM users WHERE id = ?",
            (int(payload["sub"]),),
        ).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")
    return _user_row(user)


User = Annotated[dict, Depends(get_current_user)]


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


class UpdateBatchRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class UpdateOrderIdRequest(BaseModel):
    order_id: str = Field(default="")


class BulkLeadActionRequest(BaseModel):
    lead_ids: list[int] = Field(min_length=1)
    action: Literal["delete", "mark_sent", "set_status"]
    status: str | None = None


class LeadsTextRequest(BaseModel):
    leads_text: str = Field(min_length=1)


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
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "sort_order": row["sort_order"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "full_name": f"{row['first_name']} {row['last_name']}".strip(),
        "street": row["street"],
        "city": row["city"],
        "postal_code": row["postal_code"],
        "phone": row["phone"],
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
    }


def _batch_row(row, lead_count: int, linked_count: int) -> dict[str, Any]:
    imported_date = local_date(row["created_at"])
    sent_date = local_date(row["sent_at"])
    return {
        "id": row["id"],
        "name": row["name"],
        "created_at": row["created_at"],
        "imported_date": imported_date,
        "sent_at": row["sent_at"],
        "sent_date": sent_date,
        "status": row["status"],
        "lead_count": lead_count,
        "linked_count": linked_count,
    }


def _batch_counts(conn, batch_id: int) -> tuple[int, int]:
    lead_count = conn.execute(
        "SELECT COUNT(*) FROM leads WHERE batch_id = ?", (batch_id,)
    ).fetchone()[0]
    linked_count = conn.execute(
        "SELECT COUNT(*) FROM leads WHERE batch_id = ? AND order_id IS NOT NULL AND order_id != ''",
        (batch_id,),
    ).fetchone()[0]
    return lead_count, linked_count


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
    return {
        "first_name": lead.first_name,
        "last_name": lead.last_name,
        "full_name": f"{lead.first_name} {lead.last_name}".strip(),
        "street": lead.street,
        "city": lead.city,
        "postal_code": lead.postal_code,
        "phone": lead.phone,
    }


def _insert_leads(conn, batch_id: int, leads: list[ParsedLead], start_sort: int = 1) -> int:
    ts = now_local()
    for index, lead in enumerate(leads, start=start_sort):
        conn.execute(
            """
            INSERT INTO leads (
                batch_id, sort_order, first_name, last_name,
                street, city, postal_code, phone, lifecycle_status, imported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?)
            """,
            (
                batch_id, index,
                lead.first_name, lead.last_name,
                lead.street, lead.city, lead.postal_code, lead.phone, ts,
            ),
        )
    return len(leads)


def _find_duplicate_leads(
    conn, user_id: int, leads: list[ParsedLead], batch_id: int | None = None,
) -> list[dict[str, Any]]:
    if not leads:
        return []
    existing = conn.execute(
        """
        SELECT l.first_name, l.last_name, l.phone, l.batch_id, b.name AS batch_name
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
        """,
        (user_id,),
    ).fetchall()
    existing_fps = {}
    for row in existing:
        fp = f"{re.sub(r'\D', '', row['phone'] or '')}|{(row['first_name'] + ' ' + row['last_name']).strip().lower()}"
        existing_fps[fp] = {"batch_id": row["batch_id"], "batch_name": row["batch_name"], "full_name": f"{row['first_name']} {row['last_name']}".strip()}

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
    leads = conn.execute(
        "SELECT * FROM leads WHERE batch_id = ? ORDER BY sort_order",
        (batch_id,),
    ).fetchall()
    linked_count = sum(1 for lead in leads if lead["order_id"])
    return {
        **_batch_row(batch, len(leads), linked_count),
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

@app.post("/api/auth/register")
def register(body: RegisterRequest):
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
        user = conn.execute(
            "SELECT id, username, name FROM users WHERE id = ?", (user_id,)
        ).fetchone()

    token = create_access_token(user["id"], user["username"])
    return {"token": token, "user": _user_row(user)}


@app.post("/api/auth/login")
def login(body: LoginRequest):
    username = normalize_username(body.username)
    with get_connection() as conn:
        user = conn.execute(
            "SELECT id, username, name, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")

    token = create_access_token(user["id"], user["username"])
    return {"token": token, "user": _user_row(user)}


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
    """Return dates that have batches, for calendar picker."""
    column = "created_at" if kind == "imported" else "sent_at"
    if kind not in ("imported", "sent"):
        raise HTTPException(status_code=400, detail="kind must be imported or sent")

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
            lc, linked = _batch_counts(conn, batch["id"])
            result.append(_batch_row(batch, lc, linked))

    return result


@app.get("/api/dashboard/today")
def dashboard_today(user: User):
    today = local_date(now_local())
    with get_connection() as conn:
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
    }


@app.get("/api/statistics/timeline")
def statistics_timeline(user: User, days: int = 14):
    days = max(7, min(days, 90))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT date(l.imported_at) AS d, COUNT(*) AS cnt
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.imported_at IS NOT NULL
              AND date(l.imported_at) >= date('now', ?)
            GROUP BY date(l.imported_at)
            ORDER BY d ASC
            """,
            (user["id"], f"-{days - 1} days"),
        ).fetchall()

        delivered_rows = conn.execute(
            """
            SELECT date(l.tracking_updated_at) AS d, COUNT(*) AS cnt
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.lifecycle_status = 'delivered'
              AND l.tracking_updated_at IS NOT NULL
              AND date(l.tracking_updated_at) >= date('now', ?)
            GROUP BY date(l.tracking_updated_at)
            ORDER BY d ASC
            """,
            (user["id"], f"-{days - 1} days"),
        ).fetchall()

    imported_by_day = {r["d"]: r["cnt"] for r in rows}
    delivered_by_day = {r["d"]: r["cnt"] for r in delivered_rows}
    all_dates = sorted(set(imported_by_day) | set(delivered_by_day))

    timeline = [
        {
            "date": d,
            "imported": imported_by_day.get(d, 0),
            "delivered": delivered_by_day.get(d, 0),
        }
        for d in all_dates
    ]

    return {"days": days, "timeline": timeline}


@app.post("/api/leads/parse-preview")
def parse_preview(body: ParsePreviewRequest, user: User):
    parsed = parse_leads_text_detailed(body.leads_text)
    with get_connection() as conn:
        duplicates = _find_duplicate_leads(conn, user["id"], parsed.leads, body.batch_id)
    return {
        "recognized": [_parsed_lead_dict(l) for l in parsed.leads],
        "skipped": parsed.skipped,
        "duplicates": duplicates,
        "count": len(parsed.leads),
    }


# ── Statistics ───────────────────────────────────────────────────
@app.get("/api/statistics")
def get_statistics(user: User, date: str | None = None, batch_id: int | None = None):
    return statistics(user, date=date, batch_id=batch_id)


def statistics(user: User, date: str | None = None, batch_id: int | None = None):
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


# ── Batches CRUD ─────────────────────────────────────────────────

@app.get("/api/batches")
def list_batches(user: User):
    return dashboard_batches(user)


@app.post("/api/batches")
def create_batch(body: CreateBatchRequest, user: User):
    leads = parse_leads_text(body.leads_text)
    if not leads:
        raise HTTPException(
            status_code=400,
            detail="No leads recognized. Format: Name Surname, street, city postal code, phone.",
        )

    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO batches (user_id, name, created_at) VALUES (?, ?, ?)",
            (user["id"], body.name.strip(), now_local()),
        )
        batch_id = cursor.lastrowid
        _insert_leads(conn, batch_id, leads)
        batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()

    return _batch_row(batch, len(leads), 0)


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
        max_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM leads WHERE batch_id = ?",
            (batch_id,),
        ).fetchone()[0]
        _insert_leads(conn, batch_id, parsed.leads, start_sort=max_sort + 1)
        return _get_batch_detail(conn, batch_id, user["id"])


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
            applied += 1

        batch = conn.execute("SELECT sent_at FROM batches WHERE id = ?", (batch_id,)).fetchone()
        if not batch["sent_at"]:
            conn.execute(
                "UPDATE batches SET sent_at = ?, status = 'sent' WHERE id = ?",
                (ts, batch_id),
            )

        return {
            "applied": applied,
            "remaining_without_id": max(0, len(leads) - applied),
            "unused_ids": max(0, len(order_ids) - applied),
            "batch": _get_batch_detail(conn, batch_id, user["id"]),
        }


@app.patch("/api/batches/{batch_id}")
def update_batch(batch_id: int, body: UpdateBatchRequest, user: User):
    with get_connection() as conn:
        _get_user_batch(conn, batch_id, user["id"])
        conn.execute(
            "UPDATE batches SET name = ? WHERE id = ?",
            (body.name.strip(), batch_id),
        )
        batch = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        lc, linked = _batch_counts(conn, batch_id)

    return _batch_row(batch, lc, linked)


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
                """,
                (batch_id, *lead_ids),
            )
            batch = conn.execute("SELECT sent_at FROM batches WHERE id = ?", (batch_id,)).fetchone()
            if not batch["sent_at"]:
                conn.execute(
                    "UPDATE batches SET sent_at = ?, status = 'sent' WHERE id = ?",
                    (now_local(), batch_id),
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
            if body.status == "sent":
                batch = conn.execute("SELECT sent_at FROM batches WHERE id = ?", (batch_id,)).fetchone()
                if not batch["sent_at"]:
                    conn.execute(
                        "UPDATE batches SET sent_at = ?, status = 'sent' WHERE id = ?",
                        (now_local(), batch_id),
                    )

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

        if order_id:
            lifecycle = lead["lifecycle_status"] or "registered"
            new_lifecycle = "sent" if lifecycle == "registered" else lifecycle
            conn.execute(
                "UPDATE leads SET order_id = ?, lifecycle_status = ? WHERE id = ?",
                (order_id, new_lifecycle, lead_id),
            )
            batch = conn.execute(
                "SELECT sent_at FROM batches WHERE id = ?",
                (lead["batch_id"],),
            ).fetchone()
            if not batch["sent_at"]:
                conn.execute(
                    """
                    UPDATE batches SET sent_at = ?, status = 'sent'
                    WHERE id = ?
                    """,
                    (now_local(), lead["batch_id"]),
                )
        else:
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
        updated = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()

    return _lead_row(updated)


@app.post("/api/batches/{batch_id}/mark-sent")
def mark_sent(batch_id: int, user: User):
    """Step 2: orders physically sent to AKS courier."""
    with get_connection() as conn:
        batch = _get_user_batch(conn, batch_id, user["id"])
        conn.execute(
            "UPDATE batches SET sent_at = ?, status = 'sent' WHERE id = ?",
            (now_local(), batch_id),
        )
        conn.execute(
            """
            UPDATE leads SET lifecycle_status = 'sent'
            WHERE batch_id = ? AND lifecycle_status = 'registered'
            """,
            (batch_id,),
        )
        updated = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
        lc, linked = _batch_counts(conn, batch_id)

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
        _get_user_batch(conn, batch_id, user["id"])
        leads = conn.execute(
            """
            SELECT * FROM leads
            WHERE batch_id = ?
              AND order_id IS NOT NULL AND order_id != ''
            ORDER BY sort_order
            """,
            (batch_id,),
        ).fetchall()

    results = []
    for lead in leads:
        ok, err = refresh_lead_tracking(lead["id"], lead["order_id"])
        if ok:
            with get_connection() as conn:
                updated = conn.execute(
                    "SELECT * FROM leads WHERE id = ?", (lead["id"],)
                ).fetchone()
            results.append({"lead_id": lead["id"], "ok": True, "lead": _lead_row(updated)})
        else:
            results.append({
                "lead_id": lead["id"],
                "ok": False,
                "order_id": lead["order_id"],
                "error": err or "Could not fetch status from AKS.",
            })

    return {"results": results, "total": len(results), "ok_count": sum(1 for r in results if r["ok"])}


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

    ok, err = refresh_lead_tracking(lead_id, lead["order_id"])
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
