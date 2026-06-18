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
from services.crawler import crawl_jobs_for_user

router = APIRouter(prefix="/crawler", tags=["crawler"])

MANUAL_DAILY_LIMIT = 20


@router.post("/search")
async def manual_search(user=Depends(get_current_user)):
    db = get_database()

    # check daily manual limit
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    manual_today = user.get("manual_crawl_count_today", 0)
    last_reset = user.get("manual_crawl_reset", None)

    # normalize: MongoDB returns naive datetimes, make timezone-aware for comparison
    if last_reset is not None and last_reset.tzinfo is None:
        last_reset = last_reset.replace(tzinfo=timezone.utc)

    # reset count if it's a new day
    if last_reset is None or last_reset < today_start:
        manual_today = 0
        await db.users.update_one(
            {"_id": ObjectId(user["_id"])},
            {
                "$set": {
                    "manual_crawl_count_today": 0,
                    "manual_crawl_reset": today_start,
                }
            },
        )

    if manual_today >= MANUAL_DAILY_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Manual search limit reached ({MANUAL_DAILY_LIMIT}/day). Try again tomorrow.",
        )

    # run crawl
    result = await crawl_jobs_for_user(user)

    # update counters
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {
            "$set": {"last_crawl_at": datetime.now(timezone.utc)},
            "$inc": {"manual_crawl_count_today": 1},
        },
    )

    return {
        "message": "Crawl complete.",
        "found": result["found"],
        "stored": result["stored"],
        "skipped": result["skipped"],
        "manual_searches_remaining": MANUAL_DAILY_LIMIT - manual_today - 1,
    }

@router.get("/status")
async def crawl_status(user=Depends(get_current_user)):
    db = get_database()
    total_jobs = await db.jobs.count_documents({})
    return {
        "last_crawl_at": user.get("last_crawl_at"),
        "manual_searches_today": user.get("manual_crawl_count_today", 0),
        "manual_searches_remaining": max(
            0, MANUAL_DAILY_LIMIT - user.get("manual_crawl_count_today", 0)
        ),
        "total_jobs_in_db": total_jobs,
    }
