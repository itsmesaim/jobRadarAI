"""
Freemium limits + usage tracking.

- Free users have low daily limits on searches and ratings (to control tokens/API costs).
- Admin (specific email) bypasses all limits.
- Admin can manually override limits per user via admin panel.
- Usage is tracked in user doc: usage.searches, usage.ratings, usage.last_reset
"""

from datetime import datetime, timezone, timedelta
from bson import ObjectId

from config import settings
from database import get_database


def _is_admin(user: dict) -> bool:
    admin_email = (settings.admin_email or "").strip().lower()
    user_email = (user.get("email") or "").strip().lower()
    return bool(admin_email) and user_email == admin_email


async def _get_fresh_user(user_id: str) -> dict:
    db = get_database()
    return await db.users.find_one({"_id": ObjectId(user_id)})


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
                    "usage.last_reset": today,
                }
            },
        )
        user.setdefault("usage", {})["searches"] = 0
        user["usage"]["ratings"] = 0
        user["usage"]["last_reset"] = today
    return user


async def check_and_increment_search(user: dict) -> tuple[bool, str, int]:
    """
    Returns: (allowed, message, remaining)
    """
    if _is_admin(user):
        return True, "Admin unlimited", -1

    overrides = user.get("admin_overrides", {})
    if overrides.get("full_access"):
        return True, "Full access", -1

    # Check temporary full access
    full_until = overrides.get("full_access_until")
    if full_until:
        try:
            until = datetime.fromisoformat(full_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < until:
                return True, f"Full access until {until.strftime('%Y-%m-%d %H:%M')}", -1
        except Exception:
            pass

    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    current = usage.get("searches", 0)

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


async def get_remaining_ratings(user: dict) -> int:
    """Peek without consuming."""
    if _is_admin(user):
        return 9999
    overrides = user.get("admin_overrides", {})
    if overrides.get("full_access"):
        return 9999
    full_until = overrides.get("full_access_until")
    if full_until:
        try:
            until = datetime.fromisoformat(full_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < until:
                return 9999
        except Exception:
            pass
    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    current = usage.get("ratings", 0)
    limit = overrides.get("rating_limit", settings.free_rating_limit)
    return max(0, limit - current)


async def check_and_increment_rating(
    user: dict, jobs_to_rate: int = 1
) -> tuple[bool, str, int]:
    """
    For rating jobs. Returns (allowed, message, remaining)
    """
    if _is_admin(user):
        return True, "Admin unlimited", -1

    overrides = user.get("admin_overrides", {})
    if overrides.get("full_access"):
        return True, "Full access", -1

    # Check temporary full access
    full_until = overrides.get("full_access_until")
    if full_until:
        try:
            until = datetime.fromisoformat(full_until.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) < until:
                return True, f"Full access until {until.strftime('%Y-%m-%d %H:%M')}", -1
        except Exception:
            pass

    user = await _reset_if_new_day(user)
    usage = user.get("usage", {})
    current = usage.get("ratings", 0)

    limit = overrides.get("rating_limit", settings.free_rating_limit)

    if current + jobs_to_rate > limit:
        return (
            False,
            f"Free rating limit reached ({limit}/day). Contact us for more access.",
            max(0, limit - current),
        )

    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])}, {"$inc": {"usage.ratings": jobs_to_rate}}
    )
    remaining = limit - (current + jobs_to_rate)
    return True, "", remaining


async def get_user_usage(user_id: str) -> dict:
    """For admin panel and frontend."""
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return {}

    user = await _reset_if_new_day(user)
    overrides = user.get("admin_overrides", {})
    usage = user.get("usage", {})

    return {
        "email": user.get("email"),
        "searches_used": usage.get("searches", 0),
        "ratings_used": usage.get("ratings", 0),
        "search_limit": overrides.get("search_limit", settings.free_search_limit),
        "rating_limit": overrides.get("rating_limit", settings.free_rating_limit),
        "full_access": bool(overrides.get("full_access")),
        "full_access_until": overrides.get("full_access_until"),
        "is_admin": _is_admin(user),
        "last_reset": usage.get("last_reset"),
        "admin_notes": user.get("admin_notes", ""),
    }


async def admin_update_user_limits(
    user_id: str,
    search_limit: int = None,
    rating_limit: int = None,
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
    elif full_access is not None:
        updates["admin_overrides.full_access"] = full_access
        if full_access:
            updates["admin_overrides.full_access_until"] = None
            updates["admin_overrides.search_limit"] = 9999
            updates["admin_overrides.rating_limit"] = 9999
        else:
            updates["admin_overrides.full_access_until"] = None
    if search_limit is not None:
        updates["admin_overrides.search_limit"] = search_limit
    if rating_limit is not None:
        updates["admin_overrides.rating_limit"] = rating_limit
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
