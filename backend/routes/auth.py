"""
Auth routes: /auth/register, /auth/login, /auth/me

register & login both return a JWT so the frontend can store it and
immediately start making authenticated calls.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from core.security import create_access_token, hash_password, verify_password
from database import get_database
from deps import get_current_user
from models.user import Token, UserLogin, UserPublic, UserRegister
from config import settings
from services.limits import get_user_usage

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(payload: UserRegister):
    db = get_database()

    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered. If you want to reset password on the existing account, use the reset_admin_password.py script.",
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


@router.get("/me", response_model=UserPublic)
async def me(user=Depends(get_current_user)):
    email = user.get("email", "")
    is_admin = email == settings.admin_email and bool(settings.admin_email)
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
