"""Campaign profit, stock, and cash ledger calculations."""

from __future__ import annotations

from typing import Any

RETURN_STATUSES = frozenset({
    "returned",
    "returned_to_warehouse",
    "return_pending",
    "rejected",
    "delivery_canceled",
})

DEFAULT_CONFIG = {
    "sale_price_rsd": 1000.0,
    "product_cost_eur": 2.0,
    "shipping_cost_usd": 2.0,
    "return_fee_rsd": 500.0,
    "units_per_order": 2,
    "eur_rsd": 117.0,
    "usd_rsd": 101.0,
}


def _f(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_config(row: dict | None) -> dict[str, float | int]:
    cfg = dict(DEFAULT_CONFIG)
    if not row:
        return cfg
    for key in DEFAULT_CONFIG:
        if key in row and row[key] is not None:
            cfg[key] = int(row[key]) if key == "units_per_order" else _f(row[key], cfg[key])
    return cfg


def usd_to_eur(amount_usd: float, cfg: dict) -> float:
    eur_rsd = _f(cfg["eur_rsd"], 117.0)
    usd_rsd = _f(cfg["usd_rsd"], 101.0)
    if eur_rsd <= 0:
        return amount_usd
    return amount_usd * usd_rsd / eur_rsd


def eur_to_rsd(amount_eur: float, cfg: dict) -> float:
    return amount_eur * _f(cfg["eur_rsd"], 117.0)


def rsd_to_eur(amount_rsd: float, cfg: dict) -> float:
    eur_rsd = _f(cfg["eur_rsd"], 117.0)
    return amount_rsd / eur_rsd if eur_rsd else 0.0


def profit_per_success_eur(cfg: dict) -> dict[str, float]:
    """Profit per delivered offer: sale RSD − product cost (ads subtracted in campaign_stats)."""
    sale = _f(cfg["sale_price_rsd"], 1000.0)
    product_rsd = _f(cfg["product_cost_eur"], 2.0) * _f(cfg["eur_rsd"], 117.0)
    profit_rsd = sale - product_rsd
    profit_eur = rsd_to_eur(profit_rsd, cfg)
    shipping_rsd = _f(cfg["shipping_cost_usd"], 0.0) * _f(cfg["usd_rsd"], 101.0)
    return {
        "profit_rsd": round(profit_rsd, 2),
        "profit_eur": round(profit_eur, 2),
        "product_cost_rsd": round(product_rsd, 2),
        "shipping_cost_rsd": round(shipping_rsd, 2),
    }


def return_fee_eur(cfg: dict) -> float:
    return round(rsd_to_eur(_f(cfg["return_fee_rsd"], 500.0), cfg), 2)


def _lead_field(lead, key: str, default=None):
    if hasattr(lead, "keys"):
        return lead[key] if key in lead.keys() else default
    return lead.get(key, default)


def _bundle_count(lead) -> int:
    return max(1, int(_lead_field(lead, "bundle_count", 1) or 1))


def campaign_stats(
    leads: list,
    ad_spend_usd: float,
    cfg: dict,
) -> dict[str, Any]:
    all_leads = list(leads)
    imported_count = len(all_leads)
    total_bundles = sum(_bundle_count(l) for l in all_leads)

    pending_aks = [l for l in all_leads if not _lead_field(l, "order_id")]
    returned = [
        l for l in all_leads
        if _lead_field(l, "lifecycle_status") in RETURN_STATUSES
    ]
    delivered = [
        l for l in all_leads
        if _lead_field(l, "lifecycle_status") == "delivered"
    ]
    paid = [l for l in all_leads if _lead_field(l, "payment_received_at")]
    paid_bundles = sum(_bundle_count(l) for l in paid)
    awaiting_payment = [
        l for l in delivered if not _lead_field(l, "payment_received_at")
    ]
    delivered_bundles = sum(_bundle_count(l) for l in delivered)
    returned_bundles = sum(_bundle_count(l) for l in returned)
    pending_count = max(0, total_bundles - delivered_bundles - returned_bundles)

    per = profit_per_success_eur(cfg)
    ret_fee = return_fee_eur(cfg)
    ad_eur = usd_to_eur(ad_spend_usd or 0, cfg)

    base = per["profit_eur"]
    cost_per_order_eur = ad_eur / total_bundles if total_bundles else 0.0
    cost_per_order_usd = (ad_spend_usd or 0) / total_bundles if total_bundles else 0.0

    net_per_order_eur = base - cost_per_order_eur
    net_per_order_rsd = per["profit_rsd"] - eur_to_rsd(cost_per_order_eur, cfg)

    net_after_ads_eur = (
        delivered_bundles * net_per_order_eur
        - returned_bundles * ret_fee
    )
    gross_before_ads_eur = delivered_bundles * base - returned_bundles * ret_fee
    success_bundles = max(0, total_bundles - returned_bundles)
    expected_net_eur = success_bundles * net_per_order_eur
    expected_net_rsd = success_bundles * net_per_order_rsd

    return {
        "total_leads": imported_count,
        "imported_orders": imported_count,
        "imported_bundles": total_bundles,
        "linked_orders": imported_count - len(pending_aks),
        "pending_aks": len(pending_aks),
        "pending_orders": pending_count,
        "delivered_orders": len(delivered),
        "paid_orders": len(paid),
        "paid_bundles": paid_bundles,
        "awaiting_payment_orders": len(awaiting_payment),
        "returned_orders": len(returned),
        "successful_orders": len(delivered),
        "sent_orders": imported_count - len(pending_aks),
        "ad_spend_usd": round(ad_spend_usd or 0, 2),
        "ad_spend_eur": round(ad_eur, 2),
        "cost_per_order_eur": round(cost_per_order_eur, 2),
        "cost_per_order_usd": round(cost_per_order_usd, 2),
        "base_margin_eur": base,
        "base_margin_rsd": per["profit_rsd"],
        "net_profit_per_order_eur": round(net_per_order_eur, 2),
        "net_profit_per_order_rsd": round(net_per_order_rsd, 0),
        "profit_per_order_eur": base,
        "profit_per_order_rsd": per["profit_rsd"],
        "return_fee_eur": ret_fee,
        "return_fee_rsd": _f(cfg["return_fee_rsd"], 500.0),
        "gross_profit_eur": round(gross_before_ads_eur, 2),
        "gross_profit_rsd": round(eur_to_rsd(gross_before_ads_eur, cfg), 0),
        "net_profit_eur": round(net_after_ads_eur, 2),
        "net_profit_rsd": round(eur_to_rsd(net_after_ads_eur, cfg), 0),
        "expected_net_profit_eur": round(expected_net_eur, 2),
        "expected_net_profit_rsd": round(expected_net_rsd, 0),
        "projected_net_profit_eur": round(expected_net_eur, 2),
        "projected_net_profit_rsd": round(expected_net_rsd, 0),
    }
