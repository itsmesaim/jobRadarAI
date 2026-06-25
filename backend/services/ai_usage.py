"""
Track AI token usage and estimated cost per user.

Token counts come from LLM response_metadata when available.
Embedding usage is estimated from character count when the API
does not return token usage.

Set AI_MONTHLY_BUDGET_USD in .env to show remaining budget in admin.
"""

from datetime import datetime, timezone

from bson import ObjectId

from config import settings
from database import get_database


def _current_month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _cost_rates_configured() -> bool:
    return any(
        rate > 0
        for rate in (
            settings.ai_cost_per_1k_prompt_tokens,
            settings.ai_cost_per_1k_completion_tokens,
            settings.ai_cost_per_1k_embedding_tokens,
        )
    )


def _estimate_cost_usd(
    prompt_tokens: int, completion_tokens: int, embedding_tokens: int = 0
) -> float:
    if not _cost_rates_configured():
        return 0.0
    prompt_cost = (prompt_tokens / 1000) * settings.ai_cost_per_1k_prompt_tokens
    completion_cost = (
        completion_tokens / 1000
    ) * settings.ai_cost_per_1k_completion_tokens
    embed_cost = (embedding_tokens / 1000) * settings.ai_cost_per_1k_embedding_tokens
    return round(prompt_cost + completion_cost + embed_cost, 6)


def parse_token_usage(message) -> dict:
    """Extract token usage from a LangChain AIMessage (or raw dict)."""
    meta = {}
    if hasattr(message, "response_metadata"):
        meta = message.response_metadata or {}
    elif isinstance(message, dict):
        meta = message.get("response_metadata") or message

    usage = (
        meta.get("token_usage")
        or meta.get("usage")
        or (meta.get("llm_output") or {}).get("token_usage")
        or {}
    )

    prompt = int(
        usage.get("prompt_tokens")
        or usage.get("input_tokens")
        or usage.get("prompt_token_count")
        or 0
    )
    completion = int(
        usage.get("completion_tokens")
        or usage.get("output_tokens")
        or usage.get("candidates_token_count")
        or usage.get("completion_token_count")
        or 0
    )
    total = int(usage.get("total_tokens") or usage.get("total_token_count") or 0)
    if total == 0:
        total = prompt + completion

    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


async def record_ai_usage(
    user_id: str,
    *,
    operation: str,
    provider: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    embedding_tokens: int = 0,
    llm_calls: int = 1,
    embedding_calls: int = 0,
) -> None:
    if not user_id:
        return

    total_tokens = prompt_tokens + completion_tokens + embedding_tokens
    cost = _estimate_cost_usd(prompt_tokens, completion_tokens, embedding_tokens)
    month = _current_month_key()

    inc: dict = {
        "usage.ai.prompt_tokens": prompt_tokens,
        "usage.ai.completion_tokens": completion_tokens,
        "usage.ai.total_tokens": total_tokens,
        "usage.ai.embedding_tokens": embedding_tokens,
        "usage.ai.llm_calls": llm_calls,
        "usage.ai.embedding_calls": embedding_calls,
        "usage.ai.estimated_cost_usd": cost,
        f"usage.ai.by_operation.{operation}.calls": llm_calls + embedding_calls,
        f"usage.ai.by_operation.{operation}.tokens": total_tokens,
        f"usage.ai.by_operation.{operation}.cost_usd": cost,
        "usage.ai_daily.prompt_tokens": prompt_tokens,
        "usage.ai_daily.completion_tokens": completion_tokens,
        "usage.ai_daily.total_tokens": total_tokens,
        "usage.ai_daily.embedding_tokens": embedding_tokens,
        "usage.ai_daily.llm_calls": llm_calls,
        "usage.ai_daily.embedding_calls": embedding_calls,
        "usage.ai_daily.estimated_cost_usd": cost,
    }

    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(user_id)}, {"usage.ai_month": 1})
    ai_month = (user or {}).get("usage", {}).get("ai_month", {})
    if ai_month.get("month") != month:
        await db.users.update_one(
            {"_id": ObjectId(user_id)},
            {
                "$set": {
                    "usage.ai_month": {
                        "month": month,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                        "embedding_tokens": 0,
                        "llm_calls": 0,
                        "embedding_calls": 0,
                        "estimated_cost_usd": 0.0,
                    }
                }
            },
        )

    month_inc = {
        "usage.ai_month.prompt_tokens": prompt_tokens,
        "usage.ai_month.completion_tokens": completion_tokens,
        "usage.ai_month.total_tokens": total_tokens,
        "usage.ai_month.embedding_tokens": embedding_tokens,
        "usage.ai_month.llm_calls": llm_calls,
        "usage.ai_month.embedding_calls": embedding_calls,
        "usage.ai_month.estimated_cost_usd": cost,
    }

    await db.users.update_one(
        {"_id": ObjectId(user_id)},
        {
            "$inc": {**inc, **month_inc},
            "$set": {
                "usage.ai.last_updated": datetime.now(timezone.utc),
                "usage.ai.provider_last": provider,
                "usage.ai.model_last": model,
                "usage.ai_month.month": month,
            },
        },
    )


async def record_from_llm_response(
    user_id: str,
    message,
    *,
    operation: str,
    provider: str = "",
    model: str = "",
) -> None:
    if not user_id or message is None:
        return
    usage = parse_token_usage(message)
    if usage["total_tokens"] == 0 and usage["prompt_tokens"] == 0:
        # Ollama / some providers omit usage — count the call anyway
        usage["total_tokens"] = 0

    await record_ai_usage(
        user_id,
        operation=operation,
        provider=provider or settings.rating_provider or settings.llm_provider,
        model=model or settings.rating_model or settings.openai_model or "unknown",
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        llm_calls=1,
    )


