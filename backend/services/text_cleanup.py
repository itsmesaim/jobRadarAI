"""
Tidies user-written free text (about_me, rating feedback) before it's stored,
so downstream LLM calls (rating, calibration) get clean prose instead of
typos/fragments. Falls back to the raw text on any LLM failure — a save must
never fail because cleanup did.
"""

from langchain_core.messages import HumanMessage, SystemMessage

from config import settings
from services.ai_usage import record_from_llm_response
from services.llm import get_llm

SYSTEM_PROMPT = """
Rewrite the user's text into clear, well-formed sentences for the given purpose.

Rules:
- Preserve all factual content and intent — never invent or add anything.
- Fix grammar, spelling, and awkward phrasing only.
- Return ONLY the rewritten text, no preamble, no quotes, no markdown.
""".strip()


async def clean_candidate_text(
    raw: str, purpose: str, user_id: str | None = None
) -> str:
    raw = raw.strip()
    if not raw:
        return raw

    llm = get_llm()
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"Purpose: {purpose}\n\nText:\n{raw}"),
    ]
    try:
        response = await llm.ainvoke(messages)
    except Exception:
        return raw

    if user_id:
        model = getattr(llm, "model", getattr(llm, "model_name", settings.openai_model))
        await record_from_llm_response(
            user_id,
            response,
            operation="text_cleanup",
            provider=settings.llm_provider,
            model=str(model or "unknown"),
        )

    cleaned = (response.content or "").strip()
    return cleaned or raw
