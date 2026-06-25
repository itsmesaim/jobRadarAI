"""
Background scheduler for automatic job discovery + rating.

Runs crawl (Jooble + JobsAPI) + rate-all every N hours (default 12) for users
who have uploaded a CV. Auto-crawl does not consume manual search quota but
caps new jobs stored per cycle (see AUTO_CRAWL_MAX_STORED_PER_CYCLE).
"""

from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from config import settings
from bson import ObjectId

from database import get_database
from services.job_reminders import send_job_apply_reminders
from services.jooble_crawler import crawl_jobs_for_user_jooble
from services.jobsapi_indeed_crawler import crawl_jobs_for_user_jobsapi
from services.rating import rate_all_jobs_for_user

scheduler = AsyncIOScheduler()


async def _auto_crawl_and_rate():
    """Core job: for every user with a CV, crawl new jobs then rate them."""
    db = get_database()

    # Only users who have uploaded a CV (otherwise nothing to match against)
    users = await db.users.find({"cv": {"$exists": True}}).to_list(length=None)

    print(f"[scheduler] === AUTO CYCLE START ({len(users)} users with CV) ===")
    print(
        "[scheduler] This will crawl new jobs then rate any unrated ones (respecting per-user limits)."
    )

    for user in users:
        user_id = str(user["_id"])
        email = user.get("email", user_id)

        try:
            max_stored = settings.auto_crawl_max_stored_per_cycle
            print(f"[scheduler] [{email}] → Starting crawl (cap {max_stored}/cycle)...")
            res_j = await crawl_jobs_for_user_jooble(user, max_stored=max_stored)
            jooble_stored = (res_j or {}).get("stored", 0)
            remaining = max(0, max_stored - jooble_stored)
            res_i = await crawl_jobs_for_user_jobsapi(
                user, max_stored=remaining if remaining else 0
            )
            stored = jooble_stored + (res_i or {}).get("stored", 0)
            print(f"[scheduler] [{email}] Crawl done: stored={stored} new jobs")

            await db.users.update_one(
                {"_id": ObjectId(user_id)},
                {"$set": {"last_crawl_at": datetime.now(timezone.utc)}},
            )

            print(
                f"[scheduler] [{email}] → Starting rating of new/pending jobs (the 'queue' for this user)..."
            )
            rate_res = await rate_all_jobs_for_user(user)
            print(f"[scheduler] [{email}] Rating done: {rate_res}")

            print(f"[scheduler] [{email}] ✓ FULL CYCLE OK")

        except Exception as e:
            import traceback

            print(f"[scheduler] [{email}] ✗ ERROR: {e}")
            traceback.print_exc()

    print("[scheduler] === AUTO CYCLE FINISHED ===")


def _parse_reminder_hours() -> list[int]:
    raw = (settings.job_reminder_hours_utc or "8,18").strip()
    hours: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            hour = int(part)
        except ValueError:
            continue
        if 0 <= hour <= 23:
            hours.append(hour)
    return hours or [8, 18]


def start_scheduler():
    """Start APScheduler. First run ~2 minutes after startup, then every N hours (from config)."""
    interval = settings.auto_crawl_interval_hours
    # Regular recurring job
    scheduler.add_job(
        _auto_crawl_and_rate,
        trigger=IntervalTrigger(hours=interval),
        id="auto_crawl_rate",
        replace_existing=True,
        max_instances=1,  # prevent overlapping runs
    )

    # First execution soon after the app boots (so user doesn't have to wait 12h)
    scheduler.add_job(
        _auto_crawl_and_rate,
        trigger="date",
        run_date=datetime.now(timezone.utc) + timedelta(minutes=2),
        id="first_auto_run",
        replace_existing=True,
    )

    if settings.job_reminder_enabled:
        reminder_hours = _parse_reminder_hours()
        for hour in reminder_hours:
            scheduler.add_job(
                send_job_apply_reminders,
                trigger=CronTrigger(hour=hour, minute=0, timezone="UTC"),
                id=f"job_reminder_{hour:02d}utc",
                replace_existing=True,
                max_instances=1,
            )
        hours_label = ", ".join(f"{h:02d}:00" for h in reminder_hours)
        print(
            f"[scheduler] Job apply reminders scheduled at {hours_label} UTC "
            f"(max {settings.job_reminder_max_per_day}/user/day, score ≥ "
            f"{settings.job_reminder_min_score})"
        )

    scheduler.start()
    print(
        f"[scheduler] APScheduler started (auto crawl + rate every {settings.auto_crawl_interval_hours} hours)"
    )


def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("[scheduler] APScheduler shut down.")
