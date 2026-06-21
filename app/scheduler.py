"""Background AKS tracking — fixed checks every 2 hours from 08:00 to 20:00."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.datetime_util import now_local
from app.database import get_connection
from app.finance_db import sync_stock_on_tracking_update
from app.status import categorize_aks_status
from app.aks_client import reset_session, track_order
from app.telegram_bot import notify_users_scheduled_summary
from app.tracking_schedule import (
    TRACKING_DAYS_CRON,
    TRACKING_HOURS_CRON,
    TRACKING_SCHEDULE_LABEL,
    TRACKING_TIMEZONE,
)

logger = logging.getLogger("posta.scheduler")
_scheduler: BackgroundScheduler | None = None


def refresh_lead_tracking(lead_id: int, order_id: str) -> tuple[bool, str | None, dict | None]:
    last_error: str | None = None
    for attempt in range(2):
        try:
            tracking = track_order(order_id)
            lifecycle = categorize_aks_status(tracking["status"])
            history_json = json.dumps(tracking["history"], ensure_ascii=False)

            with get_connection() as conn:
                row = conn.execute(
                    """
                    SELECT l.lifecycle_status, l.first_name, l.last_name, l.order_id,
                           b.user_id, b.name AS batch_name
                    FROM leads l
                    JOIN batches b ON b.id = l.batch_id
                    WHERE l.id = ?
                    """,
                    (lead_id,),
                ).fetchone()
                old_status = row["lifecycle_status"] if row else None
                user_id = row["user_id"] if row else None

                conn.execute(
                    """
                    UPDATE leads SET
                        lifecycle_status = ?,
                        tracking_status = ?,
                        tracking_location = ?,
                    tracking_updated_at = ?,
                    tracking_history = ?
                WHERE id = ?
                """,
                (
                    lifecycle,
                    tracking["status"],
                    tracking["location"],
                    now_local(),
                    history_json,
                    lead_id,
                ),
                )
                if user_id:
                    sync_stock_on_tracking_update(
                        conn, user_id, lead_id, old_status, lifecycle,
                    )

            change = None
            if row and old_status != lifecycle:
                change = {
                    "user_id": user_id,
                    "lead_id": lead_id,
                    "order_id": order_id,
                    "full_name": f"{row['first_name']} {row['last_name']}".strip(),
                    "batch_name": row["batch_name"] or "",
                    "old_status": old_status,
                    "new_status": lifecycle,
                    "tracking_status": tracking["status"],
                }
            return True, None, change
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "Tracking failed for lead %s (%s) attempt %s: %s",
                lead_id, order_id, attempt + 1, exc,
            )
            if attempt == 0:
                reset_session()
    return False, last_error, None


def run_scheduled_tracking() -> None:
    from datetime import datetime

    now = datetime.now(TRACKING_TIMEZONE)
    if now.weekday() >= 5:
        logger.info("Skipping scheduled AKS tracking on weekend (Sat/Sun)")
        return

    logger.info("Starting scheduled AKS tracking run...")
    with get_connection() as conn:
        leads = conn.execute(
            """
            SELECT l.id, l.order_id, b.user_id
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE l.order_id IS NOT NULL AND l.order_id != ''
              AND l.lifecycle_status NOT IN ('delivered', 'rejected', 'returned')
              AND b.status = 'tracking'
            """
        ).fetchall()

    lead_rows = [dict(lead) for lead in leads]
    ok = 0
    changes_by_user: dict[int, list] = defaultdict(list)
    tracked_by_user: dict[int, int] = defaultdict(int)

    def _track_one(lead: dict) -> tuple[bool, dict | None]:
        success, _, change = refresh_lead_tracking(lead["id"], lead["order_id"])
        return success, change

    workers = min(8, max(1, len(lead_rows)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_track_one, lead): lead for lead in lead_rows}
        for fut in as_completed(futures):
            lead = futures[fut]
            success, change = fut.result()
            uid = lead["user_id"]
            if success:
                ok += 1
                tracked_by_user[uid] += 1
            if change:
                changes_by_user[uid].append(change)

    logger.info("Scheduled tracking done: %s/%s updated", ok, len(leads))
    try:
        notify_users_scheduled_summary(dict(changes_by_user), dict(tracked_by_user))
    except Exception as exc:
        logger.warning("Telegram notify failed: %s", exc)


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    _scheduler = BackgroundScheduler(timezone=TRACKING_TIMEZONE)
    _scheduler.add_job(
        run_scheduled_tracking,
        trigger=CronTrigger(
            hour=TRACKING_HOURS_CRON,
            minute=0,
            day_of_week=TRACKING_DAYS_CRON,
            timezone=TRACKING_TIMEZONE,
        ),
        id="aks_tracking",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "AKS scheduler started (%s)",
        TRACKING_SCHEDULE_LABEL,
    )
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
