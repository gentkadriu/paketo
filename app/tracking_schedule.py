"""Fixed AKS tracking check times (Belgrade local time)."""

from zoneinfo import ZoneInfo

TRACKING_TIMEZONE = ZoneInfo("Europe/Belgrade")
TRACKING_HOURS = (8, 10, 12, 14, 16, 18, 20)
TRACKING_HOURS_CRON = ",".join(str(h) for h in TRACKING_HOURS)
TRACKING_SCHEDULE_LABEL = "08:00–20:00 Belgrade, Mon–Fri"
TRACKING_DAYS_CRON = "mon-fri"
