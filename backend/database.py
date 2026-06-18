"""
Async MongoDB connection using Motor.
Connect on startup, close on shutdown (wired up in main.py lifespan).
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import settings


class _DB:
    client: AsyncIOMotorClient | None = None


_db = _DB()


async def connect_to_mongo() -> None:
    _db.client = AsyncIOMotorClient(settings.mongo_uri)
    # Fail fast if Mongo is unreachable
    await _db.client.admin.command("ping")
    print(f"✓ Connected to MongoDB → db: {settings.mongo_db}")


async def close_mongo_connection() -> None:
    if _db.client:
        _db.client.close()
        print("✓ MongoDB connection closed")


def get_database() -> AsyncIOMotorDatabase:
    if _db.client is None:
        raise RuntimeError("MongoDB client not initialised. Did startup run?")
    return _db.client[settings.mongo_db]
