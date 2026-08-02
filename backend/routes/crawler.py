"""
Crawler routes.

POST /crawler/search  , manual trigger (capped 3/day)
GET  /crawler/status  , last crawl info for current user
"""

import asyncio
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from config import settings
from database import get_database
from deps import get_current_user
from services.jooble_crawler import crawl_jobs_for_user_jooble
from services.jobsapi_indeed_crawler import crawl_jobs_for_user_jobsapi
from services.limits import check_and_increment_search, get_user_usage


router = APIRouter(prefix="/crawler", tags=["crawler"])

MANUAL_DAILY_LIMIT = 20
STALE_FOLLOWUP_STATUSES = ["APPLIED", "HALF_APPLIED", "SAVED"]


async def get_apply_soon_count(db, user_id: str) -> int:
    """Jobs scoring 8+/10, still New, surfaced on the Dashboard reminder
    banner and the notification bell (routes/users.py)."""
    hidden_key = f"hidden_{user_id}"
    rating_key = f"ratings.{user_id}.score"
    status_key = f"status_{user_id}"
    return await db.jobs.count_documents(
        {
            "crawled_by": user_id,
            hidden_key: {"$ne": True},
            rating_key: {"$gte": 8},
            "$or": [{status_key: {"$exists": False}}, {status_key: "NEW"}],
        }
    )


def _stale_followup_query(user_id: str, stale_cutoff: datetime) -> dict:
    hidden_key = f"hidden_{user_id}"
    status_key = f"status_{user_id}"
    status_at_key = f"status_at_{user_id}"
    return {
        "crawled_by": user_id,
        hidden_key: {"$ne": True},
        status_key: {"$in": STALE_FOLLOWUP_STATUSES},
        "$or": [
            {status_at_key: {"$lte": stale_cutoff}},
            {
                status_at_key: {"$exists": False},
                "crawled_at": {"$lte": stale_cutoff},
            },
        ],
    }


async def get_stale_followup_count(db, user_id: str) -> int:
    """Jobs sitting in Applied/Half-applied/Saved for too long with no status
    change, see the comment on stale_cutoff below for the crawled_at fallback."""
    stale_cutoff = datetime.now(timezone.utc) - timedelta(
        days=settings.stale_followup_days
    )
    return await db.jobs.count_documents(_stale_followup_query(user_id, stale_cutoff))


async def get_stale_followup_jobs(db, user_id: str, limit: int = 5) -> list[dict]:
    """Same jobs as get_stale_followup_count, but named, title/company/days
    stale, for the notification bell, which needs specifics rather than a
    bare count (a user can't act on "1 job" without knowing which one)."""
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(days=settings.stale_followup_days)
    status_key = f"status_{user_id}"
    status_at_key = f"status_at_{user_id}"
    cursor = db.jobs.find(
        _stale_followup_query(user_id, stale_cutoff),
        {"title": 1, "company": 1, status_key: 1, status_at_key: 1, "crawled_at": 1},
    ).limit(limit)
    jobs = []
    async for job in cursor:
        last_update = job.get(status_at_key) or job.get("crawled_at") or now
        if last_update.tzinfo is None:
            last_update = last_update.replace(tzinfo=timezone.utc)
        days_stale = (now - last_update).days
        jobs.append(
            {
                "id": str(job["_id"]),
                "title": job.get("title", "Untitled"),
                "company": job.get("company", ""),
                "status": job.get(status_key, "SAVED"),
                "days_stale": days_stale,
            }
        )
    return jobs


