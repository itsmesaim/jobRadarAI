"""
LLM abstraction layer.

Single function get_llm() returns the configured LLM.
Swap provider by changing LLM_PROVIDER in .env — nothing else changes.

Same pattern for embeddings via get_embeddings().
"""

from functools import lru_cache

from langchain_core.language_models import BaseChatModel
from langchain_core.embeddings import Embeddings

from config import settings


@lru_cache(maxsize=1)
def get_llm() -> BaseChatModel:
    provider = settings.llm_provider.lower()

    if provider == "ollama":
        from langchain_ollama import ChatOllama

        return ChatOllama(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            temperature=0.1,  # low temp = consistent structured output
        )

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            temperature=0.1,
        )

    raise ValueError(f"Unknown LLM_PROVIDER: {provider!r}. Use 'ollama' or 'openai'.")


@lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    provider = settings.llm_provider.lower()

    if provider == "ollama":
        from langchain_ollama import OllamaEmbeddings

        return OllamaEmbeddings(
            base_url=settings.ollama_base_url,
            model="nomic-embed-text",
        )

    if provider == "openai":
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model="text-embedding-3-small",
        )

    raise ValueError(f"Unknown LLM_PROVIDER: {provider!r}.")
