"""
Freemium limits + usage tracking.

- Free users have low daily limits on searches, ratings, and AI tokens.
- Admin (specific email) bypasses all limits.
- Admin can manually override limits per user via admin panel.
- Usage is tracked in user doc: usage.searches, usage.ratings, usage.last_reset,
  usage.ai_daily, usage.ai_month
"""

from datetime import datetime, timezone, timedelta
from bson import ObjectId
from pymongo import ReturnDocument

from config import settings
from database import get_database
from services.ai_usage import format_ai_usage


def _current_month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _is_admin(user: dict) -> bool:
    admin_email = (settings.admin_email or "").strip().lower()
    user_email = (user.get("email") or "").strip().lower()
    return bool(admin_email) and user_email == admin_email


async def _get_fresh_user(user_id: str) -> dict:
    db = get_database()
    return await db.users.find_one({"_id": ObjectId(user_id)})


def _has_unlimited_access(user: dict) -> bool:
    if _is_admin(user):
        return True
    overrides = user.get("admin_overrides", {})
    if overrides.get("full_access"):
        return True
    full_until = overrides.get("full_access_until")
    if full_until:
        try:
            until = datetime.fromisoformat(full_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < until:
                return True
        except Exception:
            pass
    return False


def _get_token_limits(user: dict) -> tuple[int, int]:
    """Return (daily_limit, monthly_limit). 0 means unlimited."""
    overrides = user.get("admin_overrides", {})
    daily = overrides.get("daily_token_limit")
    monthly = overrides.get("monthly_token_limit")
    if daily is None:
        daily = settings.free_daily_token_limit
    if monthly is None:
        monthly = settings.free_monthly_token_limit
    return int(daily or 0), int(monthly or 0)


def _effective_monthly_tokens(usage: dict) -> int:
    month = _current_month_key()
    ai_month = usage.get("ai_month", {})
    if ai_month.get("month") != month:
        return 0
    return int(ai_month.get("total_tokens", 0) or 0)


def ai_token_limit_message(kind: str, limit: int) -> str:
    period = "day" if kind == "daily" else "month"
    return (
        f"AI token limit reached ({limit:,} tokens/{period}). "
        "Contact us for more access."
    )


async def check_ai_token_quota(user: dict) -> tuple[bool, str]:
    """Peek at AI token usage vs per-user caps. Does not increment."""
    if _has_unlimited_access(user):
        return True, ""

    user_id = str(user.get("_id", ""))
    if user_id:
        user = await _get_fresh_user(user_id)
    if not user:
        return True, ""

    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    daily_used = int(usage.get("ai_daily", {}).get("total_tokens", 0) or 0)
    monthly_used = _effective_monthly_tokens(usage)
    daily_limit, monthly_limit = _get_token_limits(user)

    if daily_limit > 0 and daily_used >= daily_limit:
        return False, ai_token_limit_message("daily", daily_limit)
    if monthly_limit > 0 and monthly_used >= monthly_limit:
        return False, ai_token_limit_message("monthly", monthly_limit)
    return True, ""


async def get_ai_token_quota(user: dict) -> dict:
    """Token usage + limits for admin panel and debugging."""
    unlimited = _has_unlimited_access(user)
    user_id = str(user.get("_id", ""))
    if user_id:
        user = await _get_fresh_user(user_id)
    user = await _reset_if_new_day(user or {})
    usage = (user or {}).get("usage", {})
    daily_used = int(usage.get("ai_daily", {}).get("total_tokens", 0) or 0)
    monthly_used = _effective_monthly_tokens(usage)

    if unlimited:
        return {
            "daily_tokens_used": daily_used,
            "monthly_tokens_used": monthly_used,
            "daily_token_limit": 0,
            "monthly_token_limit": 0,
            "daily_tokens_remaining": None,
            "monthly_tokens_remaining": None,
            "unlimited": True,
        }

    daily_limit, monthly_limit = _get_token_limits(user or {})
    daily_remaining = None if daily_limit == 0 else max(0, daily_limit - daily_used)
    monthly_remaining = (
        None if monthly_limit == 0 else max(0, monthly_limit - monthly_used)
    )

    return {
        "daily_tokens_used": daily_used,
        "monthly_tokens_used": monthly_used,
        "daily_token_limit": daily_limit,
        "monthly_token_limit": monthly_limit,
        "daily_tokens_remaining": daily_remaining,
        "monthly_tokens_remaining": monthly_remaining,
        "unlimited": False,
    }


async def _reset_if_new_day(user: dict) -> dict:
    """Reset daily counters if it's a new day."""
    db = get_database()
    today = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    last_reset = user.get("usage", {}).get("last_reset")

    # Normalize last_reset: treat naive datetimes as UTC (common with old Mongo data)
    if isinstance(last_reset, datetime):
        if last_reset.tzinfo is None:
            last_reset = last_reset.replace(tzinfo=timezone.utc)
        # also normalize any non-UTC tz to UTC for comparison
        elif last_reset.tzinfo != timezone.utc:
            last_reset = last_reset.astimezone(timezone.utc)

    if last_reset is None or last_reset < today:
        await db.users.update_one(
            {"_id": ObjectId(user["_id"])},
            {
                "$set": {
                    "usage.searches": 0,
                    "usage.ratings": 0,
                    "usage.reminder_emails": 0,
                    "usage.last_reset": today,
                    "usage.ai_daily": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "embedding_tokens": 0,
                        "llm_calls": 0,
                        "embedding_calls": 0,
                        "estimated_cost_usd": 0.0,
                    },
                }
            },
        )
        user.setdefault("usage", {})["searches"] = 0
        user["usage"]["ratings"] = 0
        user["usage"]["reminder_emails"] = 0
        user["usage"]["last_reset"] = today
        user["usage"]["ai_daily"] = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "embedding_tokens": 0,
            "llm_calls": 0,
            "embedding_calls": 0,
            "estimated_cost_usd": 0.0,
        }
    return user