@router.post("/search")
async def manual_search(user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])

    # Freemium check
    allowed, message, remaining = await check_and_increment_search(user)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=message,
        )

    # Run both sources concurrently, they're independent network calls, no
    # reason to make the user wait for Jooble to finish before Indeed starts.
    result_jooble, result_jobsapi = await asyncio.gather(
        crawl_jobs_for_user_jooble(user),
        crawl_jobs_for_user_jobsapi(user),
    )

    result = {
        "found": result_jooble["found"] + result_jobsapi["found"],
        "stored": result_jooble["stored"] + result_jobsapi["stored"],
        "skipped": result_jooble["skipped"] + result_jobsapi["skipped"],
    }

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"last_crawl_at": datetime.now(timezone.utc)}},
    )

    usage = await get_user_usage(user_id)
    return {
        "message": "Crawl complete.",
        "found": result["found"],
        "stored": result["stored"],
        "skipped": result["skipped"],
        "searches_remaining": usage.get("search_limit", 0)
        - usage.get("searches_used", 0),
    }


@router.get("/status")
async def crawl_status(user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])
    hidden_key = f"hidden_{user_id}"
    rating_key = f"ratings.{user_id}.score"
    status_key = f"status_{user_id}"
    base_filter = {"crawled_by": user_id, hidden_key: {"$ne": True}}

    total_jobs = await db.jobs.count_documents(base_filter)
    apply_soon_count = await get_apply_soon_count(db, user_id)
    active_status = {
        "$or": [
            {status_key: {"$exists": False}},
            {status_key: {"$nin": ["APPLIED", "REJECTED", "OFFER"]}},
        ]
    }
    strong_matches_count = await db.jobs.count_documents(
        {**base_filter, rating_key: {"$gte": 7}, **active_status}
    )
    unrated_count = await db.jobs.count_documents(
        {
            **base_filter,
            f"ratings.{user_id}": {"$exists": False},
        }
    )
    active_count = await db.jobs.count_documents({**base_filter, **active_status})

    # Follow-up nudge: jobs sitting in Applied/Half-applied/Saved for too
    # long with no status change. status_at_{user_id} is only set going
    # forward (added when this feature shipped), for older status changes
    # that predate it, fall back to crawled_at as a best-effort proxy so
    # existing pipeline jobs aren't silently excluded forever.
    stale_followup_count = await get_stale_followup_count(db, user_id)

    usage = await get_user_usage(user_id)
    is_full = (
        usage.get("full_access")
        or usage.get("is_admin")
        or (
            usage.get("full_access_until")
            and datetime.now(timezone.utc)
            < datetime.fromisoformat(
                usage.get("full_access_until").replace("Z", "+00:00")
            )
        )
    )
    token_unlimited = is_full or usage.get("unlimited")
    return {
        "last_crawl_at": user.get("last_crawl_at"),
        "searches_used": usage.get("searches_used", 0),
        "search_limit": 9999 if is_full else usage.get("search_limit", 0),
        "ratings_used": usage.get("ratings_used", 0),
        "rating_limit": 9999 if is_full else usage.get("rating_limit", 0),
        "apply_packs_used": usage.get("apply_packs_used", 0),
        "apply_pack_limit": 9999 if is_full else usage.get("apply_pack_limit", 0),
        "apply_packs_remaining": (
            9999
            if is_full
            else max(
                0,
                int(usage.get("apply_pack_limit", 0) or 0)
                - int(usage.get("apply_packs_used", 0) or 0),
            )
        ),
        "daily_tokens_used": usage.get("daily_tokens_used", 0),
        "monthly_tokens_used": usage.get("monthly_tokens_used", 0),
        "daily_token_limit": (
            0 if token_unlimited else usage.get("daily_token_limit", 0)
        ),
        "monthly_token_limit": (
            0 if token_unlimited else usage.get("monthly_token_limit", 0)
        ),
        "daily_tokens_remaining": usage.get("daily_tokens_remaining"),
        "monthly_tokens_remaining": usage.get("monthly_tokens_remaining"),
        "token_quota_unlimited": token_unlimited,
        "full_access": is_full,
        "full_access_until": usage.get("full_access_until"),
        "my_jobs": total_jobs,
        "is_admin": usage.get("is_admin", False),
        "apply_soon_count": apply_soon_count,
        "strong_matches_count": strong_matches_count,
        "unrated_count": unrated_count,
        "active_count": active_count,
        "stale_followup_count": stale_followup_count,
        "stale_followup_days": settings.stale_followup_days,
    }
