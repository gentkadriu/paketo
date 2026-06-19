"""Finance DB helpers: stock, ledger, config."""

from __future__ import annotations

import re

from app.datetime_util import now_local
from app.finance import DEFAULT_CONFIG, parse_config, usd_to_eur

ORDER_SENT_NOTE_RE = re.compile(r"^Order #(\d+) sent$")
ORDER_RETURNED_NOTE_RE = re.compile(r"^Order #(\d+) returned$")
FINAL_RETURN_STATUSES = frozenset({"returned", "rejected"})


def _ensure_finance_tables(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS finance_config (
            user_id INTEGER PRIMARY KEY,
            sale_price_rsd REAL NOT NULL DEFAULT 1000,
            product_cost_eur REAL NOT NULL DEFAULT 2,
            shipping_cost_usd REAL NOT NULL DEFAULT 2,
            return_fee_rsd REAL NOT NULL DEFAULT 500,
            units_per_order INTEGER NOT NULL DEFAULT 2,
            eur_rsd REAL NOT NULL DEFAULT 117,
            usd_rsd REAL NOT NULL DEFAULT 101,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS finance_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount_eur REAL NOT NULL,
            category TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            batch_id INTEGER,
            stock_delta INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_stock (
            user_id INTEGER PRIMARY KEY,
            quantity INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def migrate_finance(conn) -> None:
    from app.database import _column_exists

    _ensure_finance_tables(conn)
    if not _column_exists(conn, "batches", "ad_spend_usd"):
        conn.execute("ALTER TABLE batches ADD COLUMN ad_spend_usd REAL")
    if not _column_exists(conn, "batches", "boost_days"):
        conn.execute("ALTER TABLE batches ADD COLUMN boost_days INTEGER")
    if not _column_exists(conn, "leads", "stock_units_reserved"):
        conn.execute(
            "ALTER TABLE leads ADD COLUMN stock_units_reserved INTEGER NOT NULL DEFAULT 0"
        )
    if not _column_exists(conn, "leads", "stock_inventory_committed"):
        conn.execute(
            "ALTER TABLE leads ADD COLUMN stock_inventory_committed INTEGER NOT NULL DEFAULT 0"
        )
    _migrate_stock_committed_flags(conn)
    if not _column_exists(conn, "leads", "payment_received_at"):
        conn.execute("ALTER TABLE leads ADD COLUMN payment_received_at TEXT")
    if not _column_exists(conn, "leads", "payment_amount_rsd"):
        conn.execute("ALTER TABLE leads ADD COLUMN payment_amount_rsd REAL")
    if not _column_exists(conn, "leads", "payment_settlement_ref"):
        conn.execute("ALTER TABLE leads ADD COLUMN payment_settlement_ref TEXT")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS aks_settlements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            settlement_ref TEXT NOT NULL,
            settlement_date TEXT,
            filename TEXT NOT NULL,
            line_count INTEGER NOT NULL,
            total_product_rsd REAL NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_aks_settlement_user_ref
        ON aks_settlements(user_id, settlement_ref)
        """
    )


def get_finance_config(conn, user_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM finance_config WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        conn.execute(
            """
            INSERT INTO finance_config (user_id) VALUES (?)
            """,
            (user_id,),
        )
        row = conn.execute(
            "SELECT * FROM finance_config WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return parse_config(dict(row) if row else None)


def get_stock(conn, user_id: int) -> int:
    row = conn.execute(
        "SELECT quantity FROM user_stock WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO user_stock (user_id, quantity) VALUES (?, 0)",
            (user_id,),
        )
        return 0
    return int(row["quantity"])


def set_stock(conn, user_id: int, quantity: int) -> int:
    get_stock(conn, user_id)
    conn.execute(
        "UPDATE user_stock SET quantity = ? WHERE user_id = ?",
        (max(0, quantity), user_id),
    )
    return max(0, quantity)


def adjust_stock(conn, user_id: int, delta: int) -> int:
    current = get_stock(conn, user_id)
    new_qty = max(0, current + delta)
    conn.execute(
        "UPDATE user_stock SET quantity = ? WHERE user_id = ?",
        (new_qty, user_id),
    )
    return new_qty


def ledger_balance(conn, user_id: int) -> float:
    row = conn.execute(
        "SELECT COALESCE(SUM(amount_eur), 0) AS total FROM finance_ledger WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return round(float(row["total"]), 2)


def order_sent_note(lead_id: int) -> str:
    return f"Order #{lead_id} sent"


def order_returned_note(lead_id: int) -> str:
    return f"Order #{lead_id} returned"


def _units_per_order(conn, user_id: int) -> int:
    cfg = get_finance_config(conn, user_id)
    return int(cfg.get("units_per_order", 2))


def lead_stock_deduct_units(conn, user_id: int, lead_id: int) -> int:
    row = conn.execute(
        """
        SELECT l.stock_units, l.bundle_count, l.sale_product_rsd, p.units_per_offer
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        LEFT JOIN products p ON p.id = b.product_id
        WHERE l.id = ? AND b.user_id = ?
        """,
        (lead_id, user_id),
    ).fetchone()
    if not row:
        return _units_per_order(conn, user_id)
    explicit = int(row["stock_units"] or 0)
    if explicit > 0:
        return explicit
    cfg = get_finance_config(conn, user_id)
    units = int(row["units_per_offer"] or 0) or _units_per_order(conn, user_id)
    bundle = max(1, int(row["bundle_count"] or 1))
    sale_rsd = int(row["sale_product_rsd"] or 0)
    unit_price = int(cfg.get("sale_price_rsd", 1000))
    if sale_rsd > unit_price:
        from app.parser import _bundle_from_product

        bundle = max(bundle, _bundle_from_product(sale_rsd))
    return bundle * units


def find_order_sent_entry(conn, user_id: int, lead_id: int):
    return conn.execute(
        """
        SELECT id, stock_delta FROM finance_ledger
        WHERE user_id = ? AND category = 'stock_use' AND note = ?
        ORDER BY id DESC LIMIT 1
        """,
        (user_id, order_sent_note(lead_id)),
    ).fetchone()


def find_order_returned_entry(conn, user_id: int, lead_id: int):
    return conn.execute(
        """
        SELECT id FROM finance_ledger
        WHERE user_id = ? AND category = 'stock_return' AND note = ?
        LIMIT 1
        """,
        (user_id, order_returned_note(lead_id)),
    ).fetchone()


def _lead_stock_reserved(conn, lead_id: int) -> int:
    row = conn.execute(
        "SELECT stock_units_reserved FROM leads WHERE id = ?",
        (lead_id,),
    ).fetchone()
    return int(row["stock_units_reserved"] or 0) if row else 0


def purge_automatic_stock_ledger(conn, user_id: int) -> int:
    """Delete all automatic order-stock log rows (never shown in Recent entries)."""
    cursor = conn.execute(
        """
        DELETE FROM finance_ledger
        WHERE user_id = ? AND category IN ('stock_use', 'stock_return')
        """,
        (user_id,),
    )
    return cursor.rowcount


def _migrate_stock_committed_flags(conn) -> None:
    """One-time: trust reserved flags only when inventory was already reduced."""
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key = 'stock_committed_v1'"
    ).fetchone()
    if row:
        return

    users = conn.execute("SELECT id FROM users").fetchall()
    for user in users:
        user_id = user["id"]
        active = conn.execute(
            """
            SELECT l.id, l.stock_units_reserved
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
              AND l.order_id IS NOT NULL AND l.order_id != ''
              AND l.lifecycle_status NOT IN ('returned', 'rejected')
            """,
            (user_id,),
        ).fetchall()
        if not active:
            continue

        needed = sum(lead_stock_deduct_units(conn, user_id, r["id"]) for r in active)
        current = get_stock(conn, user_id)
        lead_ids = [r["id"] for r in active]

        if needed > 0 and current >= needed:
            conn.execute(
                f"""
                UPDATE leads SET stock_inventory_committed = 0
                WHERE id IN ({",".join("?" * len(lead_ids))})
                """,
                lead_ids,
            )
        else:
            conn.execute(
                f"""
                UPDATE leads SET stock_inventory_committed = 1
                WHERE id IN ({",".join("?" * len(lead_ids))})
                  AND stock_units_reserved > 0
                """,
                lead_ids,
            )

    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('stock_committed_v1', '1')"
    )


def ensure_stock_deducted_for_order(conn, user_id: int, lead_id: int) -> None:
    """Commit inventory when an Order ID is active (sent to courier). Idempotent."""
    row = conn.execute(
        """
        SELECT l.order_id, l.lifecycle_status, l.stock_units_reserved,
               l.stock_inventory_committed
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE l.id = ? AND b.user_id = ?
        """,
        (lead_id, user_id),
    ).fetchone()
    if not row or not (row["order_id"] or "").strip():
        return
    if (row["lifecycle_status"] or "") in FINAL_RETURN_STATUSES:
        return

    units = lead_stock_deduct_units(conn, user_id, lead_id)
    reserved = int(row["stock_units_reserved"] or 0)
    committed = int(row["stock_inventory_committed"] or 0)

    if committed:
        if units > reserved:
            adjust_stock(conn, user_id, -(units - reserved))
        elif units < reserved:
            adjust_stock(conn, user_id, reserved - units)
        if reserved != units:
            conn.execute(
                "UPDATE leads SET stock_units_reserved = ? WHERE id = ?",
                (units, lead_id),
            )
        return

    adjust_stock(conn, user_id, -units)
    conn.execute(
        """
        UPDATE leads SET stock_units_reserved = ?, stock_inventory_committed = 1
        WHERE id = ?
        """,
        (units, lead_id),
    )


def reconcile_user_stock(conn, user_id: int) -> int:
    """Set stock = purchased pieces − pieces still out with courier (not final return)."""
    row = conn.execute(
        """
        SELECT COALESCE(SUM(stock_delta), 0) AS purchased
        FROM finance_ledger WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    purchased = int(row["purchased"] or 0)
    if purchased <= 0:
        return get_stock(conn, user_id)

    leads = conn.execute(
        """
        SELECT l.id FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
          AND l.order_id IS NOT NULL AND l.order_id != ''
        """,
        (user_id,),
    ).fetchall()

    committed = 0
    for lead_row in leads:
        units = lead_stock_deduct_units(conn, user_id, lead_row["id"])
        committed += units
        conn.execute(
            """
            UPDATE leads
            SET stock_units_reserved = ?, stock_inventory_committed = 1
            WHERE id = ?
            """,
            (units, lead_row["id"]),
        )

    for lead_row in conn.execute(
        """
        SELECT l.id FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
          AND (l.order_id IS NULL OR l.order_id = '')
        """,
        (user_id,),
    ).fetchall():
        conn.execute(
            """
            UPDATE leads
            SET stock_units_reserved = 0, stock_inventory_committed = 0
            WHERE id = ?
            """,
            (lead_row["id"],),
        )

    new_qty = max(0, purchased - committed)
    conn.execute(
        "UPDATE user_stock SET quantity = ? WHERE user_id = ?",
        (new_qty, user_id),
    )
    return new_qty


def cleanup_stock_ledger_noise(conn, user_id: int) -> None:
    """Reconcile stock from purchases vs active shipments, then purge ledger noise."""
    reconcile_user_stock(conn, user_id)
    purge_automatic_stock_ledger(conn, user_id)


def add_ledger_entry(
    conn,
    user_id: int,
    *,
    amount_eur: float,
    category: str,
    note: str = "",
    batch_id: int | None = None,
    stock_delta: int = 0,
) -> dict:
    ts = now_local()
    cursor = conn.execute(
        """
        INSERT INTO finance_ledger (user_id, amount_eur, category, note, batch_id, stock_delta, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, round(amount_eur, 2), category, note or "", batch_id, stock_delta, ts),
    )
    if stock_delta:
        adjust_stock(conn, user_id, stock_delta)
    return {
        "id": cursor.lastrowid,
        "amount_eur": round(amount_eur, 2),
        "category": category,
        "note": note or "",
        "batch_id": batch_id,
        "stock_delta": stock_delta,
        "created_at": ts,
    }


def _release_lead_stock(conn, user_id: int, lead_id: int) -> None:
    reserved = _lead_stock_reserved(conn, lead_id)
    if not reserved:
        return
    adjust_stock(conn, user_id, reserved)
    conn.execute(
        """
        UPDATE leads SET stock_units_reserved = 0, stock_inventory_committed = 0
        WHERE id = ?
        """,
        (lead_id,),
    )


def deduct_stock_for_order(conn, user_id: int, lead_id: int) -> None:
    """Remove stock when an Order ID is first added (package sent to courier) — no ledger row."""
    ensure_stock_deducted_for_order(conn, user_id, lead_id)


def restore_stock_for_order(conn, user_id: int, lead_id: int) -> None:
    """Undo stock use when an Order ID is cleared — silent."""
    _release_lead_stock(conn, user_id, lead_id)


def restore_stock_for_return(conn, user_id: int, lead_id: int) -> None:
    """Add stock back when an order is returned/rejected — silent."""
    _release_lead_stock(conn, user_id, lead_id)


def sync_stock_on_tracking_update(
    conn,
    user_id: int,
    lead_id: int,
    old_status: str | None,
    new_status: str,
) -> None:
    """Stock is reconciled from purchases vs active orders — not auto-restored on tracking."""
    _ = (conn, user_id, lead_id, old_status, new_status)


def sync_batch_ad_ledger(
    conn,
    user_id: int,
    batch_id: int,
    batch_name: str,
    old_usd: float,
    new_usd: float,
    cfg: dict,
) -> None:
    """Adjust cash ledger when batch ad spend is updated."""
    old_usd = old_usd or 0
    new_usd = new_usd or 0
    delta_usd = new_usd - old_usd
    if not delta_usd:
        return
    amount_eur = -usd_to_eur(delta_usd, cfg)
    add_ledger_entry(
        conn,
        user_id,
        amount_eur=amount_eur,
        category="ads",
        note=f"Meta ads update — {batch_name} (${old_usd:g} → ${new_usd:g})",
        batch_id=batch_id,
    )


def clear_stock_purchase_history(conn, user_id: int) -> int:
    """Remove manual stock purchase rows from the ledger without changing stock qty."""
    manual = conn.execute(
        "DELETE FROM finance_ledger WHERE user_id = ? AND category = 'stock'",
        (user_id,),
    ).rowcount
    automatic = purge_automatic_stock_ledger(conn, user_id)
    return manual + automatic


def delete_ledger_entry(conn, user_id: int, entry_id: int) -> None:
    row = conn.execute(
        "SELECT * FROM finance_ledger WHERE id = ? AND user_id = ?",
        (entry_id, user_id),
    ).fetchone()
    if not row:
        raise ValueError("Entry not found.")
    if row["category"] in ("stock_use", "stock_return", "payout"):
        raise ValueError("Automatic stock entries cannot be deleted.")
    if row["stock_delta"]:
        adjust_stock(conn, user_id, -int(row["stock_delta"]))
    conn.execute("DELETE FROM finance_ledger WHERE id = ?", (entry_id,))


def update_ledger_entry(
    conn,
    user_id: int,
    entry_id: int,
    *,
    amount_eur: float,
    category: str,
    note: str,
    stock_delta: int = 0,
) -> dict:
    row = conn.execute(
        "SELECT * FROM finance_ledger WHERE id = ? AND user_id = ?",
        (entry_id, user_id),
    ).fetchone()
    if not row:
        raise ValueError("Entry not found.")
    if row["category"] in ("stock_use", "stock_return", "payout"):
        raise ValueError("This entry cannot be edited.")
    if row["stock_delta"]:
        adjust_stock(conn, user_id, -int(row["stock_delta"]))
    conn.execute(
        """
        UPDATE finance_ledger
        SET amount_eur = ?, category = ?, note = ?, stock_delta = ?
        WHERE id = ?
        """,
        (round(amount_eur, 2), category, note or "", stock_delta, entry_id),
    )
    if stock_delta:
        adjust_stock(conn, user_id, stock_delta)
    return {
        "id": entry_id,
        "amount_eur": round(amount_eur, 2),
        "category": category,
        "note": note or "",
        "stock_delta": stock_delta,
        "created_at": row["created_at"],
    }


def _find_lead_by_order_id(conn, user_id: int, order_id: str):
    return conn.execute(
        """
        SELECT l.*, b.name AS batch_name
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ? AND l.order_id = ?
        """,
        (user_id, order_id),
    ).fetchone()


def _find_leads_by_order_ids(conn, user_id: int, order_ids: list[str]) -> dict:
    unique = list(dict.fromkeys(order_ids))
    if not unique:
        return {}
    placeholders = ",".join("?" * len(unique))
    rows = conn.execute(
        f"""
        SELECT l.*, b.name AS batch_name
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ? AND l.order_id IN ({placeholders})
        """,
        (user_id, *unique),
    ).fetchall()
    return {row["order_id"]: row for row in rows}


def _settlement_line_preview(conn, user_id: int, line, cfg: dict, lead=None) -> dict:
    from app.aks_settlement import settlement_product_rsd

    if lead is None:
        lead = _find_lead_by_order_id(conn, user_id, line.order_id)
    bundle = max(1, int(lead["bundle_count"] or 1)) if lead else 0
    product_rsd = settlement_product_rsd(
        line.aks_amount_rsd,
        bundle_count=bundle,
        sale_unit_rsd=float(cfg.get("sale_price_rsd", 1000.0)),
    )
    if not lead:
        status = "not_found"
    elif lead["payment_received_at"]:
        status = "already_paid"
    else:
        status = "ready"

    lead_name = ""
    if lead:
        lead_name = f"{lead['first_name']} {lead['last_name']}".strip()

    return {
        "order_id": line.order_id,
        "payer_name": line.payer_name,
        "aks_amount_rsd": line.aks_amount_rsd,
        "product_rsd": product_rsd,
        "status": status,
        "lead_id": lead["id"] if lead else None,
        "lead_name": lead_name,
        "batch_name": lead["batch_name"] if lead else None,
        "lifecycle_status": lead["lifecycle_status"] if lead else None,
        "bundle_count": bundle or None,
    }


def preview_aks_settlement(conn, user_id: int, parsed, cfg: dict) -> dict:
    lead_map = _find_leads_by_order_ids(conn, user_id, [line.order_id for line in parsed.lines])
    rows = [
        _settlement_line_preview(conn, user_id, line, cfg, lead=lead_map.get(line.order_id))
        for line in parsed.lines
    ]
    ready = [r for r in rows if r["status"] == "ready"]
    return {
        "settlement_ref": parsed.settlement_ref,
        "settlement_date": parsed.settlement_date,
        "filename": parsed.filename,
        "line_count": len(rows),
        "total_aks_rsd": parsed.total_aks_rsd,
        "total_product_rsd": round(sum(r["product_rsd"] for r in ready), 2),
        "ready_count": len(ready),
        "already_paid_count": sum(1 for r in rows if r["status"] == "already_paid"),
        "not_found_count": sum(1 for r in rows if r["status"] == "not_found"),
        "lines": rows,
        "already_imported": bool(
            conn.execute(
                """
                SELECT 1 FROM aks_settlements
                WHERE user_id = ? AND settlement_ref = ?
                """,
                (user_id, parsed.settlement_ref),
            ).fetchone()
        ),
    }


def apply_aks_settlement(conn, user_id: int, parsed, cfg: dict) -> dict:
    from app.finance import rsd_to_eur

    existing = conn.execute(
        """
        SELECT id FROM aks_settlements
        WHERE user_id = ? AND settlement_ref = ?
        """,
        (user_id, parsed.settlement_ref),
    ).fetchone()
    if existing:
        raise ValueError(f"Settlement {parsed.settlement_ref} was already imported.")

    preview = preview_aks_settlement(conn, user_id, parsed, cfg)
    ts = now_local()
    applied: list[dict] = []

    for row in preview["lines"]:
        if row["status"] != "ready":
            continue
        lead = conn.execute("SELECT * FROM leads WHERE id = ?", (row["lead_id"],)).fetchone()
        if not lead:
            continue
        product_rsd = row["product_rsd"]
        conn.execute(
            """
            UPDATE leads SET
                payment_received_at = ?,
                payment_amount_rsd = ?,
                payment_settlement_ref = ?
            WHERE id = ?
            """,
            (ts, product_rsd, parsed.settlement_ref, row["lead_id"]),
        )
        add_ledger_entry(
            conn,
            user_id,
            amount_eur=round(rsd_to_eur(product_rsd, cfg), 2),
            category="payout",
            note=(
                f"AKS {parsed.settlement_ref} · {row['order_id']} · "
                f"{row['lead_name'] or row['payer_name']}"
            ),
        )
        applied.append(row)

    if not applied:
        raise ValueError("No new payments to apply — all orders were already paid or not found in Paketo.")

    total_product_rsd = round(sum(r["product_rsd"] for r in applied), 2)
    conn.execute(
        """
        INSERT INTO aks_settlements (
            user_id, settlement_ref, settlement_date, filename,
            line_count, total_product_rsd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            parsed.settlement_ref,
            parsed.settlement_date,
            parsed.filename,
            len(applied),
            total_product_rsd,
            ts,
        ),
    )

    return {
        **preview,
        "applied_count": len(applied),
        "total_product_rsd": total_product_rsd,
        "balance_eur": ledger_balance(conn, user_id),
    }


def payment_summary(conn, user_id: int) -> dict:
    row = conn.execute(
        """
        SELECT
            COUNT(*) AS total_with_id,
            SUM(CASE WHEN l.payment_received_at IS NOT NULL THEN 1 ELSE 0 END) AS paid_orders,
            SUM(CASE WHEN l.payment_received_at IS NOT NULL THEN COALESCE(l.payment_amount_rsd, 0) ELSE 0 END) AS paid_rsd,
            SUM(
                CASE
                    WHEN l.lifecycle_status = 'delivered'
                     AND l.payment_received_at IS NULL
                    THEN 1 ELSE 0
                END
            ) AS delivered_awaiting_payment
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
          AND l.order_id IS NOT NULL AND l.order_id != ''
        """,
        (user_id,),
    ).fetchone()
    return {
        "paid_orders": int(row["paid_orders"] or 0),
        "paid_rsd": round(float(row["paid_rsd"] or 0), 0),
        "delivered_awaiting_payment": int(row["delivered_awaiting_payment"] or 0),
    }
