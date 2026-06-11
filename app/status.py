"""Map raw AKS tracking text to normalized lifecycle statuses."""

from __future__ import annotations

FINAL_STATUSES = {"delivered", "rejected", "returned"}
MANUAL_STATUSES = {"registered", "sent"}
NOT_TRACKED_STATUSES = {"registered"}

STATUS_LABELS = {
    "registered": "Registered",
    "not_sent": "No Order ID",
    "sent": "Sent to courier",
    "in_warehouse": "At AKS warehouse",
    "in_transit": "In transit",
    "out_for_delivery": "Out for delivery",
    "delivered": "Delivered",
    "returned_to_warehouse": "Returned to warehouse",
    "delivery_canceled": "Delivery canceled",
    "return_pending": "Return pending",
    "rejected": "Rejected",
    "returned": "Returned",
    "unknown": "Unknown",
}


def _normalize(raw_status: str) -> str:
    return (
        raw_status.lower()
        .replace("š", "s")
        .replace("č", "c")
        .replace("ć", "c")
        .replace("ž", "z")
    )


def categorize_aks_status(raw_status: str) -> str:
    s = _normalize(raw_status)

    if any(k in s for k in ("isporucena", "isporuceno", "dostavljena", "posiljka isporucena")):
        return "delivered"
    if "unet povrat" in s:
        return "returned"
    if "otkaz isporuke" in s:
        return "delivery_canceled"
    if "vraceno u magacin" in s or "vracen u magacin" in s:
        return "returned_to_warehouse"
    if any(k in s for k in ("na isporuci",)):
        return "out_for_delivery"
    if any(k in s for k in ("odbijen", "odbijena", "refused", "nije preuzet")):
        return "rejected"
    if any(k in s for k in ("vracen", "vracena", "return")):
        return "returned"
    if "povrat" in s:
        return "return_pending"
    if any(k in s for k in ("magacin", "sortirn", "skladiste")):
        return "in_warehouse"
    if any(k in s for k in ("utovar", "kamion", "tranzit", "preuzimanje", "ulazak", "isporuci")):
        return "in_transit"

    return "unknown"


def label_for(status: str) -> str:
    return STATUS_LABELS.get(status, status)


def is_trackable_lead(order_id: str | None, lifecycle_status: str | None = None) -> bool:
    """Lead is trackable when it has a saved AKS Order ID."""
    return bool(order_id and str(order_id).strip())


def display_status(order_id: str | None, lifecycle_status: str | None) -> tuple[str, str]:
    if not is_trackable_lead(order_id):
        return "not_sent", STATUS_LABELS["not_sent"]
    status = lifecycle_status or "sent"
    if status == "registered":
        status = "sent"
    return status, label_for(status)
