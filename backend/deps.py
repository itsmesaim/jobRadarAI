"""
Auth dependency. Any route that needs a logged-in user does:

    async def route(user = Depends(get_current_user)):
        ...

It reads the Bearer token, decodes it, loads the user from Mongo,
and hands you the full user document.
"""

from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from core.security import decode_access_token
from database import get_database

bearer_scheme = HTTPBearer(auto_error=True)

# Only write last_active_at at most this often — every route depends on
# get_current_user, so unthrottled writes would hit Mongo on every request.
_ACTIVITY_UPDATE_INTERVAL = timedelta(hours=1)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    decoded = decode_access_token(creds.credentials)
    if not decoded:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id, token_version = decoded

    try:
        oid = ObjectId(user_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed token"
        )

    user = await get_database().users.find_one({"_id": oid})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )

    current_version = int(user.get("token_version", 1) or 1)
    if token_version != current_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        )

    if user.get("suspended"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been paused by an admin.",
        )

    now = datetime.now(timezone.utc)
    last_active = user.get("last_active_at")
    if isinstance(last_active, datetime) and last_active.tzinfo is None:
        last_active = last_active.replace(tzinfo=timezone.utc)
    if not last_active or now - last_active > _ACTIVITY_UPDATE_INTERVAL:
        await get_database().users.update_one(
            {"_id": oid}, {"$set": {"last_active_at": now}}
        )
        user["last_active_at"] = now

    return user
