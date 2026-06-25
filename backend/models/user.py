"""
User schemas (Pydantic v2).

Note: we keep request models (what the client sends) separate from
response models (what we send back). Password hashes never appear in
any response model — they simply aren't a field on UserPublic.
"""

from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    id: str
    name: str
    email: EmailStr
    created_at: datetime
    isAdmin: bool = False
    adminBasePath: str | None = None  # only sent to admins
    usage: dict | None = None  # full usage for admin self-view

    class Config:
        extra = "allow"  # allow additional fields from backend


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10)
    new_password: str = Field(..., min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


class MessageResponse(BaseModel):
    message: str