async def record_embedding_usage(
    user_id: str,
    *,
    num_documents: int = 1,
    total_chars: int = 0,
    operation: str = "embedding",
) -> None:
    if not user_id:
        return
    estimated_tokens = max((total_chars // 4) * num_documents, 50 * num_documents)
    await record_ai_usage(
        user_id,
        operation=operation,
        provider=settings.llm_provider,
        model="text-embedding-3-small",
        embedding_tokens=estimated_tokens,
        embedding_calls=num_documents,
        llm_calls=0,
    )


def format_ai_usage(user: dict) -> dict:
    """Shape AI usage for API responses."""
    cost_enabled = _cost_rates_configured()
    ai = user.get("usage", {}).get("ai", {})
    ai_daily = user.get("usage", {}).get("ai_daily", {})
    ai_month = user.get("usage", {}).get("ai_month", {})
    by_op = ai.get("by_operation", {})

    return {
        "cost_estimation_enabled": cost_enabled,
        "lifetime": {
            "prompt_tokens": ai.get("prompt_tokens", 0),
            "completion_tokens": ai.get("completion_tokens", 0),
            "total_tokens": ai.get("total_tokens", 0),
            "embedding_tokens": ai.get("embedding_tokens", 0),
            "llm_calls": ai.get("llm_calls", 0),
            "embedding_calls": ai.get("embedding_calls", 0),
            "estimated_cost_usd": round(ai.get("estimated_cost_usd", 0.0), 4),
            "by_operation": by_op,
            "provider_last": ai.get("provider_last"),
            "model_last": ai.get("model_last"),
        },
        "today": {
            "total_tokens": ai_daily.get("total_tokens", 0),
            "llm_calls": ai_daily.get("llm_calls", 0),
            "embedding_calls": ai_daily.get("embedding_calls", 0),
            "estimated_cost_usd": round(ai_daily.get("estimated_cost_usd", 0.0), 4),
        },
        "this_month": {
            "month": ai_month.get("month", _current_month_key()),
            "total_tokens": ai_month.get("total_tokens", 0),
            "llm_calls": ai_month.get("llm_calls", 0),
            "estimated_cost_usd": round(ai_month.get("estimated_cost_usd", 0.0), 4),
        },
    }


async def get_platform_ai_summary() -> dict:
    """Aggregate AI usage across all users for admin dashboard."""
    db = get_database()
    month = _current_month_key()
    pipeline = [
        {
            "$group": {
                "_id": None,
                "total_tokens": {"$sum": {"$ifNull": ["$usage.ai.total_tokens", 0]}},
                "llm_calls": {"$sum": {"$ifNull": ["$usage.ai.llm_calls", 0]}},
                "embedding_calls": {
                    "$sum": {"$ifNull": ["$usage.ai.embedding_calls", 0]}
                },
                "lifetime_cost_usd": {
                    "$sum": {"$ifNull": ["$usage.ai.estimated_cost_usd", 0]}
                },
                "month_cost_usd": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$usage.ai_month.month", month]},
                            {"$ifNull": ["$usage.ai_month.estimated_cost_usd", 0]},
                            0,
                        ]
                    }
                },
                "month_tokens": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$usage.ai_month.month", month]},
                            {"$ifNull": ["$usage.ai_month.total_tokens", 0]},
                            0,
                        ]
                    }
                },
                "today_tokens": {
                    "$sum": {"$ifNull": ["$usage.ai_daily.total_tokens", 0]}
                },
                "today_cost_usd": {
                    "$sum": {"$ifNull": ["$usage.ai_daily.estimated_cost_usd", 0]}
                },
            }
        }
    ]

    agg = await db.users.aggregate(pipeline).to_list(length=1)
    totals = agg[0] if agg else {}

    budget = settings.ai_monthly_budget_usd
    month_spent = round(totals.get("month_cost_usd", 0) or 0, 4)
    budget_remaining = None
    if budget and budget > 0:
        budget_remaining = round(max(0, budget - month_spent), 4)

    return {
        "providers": {
            "main_llm": settings.llm_provider,
            "rating_llm": settings.rating_provider or settings.llm_provider,
            "rating_model": settings.rating_model or settings.openai_model or "—",
        },
        "cost_rates_per_1k": {
            "prompt": settings.ai_cost_per_1k_prompt_tokens,
            "completion": settings.ai_cost_per_1k_completion_tokens,
            "embedding": settings.ai_cost_per_1k_embedding_tokens,
        },
        "monthly_budget_usd": budget if budget > 0 else None,
        "monthly_spent_usd": month_spent,
        "monthly_remaining_usd": budget_remaining,
        "today": {
            "total_tokens": totals.get("today_tokens", 0),
            "estimated_cost_usd": round(totals.get("today_cost_usd", 0) or 0, 4),
        },
        "this_month": {
            "month": month,
            "total_tokens": totals.get("month_tokens", 0),
            "estimated_cost_usd": month_spent,
        },
        "lifetime": {
            "total_tokens": totals.get("total_tokens", 0),
            "llm_calls": totals.get("llm_calls", 0),
            "embedding_calls": totals.get("embedding_calls", 0),
            "estimated_cost_usd": round(totals.get("lifetime_cost_usd", 0) or 0, 4),
        },
        "cost_estimation_enabled": _cost_rates_configured(),
        "note": (
            "Token counts are tracked automatically. "
            + (
                "Cost estimates use your AI_COST_PER_1K_* rates from .env. "
                if _cost_rates_configured()
                else "Set AI_COST_PER_1K_* in .env to enable cost estimates. "
            )
            + "Ollama is free (local). Provider balance is not fetched — "
            "set AI_MONTHLY_BUDGET_USD to track remaining budget manually."
        ),
    }
