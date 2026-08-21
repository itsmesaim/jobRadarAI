"""
Admin-managed AI model catalog - one picker per job: "rating" (bulk job
scores), "apply_pack" (tailored CV + cover letter), "cv_parsing" (upload →
structured JSON). One doc per (provider, model, purpose); the same
provider/model can appear under more than one purpose as separate rows.

Admin adds/edits/disables models from the Admin panel - no code change or
deploy needed - and Settings' pickers list whatever's active for that
purpose. Users can freely switch between any active entry for a purpose,
including off an admin-granted custom model, since picking any catalog entry
overwrites the model field too (self-service revert, no special case).
"""

from datetime import datetime, timezone

from bson import ObjectId

from services.llm import normalize_provider
from database import get_database

Purpose = str  # "rating" | "apply_pack" | "cv_parsing"
PURPOSES: tuple[Purpose, ...] = ("rating", "apply_pack", "cv_parsing")
PURPOSE_USER_FIELDS = {
    "rating": ("rating_provider", "rating_model", "rating_model_request"),
    "apply_pack": (
        "apply_pack_provider",
        "apply_pack_model",
        "apply_pack_model_request",
    ),
    "cv_parsing": (
        "cv_parsing_provider",
        "cv_parsing_model",
        "cv_parsing_model_request",
    ),
}


async def seed_default_rating_models(db) -> None:
    """No model names are inserted here. Admin adds every catalog row.
    Only tags old docs that predate `purpose` / `is_default`."""
    await db.rating_models.update_many(
        {"purpose": {"$exists": False}}, {"$set": {"purpose": "rating"}}
    )
    for purpose in PURPOSES:
        if (
            await db.rating_models.count_documents(
                {"purpose": purpose, "is_default": True}
            )
            == 0
        ):
            fallback = await db.rating_models.find_one(
                {"purpose": purpose, "active": True}
            )
            if fallback:
                await db.rating_models.update_one(
                    {"_id": fallback["_id"]}, {"$set": {"is_default": True}}
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
    if active_only:
        from services.llm import provider_api_key

        docs = [
            d for d in docs if provider_api_key(normalize_provider(d.get("provider")))
        ]
    return [_serialize(d) for d in docs]


async def get_default_model(purpose: Purpose) -> dict | None:
    """The model "App default" resolves to for this purpose - admin-settable,
    one entry per purpose (see update_model's is_default handling)."""
    db = get_database()
    doc = await db.rating_models.find_one(
        {"purpose": purpose, "is_default": True, "active": True}
    )
    return _serialize(doc) if doc else None


async def get_model(provider: str, model: str, purpose: Purpose) -> dict | None:
    db = get_database()
    p = normalize_provider(provider)
    doc = await db.rating_models.find_one(
        {"provider": p, "model": model, "purpose": purpose}
    ) or await db.rating_models.find_one(
        {"provider": provider, "model": model, "purpose": purpose}
    )
    return _serialize(doc) if doc else None


async def get_default_model_for_provider(provider: str, purpose: Purpose) -> str | None:
    """Fallback for legacy user docs that only ever stored a provider,
    from before Settings let users pick a specific model."""
    db = get_database()
    p = normalize_provider(provider) or provider
    doc = await db.rating_models.find_one(
        {"provider": p, "purpose": purpose, "active": True}
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
        "provider": normalize_provider(provider) or provider,
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
