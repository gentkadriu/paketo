"""Finance return buckets and multi-piece stock units."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.finance import DEFAULT_CONFIG, campaign_stats


def test_return_buckets():
    cfg = dict(DEFAULT_CONFIG)
    leads = [
        {"order_id": "1", "lifecycle_status": "delivered", "bundle_count": 1},
        {"order_id": "2", "lifecycle_status": "returned", "bundle_count": 1},
        {"order_id": "3", "lifecycle_status": "returned_to_warehouse", "bundle_count": 1},
        {"order_id": "4", "lifecycle_status": "return_pending", "bundle_count": 1},
        {"order_id": "5", "lifecycle_status": "sent", "bundle_count": 1},
    ]
    stats = campaign_stats(leads, 0, cfg)
    assert stats["returned_orders"] == 1
    assert stats["return_in_progress_orders"] == 2


def test_bundle_from_sale_rsd():
    cfg = dict(DEFAULT_CONFIG)
    leads = [
        {"order_id": "1", "lifecycle_status": "sent", "bundle_count": 1, "sale_product_rsd": 3000},
    ]
    stats = campaign_stats(leads, 46, cfg)
    assert stats["imported_bundles"] == 3


if __name__ == "__main__":
    test_return_buckets()
    test_bundle_from_sale_rsd()
    print("ok")
