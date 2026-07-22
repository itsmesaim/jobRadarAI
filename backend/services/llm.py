"""
LLM abstraction layer.

There are TWO different LLMs in this app:

1. Main LLM     → get_llm()
   Used for: CV parsing (once), generating briefs, roasts, manual jobs.

2. Rating LLM   → get_rating_llm()
   Used ONLY for: bulk job rating (the thing that runs on 600+ jobs).

These two can be completely different providers/models.

You can mix providers freely (see RATING_PROVIDER + RATING_MODEL), e.g. parse
CVs with OpenAI but rate jobs for free on a local Ollama model, or on
EU-based Mistral.

The code respects these common env var names from your .env:
  - GROK_API_KEY / XAI_API_KEY
  - GROK_MODEL / XAI_MODEL
  - MISTRAL_API_KEY / MISTRAL_MODEL
  - DEEPSEEK_API_KEY / DEEPSEEK_MODEL
  - RATING_PROVIDER / RATING_MODEL

Per-user rating provider selection (Settings page) is layered on top of this —
see services/ai_models.py (admin-managed catalog) and get_rating_llm()'s
provider/model params.

Embeddings (for fast pre-filter) always use OpenAI, regardless of LLM_PROVIDER
or RATING_PROVIDER — they're a cheap, working cosine-prefilter step, not
worth switching when the main/rating providers change.
"""

from functools import lru_cache

from langchain_core.language_models import BaseChatModel
from langchain_core.embeddings import Embeddings

from config import settings


def _make_llm(provider: str, model: str, **extra) -> BaseChatModel:
    """Internal factory so we can create different LLMs for different tasks.

    Model names must come from your .env. No hardcoded defaults.
    """
    p = (provider or settings.llm_provider).lower()

    if p == "ollama":
        from langchain_ollama import ChatOllama

        resolved_model = model or settings.ollama_model
        if not resolved_model:
            raise ValueError("No OLLAMA_MODEL set in .env for ollama provider.")
        params = {"temperature": 0.1, **extra}
        return ChatOllama(
            base_url=settings.ollama_base_url,
            model=resolved_model,
            **params,
        )

    if p == "openai":
        from langchain_openai import ChatOpenAI

        resolved_model = model or settings.openai_model
        if not resolved_model:
            raise ValueError("No OPENAI_MODEL set in .env for openai provider.")

        # Allow using GROK_API_KEY when pointing OpenAI client at xAI endpoint
        base_url = extra.pop("base_url", None) or settings.openai_base_url
        api_key = (settings.openai_api_key or "").strip()
        if base_url and "x.ai" in base_url and not api_key:
            api_key = (settings.grok_api_key or "").strip() or (
                settings.xai_api_key or ""
            ).strip()

        params = {
            "api_key": api_key,
            "model": resolved_model,
            "temperature": 0.1,
            **extra,
        }
        if base_url:
            params["base_url"] = base_url
        return ChatOpenAI(**params)

    if p == "xai":
        # Support both XAI_API_KEY and GROK_API_KEY (user's preferred name)
        resolved_key = (
            (settings.grok_api_key or "").strip()
            or (settings.xai_api_key or "").strip()
            or None
        )
        resolved_model = model or settings.grok_model or settings.xai_model
        if not resolved_model:
            raise ValueError("No XAI_MODEL or GROK_MODEL set in .env for xai provider.")

        # Prefer native langchain-xai if installed, otherwise fall back to
        # OpenAI-compatible client pointed at xAI (more reliable, no extra dep needed)
        params = {
            "xai_api_key": resolved_key,
            "model": resolved_model,
            "temperature": 0.0,
            **extra,
        }
        try:
            from langchain_xai import ChatXAI

            return ChatXAI(**params)
        except ImportError:
            from langchain_openai import ChatOpenAI

            # Remap key for OpenAI-compatible client
            openai_params = {k: v for k, v in params.items() if k != "xai_api_key"}
            if "xai_api_key" in params:
                openai_params["api_key"] = params["xai_api_key"]
            openai_params["base_url"] = "https://api.x.ai/v1"
            return ChatOpenAI(**openai_params)

    if p == "mistral":
        from langchain_openai import ChatOpenAI

        resolved_model = model or settings.mistral_model
        if not resolved_model:
            raise ValueError("No MISTRAL_MODEL set in .env for mistral provider.")

        params = {
            "api_key": settings.mistral_api_key,
            "model": resolved_model,
            "base_url": "https://api.mistral.ai/v1",
            "temperature": 0.1,
            **extra,
        }
        return ChatOpenAI(**params)

    if p == "deepseek":
        from langchain_openai import ChatOpenAI

        resolved_model = model or settings.deepseek_model
        if not resolved_model:
            raise ValueError("No DEEPSEEK_MODEL set in .env for deepseek provider.")

        params = {
            "api_key": settings.deepseek_api_key,
            "model": resolved_model,
            "base_url": "https://api.deepseek.com",
            "temperature": 0.1,
            **extra,
        }
        return ChatOpenAI(**params)

    raise ValueError(
        f"Unknown LLM provider: {p!r}. Use 'ollama', 'openai', 'xai', 'mistral', or 'deepseek'."
    )


