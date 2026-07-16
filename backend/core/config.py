"""Application configuration using pydantic-settings.

All configuration is loaded from environment variables with .env file support.
Access the singleton settings instance via get_settings().
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    """Core application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- GitHub Integration ---
    github_webhook_secret: str = Field(
        default="changeme",
        description="Secret used to verify GitHub webhook HMAC-SHA256 signatures.",
    )
    github_token: str = Field(
        default="",
        description="GitHub personal-access token for API calls.",
    )

    # --- Infrastructure ---
    redis_url: str = Field(
        default="redis://redis:6379/0",
        description="Redis connection URL used by Celery broker and result backend.",
    )
    mlflow_tracking_uri: str = Field(
        default="http://mlflow:5000",
        description="MLflow tracking server URI.",
    )
    model_server_url: str = Field(
        default="http://model-server:8001",
        description="Internal URL of the model-server service.",
    )
    database_url: str = Field(
        default="sqlite:///./mlops.db",
        description="SQLModel / SQLAlchemy database URL.",
    )

    # --- Storage ---
    models_base_path: str = Field(
        default="/app/models",
        description="Base directory where trained model artifacts are stored.",
    )

    # --- Pipeline behaviour ---
    auto_deploy_on_success: bool = Field(
        default=True,
        description="Automatically deploy a model when pipeline succeeds.",
    )
    min_accuracy_threshold: float = Field(
        default=0.70,
        description="Minimum accuracy required for auto-deployment.",
    )
    runner_backend: Literal["celery", "kubernetes"] = Field(
        default="celery",
        description="Pipeline runner implementation to use.",
    )

    # --- AI Advisor ---
    anthropic_api_key: str = Field(
        default="",
        description="Anthropic API key used by the AI training advisor.",
    )
    ai_advisor_enabled: bool = Field(
        default=True,
        description="Generate AI feedback automatically after each pipeline run.",
    )
    ai_advisor_model: str = Field(
        default="claude-opus-4-8",
        description="Claude model used to generate training feedback.",
    )

    # --- Authentication ---
    auth_secret_key: str = Field(
        default="change-this-secret",
        description="Secret used to sign session tokens (HMAC-SHA256).",
    )
    auth_token_ttl_hours: int = Field(
        default=24,
        description="Session token lifetime in hours.",
    )
    admin_email: str = Field(
        default="admin@mlops.local",
        description="Email of the seeded admin user.",
    )
    admin_password: str = Field(
        default="admin123",
        description="Password of the seeded admin user (change in production).",
    )

    # --- Application ---
    log_level: str = Field(default="INFO", description="Root log level.")
    frontend_url: str = Field(
        default="http://localhost:3000",
        description="Frontend origin for CORS.",
    )
    backend_public_url: str = Field(
        default="http://localhost:8000",
        description="Public URL of the backend, used to register GitHub webhooks.",
    )


@lru_cache(maxsize=1)
def get_settings() -> AppSettings:
    """Return the cached application settings singleton."""
    return AppSettings()
