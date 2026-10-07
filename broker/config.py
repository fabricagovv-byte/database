"""Configuração da aplicação, lida exclusivamente de variáveis de ambiente (prefixo BROKER_)."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BROKER_", env_file=".env", extra="ignore")

    ambiente: str = "desenvolvimento"
    log_level: str = "INFO"
    database_url: str = "postgresql+psycopg://broker:broker@localhost:5432/broker"
    redis_url: str = "redis://localhost:6379/0"
    oidc_issuer: str = "http://localhost:8080/realms/cvm"
    oidc_client_id: str = "broker-api"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    health_timeout_s: float = 2.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
