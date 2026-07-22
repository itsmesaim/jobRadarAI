"""
Admin-managed AI model catalog — covers both jobs the app lets a user pick a
model for: "rating" (bulk job rating + apply packs) and "cv_parsing" (CV
upload → structured JSON). One doc per (provider, model, purpose); the same
provider/model can appear under both purposes as two separate rows if it's
offered for both.

Admin adds/edits/disables models from the Admin panel — no code change or
deploy needed — and Settings' pickers list whatever's active for that
purpose. Users can freely switch between any active entry for a purpose,
including off an admin-granted custom model, since picking any catalog entry
overwrites the model field too (self-service revert, no special case).
"""

from datetime import datetime, timezone

from bson import ObjectId

from config import settings
from database import get_database

Purpose = str  # "rating" | "cv_parsing"

# Seeded once on first startup — the models already in production, kept
# as-is (they work fine, budget-friendly); admin adds more from here on.
_DEFAULT_MODELS: dict[Purpose, list[dict]] = {
    "rating": [
        {
            "provider": "mistral",
            "model": settings.rating_model or settings.mistral_model,
            "label": "Mistral (default, GDPR-aware)",
            "cost_multiplier": 1.0,
            "is_default": True,
        },
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "label": "OpenAI",
            "cost_multiplier": 1.0,
        },
        {
            "provider": "deepseek",
            "model": settings.deepseek_model,
            "label": "DeepSeek",
            "cost_multiplier": 1.0,
        },
    ],
    "cv_parsing": [
        {
            "provider": settings.llm_provider,
            "model": (
                settings.mistral_model
                if settings.llm_provider == "mistral"
                else settings.openai_model
            ),
            "label": (
                "Mistral (default, GDPR-aware)"
                if settings.llm_provider == "mistral"
                else "OpenAI"
            ),
            "cost_multiplier": 1.0,
            "is_default": True,
        },
    ],
}


async def seed_default_rating_models(db) -> None:
    # Migration: docs created before `purpose` existed default to "rating"
    # (the only purpose the catalog originally covered) — run this before the
    # per-purpose emptiness check below so it doesn't see stale un-tagged docs.
    await db.rating_models.update_many(
        {"purpose": {"$exists": False}}, {"$set": {"purpose": "rating"}}
    )

    # Seed per purpose, not just "collection is totally empty" — an existing
    # install already has `rating` entries, but cv_parsing was added later
    # and needs its own defaults seeded once.
    now = datetime.now(timezone.utc)
    for purpose, models in _DEFAULT_MODELS.items():
        if await db.rating_models.count_documents({"purpose": purpose}) > 0:
            continue
        docs = [
            {
                "is_default": False,
                **m,
                "purpose": purpose,
                "active": True,
                "created_at": now,
            }
            for m in models
            if m["model"]
        ]
        if docs:
            await db.rating_models.insert_many(docs)
            print(f"[startup] Seeded {len(docs)} default {purpose} model(s)")

    # Backfill: a purpose with no entry flagged default (e.g. catalogs from
    # before is_default existed, or the newly-added cv_parsing purpose on an
    # existing install) needs one, so "App default" always resolves to
    # something real.
    for purpose in ("rating", "cv_parsing"):
        if (
            await db.rating_models.count_documents(
                {"purpose": purpose, "is_default": True}
            )
            == 0
        ):
            fallback = await db.rating_models.find_one(
                {"purpose": purpose, "provider": "mistral", "active": True}
            ) or await db.rating_models.find_one({"purpose": purpose, "active": True})
            if fallback:
                await db.rating_models.update_one(
                    {"_id": fallback["_id"]}, {"$set": {"is_default": True}}
                )
                print(
                    f"[startup] Backfilled is_default onto {fallback['provider']}/"
                    f"{fallback['model']} for purpose={purpose}"
                )


def _serialize(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "provider": doc["provider"],
        "model": doc["model"],
        "label": doc.get("label") or doc["model"],
        "purpose": doc.get("purpose", "rating"),
        "cost_multiplier": float(doc.get("cost_multiplier", 1.0) or 1.0),
        "active": bool(doc.get("active", True)),
        "is_default": bool(doc.get("is_default", False)),
    }


async def list_models(purpose: Purpose, active_only: bool = False) -> list[dict]:
    db = get_database()
    query: dict = {"purpose": purpose}
    if active_only:
        query["active"] = True
    docs = (
        await db.rating_models.find(query)
        .sort([("provider", 1), ("label", 1)])
        .to_list(length=200)
    )
    return [_serialize(d) for d in docs]


async def get_default_model(purpose: Purpose) -> dict | None:
    """The model "App default" resolves to for this purpose — admin-settable,
    one entry per purpose (see update_model's is_default handling)."""
    db = get_database()
    doc = await db.rating_models.find_one(
        {"purpose": purpose, "is_default": True, "active": True}
    )
    return _serialize(doc) if doc else None


async def get_model(provider: str, model: str, purpose: Purpose) -> dict | None:
    db = get_database()
    doc = await db.rating_models.find_one(
        {"provider": provider, "model": model, "purpose": purpose}
    )
    return _serialize(doc) if doc else None


async def get_default_model_for_provider(provider: str, purpose: Purpose) -> str | None:
    """Fallback for legacy user docs that only ever stored a provider,
    from before Settings let users pick a specific model."""
    db = get_database()
    doc = await db.rating_models.find_one(
        {"provider": provider, "purpose": purpose, "active": True}
    )
    return doc["model"] if doc else None


async def get_cost_multiplier(
    provider: str | None, model: str | None, purpose: Purpose
) -> float:
    """1.0 (no weighting) if provider/model is unset or not in the catalog
    (e.g. app-wide default, or an admin-granted one-off outside the catalog)."""
    if not provider or not model:
        return 1.0
    entry = await get_model(provider, model, purpose)
    return entry["cost_multiplier"] if entry else 1.0


async def create_model(
    provider: str,
    model: str,
    label: str,
    purpose: Purpose,
    cost_multiplier: float = 1.0,
) -> dict:
    db = get_database()
    doc = {
        "provider": provider,
        "model": model,
        "label": label or model,
        "purpose": purpose,
        "cost_multiplier": cost_multiplier,
        "active": True,
        "is_default": False,
        "created_at": datetime.now(timezone.utc),
    }
    result = await db.rating_models.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _serialize(doc)


async def update_model(catalog_id: str, **fields) -> dict | None:
    db = get_database()
    updates = {k: v for k, v in fields.items() if v is not None}
    if updates:
        if updates.get("is_default"):
            existing = await db.rating_models.find_one({"_id": ObjectId(catalog_id)})
            if existing:
                # Only one catalog entry per purpose is ever "the" default.
                await db.rating_models.update_many(
                    {
                        "_id": {"$ne": ObjectId(catalog_id)},
                        "purpose": existing["purpose"],
                    },
                    {"$set": {"is_default": False}},
                )
        await db.rating_models.update_one(
            {"_id": ObjectId(catalog_id)}, {"$set": updates}
        )
    doc = await db.rating_models.find_one({"_id": ObjectId(catalog_id)})
    return _serialize(doc) if doc else None


async def delete_model(catalog_id: str) -> bool:
    db = get_database()
    result = await db.rating_models.delete_one({"_id": ObjectId(catalog_id)})
    return result.deleted_count > 0
