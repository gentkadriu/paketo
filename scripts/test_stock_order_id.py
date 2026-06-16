"""Verify stock deducts only when Order ID is set, and phantom reservations are repaired."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import get_connection
from app.finance_db import (
    cleanup_stock_ledger_noise,
    deduct_stock_for_order,
    ensure_stock_deducted_for_order,
    get_stock,
    lead_stock_deduct_units,
    migrate_finance,
    restore_stock_for_order,
    set_stock,
)

ORDER_ID = "91766000346509"


def main() -> None:
    with get_connection() as conn:
        migrate_finance(conn)
        user = conn.execute("SELECT id FROM users LIMIT 1").fetchone()
        assert user, "no user"
        uid = user["id"]

        lead = conn.execute(
            """
            SELECT l.id FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE b.user_id = ?
            ORDER BY l.id LIMIT 1
            """,
            (uid,),
        ).fetchone()
        assert lead, "no lead"
        lead_id = lead["id"]

        conn.execute(
            """
            UPDATE leads SET
                order_id = NULL,
                lifecycle_status = 'registered',
                stock_units_reserved = 0
            WHERE id = ?
            """,
            (lead_id,),
        )
        set_stock(conn, uid, 100)
        units = lead_stock_deduct_units(conn, uid, lead_id)

        # Import alone: no deduction
        assert get_stock(conn, uid) == 100

        # Order ID set: deduct
        conn.execute(
            "UPDATE leads SET order_id = ?, lifecycle_status = 'sent' WHERE id = ?",
            (ORDER_ID, lead_id),
        )
        deduct_stock_for_order(conn, uid, lead_id)
        after = get_stock(conn, uid)
        assert after == 100 - units, f"expected {100 - units}, got {after}"

        # Phantom reservation without prior deduct (old bug)
        set_stock(conn, uid, 100)
        conn.execute(
            """
            UPDATE leads SET stock_units_reserved = ?, stock_inventory_committed = 0
            WHERE id = ?
            """,
            (units, lead_id),
        )
        assert get_stock(conn, uid) == 100
        ensure_stock_deducted_for_order(conn, uid, lead_id)
        assert get_stock(conn, uid) == 100 - units

        cleanup_stock_ledger_noise(conn, uid)
        assert get_stock(conn, uid) == 100 - units

        # Clear Order ID: restore
        restore_stock_for_order(conn, uid, lead_id)
        conn.execute(
            """
            UPDATE leads SET order_id = NULL, lifecycle_status = 'registered'
            WHERE id = ?
            """,
            (lead_id,),
        )
        assert get_stock(conn, uid) == 100

    print("OK: stock deduct/restore on Order ID only")


if __name__ == "__main__":
    main()