def structured_output_kwargs(provider: str | None) -> dict:
    """Extra kwargs for `llm.with_structured_output(..., method="function_calling")`.

    DeepSeek's thinking-mode models reject a forced tool_choice ("Thinking
    mode does not support this tool_choice") — only tool_choice="auto" is
    accepted. Every other provider keeps LangChain's default forced
    tool_choice, which is more reliable at actually returning the tool call.
    """
    if (provider or settings.llm_provider).lower() == "deepseek":
        return {"tool_choice": "auto"}
    return {}


@lru_cache(maxsize=32)
def get_llm(provider: str | None = None, model: str | None = None) -> BaseChatModel:
    """
    Main LLM used for CV parsing, briefs, roasts, etc.

    Pass a user's `cv_parsing_provider`/`cv_parsing_model` (see
    services/ai_models.py for the admin-managed catalog) to parse their CV
    with their chosen provider. Called with no args, falls back to the
    app-wide default from LLM_PROVIDER in .env — unchanged behavior for
    users who haven't picked one. Cached per (provider, model) pair since
    the catalog stays small.
    """
    return _make_llm(provider or settings.llm_provider, model or "")


@lru_cache(maxsize=32)
def get_rating_llm(
    provider: str | None = None, model: str | None = None
) -> BaseChatModel:
    """
    LLM used ONLY for rating jobs (the heavy part when you have 600+ jobs).

    Pass a user's `rating_provider`/`rating_model` (see services/ai_models.py
    for the admin-managed catalog they're picked from) to rate with their chosen
    provider. Called with no args, falls back to the app-wide default from
    RATING_PROVIDER/RATING_MODEL in .env — unchanged behavior for users who
    haven't picked a provider. Cached per (provider, model) pair since the
    catalog stays small.
    """
    resolved_provider = provider or settings.rating_provider or settings.llm_provider
    resolved_model = model or settings.rating_model or ""
    # Bulk rating fires many calls back-to-back — bump retries so a
    # transient 429 (tokens-per-minute) backs off and retries instead of
    # failing the job outright. The SDK honors the provider's Retry-After.
    llm = _make_llm(resolved_provider, resolved_model, temperature=0.0, max_retries=5)

    # Helpful visibility so you can see what's actually being used for bulk rating
    # (printed once per distinct provider/model thanks to caching)
    mname = getattr(
        llm, "model", getattr(llm, "model_name", getattr(llm, "model_id", "unknown"))
    )
    print(f"[rating] Using provider={resolved_provider} model={mname}")
    return llm


@lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    """Always OpenAI — see module docstring. Independent of LLM_PROVIDER/RATING_PROVIDER."""
    embed_key = (settings.openai_api_key or "").strip()
    if not embed_key:
        raise ValueError(
            "OPENAI_API_KEY is required for embeddings (cosine pre-filter), "
            "regardless of LLM_PROVIDER/RATING_PROVIDER."
        )

    from langchain_openai import OpenAIEmbeddings

    return OpenAIEmbeddings(
        api_key=embed_key,
        model="text-embedding-3-small",
    )

