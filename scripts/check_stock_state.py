import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.database import get_connection
from app.finance_db import get_stock, lead_stock_deduct_units, _lead_stock_reserved

with get_connection() as conn:
    user = conn.execute("SELECT id FROM users LIMIT 1").fetchone()
    uid = user["id"]
    stock = get_stock(conn, uid)
    leads = conn.execute("""
        SELECT l.id, l.order_id, l.stock_units_reserved, l.bundle_count, l.stock_units
        FROM leads l JOIN batches b ON b.id = l.batch_id WHERE b.user_id = ?
    """, (uid,)).fetchall()
    with_id = [l for l in leads if (l["order_id"] or "").strip()]
    reserved_sum = sum(int(l["stock_units_reserved"] or 0) for l in leads)
    needed = sum(lead_stock_deduct_units(conn, uid, l["id"]) for l in with_id)
    print("stock", stock, "leads", len(leads), "with_id", len(with_id))
    print("reserved_sum", reserved_sum, "needed_units", needed)
    zero_reserved_with_id = sum(1 for l in with_id if not int(l["stock_units_reserved"] or 0))
    print("with_id but reserved=0", zero_reserved_with_id)
