"""
Auth routes: /auth/register, /auth/login, /auth/me

register & login both return a JWT so the frontend can store it and
immediately start making authenticated calls.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from core.security import (
    create_access_token,
    create_password_reset_token,
    decode_password_reset_token,
    hash_password,
    verify_password,
)
from database import get_database
from deps import get_current_user
from models.user import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    MessageResponse,
    ResetPasswordRequest,
    Token,
    UserLogin,
    UserPublic,
    UserRegister,
)
from config import settings
from services.email import (
    send_password_reset_email,
    smtp_configured,
    smtp_missing_reason,
)
from services.limits import get_user_usage

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(payload: UserRegister):
    db = get_database()

    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered. Use “Forgot password” on the login page to reset it.",
        )

    doc = {
        "name": payload.name,
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.users.insert_one(doc)

    token = create_access_token(str(result.inserted_id))
    return Token(access_token=token)


@router.post("/login", response_model=Token)
async def login(payload: UserLogin):
    db = get_database()

    user = await db.users.find_one({"email": payload.email.lower()})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_access_token(str(user["_id"]))
    return Token(access_token=token)


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(payload: ForgotPasswordRequest):
    """
    Request a password reset link. Always returns the same message (no email enumeration).
    Sends email when SMTP is configured; logs link in DEBUG when not.
    """
    db = get_database()
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})

    if user:
        token = create_password_reset_token(str(user["_id"]))
        reset_url = f"{settings.frontend_url.rstrip('/')}/reset-password?token={token}"
        if smtp_configured():
            try:
                send_password_reset_email(to_email=email, reset_url=reset_url)
                print(f"[auth] Password reset email sent to {email}")
            except Exception as exc:
                print(f"[auth] Failed to send reset email to {email}: {exc}")
                if settings.debug:
                    print(f"[auth] Password reset link for {email}: {reset_url}")
        elif settings.debug:
            reason = smtp_missing_reason() or "unknown"
            print(
                f"[auth] SMTP not configured ({reason}) — "
                f"password reset link for {email}: {reset_url}"
            )

    return MessageResponse(
        message=(
            "If an account exists for that email, we sent password reset instructions. "
            "Check your inbox (link expires in "
            f"{settings.password_reset_expire_minutes} minutes)."
        )
    )


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(payload: ResetPasswordRequest):
    user_id = decode_password_reset_token(payload.token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset link. Request a new one.",
        )

    db = get_database()
    from bson import ObjectId

    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset link. Request a new one.",
        )

    result = await db.users.update_one(
        {"_id": oid},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset link. Request a new one.",
        )

    return MessageResponse(message="Password updated. You can sign in now.")


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    payload: ChangePasswordRequest, user=Depends(get_current_user)
):
    if not verify_password(payload.current_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from the current password.",
        )

    db = get_database()
    from bson import ObjectId

    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    return MessageResponse(message="Password changed successfully.")


@router.get("/me", response_model=UserPublic)
async def me(user=Depends(get_current_user)):
    email = user.get("email", "")
    admin_email = (settings.admin_email or "").strip().lower()
    is_admin = bool(admin_email) and email.strip().lower() == admin_email
    admin_base = None
    if is_admin and settings.admin_secret_path:
        admin_base = f"/{settings.admin_secret_path.strip('/')}"

    # For admin, also include basic usage summary
    usage_info = {}
    if is_admin:
        try:
            usage = await get_user_usage(str(user["_id"]))
            usage_info = {"usage": usage}
        except Exception:
            pass

    return UserPublic(
        id=str(user["_id"]),
        name=user["name"],
        email=email,
        created_at=user["created_at"],
        isAdmin=is_admin,
        adminBasePath=admin_base,
        **usage_info,
    )
