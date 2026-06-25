"""
JobRadar AI — application entry point.

Run from inside the backend/ folder:
    uvicorn main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env")

import os
from config import settings

# if settings.langsmith_tracing:
#     os.environ["LANGCHAIN_TRACING_V2"] = "true"
#     os.environ["LANGCHAIN_ENDPOINT"] = settings.langsmith_endpoint
#     os.environ["LANGCHAIN_API_KEY"] = settings.langsmith_api_key
#     os.environ["LANGCHAIN_PROJECT"] = settings.langsmith_project

from core.security import is_weak_jwt_secret
from database import close_mongo_connection, connect_to_mongo, get_database
from routes import auth, cv, crawler, jobs, users, admin
from services.email import gmail_from_mismatch, smtp_configured, smtp_missing_reason
from services.scheduler import start_scheduler, shutdown_scheduler

if not settings.debug and is_weak_jwt_secret(settings.jwt_secret):
    raise RuntimeError(
        "JWT_SECRET is missing, default, or shorter than 48 characters. "
        "Set a strong secret in .env before running with DEBUG=false."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    await connect_to_mongo()
    # enforce one account per email at the DB level
    await get_database().users.create_index("email", unique=True)

    if is_weak_jwt_secret(settings.jwt_secret):
        print(
            "[startup] SECURITY: JWT_SECRET is default, empty, or too short — "
            "set a 48+ character random value in .env before production"
        )
    if settings.debug:
        print(
            "[startup] SECURITY: DEBUG=true — password reset links may print to logs; "
            "set DEBUG=false in production"
        )
    if not admin_secret:
        print(
            "[startup] SECURITY: ADMIN_SECRET_PATH unset — admin API disabled "
            "(set in .env for admin panel)"
        )

    if smtp_configured():
        print(
            f"[startup] SMTP ready (from {settings.smtp_from_name} "
            f"<{settings.smtp_from_email}>)"
        )
        gmail_warn = gmail_from_mismatch()
        if gmail_warn:
            print(f"[startup] SMTP warning: {gmail_warn}")
    else:
        reason = smtp_missing_reason() or "unknown"
        print(
            f"[startup] SMTP not configured ({reason}) — "
            "emails will not send; reset links print when DEBUG=true"
        )

    # Start automatic crawl + rate (every 12 hours)
    start_scheduler()

    yield

    # ── shutdown ──
    shutdown_scheduler()
    await close_mongo_connection()


app = FastAPI(
    title=settings.app_name,
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    openapi_url="/openapi.json" if settings.debug else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── routers ──
app.include_router(auth.router)
app.include_router(cv.router)
app.include_router(crawler.router)
app.include_router(jobs.router)
app.include_router(users.router)

# Admin routes are mounted under a random secret path for obscurity.
# Example: /<ADMIN_SECRET_PATH>/users
# Only the configured admin email can actually use them.
# The secret MUST come from .env — never hardcode or commit real value.
admin_secret = (getattr(settings, "admin_secret_path", "") or "").strip("/")
if admin_secret:
    app.include_router(admin.router, prefix=f"/{admin_secret}")
else:
    print(
        "[startup] WARNING: ADMIN_SECRET_PATH not set in .env — admin routes disabled for security"
    )


@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": settings.app_name}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy"}
