"""
Crawler routes.

POST /crawler/search   — manual trigger (capped 3/day)
GET  /crawler/status   — last crawl info for current user
"""

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status

from database import get_database
from deps import get_current_user
from services.adzuna_crawler import crawl_jobs_for_user_adzuna
from services.jooble_crawler import crawl_jobs_for_user_jooble
from services.jobsapi_indeed_crawler import (
    crawl_jobs_for_user_jobsapi,
    crawl_jobs_for_user_jobsapi_linkedin,
)
from services.limits import check_and_increment_search, get_user_usage


router = APIRouter(prefix="/crawler", tags=["crawler"])

MANUAL_DAILY_LIMIT = 20


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

    # run crawl (legacy counter still updated for backward compat)
    result_jooble = await crawl_jobs_for_user_jooble(user)
    result_jobsapi = await crawl_jobs_for_user_jobsapi(user)
    result_linkedin = await crawl_jobs_for_user_jobsapi_linkedin(user)
    result_adzuna = {"found": 0, "stored": 0, "skipped": 0}

    result = {
        "found": result_jooble["found"]
        + result_jobsapi["found"]
        + result_linkedin["found"]
        + result_adzuna["found"],
        "stored": result_jooble["stored"]
        + result_jobsapi["stored"]
        + result_linkedin["stored"]
        + result_adzuna["stored"],
        "skipped": result_jooble["skipped"]
        + result_jobsapi["skipped"]
        + result_linkedin["skipped"]
        + result_adzuna["skipped"],
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
    total_jobs = await db.jobs.count_documents({"crawled_by": str(user["_id"])})
    usage = await get_user_usage(str(user["_id"]))
    is_full = usage.get("full_access") or (
        usage.get("full_access_until")
        and datetime.now(timezone.utc)
        < datetime.fromisoformat(usage.get("full_access_until").replace("Z", "+00:00"))
    )
    token_unlimited = is_full or usage.get("unlimited")
    return {
        "last_crawl_at": user.get("last_crawl_at"),
        "searches_used": usage.get("searches_used", 0),
        "search_limit": 9999 if is_full else usage.get("search_limit", 0),
        "ratings_used": usage.get("ratings_used", 0),
        "rating_limit": 9999 if is_full else usage.get("rating_limit", 0),
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
    }
