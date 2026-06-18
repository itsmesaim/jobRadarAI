"""
JobRadar AI — application entry point.

Run from inside the backend/ folder:
    uvicorn main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import close_mongo_connection, connect_to_mongo, get_database
from routes import auth


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    await connect_to_mongo()
    # enforce one account per email at the DB level
    await get_database().users.create_index("email", unique=True)
    yield
    # ── shutdown ──
    await close_mongo_connection()


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── routers ──
app.include_router(auth.router)


@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": settings.app_name}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy"}
