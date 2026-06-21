"""Multi-tenant platform: users, subscriptions, product catalog."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.datetime_util import APP_TIMEZONE, add_days_local, days_until, now_local, parse_local_dt
from app.finance_db import get_finance_config

SUBSCRIPTION_STATUSES = frozenset({"active", "trial", "expired", "suspended"})
USER_ROLES = frozenset({"admin", "user"})


def migrate_platform(conn) -> None:
    from app.database import _column_exists

    if not _column_exists(conn, "users", "role"):
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
    if not _column_exists(conn, "users", "is_active"):
        conn.execute("ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
    if not _column_exists(conn, "users", "subscription_status"):
        conn.execute(
            "ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active'"
        )
    if not _column_exists(conn, "users", "subscription_expires_at"):
        conn.execute("ALTER TABLE users ADD COLUMN subscription_expires_at TEXT")
    if not _column_exists(conn, "users", "store_name"):
        conn.execute("ALTER TABLE users ADD COLUMN store_name TEXT NOT NULL DEFAULT ''")
    if not _column_exists(conn, "users", "telegram_chat_id"):
        conn.execute("ALTER TABLE users ADD COLUMN telegram_chat_id INTEGER")
    if not _column_exists(conn, "users", "telegram_enabled"):
        conn.execute("ALTER TABLE users ADD COLUMN telegram_enabled INTEGER NOT NULL DEFAULT 0")
    if not _column_exists(conn, "users", "telegram_link_token"):
        conn.execute("ALTER TABLE users ADD COLUMN telegram_link_token TEXT")
    if not _column_exists(conn, "users", "telegram_link_token_at"):
        conn.execute("ALTER TABLE users ADD COLUMN telegram_link_token_at TEXT")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_code TEXT NOT NULL,
            name TEXT NOT NULL,
            sale_price_rsd REAL NOT NULL,
            units_per_offer INTEGER NOT NULL DEFAULT 2,
            product_cost_eur REAL,
            delivery_fee_rsd REAL NOT NULL DEFAULT 490,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, product_code)
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_products_user_active
        ON products(user_id, is_active)
        """
    )

    if not _column_exists(conn, "batches", "product_id"):
        conn.execute("ALTER TABLE batches ADD COLUMN product_id INTEGER")

    _bootstrap_platform(conn)
    _bootstrap_telegram(conn)


def _bootstrap_telegram(conn) -> None:
    from app.telegram_bot import bootstrap_telegram_from_env

    bootstrap_telegram_from_env(conn)


def _bootstrap_platform(conn) -> None:
    conn.execute(
        "UPDATE users SET role = 'admin' WHERE lower(username) = 'auloni'"
    )
    if not conn.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone():
        first = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
        if first:
            conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", (first["id"],))

    for row in conn.execute("SELECT id FROM users").fetchall():
        ensure_default_product(conn, row["id"])


def product_row(row, *, batch_count: int | None = None) -> dict:
    result = {
        "id": row["id"],
        "product_code": row["product_code"],
        "name": row["name"],
        "sale_price_rsd": float(row["sale_price_rsd"]),
        "units_per_offer": int(row["units_per_offer"]),
        "product_cost_eur": (
            float(row["product_cost_eur"]) if row["product_cost_eur"] is not None else None
        ),
        "delivery_fee_rsd": float(row["delivery_fee_rsd"] or 490),
        "is_default": bool(row["is_default"]),
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "offer_label": f"{int(row['sale_price_rsd']):,} RSD / {int(row['units_per_offer'])} pcs",
    }
    if batch_count is not None:
        result["batch_count"] = batch_count
    return result


def user_platform_row(row) -> dict:
    expires = (
        row["subscription_expires_at"] if "subscription_expires_at" in row.keys() else None
    )
    status = (
        row["subscription_status"] if "subscription_status" in row.keys() else "active"
    )
    role = row["role"] if "role" in row.keys() else "user"
    if role != "admin" and status not in ("suspended",) and expires:
        if parse_local_dt(expires) <= datetime.now(APP_TIMEZONE):
            status = "expired"

    return {
        "id": row["id"],
        "username": row["username"] or "",
        "name": row["name"] or "",
        "role": role,
        "is_active": bool(row["is_active"] if "is_active" in row.keys() else 1),
        "subscription_status": status,
        "subscription_expires_at": expires,
        "subscription_days_remaining": days_until(expires) if role != "admin" else None,
        "store_name": row["store_name"] if "store_name" in row.keys() else "",
        "created_at": row["created_at"] if "created_at" in row.keys() else None,
    }


