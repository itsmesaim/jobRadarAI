"""
LLM abstraction layer.

There are TWO different LLMs in this app:

1. Main LLM     → get_llm()
   Used for: CV parsing (once), generating briefs, roasts, manual jobs.

2. Rating LLM   → get_rating_llm()
   Used ONLY for: bulk job rating (the thing that runs on 600+ jobs).

These two can be completely different providers/models.

You can mix OpenAI + Grok freely (see RATING_PROVIDER + RATING_MODEL).

The code respects these common env var names from your .env:
  - GROK_API_KEY / XAI_API_KEY
  - GROK_MODEL / XAI_MODEL
  - RATING_PROVIDER / RATING_MODEL

Embeddings (for fast pre-filter) usually use OpenAI embeddings even if your LLM is Grok.
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

    raise ValueError(f"Unknown LLM provider: {p!r}. Use 'ollama', 'openai', or 'xai'.")


@lru_cache(maxsize=1)
def get_llm() -> BaseChatModel:
    """Main LLM used for CV parsing, briefs, roasts, etc."""
    return _make_llm(settings.llm_provider, "")


@lru_cache(maxsize=1)
def get_rating_llm() -> BaseChatModel:
    """
    LLM used ONLY for rating jobs (the heavy part when you have 600+ jobs).

    This can be a COMPLETELY DIFFERENT provider and model than the main LLM.
    Controlled by RATING_PROVIDER and RATING_MODEL in .env.
    """
    provider = settings.rating_provider or settings.llm_provider
    model = settings.rating_model or ""
    # Bulk rating fires many calls back-to-back — bump retries so a
    # transient 429 (tokens-per-minute) backs off and retries instead of
    # failing the job outright. The SDK honors the provider's Retry-After.
    llm = _make_llm(provider, model, temperature=0.0, max_retries=5)

    # Helpful visibility so you can see what's actually being used for bulk rating
    # (printed once thanks to caching)
    mname = getattr(
        llm, "model", getattr(llm, "model_name", getattr(llm, "model_id", "unknown"))
    )
    print(f"[rating] Using provider={provider} model={mname}")
    print(
        f"[rating] (from .env: RATING_PROVIDER={settings.rating_provider} RATING_MODEL={settings.rating_model})"
    )
    return llm


@lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    provider = settings.llm_provider.lower()

    if provider == "ollama":
        from langchain_ollama import OllamaEmbeddings

        return OllamaEmbeddings(
            base_url=settings.ollama_base_url,
            model="nomic-embed-text",
        )

    # For xai we don't have good native embeddings yet.
    # Prefer OpenAI embeddings (very cheap + fast for pre-filter) if key is present.
    if provider in ("openai", "xai"):
        embed_key = (
            settings.openai_api_key
            or settings.grok_api_key
            or settings.xai_api_key
            or ""
        ).strip()
        if embed_key:
            from langchain_openai import OpenAIEmbeddings

            return OpenAIEmbeddings(
                api_key=embed_key,
                model="text-embedding-3-small",
            )
        # fallback if no key but using xai provider
        if provider == "xai":
            raise ValueError(
                "xAI provider selected but no key found for embeddings. "
                "Set OPENAI_API_KEY (recommended for text-embedding-3-small) or GROK_API_KEY / XAI_API_KEY."
            )

    if provider == "openai":
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model="text-embedding-3-small",
        )

    raise ValueError(f"Unknown LLM_PROVIDER for embeddings: {provider!r}.")
