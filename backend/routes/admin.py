"""
Admin routes - heavily obfuscated path for security.

Access via secret prefix defined in .env (ADMIN_SECRET_PATH).
Only the admin email can access.
Regular users can never discover this.

The prefix comes from .env — do not hardcode real value in code.
Example final URL (whatever you set in .env): /k9x7p2mQvL4r/users
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel

from database import get_database
from deps import get_current_user
from config import settings
from services.ai_usage import get_platform_ai_summary
from services.limits import admin_list_users, admin_update_user_limits, get_user_usage


class JobCleanupRequest(BaseModel):
    user_id: str
    filter_type: Literal[
        "all",
        "old",
        "unrated",
        "low_score",
        "below_score",
        "by_status",
        "auto_rejected",
    ]
    older_than_days: int | None = None  # used when filter_type == "old"
    max_score: int | None = None  # used when filter_type == "low_score"
    min_score: int | None = None  # used when filter_type == "below_score"
    statuses: list[str] | None = None  # used when filter_type == "by_status"
    dry_run: bool = True  # True = preview only, no deletion


class UserAccessUpdate(BaseModel):
    search_limit: int | None = None
    rating_limit: int | None = None
    daily_token_limit: int | None = None
    monthly_token_limit: int | None = None
    notes: str | None = None
    full_access: bool | None = None
    full_access_duration_hours: int | None = None


# These routes are included with a secret prefix in main.py
router = APIRouter(tags=["admin (secret path)"])


def _require_admin(user: dict):
    admin_email = (settings.admin_email or "").strip().lower()
    user_email = (user.get("email") or "").strip().lower()
    if not admin_email or user_email != admin_email:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN, detail="Admin access only."
        )


@router.get("/users")
async def list_all_users(
    page: int = 1, limit: int = 50, user=Depends(get_current_user)
):
    _require_admin(user)
    return await admin_list_users(page=page, limit=limit)


@router.get("/users/{user_id}")
async def get_user_details(user_id: str, user=Depends(get_current_user)):
    _require_admin(user)
    usage = await get_user_usage(user_id)
    if not usage:
        raise HTTPException(status_code=404, detail="User not found")
    return usage


@router.patch("/users/{user_id}/access")
async def update_user_access(
    user_id: str, payload: UserAccessUpdate, user=Depends(get_current_user)
):
    """
    Admin manually grants/revokes access after payment or for testing.
    - full_access=true : permanent full
    - full_access_duration_hours=12 or 24 : temporary full access for free users
    """
    _require_admin(user)
    return await admin_update_user_limits(
        user_id=user_id, **payload.model_dump(exclude_unset=True)
    )


@router.get("/usage/{user_id}")
async def get_raw_usage(user_id: str, user=Depends(get_current_user)):
    _require_admin(user)
    return await get_user_usage(user_id)


@router.get("/ai-summary")
async def get_ai_platform_summary(user=Depends(get_current_user)):
    """Platform-wide AI token usage and estimated budget remaining."""
    _require_admin(user)
    return await get_platform_ai_summary()


@router.post("/jobs/cleanup")
async def cleanup_user_jobs(payload: JobCleanupRequest, user=Depends(get_current_user)):
    """
    Delete (or preview) jobs for a specific user.

    Always scoped to crawled_by == user_id — never touches another user's documents.
    Use dry_run=true first to see the count, then dry_run=false to execute.
    """
    _require_admin(user)
    db = get_database()
    uid = payload.user_id

    # Validate user exists
    target = await db.users.find_one({"_id": ObjectId(uid)}, {"email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    # Base filter — always locked to this user's documents
    query: dict = {"crawled_by": uid}

    if payload.filter_type == "old":
        days = max(1, payload.older_than_days or 30)
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query["crawled_at"] = {"$lt": cutoff}

    elif payload.filter_type == "unrated":
        query[f"ratings.{uid}"] = {"$exists": False}

    elif payload.filter_type == "low_score":
        threshold = payload.max_score if payload.max_score is not None else 3
        query[f"ratings.{uid}.score"] = {"$lte": threshold}

    elif payload.filter_type == "below_score":
        # Score 0 (failed/thin JD) and any rating strictly below min_score (default 6).
        cutoff = payload.min_score if payload.min_score is not None else 6
        cutoff = max(1, min(10, cutoff))
        query[f"ratings.{uid}.score"] = {"$lt": cutoff}

    elif payload.filter_type == "by_status":
        if not payload.statuses:
            raise HTTPException(
                status_code=400,
                detail="statuses list is required for by_status filter.",
            )
        query[f"status_{uid}"] = {"$in": payload.statuses}

    elif payload.filter_type == "auto_rejected":
        query[f"ratings.{uid}.auto_reject"] = True

    # "all" keeps only the crawled_by scope — deletes every job for this user

    count = await db.jobs.count_documents(query)

    if payload.dry_run:
        return {
            "dry_run": True,
            "would_delete": count,
            "filter_type": payload.filter_type,
            "target_email": target.get("email"),
        }

    if count == 0:
        return {"dry_run": False, "deleted": 0, "filter_type": payload.filter_type}

    result = await db.jobs.delete_many(query)
    print(
        f"[admin] Job cleanup: deleted {result.deleted_count} jobs "
        f"for user={target.get('email')} filter={payload.filter_type}"
    )
    return {
        "dry_run": False,
        "deleted": result.deleted_count,
        "filter_type": payload.filter_type,
        "target_email": target.get("email"),
    }
