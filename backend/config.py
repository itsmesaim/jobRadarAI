"""
Central configuration. Everything reads from environment variables
(loaded from .env). This is also where the LLM provider switch lives
for later phases — change LLM_PROVIDER and nothing else breaks.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    #  App
    app_name: str = "JobRadar AI"
    debug: bool = True

    #  MongoDB
    # Option A (dev): MONGO_URI=mongodb://localhost:27017
    # Option B (VPS with auth): set MONGO_USER, MONGO_PASSWORD, MONGO_HOST — URI is built automatically
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "jobradar"
    mongo_host: str = "localhost"
    mongo_user: str = ""
    mongo_password: str = ""

    # JWT Auth
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    #  CORS (frontend origins)
    cors_origins: list[str] = [
        "http://localhost:5173",  # Vite dev
        # "http://localhost:3000",  # CRA / Next dev
        "https://jobradar.saimjs.com",
    ]

    #  LLM
    # Swap provider here only. LangChain abstraction handles the rest.
    # Supported: "ollama" | "openai" | "xai"
    #
    # Set the actual models in your .env file:
    #   - OLLAMA_MODEL
    #   - OPENAI_MODEL
    #   - XAI_MODEL or GROK_MODEL
    #   - RATING_MODEL + RATING_PROVIDER (for using different model/provider only for bulk rating)
    llm_provider: str = "ollama"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = ""

    openai_api_key: str = ""
    openai_model: str = ""
    openai_base_url: str = (
        ""  # Optional: set to "https://api.x.ai/v1" to use Grok via OpenAI-compatible
    )

    # xAI / Grok support - accepts common names from .env
    xai_api_key: str = Field(default="", validation_alias="XAI_API_KEY")
    grok_api_key: str = Field(default="", validation_alias="GROK_API_KEY")
    xai_model: str = Field(default="", validation_alias="XAI_MODEL")
    grok_model: str = Field(default="", validation_alias="GROK_MODEL")

    # Optional separate model just for job rating (bulk / rate-all).
    # Lets you mix providers, e.g. parse CV with OpenAI, rate jobs with fast Grok.
    # Control everything via .env (RATING_MODEL, RATING_PROVIDER, etc.)
    rating_model: str = ""
    rating_provider: str = (
        ""  # "xai" | "openai" | "ollama" (empty = use main llm_provider)
    )

    # External
    tavily_api_key: str = ""
    pinecone_api_key: str = ""

    langsmith_tracing: bool = False
    langsmith_endpoint: str = ""
    langsmith_api_key: str = ""
    langsmith_project: str = "My first app"

    #  Adzuna
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""

    jooble_api_key: str = ""
    jobsapi_key: str = ""

    # Auto scheduler (search + rate every N hours in background)
    auto_crawl_interval_hours: int = 12

    # Admin / Freemium
    # IMPORTANT: Put real values in .env only. These defaults are safe for git.
    # Do NOT commit your real admin email or secret path.
    admin_email: str = ""
    admin_secret_path: str = (
        ""  # e.g. "k9x7p2mQvL4r" — random string used as URL prefix for admin routes
    )

    # Free tier defaults (per day, reset daily)
    free_search_limit: int = 3
    free_rating_limit: int = 10  # number of jobs that can be rated per period


settings = Settings()
