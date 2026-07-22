"""Shared "what's the user's local time/day" helpers.

Every user can set their own `timezone` preference (Settings). Auto-crawl/
reminders (scheduler.py) already use this to decide "is it 5am for this
user right now?" — freemium quota resets (limits.py) need the same local-day
concept, otherwise a user near a UTC day boundary sees two quota resets
within their own single calendar day.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

DEFAULT_TIMEZONE = "Europe/Dublin"


def user_local_time(user: dict, now_utc: datetime) -> datetime:
    tz_name = user.get("timezone") or DEFAULT_TIMEZONE
    try:
        return now_utc.astimezone(ZoneInfo(tz_name))
    except Exception:
        return now_utc.astimezone(ZoneInfo(DEFAULT_TIMEZONE))


def user_day_start_utc(user: dict, now_utc: datetime | None = None) -> datetime:
    """UTC instant marking local midnight, start of "today" in the user's own timezone."""
    now_utc = now_utc or datetime.now(timezone.utc)
    local_now = user_local_time(user, now_utc)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(timezone.utc)