def sync_subscription_expiry(conn, user_id: int) -> None:
    """Mark subscription expired in DB when past expiry."""
    row = conn.execute(
        """
        SELECT role, subscription_status, subscription_expires_at
        FROM users WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    if not row or row["role"] == "admin" or row["subscription_status"] == "suspended":
        return
    expires = row["subscription_expires_at"]
    if not expires:
        return
    if parse_local_dt(expires) <= datetime.now(APP_TIMEZONE) and row["subscription_status"] != "expired":
        conn.execute(
            "UPDATE users SET subscription_status = 'expired' WHERE id = ?",
            (user_id,),
        )


def extend_subscription(conn, user_id: int, days: int) -> str:
    """Add days from max(now, current expiry). Returns new expires_at."""
    if days < 1:
        raise ValueError("Days must be at least 1.")
    row = conn.execute(
        "SELECT subscription_expires_at, subscription_status FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        raise ValueError("User not found.")

    now = datetime.now(APP_TIMEZONE)
    base = now
    if row["subscription_expires_at"]:
        current = parse_local_dt(row["subscription_expires_at"])
        if current > now:
            base = current

    new_expires = add_days_local(days, from_dt=base)
    status = row["subscription_status"] or "active"
    if status != "suspended":
        status = "active"
    conn.execute(
        """
        UPDATE users SET subscription_expires_at = ?, subscription_status = ?
        WHERE id = ?
        """,
        (new_expires, status, user_id),
    )
    return new_expires


def subtract_subscription(conn, user_id: int, days: int) -> str:
    """Remove days from current expiry (not below now). Returns new expires_at."""
    if days < 1:
        raise ValueError("Days must be at least 1.")
    row = conn.execute(
        "SELECT subscription_expires_at, subscription_status FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    if not row or not row["subscription_expires_at"]:
        raise ValueError("No subscription expiry set.")

    now = datetime.now(APP_TIMEZONE)
    current = parse_local_dt(row["subscription_expires_at"])
    new_dt = current - timedelta(days=days)
    if new_dt < now:
        new_dt = now

    new_expires = new_dt.strftime("%Y-%m-%d %H:%M:%S")
    status = row["subscription_status"] or "active"
    if status != "suspended":
        status = "expired" if new_dt <= now else "active"
    conn.execute(
        """
        UPDATE users SET subscription_expires_at = ?, subscription_status = ?
        WHERE id = ?
        """,
        (new_expires, status, user_id),
    )
    return new_expires


def ensure_subscription_active_if_unsuspended(conn, user_id: int, min_days: int = 1) -> None:
    """When admin sets active, grant at least min_days if expiry is in the past."""
    row = conn.execute(
        """
        SELECT subscription_expires_at, subscription_status
        FROM users WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    if not row or row["subscription_status"] == "suspended":
        return
    now = datetime.now(APP_TIMEZONE)
    expires = row["subscription_expires_at"]
    if not expires or parse_local_dt(expires) <= now:
        new_expires = add_days_local(min_days, from_dt=now)
        conn.execute(
            """
            UPDATE users SET subscription_expires_at = ?, subscription_status = 'active'
            WHERE id = ?
            """,
            (new_expires, user_id),
        )


def set_initial_subscription(conn, user_id: int, days: int) -> str:
    """Set subscription expiry from now for a new user."""
    if days < 1:
        raise ValueError("Days must be at least 1.")
    expires = add_days_local(days)
    conn.execute(
        """
        UPDATE users SET subscription_expires_at = ?, subscription_status = 'active'
        WHERE id = ?
        """,
        (expires, user_id),
    )
    return expires


def list_products(conn, user_id: int, *, active_only: bool = True) -> list[dict]:
    query = """
        SELECT * FROM products WHERE user_id = ?
    """
    params: list = [user_id]
    if active_only:
        query += " AND is_active = 1"
    query += " ORDER BY is_default DESC, name ASC"
    rows = conn.execute(query, params).fetchall()
    results = []
    for row in rows:
        batch_count = conn.execute(
            "SELECT COUNT(*) FROM batches WHERE user_id = ? AND product_id = ?",
            (user_id, row["id"]),
        ).fetchone()[0]
        results.append(product_row(row, batch_count=batch_count))
    return results


def get_product(conn, user_id: int, product_id: int):
    return conn.execute(
        "SELECT * FROM products WHERE id = ? AND user_id = ?",
        (product_id, user_id),
    ).fetchone()


def get_default_product(conn, user_id: int):
    row = conn.execute(
        """
        SELECT * FROM products
        WHERE user_id = ? AND is_active = 1
        ORDER BY is_default DESC, id ASC LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    return product_row(row) if row else None


def ensure_default_product(conn, user_id: int) -> int | None:
    """Mark one active product as default if none is set. Never auto-creates products."""
    row = conn.execute(
        """
        SELECT id FROM products
        WHERE user_id = ? AND is_active = 1
        ORDER BY id ASC LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    if not row:
        return None
    if not conn.execute(
        "SELECT 1 FROM products WHERE user_id = ? AND is_active = 1 AND is_default = 1",
        (user_id,),
    ).fetchone():
        conn.execute(
            "UPDATE products SET is_default = 1 WHERE id = ?",
            (row["id"],),
        )
    return row["id"]


def normalize_product_code(code: str) -> str:
    cleaned = "".join(c for c in (code or "").upper().strip() if c.isalnum() or c in "-_")
    return cleaned[:32]


def create_product(
    conn,
    user_id: int,
    *,
    product_code: str,
    name: str,
    sale_price_rsd: float,
    units_per_offer: int,
    product_cost_eur: float | None = None,
    delivery_fee_rsd: float = 490,
    is_default: bool = False,
) -> dict:
    code = normalize_product_code(product_code)
    if not code or len(name.strip()) < 2:
        raise ValueError("Product code and name are required.")
    if sale_price_rsd <= 0 or units_per_offer < 1:
        raise ValueError("Invalid price or units per offer.")

    dup = conn.execute(
        "SELECT id FROM products WHERE user_id = ? AND product_code = ?",
        (user_id, code),
    ).fetchone()
    if dup:
        raise ValueError(f"Product code {code} already exists.")

    ts = now_local()
    if is_default or not conn.execute(
        "SELECT 1 FROM products WHERE user_id = ? AND is_default = 1", (user_id,)
    ).fetchone():
        conn.execute("UPDATE products SET is_default = 0 WHERE user_id = ?", (user_id,))
        is_default = True

    cursor = conn.execute(
        """
        INSERT INTO products (
            user_id, product_code, name, sale_price_rsd, units_per_offer,
            product_cost_eur, delivery_fee_rsd, is_default, is_active,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            user_id,
            code,
            name.strip(),
            round(sale_price_rsd, 2),
            units_per_offer,
            product_cost_eur,
            round(delivery_fee_rsd, 2),
            1 if is_default else 0,
            ts,
            ts,
        ),
    )
    row = conn.execute("SELECT * FROM products WHERE id = ?", (cursor.lastrowid,)).fetchone()
    _sync_finance_from_default_product(conn, user_id)
    return product_row(row)


def update_product(
    conn,
    user_id: int,
    product_id: int,
    *,
    name: str | None = None,
    sale_price_rsd: float | None = None,
    units_per_offer: int | None = None,
    product_cost_eur: float | None = None,
    delivery_fee_rsd: float | None = None,
    is_default: bool | None = None,
    is_active: bool | None = None,
) -> dict:
    row = get_product(conn, user_id, product_id)
    if not row:
        raise ValueError("Product not found.")

    if is_default:
        conn.execute("UPDATE products SET is_default = 0 WHERE user_id = ?", (user_id,))

    conn.execute(
        """
        UPDATE products SET
            name = COALESCE(?, name),
            sale_price_rsd = COALESCE(?, sale_price_rsd),
            units_per_offer = COALESCE(?, units_per_offer),
            product_cost_eur = COALESCE(?, product_cost_eur),
            delivery_fee_rsd = COALESCE(?, delivery_fee_rsd),
            is_default = COALESCE(?, is_default),
            is_active = COALESCE(?, is_active),
            updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            name.strip() if name else None,
            round(sale_price_rsd, 2) if sale_price_rsd is not None else None,
            units_per_offer,
            product_cost_eur,
            round(delivery_fee_rsd, 2) if delivery_fee_rsd is not None else None,
            1 if is_default else (0 if is_default is False else None),
            1 if is_active else (0 if is_active is False else None),
            now_local(),
            product_id,
            user_id,
        ),
    )
    updated = get_product(conn, user_id, product_id)
    _sync_finance_from_default_product(conn, user_id)
    return product_row(updated)


def delete_product(conn, user_id: int, product_id: int) -> dict:
    """Soft-delete a product. Existing batches keep their linked pricing."""
    row = get_product(conn, user_id, product_id)
    if not row:
        raise ValueError("Product not found.")
    if not row["is_active"]:
        raise ValueError("Product already removed.")

    batch_count = conn.execute(
        "SELECT COUNT(*) FROM batches WHERE user_id = ? AND product_id = ?",
        (user_id, product_id),
    ).fetchone()[0]

    was_default = bool(row["is_default"])
    conn.execute(
        """
        UPDATE products SET is_active = 0, is_default = 0, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (now_local(), product_id, user_id),
    )

    if was_default:
        successor = conn.execute(
            """
            SELECT id FROM products
            WHERE user_id = ? AND is_active = 1
            ORDER BY id ASC LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        if successor:
            conn.execute(
                "UPDATE products SET is_default = 1 WHERE id = ?",
                (successor["id"],),
            )

    _sync_finance_from_default_product(conn, user_id)
    return {"ok": True, "batch_count": batch_count}


def update_user_profile(
    conn,
    user_id: int,
    *,
    username: str | None = None,
    name: str | None = None,
) -> None:
    from app.database import _column_exists

    updates: list[str] = []
    params: list[object] = []
    if username is not None:
        updates.append("username = ?")
        params.append(username)
        if _column_exists(conn, "users", "email"):
            updates.append("email = ?")
            params.append(username)
    if name is not None:
        updates.append("name = ?")
        params.append(name.strip())
    if not updates:
        return
    params.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)


def _sync_finance_from_default_product(conn, user_id: int) -> None:
    """Keep finance_config aligned with default product for legacy code paths."""
    default = conn.execute(
        """
        SELECT sale_price_rsd, units_per_offer, product_cost_eur
        FROM products WHERE user_id = ? AND is_default = 1 AND is_active = 1 LIMIT 1
        """,
        (user_id,),
    ).fetchone()
    if not default:
        return
    conn.execute(
        """
        UPDATE finance_config SET
            sale_price_rsd = ?,
            units_per_order = ?,
            product_cost_eur = COALESCE(?, product_cost_eur)
        WHERE user_id = ?
        """,
        (
            default["sale_price_rsd"],
            default["units_per_offer"],
            default["product_cost_eur"],
            user_id,
        ),
    )


def product_pricing(conn, user_id: int, product_id: int | None = None) -> dict:
    if product_id:
        row = get_product(conn, user_id, product_id)
        if row:
            return {
                "product_id": row["id"],
                "sale_price_rsd": float(row["sale_price_rsd"]),
                "units_per_offer": int(row["units_per_offer"]),
                "delivery_fee_rsd": float(row["delivery_fee_rsd"] or 490),
                "product_cost_eur": float(row["product_cost_eur"] or 2),
            }
    default = get_default_product(conn, user_id)
    if default:
        return {
            "product_id": default["id"],
            "sale_price_rsd": default["sale_price_rsd"],
            "units_per_offer": default["units_per_offer"],
            "delivery_fee_rsd": default["delivery_fee_rsd"],
            "product_cost_eur": default["product_cost_eur"] or 2.0,
        }
    cfg = get_finance_config(conn, user_id)
    return {
        "product_id": None,
        "sale_price_rsd": float(cfg["sale_price_rsd"]),
        "units_per_offer": int(cfg["units_per_order"]),
        "delivery_fee_rsd": 490.0,
        "product_cost_eur": float(cfg["product_cost_eur"]),
    }
