"""
JobRadar AI — application entry point.

Run from inside the backend/ folder:
    uvicorn main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from dotenv import load_dotenv
load_dotenv()

import os
from config import settings
# if settings.langsmith_tracing:
#     os.environ["LANGCHAIN_TRACING_V2"] = "true"
#     os.environ["LANGCHAIN_ENDPOINT"] = settings.langsmith_endpoint
#     os.environ["LANGCHAIN_API_KEY"] = settings.langsmith_api_key
#     os.environ["LANGCHAIN_PROJECT"] = settings.langsmith_project

from database import close_mongo_connection, connect_to_mongo, get_database
from routes import auth, cv , crawler , jobs , users


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
app.include_router(cv.router)
app.include_router(crawler.router)
app.include_router(jobs.router)
app.include_router(users.router)


@app.get("/", tags=["health"])
async def root():
    return {"status": "ok", "service": settings.app_name}


@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy"}
