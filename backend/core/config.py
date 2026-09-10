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
        default="postgresql://mlops:mlops@postgres:5432/mlops",
        description="SQLAlchemy database URL (PostgreSQL).",
    )

    # --- Auth ---
    jwt_secret_key: str = Field(
        default="change-me-in-production",
        description="Secret key for signing JWT tokens.",
    )
    jwt_algorithm: str = Field(
        default="HS256",
        description="Algorithm used to sign JWT tokens.",
    )
    access_token_expire_minutes: int = Field(
        default=60,
        description="JWT access token TTL in minutes.",
    )
    invite_token_expire_hours: int = Field(
        default=48,
        description="Default TTL in hours for invite tokens.",
    )
    first_admin_username: str = Field(
        default="",
        description="Bootstrap admin username. Created on first startup if set and no users exist.",
    )
    first_admin_password: str = Field(
        default="",
        description="Bootstrap admin password. Must be 8–72 characters.",
    )

    # --- AI Advisor ---
    ai_advisor_enabled: bool = Field(
        default=True,
        description="Generate AI feedback automatically after each pipeline run.",
    )
    ai_advisor_provider: Literal["anthropic", "gemini", "ollama"] = Field(
        default="anthropic",
        description="LLM provider used to generate training feedback.",
    )
    ai_advisor_model: str = Field(
        default="",
        description=(
            "Model used to generate training feedback. Leave empty to use the "
            "provider default (claude-opus-4-8 / gemini-2.5-pro / llama3.1)."
        ),
    )
    anthropic_api_key: str = Field(
        default="",
        description="Anthropic API key (provider=anthropic).",
    )
    gemini_api_key: str = Field(
        default="",
        description="Google AI Studio API key (provider=gemini).",
    )
    ollama_base_url: str = Field(
        default="http://host.docker.internal:11434",
        description="Base URL of the Ollama server (provider=ollama).",
    )

    # --- Storage ---
    models_base_path: str = Field(
        default="/app/model_artifacts",
        description="Base directory where trained model artifacts are stored.",
    )

    # --- Object storage (MinIO / S3) ---
    minio_endpoint: str = Field(
        default="http://minio:9000",
        description="MinIO/S3 endpoint URL as seen from the backend and worker.",
    )
    minio_access_key: str = Field(
        default="minioadmin",
        description="MinIO access key (S3 AWS_ACCESS_KEY_ID).",
    )
    minio_secret_key: str = Field(
        default="minioadmin",
        description="MinIO secret key (S3 AWS_SECRET_ACCESS_KEY).",
    )
    minio_region: str = Field(
        default="us-east-1",
        description="Region name sent to the S3 API (MinIO ignores it but boto3 requires one).",
    )
    minio_bucket_datasets: str = Field(
        default="datasets",
        description="Bucket where user-uploaded training datasets are stored.",
    )
    minio_bucket_mlflow: str = Field(
        default="mlflow",
        description="Bucket used by MLflow as its artifact store.",
    )
    dataset_max_size_mb: int = Field(
        default=512,
        description="Maximum accepted size for an uploaded dataset, in megabytes.",
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

    # --- Email (SMTP) ---
    # Dev: point at Mailhog (smtp_host=mailhog, smtp_port=1025, no auth, no TLS)
    # Prod (ACS): smtp_host=smtp.azurecomm.net, smtp_port=587, use_tls=true,
    #             smtp_user=<ACS connection string user>, smtp_password=<ACS password>
    smtp_host: str = Field(default="mailhog", description="SMTP server hostname.")
    smtp_port: int = Field(default=1025, description="SMTP server port.")
    smtp_use_tls: bool = Field(default=False, description="Use STARTTLS when connecting.")
    smtp_user: str = Field(default="", description="SMTP authentication username.")
    smtp_password: str = Field(default="", description="SMTP authentication password.")
    email_from_address: str = Field(
        default="noreply@mlops.local",
        description="The From address used in outgoing emails.",
    )
    email_from_name: str = Field(default="MLOps Platform", description="Display name for the From address.")
    smtp_enabled: bool = Field(
        default=True,
        description="Set to false to disable email sending entirely (invite link still returned).",
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
