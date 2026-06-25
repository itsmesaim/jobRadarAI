"""
Admin routes - heavily obfuscated path for security.

Access via secret prefix defined in .env (ADMIN_SECRET_PATH).
Only the admin email can access.
Regular users can never discover this.

The prefix comes from .env — do not hardcode real value in code.
Example final URL (whatever you set in .env): /k9x7p2mQvL4r/users
"""

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel

from deps import get_current_user
from config import settings
from services.ai_usage import get_platform_ai_summary
from services.limits import admin_list_users, admin_update_user_limits, get_user_usage


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
