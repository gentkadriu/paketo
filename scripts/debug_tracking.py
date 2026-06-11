import sqlite3
from app.scheduler import refresh_lead_tracking
from app.aks_client import track_order, reset_session

conn = sqlite3.connect("posta.db")
conn.row_factory = sqlite3.Row
batches = conn.execute("SELECT id, name FROM batches ORDER BY id DESC LIMIT 5").fetchall()
for b in batches:
    print(f"Batch {b['id']} {b['name']!r}")
    leads = conn.execute(
        "SELECT id, order_id, lifecycle_status FROM leads WHERE batch_id=? ORDER BY sort_order",
        (b["id"],),
    ).fetchall()
    for l in leads:
        oid = (l["order_id"] or "").strip()
        print(f"  lead {l['id']} len={len(oid)} id={oid!r} status={l['lifecycle_status']}")
        if oid:
            reset_session()
            try:
                t = track_order(oid)
                print(f"    aks: {t['status'][:40]}")
            except Exception as e:
                print(f"    aks FAIL: {e}")
        if (oid:
            ok = refresh_lead_tracking(l["id"], oid)
            print(f"    refresh: {ok[0]}{' — ' + ok[1] if ok[1] else ''}")
