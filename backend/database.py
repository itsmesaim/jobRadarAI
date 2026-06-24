"""
Async MongoDB connection using Motor.
Connect on startup, close on shutdown.
"""

from urllib.parse import quote_plus

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import settings


class _DB:
    client: AsyncIOMotorClient | None = None


_db = _DB()


def _build_mongo_uri() -> str:
    """Authenticated local/VPS Mongo when MONGO_USER is set; else MONGO_URI."""
    if settings.mongo_user:
        username = quote_plus(settings.mongo_user)
        password = quote_plus(settings.mongo_password)
        host = settings.mongo_host or "localhost"
        return (
            f"mongodb://{username}:{password}@"
            f"{host}:27017/"
            f"{settings.mongo_db}?authSource=admin"
        )
    return settings.mongo_uri


async def connect_to_mongo() -> None:
    mongo_uri = _build_mongo_uri()
    _db.client = AsyncIOMotorClient(mongo_uri)
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
