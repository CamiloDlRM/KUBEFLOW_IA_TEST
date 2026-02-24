"""Pydantic v2 and SQLModel schemas for the MLOps platform.

Defines database tables (SQLModel) and request/response DTOs (BaseModel).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Column, Field as SQLField, JSON, SQLModel


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Database tables (SQLModel with table=True)
# ---------------------------------------------------------------------------

class Repository(SQLModel, table=True):
    """Registered GitHub repository."""

    __tablename__ = "repositories"

    id: int | None = SQLField(default=None, primary_key=True)
    github_url: str = SQLField(index=True)
    github_token_masked: str = SQLField(
        default="",
        description="Masked token stored for display only (last 4 chars).",
    )
    branch: str = SQLField(default="main")
    notebook_path: str = SQLField(default="notebooks/train.ipynb")
    webhook_id: int | None = SQLField(default=None)
    webhook_url: str | None = SQLField(default=None)
    created_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)


class Pipeline(SQLModel, table=True):
    """A single pipeline execution record."""

    __tablename__ = "pipelines"

    id: str = SQLField(default_factory=_new_uuid, primary_key=True)
    repo_id: int = SQLField(foreign_key="repositories.id")
    status: str = SQLField(default="queued")  # queued | running | success | failed
    commit_sha: str = SQLField(default="")
    started_at: datetime | None = SQLField(default=None)
    finished_at: datetime | None = SQLField(default=None)
    phases: list[dict[str, Any]] = SQLField(default=[], sa_column=Column(JSON))
    metrics: dict[str, Any] = SQLField(default={}, sa_column=Column(JSON))


class ModelDeployment(SQLModel, table=True):
    """A deployed model version."""

    __tablename__ = "model_deployments"

    id: int | None = SQLField(default=None, primary_key=True)
    model_name: str = SQLField(index=True)
    version: str = SQLField(default="1")
    accuracy: float = SQLField(default=0.0)
    endpoint_url: str = SQLField(default="")
    deployed_at: datetime = SQLField(default_factory=_utcnow)
    is_active: bool = SQLField(default=True)
    pipeline_id: str | None = SQLField(default=None, foreign_key="pipelines.id")


# ---------------------------------------------------------------------------
# Pipeline phase (embedded, not a table)
# ---------------------------------------------------------------------------

class PipelinePhase(BaseModel):
    """A single phase inside a pipeline run."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    status: str = "pending"  # pending | running | success | failed
    started_at: datetime | None = None
    finished_at: datetime | None = None
    logs: str = ""


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RepoCreateRequest(BaseModel):
    """Payload to register a new repository."""

    model_config = ConfigDict(strict=True)

    github_url: str = Field(..., examples=["https://github.com/user/repo"])
    github_token: str = Field(default="", description="Optional override token.")
    branch: str = Field(default="main")
    notebook_path: str = Field(default="notebooks/train.ipynb")


class PredictRequest(BaseModel):
    """Payload for model inference."""

    model_config = ConfigDict(strict=True)

    data: list[list[float]] = Field(
        ...,
        description="2-D array of feature vectors.",
        examples=[[[5.1, 3.5, 1.4, 0.2]]],
    )


class LoadModelRequest(BaseModel):
    """Internal request to load a model into the model-server."""

    model_config = ConfigDict(strict=True)

    mlflow_run_id: str
    version: str


class RollbackRequest(BaseModel):
    """Request to rollback a model to a previous version."""

    model_config = ConfigDict(strict=True)

    version: str = Field(..., description="MLflow model version to rollback to.")


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class RepoResponse(BaseModel):
    """Repository read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    github_url: str
    github_token_masked: str
    branch: str
    notebook_path: str
    webhook_id: int | None
    webhook_url: str | None
    created_at: datetime
    is_active: bool


class RepoCreatedResponse(BaseModel):
    """Response after creating a repo."""

    repo_id: int
    webhook_url: str
    status: str = "webhook_created"


class PipelineResponse(BaseModel):
    """Pipeline read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    repo_id: int
    status: str
    commit_sha: str
    started_at: datetime | None
    finished_at: datetime | None
    phases: list[dict[str, Any]]
    metrics: dict[str, Any]


class PipelineListResponse(BaseModel):
    """Paginated list of pipelines."""

    items: list[PipelineResponse]
    total: int
    page: int
    size: int


class PipelineLogsResponse(BaseModel):
    """Aggregated logs for a pipeline."""

    pipeline_id: str
    logs: list[dict[str, Any]]


class WebhookAccepted(BaseModel):
    """Response when a webhook event is accepted."""

    status: str = "queued"
    pipeline_id: str


class ModelDeploymentResponse(BaseModel):
    """Deployed model read representation."""

    model_config = ConfigDict(from_attributes=True)

    model_name: str
    version: str
    accuracy: float
    endpoint_url: str
    deployed_at: datetime
    is_active: bool
    pipeline_id: str | None


class PredictResponse(BaseModel):
    """Model prediction response."""

    prediction: list[Any]
    model_name: str
    version: str


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"


class ReadyResponse(BaseModel):
    """Readiness check response."""

    status: str
    redis: str
    mlflow: str
    model_server: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
