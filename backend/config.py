"""
Central configuration. Everything reads from environment variables
(loaded from .env). This is also where the LLM provider switch lives
for later phases — change LLM_PROVIDER and nothing else breaks.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    #  App 
    app_name: str = "JobRadar AI"
    debug: bool = True

    #  MongoDB 
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "jobradar"

    # JWT Auth 
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    #  CORS (frontend origins) 
    cors_origins: list[str] = [
        "http://localhost:5173",  # Vite dev
        "http://localhost:3000",  # CRA / Next dev
    ]

    #  LLM 
    # Swap provider here only. LangChain abstraction handles the rest.
    llm_provider: str = "ollama"  # "ollama" | "openai" | "anthropic"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:14b"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

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


settings = Settings()
