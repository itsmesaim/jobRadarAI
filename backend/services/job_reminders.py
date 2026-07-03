"""
Daily email reminders for high-scoring unapplied jobs.

Sends up to N emails per user per day (default 2) when they have enough
NEW jobs scoring at or above the configured threshold (default 8/10).
"""

from datetime import datetime, timezone

from bson import ObjectId

from config import settings
from database import get_database
from services.email import (
    send_apply_reminder_email,
    smtp_configured,
    smtp_missing_reason,
)
from services.limits import _reset_if_new_day


def _high_score_unapplied_filter(user_id: str, *, min_score: int) -> dict:
    rating_key = f"ratings.{user_id}.score"
    status_key = f"status_{user_id}"
    hidden_key = f"hidden_{user_id}"
    return {
        "crawled_by": user_id,
        hidden_key: {"$ne": True},
        rating_key: {"$gte": min_score},
        "$or": [{status_key: {"$exists": False}}, {status_key: "NEW"}],
    }


async def count_high_score_unapplied_jobs(user_id: str, *, min_score: int) -> int:
    db = get_database()
    return await db.jobs.count_documents(
        _high_score_unapplied_filter(user_id, min_score=min_score)
    )


async def get_high_score_unapplied_jobs(
    user_id: str,
    *,
    min_score: int,
    limit: int = 8,
) -> list[dict]:
    """Return NEW/unapplied jobs rated >= min_score, highest score first."""
    db = get_database()
    rating_key = f"ratings.{user_id}.score"

    jobs = (
        await db.jobs.find(_high_score_unapplied_filter(user_id, min_score=min_score))
        .sort(rating_key, -1)
        .limit(limit)
        .to_list(length=limit)
    )

    results: list[dict] = []
    for job in jobs:
        rating = job.get("ratings", {}).get(user_id, {})
        strengths = rating.get("matched_strengths") or []
        results.append(
            {
                "id": str(job["_id"]),
                "title": job.get("title") or "Untitled role",
                "company": job.get("company") or "",
                "location": job.get("location") or "",
                "score": rating.get("score"),
                "url": job.get("url") or "",
                "verdict": rating.get("verdict") or "",
                "top_strength": strengths[0] if strengths else "",
            }
        )
    return results


async def _reminders_sent_today(user: dict) -> int:
    user = await _reset_if_new_day(user)
    return int(user.get("usage", {}).get("reminder_emails", 0) or 0)


async def _increment_reminder_count(user_id: str) -> None:
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$inc": {"usage.reminder_emails": 1}},
    )


async def _try_send_reminder_for_user(user: dict) -> dict:
    """Send one reminder email if the user qualifies. Returns a small status dict."""
    user_id = str(user["_id"])
    email = user.get("email", user_id)
    name = user.get("name") or "there"

    if user.get("email_reminders_enabled", True) is False:
        return {"email": email, "skipped": "disabled"}

    sent_today = await _reminders_sent_today(user)
    if sent_today >= settings.job_reminder_max_per_day:
        return {"email": email, "skipped": "daily_cap"}

    total_count = await count_high_score_unapplied_jobs(
        user_id,
        min_score=settings.job_reminder_min_score,
    )
    if total_count < settings.job_reminder_min_jobs:
        return {
            "email": email,
            "skipped": "not_enough_jobs",
            "count": total_count,
        }

    jobs = await get_high_score_unapplied_jobs(
        user_id,
        min_score=settings.job_reminder_min_score,
        limit=settings.job_reminder_email_job_limit,
    )

    dashboard_url = f"{settings.frontend_url.rstrip('/')}/"
    settings_url = f"{settings.frontend_url.rstrip('/')}/settings"

    if not smtp_configured():
        reason = smtp_missing_reason() or "unknown"
        if settings.debug:
            top = ", ".join(f"{j['title']} ({j['score']}/10)" for j in jobs[:5])
            print(
                f"[reminders] [{email}] SMTP not configured ({reason}) — "
                f"would email {len(jobs)} high-score jobs: {top}"
            )
        return {"email": email, "skipped": "smtp_not_configured", "count": len(jobs)}

    try:
        send_apply_reminder_email(
            to_email=email,
            user_name=name,
            jobs=jobs,
            total_count=total_count,
            min_score=settings.job_reminder_min_score,
            dashboard_url=dashboard_url,
            settings_url=settings_url,
        )
        await _increment_reminder_count(user_id)
        print(
            f"[reminders] [{email}] ✓ Sent reminder ({len(jobs)} jobs ≥ "
            f"{settings.job_reminder_min_score}/10)"
        )
        return {"email": email, "sent": True, "count": len(jobs)}
    except Exception as e:
        print(f"[reminders] [{email}] ✗ Failed to send: {e}")
        return {"email": email, "error": str(e)}


async def send_job_apply_reminders() -> None:
    """Scheduler entry: remind every user with a CV about high-score NEW jobs."""
    if not settings.job_reminder_enabled:
        print("[reminders] Disabled via JOB_REMINDER_ENABLED=false")
        return

    db = get_database()
    users = await db.users.find({"cv": {"$exists": True}}).to_list(length=None)

    print(
        f"[reminders] === REMINDER RUN ({len(users)} users with CV) "
        f"{datetime.now(timezone.utc).isoformat()} ==="
    )

    sent = 0
    skipped = 0
    for user in users:
        result = await _try_send_reminder_for_user(user)
        if result.get("sent"):
            sent += 1
        else:
            skipped += 1

    print(f"[reminders] === DONE sent={sent} skipped={skipped} ===")
