"""Check MONDAY batch profit numbers from live DB."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import get_connection
from app.finance import campaign_stats, profit_per_success_eur
from app.finance_db import get_finance_config

with get_connection() as conn:
    batch = conn.execute(
        "SELECT id, name, user_id, ad_spend_usd FROM batches WHERE name LIKE '%MONDAY%' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not batch:
        print("No MONDAY batch found")
        raise SystemExit(1)
    cfg = get_finance_config(conn, batch["user_id"])
    per = profit_per_success_eur(cfg)
    leads = conn.execute(
        "SELECT order_id, lifecycle_status, bundle_count FROM leads WHERE batch_id = ?",
        (batch["id"],),
    ).fetchall()
    stats = campaign_stats(list(leads), batch["ad_spend_usd"] or 0, cfg)
    print("batch:", batch["name"])
    print("leads:", len(leads), "bundles:", stats["imported_bundles"])
    print("base profit RSD (sale-product):", per["profit_rsd"])
    print("shipping in config USD:", cfg.get("shipping_cost_usd"))
    print("net per order RSD:", stats["net_profit_per_order_rsd"])
    print("net per order EUR:", stats["net_profit_per_order_eur"])
    print("expected total RSD:", stats.get("expected_net_profit_rsd"))
