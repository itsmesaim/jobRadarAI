"""
Background scheduler for automatic job discovery + rating.

Runs crawl (Jooble + JobsAPI) + rate-all at 5am/5pm *in each user's own
timezone* (see CRAWL_HOURS below) for users who have uploaded a CV.
Auto-crawl does not consume manual search quota but caps new jobs stored
per cycle (see AUTO_CRAWL_MAX_STORED_PER_CYCLE).
"""

import asyncio
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from config import settings
from bson import ObjectId

from database import get_database
from services.job_reminders import send_job_apply_reminders
from services.jooble_crawler import crawl_jobs_for_user_jooble
from services.jobsapi_indeed_crawler import crawl_jobs_for_user_jobsapi
from services.rating import rate_all_jobs_for_user
from services.user_time import user_local_time as _user_local_time

scheduler = AsyncIOScheduler()

# Don't burn LLM tokens auto-crawling/rating for accounts nobody's using.
# 24h was too aggressive: it required logging in daily just to keep the
# automation alive, which defeats the point of "auto". A week of silence
# is a better line for "actually abandoned".
DEAD_USER_INACTIVE_HOURS = 24 * 7

# Local hours (in the user's own timezone) to auto crawl+rate.
CRAWL_HOURS = (5, 17)

# How often the sweep tick runs. Every user's target hour falls inside some
# tick's [hour:00, hour:15) window, so a 15-min sweep hits it once a day
# without needing one cron job per timezone in use.
SWEEP_WINDOW_MINUTES = 15


async def _auto_crawl_and_rate():
    """Sweep tick: for every user whose local time is in a CRAWL_HOURS window,
    crawl new jobs then rate them."""
    db = get_database()

    # Only users who have uploaded a CV (otherwise nothing to match against),
    # aren't paused by an admin, and have been active recently.
    users = await db.users.find(
        {"cv": {"$exists": True}, "suspended": {"$ne": True}}
    ).to_list(length=None)

    now_utc = datetime.now(timezone.utc)
    min_gap = timedelta(hours=max(1, settings.auto_crawl_interval_hours - 1))

    due = [
        u
        for u in users
        if _user_local_time(u, now_utc).hour in CRAWL_HOURS
        and _user_local_time(u, now_utc).minute < SWEEP_WINDOW_MINUTES
    ]
    if not due:
        return

    print(f"[scheduler] === AUTO CYCLE START ({len(due)}/{len(users)} users due) ===")

    for user in due:
        user_id = str(user["_id"])
        email = user.get("email", user_id)

        last_active = user.get("last_active_at")
        if isinstance(last_active, datetime) and last_active.tzinfo is None:
            last_active = last_active.replace(tzinfo=timezone.utc)
        if not isinstance(last_active, datetime) or (now_utc - last_active) > timedelta(
            hours=DEAD_USER_INACTIVE_HOURS
        ):
            idle_desc = (
                f"{int((now_utc - last_active).total_seconds() // 3600)}h"
                if isinstance(last_active, datetime)
                else "never"
            )
            print(
                f"[scheduler] [{email}] Skipped — inactive for {idle_desc} "
                f"(dead-user cutoff {DEAD_USER_INACTIVE_HOURS}h), not wasting tokens"
            )
            continue

        last_crawl = user.get("last_crawl_at")
        if last_crawl:
            if isinstance(last_crawl, datetime) and last_crawl.tzinfo is None:
                last_crawl = last_crawl.replace(tzinfo=timezone.utc)
            if isinstance(last_crawl, datetime) and (now_utc - last_crawl) < min_gap:
                print(
                    f"[scheduler] [{email}] Skipped — crawled {int((now_utc - last_crawl).total_seconds() // 3600)}h ago (min gap {int(min_gap.total_seconds() // 3600)}h)"
                )
                continue

        try:
            max_stored = settings.auto_crawl_max_stored_per_cycle
            # Jooble + Indeed only (LinkedIn API has no JD text).
            jooble_cap = max_stored // 2
            indeed_cap = max_stored - jooble_cap
            print(
                f"[scheduler] [{email}] → Starting crawl "
                f"(cap {max_stored}/cycle: jooble={jooble_cap}, indeed={indeed_cap})..."
            )
            res_j, res_i = await asyncio.gather(
                crawl_jobs_for_user_jooble(user, max_stored=jooble_cap),
                crawl_jobs_for_user_jobsapi(user, max_stored=indeed_cap),
            )
            stored = (res_j or {}).get("stored", 0) + (res_i or {}).get("stored", 0)
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


def start_scheduler():
    """Start APScheduler.

    Auto crawl+rate and reminders run on a 15-min sweep tick rather than a
    fixed-timezone cron trigger — each tick checks every user's *local* time
    (via their `timezone` preference) against the target hours, so each user
    gets their own 5am/5pm and 9am/2pm/7pm regardless of where they live,
    without needing one cron job per timezone in use. This also survives
    restarts cleanly: the decision is made from wall-clock time on each
    tick, not from elapsed time since boot (unlike an IntervalTrigger used
    to count down a full 12h window, which resets on every redeploy).
    """
    scheduler.add_job(
        _auto_crawl_and_rate,
        trigger=IntervalTrigger(minutes=SWEEP_WINDOW_MINUTES),
        id="auto_crawl_rate_sweep",
        replace_existing=True,
        max_instances=1,  # prevent overlapping runs
    )

    # Also run soon after boot so a redeploy near someone's window doesn't
    # make them wait for the next sweep tick.
    scheduler.add_job(
        _auto_crawl_and_rate,
        trigger="date",
        run_date=datetime.now(timezone.utc) + timedelta(minutes=2),
        id="first_auto_run",
        replace_existing=True,
    )

    if settings.job_reminder_enabled:
        scheduler.add_job(
            send_job_apply_reminders,
            trigger=IntervalTrigger(minutes=SWEEP_WINDOW_MINUTES),
            id="job_reminder_sweep",
            replace_existing=True,
            max_instances=1,
        )
        print(
            "[scheduler] Job apply reminders: local 09:00/14:00/19:00 per user timezone "
            f"(max {settings.job_reminder_max_per_day}/user/day, score ≥ "
            f"{settings.job_reminder_min_score})"
        )

    scheduler.start()
    print(
        "[scheduler] APScheduler started (auto crawl+rate: local 05:00/17:00 per user timezone)"
    )


def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        print("[scheduler] APScheduler shut down.")