async def check_and_increment_search(user: dict) -> tuple[bool, str, int]:
    """
    Returns: (allowed, message, remaining)
    """
    if _has_unlimited_access(user):
        return True, "Unlimited access", -1

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        return False, token_msg, 0

    user_id = str(user.get("_id", ""))
    if user_id:
        user = await _get_fresh_user(user_id)
    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    current = usage.get("searches", 0)
    overrides = user.get("admin_overrides", {})

    limit = overrides.get("search_limit", settings.free_search_limit)

    if current >= limit:
        return (
            False,
            f"Free search limit reached ({limit}/day). Contact us for more access.",
            0,
        )

    # Increment
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])}, {"$inc": {"usage.searches": 1}}
    )
    remaining = limit - (current + 1)
    return True, "", remaining


def rating_limit_message(limit: int) -> str:
    return f"Free rating limit reached ({limit}/day). Contact us for more access."


async def count_ratings_today(user_id: str) -> int:
    """How many jobs this user actually received a rating for today (UTC)."""
    db = get_database()
    today = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return await db.jobs.count_documents(
        {f"ratings.{user_id}.rated_at": {"$gte": today}}
    )


async def _sync_ratings_counter(user_id: str, actual: int) -> None:
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"usage.ratings": actual}},
    )


async def _effective_ratings_used(user_id: str, usage: dict) -> int:
    """Max of stored counter and real rated-job count — fixes drift after failed increments."""
    counter = int(usage.get("ratings", 0) or 0)
    db_count = await count_ratings_today(user_id)
    effective = max(counter, db_count)
    if db_count > counter:
        await _sync_ratings_counter(user_id, db_count)
    return effective


async def get_remaining_ratings(user: dict) -> int:
    """Peek rating quota without consuming (does not include token caps)."""
    user_id = str(user.get("_id", ""))
    if user_id:
        user = await _get_fresh_user(user_id)
    if _has_unlimited_access(user):
        return 9999

    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    user_id = str(user.get("_id", ""))
    current = await _effective_ratings_used(user_id, usage)
    overrides = user.get("admin_overrides", {})
    limit = overrides.get("rating_limit", settings.free_rating_limit)
    return max(0, limit - current)


async def check_and_increment_rating(
    user: dict, jobs_to_rate: int = 1
) -> tuple[bool, str, int]:
    """
    For rating jobs. Returns (allowed, message, remaining)
    """
    if _has_unlimited_access(user):
        return True, "Unlimited access", -1

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        return False, token_msg, 0

    user_id = str(user.get("_id", ""))
    if user_id:
        user = await _get_fresh_user(user_id)
    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    overrides = user.get("admin_overrides", {})
    limit = overrides.get("rating_limit", settings.free_rating_limit)

    current = await _effective_ratings_used(user_id, usage)
    if current + jobs_to_rate > limit:
        return (
            False,
            rating_limit_message(limit),
            max(0, limit - current),
        )

    db = get_database()
    max_before_inc = limit - jobs_to_rate
    result = await db.users.find_one_and_update(
        {
            "_id": ObjectId(user["_id"]),
            "$or": [
                {"usage.ratings": {"$exists": False}},
                {"usage.ratings": {"$lte": max_before_inc}},
            ],
        },
        {"$inc": {"usage.ratings": jobs_to_rate}},
        return_document=ReturnDocument.AFTER,
    )
    if not result:
        # Re-check against DB truth in case counter was behind
        current = await _effective_ratings_used(user_id, usage)
        return (
            False,
            rating_limit_message(limit),
            max(0, limit - current),
        )

    new_used = int(result.get("usage", {}).get("ratings", 0) or 0)
    remaining = max(0, limit - new_used)
    return True, "", remaining


