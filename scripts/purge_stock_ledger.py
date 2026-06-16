"""One-off: purge automatic stock_use/stock_return ledger rows."""
from app.database import get_connection
from app.finance_db import migrate_finance, cleanup_stock_ledger_noise

with get_connection() as conn:
    migrate_finance(conn)
    users = conn.execute("SELECT id FROM users").fetchall()
    for u in users:
        cleanup_stock_ledger_noise(conn, u["id"])
    remaining = conn.execute(
        "SELECT COUNT(*) AS n FROM finance_ledger WHERE category IN ('stock_use', 'stock_return')"
    ).fetchone()["n"]
    print(f"Done. Remaining stock_use/return rows: {remaining}")
