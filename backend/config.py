"""
Central configuration. Everything reads from environment variables
(loaded from .env). This is also where the LLM provider switch lives
for later phases — change LLM_PROVIDER and nothing else breaks.
"""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

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
    password_reset_expire_minutes: int = 60  # reset link validity
    frontend_url: str = "http://localhost:5173"

    # Optional SMTP — required to email reset links in production
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_from_name: str = "JobRadar"
    smtp_reply_to: str = ""  # optional; e.g. support@saimjs.com
    smtp_use_tls: bool = True

    #  CORS (frontend origins)
    cors_origins: list[str] = [
        "http://localhost:5173",  # Vite dev
        "http://127.0.0.1:5173",  # Vite dev (opened via 127.0.0.1 instead of localhost)
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

    # Mistral — OpenAI-API-compatible endpoint, no extra dependency needed
    # (see services/llm.py). EU-based (GDPR-friendly), free tier available.
    mistral_api_key: str = ""
    mistral_model: str = ""

    # Optional separate model just for job rating (bulk / rate-all).
    # Lets you mix providers, e.g. parse CV with OpenAI, rate jobs with fast Grok.
    # Control everything via .env (RATING_MODEL, RATING_PROVIDER, etc.)
    rating_model: str = ""
    rating_provider: str = (
        ""  # "xai" | "openai" | "ollama" | "mistral" (empty = use main llm_provider)
    )
    # Max concurrent LLM calls during bulk rating. Every call now uses the
    # full-length prompt (see rating.py), so this directly controls tokens/min
    # sent to your rating provider — lower it if you hit 429 TPM rate limits
    # on a low-tier model/org (e.g. gpt-4.1-nano).
    rating_concurrency: int = 4

    langsmith_tracing: bool = False
    langsmith_endpoint: str = ""
    langsmith_api_key: str = ""
    langsmith_project: str = "My first app"

    jooble_api_key: str = ""
    jobsapi_key: str = ""

    # Auto scheduler (search + rate every N hours in background)
    auto_crawl_interval_hours: int = 12
    # Cap new jobs stored per user per auto-crawl cycle (does not consume manual search quota)
    auto_crawl_max_stored_per_cycle: int = 25

    # High-score job apply reminders (SMTP required in production)
    job_reminder_enabled: bool = True
    job_reminder_min_score: int = 8
    job_reminder_min_jobs: int = 2  # same threshold as dashboard banner
    job_reminder_max_per_day: int = 2
    job_reminder_email_job_limit: int = 8  # max jobs listed in one email
    # Comma-separated UTC hours, e.g. "8,18" → 08:00 and 18:00 UTC daily
    job_reminder_hours_utc: str = "8,18"

    # A job sitting in Applied/Half-applied/Saved for this many days with no
    # status change gets flagged as needing a follow-up nudge.
    stale_followup_days: int = 7

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
    free_cv_upload_limit: int = 3  # CV parses cost an LLM call each time
    # Apply pack (ATS keywords + XYZ bullets + LaTeX). 0 = premium only; 1 = one free/day.
    free_apply_pack_limit: int = 1
    # AI token caps for free users (0 = unlimited). Resets daily / monthly via usage.ai_daily / usage.ai_month.
    free_daily_token_limit: int = 250_000
    free_monthly_token_limit: int = (
        3_000_000  # ~12 days' worth of daily max; backstop against sustained abuse
    )

    # AI usage tracking — optional; set rates in .env to enable cost estimates in admin
    ai_monthly_budget_usd: float = 0
    ai_cost_per_1k_prompt_tokens: float = 0
    ai_cost_per_1k_completion_tokens: float = 0
    ai_cost_per_1k_embedding_tokens: float = 0


settings = Settings()