async def refund_rating(user_id: str, count: int = 1) -> None:
    """Undo a rating quota increment when a reserved slot did not produce a billable rating."""
    if not user_id or count <= 0:
        return
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(user_id)}, {"usage.ratings": 1})
    current = int((user or {}).get("usage", {}).get("ratings", 0) or 0)
    refund = min(count, current)
    if refund > 0:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$inc": {"usage.ratings": -refund}},
        )


async def get_user_usage(user_id: str) -> dict:
    """For admin panel and frontend."""
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return {}

    user = await _reset_if_new_day(user)
    overrides = user.get("admin_overrides", {})
    usage = user.get("usage", {})
    token_quota = await get_ai_token_quota(user)
    ratings_used = await _effective_ratings_used(user_id, usage)

    return {
        "email": user.get("email"),
        "searches_used": usage.get("searches", 0),
        "ratings_used": ratings_used,
        "search_limit": overrides.get("search_limit", settings.free_search_limit),
        "rating_limit": overrides.get("rating_limit", settings.free_rating_limit),
        "full_access": bool(overrides.get("full_access")),
        "full_access_until": overrides.get("full_access_until"),
        "is_admin": _is_admin(user),
        "last_reset": usage.get("last_reset"),
        "admin_notes": user.get("admin_notes", ""),
        "ai_usage": format_ai_usage(user),
        **token_quota,
    }


async def admin_update_user_limits(
    user_id: str,
    search_limit: int = None,
    rating_limit: int = None,
    daily_token_limit: int = None,
    monthly_token_limit: int = None,
    notes: str = None,
    full_access: bool = None,
    full_access_duration_hours: int = None,  # e.g. 12 or 24 for temporary
):
    """Admin manually sets access for a user (freemium control).
    full_access_duration_hours: grant temporary full access for N hours.
    """
    db = get_database()
    updates = {}
    if full_access_duration_hours is not None and full_access_duration_hours > 0:
        until = datetime.now(timezone.utc) + timedelta(hours=full_access_duration_hours)
        updates["admin_overrides.full_access_until"] = until.isoformat()
        updates["admin_overrides.full_access"] = False  # use until instead
        updates["admin_overrides.search_limit"] = 9999
        updates["admin_overrides.rating_limit"] = 9999
        updates["admin_overrides.daily_token_limit"] = 0
        updates["admin_overrides.monthly_token_limit"] = 0
    elif full_access is not None:
        updates["admin_overrides.full_access"] = full_access
        if full_access:
            updates["admin_overrides.full_access_until"] = None
            updates["admin_overrides.search_limit"] = 9999
            updates["admin_overrides.rating_limit"] = 9999
            updates["admin_overrides.daily_token_limit"] = 0
            updates["admin_overrides.monthly_token_limit"] = 0
        else:
            updates["admin_overrides.full_access_until"] = None
    if search_limit is not None:
        updates["admin_overrides.search_limit"] = search_limit
    if rating_limit is not None:
        updates["admin_overrides.rating_limit"] = rating_limit
    if daily_token_limit is not None:
        updates["admin_overrides.daily_token_limit"] = daily_token_limit
    if monthly_token_limit is not None:
        updates["admin_overrides.monthly_token_limit"] = monthly_token_limit
    if notes is not None:
        updates["admin_notes"] = notes

    if updates:
        await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": updates})
    return await get_user_usage(user_id)


async def admin_list_users(page: int = 1, limit: int = 50):
    """For admin panel to see all users and their usage."""
    db = get_database()
    skip = (page - 1) * limit
    cursor = db.users.find({}).sort("created_at", -1).skip(skip).limit(limit)
    users = await cursor.to_list(length=limit)

    result = []
    for u in users:
        usage = await get_user_usage(str(u["_id"]))
        result.append(
            {
                "id": str(u["_id"]),
                "name": u.get("name"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                **usage,
            }
        )
    total = await db.users.count_documents({})
    return {"users": result, "total": total, "page": page}
