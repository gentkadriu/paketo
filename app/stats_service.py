"""Shared statistics queries for user dashboards and admin views."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.datetime_util import local_date, now_local
from app.status import STATUS_LABELS, label_for


def statistics_for_user(
    conn,
    user_id: int,
    *,
    date: str | None = None,
    batch_id: int | None = None,
    kind: str = "imported",
) -> dict:
    query = """
        SELECT l.lifecycle_status, COUNT(*) AS cnt
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
    """
    params: list[Any] = [user_id]

    if batch_id:
        query += " AND b.id = ?"
        params.append(batch_id)
    elif date:
        if kind == "delivered":
            query += " AND l.lifecycle_status = 'delivered' AND date(l.tracking_updated_at) = ?"
        else:
            query += " AND date(b.created_at) = ?"
        params.append(date)

    query += " GROUP BY l.lifecycle_status"
    rows = conn.execute(query, params).fetchall()
    total = sum(r["cnt"] for r in rows)
    breakdown = {r["lifecycle_status"]: r["cnt"] for r in rows}

    ordered_keys = [
        "registered", "sent", "in_warehouse", "in_transit",
        "out_for_delivery", "delivered", "returned_to_warehouse",
        "delivery_canceled", "return_pending", "rejected", "returned", "unknown",
    ]
    items = []
    for key in ordered_keys:
        count = breakdown.get(key, 0)
        if count or total == 0:
            items.append({
                "status": key,
                "label": label_for(key),
                "count": count,
                "percent": round(count / total * 100, 1) if total else 0,
            })

    return {"total": total, "items": items, "status_labels": STATUS_LABELS}


def timeline_for_user(conn, user_id: int, days: int = 30) -> dict:
    days = max(7, min(days, 90))
    today = date.fromisoformat(local_date(now_local()))
    start = today - timedelta(days=days - 1)

    total_delivered = conn.execute(
        """
        SELECT COUNT(*) FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ? AND l.lifecycle_status = 'delivered'
        """,
        (user_id,),
    ).fetchone()[0]

    total_imported = conn.execute(
        """
        SELECT COUNT(*) FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
        """,
        (user_id,),
    ).fetchone()[0]

    rows = conn.execute(
        """
        SELECT date(l.imported_at) AS d, COUNT(*) AS cnt
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
          AND l.imported_at IS NOT NULL
          AND date(l.imported_at) >= ?
        GROUP BY date(l.imported_at)
        ORDER BY d ASC
        """,
        (user_id, start.isoformat()),
    ).fetchall()

    delivered_rows = conn.execute(
        """
        SELECT date(l.tracking_updated_at) AS d, COUNT(*) AS cnt
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
          AND l.lifecycle_status = 'delivered'
          AND l.tracking_updated_at IS NOT NULL
          AND date(l.tracking_updated_at) >= ?
        GROUP BY date(l.tracking_updated_at)
        ORDER BY d ASC
        """,
        (user_id, start.isoformat()),
    ).fetchall()

    imported_by_day = {r["d"]: r["cnt"] for r in rows}
    delivered_by_day = {r["d"]: r["cnt"] for r in delivered_rows}

    timeline = []
    current = start
    while current <= today:
        d = current.isoformat()
        timeline.append({
            "date": d,
            "imported": imported_by_day.get(d, 0),
            "delivered": delivered_by_day.get(d, 0),
        })
        current += timedelta(days=1)

    delivered_in_period = sum(delivered_by_day.values())
    imported_in_period = sum(imported_by_day.values())
    active_delivery_days = sum(1 for v in delivered_by_day.values() if v > 0)
    active_import_days = sum(1 for v in imported_by_day.values() if v > 0)
    peak_date, peak_count = None, 0
    if delivered_by_day:
        peak_date, peak_count = max(delivered_by_day.items(), key=lambda x: x[1])

    return {
        "days": days,
        "timeline": timeline,
        "summary": {
            "total_delivered": total_delivered,
            "total_imported": total_imported,
            "delivered_in_period": delivered_in_period,
            "imported_in_period": imported_in_period,
            "avg_delivered_per_day": round(
                delivered_in_period / active_delivery_days, 1,
            ) if active_delivery_days else 0,
            "avg_imported_per_day": round(
                imported_in_period / active_import_days, 1,
            ) if active_import_days else 0,
            "peak_delivery_date": peak_date,
            "peak_delivery_count": peak_count,
        },
    }


def orders_for_user(
    conn,
    user_id: int,
    *,
    limit: int = 500,
    offset: int = 0,
    status: str | None = None,
) -> dict:
    limit = max(1, min(limit, 2000))
    offset = max(0, offset)
    query = """
        SELECT l.id, l.order_id, l.first_name, l.last_name, l.lifecycle_status,
               l.phone, b.name AS batch_name, b.id AS batch_id
        FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
    """
    params: list[Any] = [user_id]
    if status:
        query += " AND l.lifecycle_status = ?"
        params.append(status)
    query += " ORDER BY l.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    rows = conn.execute(query, params).fetchall()
    count_query = """
        SELECT COUNT(*) FROM leads l
        JOIN batches b ON b.id = l.batch_id
        WHERE b.user_id = ?
    """
    count_params: list[Any] = [user_id]
    if status:
        count_query += " AND l.lifecycle_status = ?"
        count_params.append(status)
    total = conn.execute(count_query, count_params).fetchone()[0]

    orders = []
    for r in rows:
        orders.append({
            "id": r["id"],
            "order_id": r["order_id"] or "",
            "name": f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
            "status": r["lifecycle_status"],
            "phone": r["phone"] or "",
            "batch_id": r["batch_id"],
            "batch_name": r["batch_name"] or "",
        })

    return {"total": total, "orders": orders, "limit": limit, "offset": offset}
