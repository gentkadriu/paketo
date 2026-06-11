"""Background AKS tracking — fixed checks every 2 hours from 08:00 to 20:00."""

from __future__ import annotations

import json
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.datetime_util import now_local
from app.database import get_connection
from app.status import categorize_aks_status
from app.aks_client import reset_session, track_order
from app.tracking_schedule import TRACKING_HOURS_CRON, TRACKING_SCHEDULE_LABEL, TRACKING_TIMEZONE

logger = logging.getLogger("posta.scheduler")
_scheduler: BackgroundScheduler | None = None


def refresh_lead_tracking(lead_id: int, order_id: str) -> tuple[bool, str | None]:
    last_error: str | None = None
    for attempt in range(2):
        try:
            tracking = track_order(order_id)
            lifecycle = categorize_aks_status(tracking["status"])
            history_json = json.dumps(tracking["history"], ensure_ascii=False)

            with get_connection() as conn:
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
            return True, None
        except Exception as exc:
            last_error = str(exc)
            logger.warning(
                "Tracking failed for lead %s (%s) attempt %s: %s",
                lead_id, order_id, attempt + 1, exc,
            )
            if attempt == 0:
                reset_session()
    return False, last_error


def run_scheduled_tracking() -> None:
    logger.info("Starting scheduled AKS tracking run...")
    with get_connection() as conn:
        leads = conn.execute(
            """
            SELECT l.id, l.order_id
            FROM leads l
            JOIN batches b ON b.id = l.batch_id
            WHERE l.order_id IS NOT NULL AND l.order_id != ''
              AND l.lifecycle_status NOT IN ('delivered', 'rejected', 'returned')
              AND b.status = 'tracking'
            """
        ).fetchall()

    ok = 0
    for lead in leads:
        success, _ = refresh_lead_tracking(lead["id"], lead["order_id"])
        if success:
            ok += 1

    logger.info("Scheduled tracking done: %s/%s updated", ok, len(leads))


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
            timezone=TRACKING_TIMEZONE,
        ),
        id="aks_tracking",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info(
        "AKS scheduler started (%s Belgrade time, Mon–Sun)",
        TRACKING_SCHEDULE_LABEL,
    )
    return _scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
