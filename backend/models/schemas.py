"""Pydantic v2 schemas for the MLOps platform.

Defines request/response DTOs (BaseModel) and helpers to convert
ROBLE REST API dicts into response schemas.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# ROBLE table definitions (used for table creation at startup)
# ---------------------------------------------------------------------------

ROBLE_TABLES = {
    "repositories": {
        "description": "Registered GitHub repositories",
        "columns": [
            {"name": "github_url", "type": "TEXT", "isNullable": False, "isPrimary": False},
            {"name": "github_token_masked", "type": "VARCHAR", "isNullable": True, "isPrimary": False},
            {"name": "branch", "type": "VARCHAR", "isNullable": True, "isPrimary": False},
            {"name": "notebook_path", "type": "TEXT", "isNullable": False, "isPrimary": False},
            {"name": "webhook_id", "type": "INTEGER", "isNullable": True, "isPrimary": False},
            {"name": "webhook_url", "type": "TEXT", "isNullable": True, "isPrimary": False},
            {"name": "created_at", "type": "TIMESTAMP", "isNullable": True, "isPrimary": False},
            {"name": "is_active", "type": "BOOLEAN", "isNullable": True, "isPrimary": False},
        ],
    },
    "pipelines": {
        "description": "Pipeline execution records",
        "columns": [
            {"name": "pipeline_uuid", "type": "VARCHAR", "isNullable": False, "isPrimary": False},
            {"name": "repo_id", "type": "VARCHAR", "isNullable": False, "isPrimary": False},
            {"name": "status", "type": "VARCHAR", "isNullable": False, "isPrimary": False},
            {"name": "commit_sha", "type": "VARCHAR", "isNullable": True, "isPrimary": False},
            {"name": "started_at", "type": "TIMESTAMP", "isNullable": True, "isPrimary": False},
            {"name": "finished_at", "type": "TIMESTAMP", "isNullable": True, "isPrimary": False},
            {"name": "phases", "type": "JSON", "isNullable": True, "isPrimary": False},
            {"name": "metrics", "type": "JSON", "isNullable": True, "isPrimary": False},
        ],
    },
    "model_deployments": {
        "description": "Deployed model versions",
        "columns": [
            {"name": "model_name", "type": "VARCHAR", "isNullable": False, "isPrimary": False},
            {"name": "version", "type": "VARCHAR", "isNullable": True, "isPrimary": False},
            {"name": "accuracy", "type": "DOUBLE PRECISION", "isNullable": True, "isPrimary": False},
            {"name": "endpoint_url", "type": "TEXT", "isNullable": True, "isPrimary": False},
            {"name": "deployed_at", "type": "TIMESTAMP", "isNullable": True, "isPrimary": False},
            {"name": "is_active", "type": "BOOLEAN", "isNullable": True, "isPrimary": False},
            {"name": "pipeline_id", "type": "VARCHAR", "isNullable": True, "isPrimary": False},
        ],
    },
}


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
    notebook_path: str = Field(..., description="Path to the notebook file within the repository (e.g. 'train.ipynb' or 'notebooks/train.ipynb').")


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

    id: str
    github_url: str
    github_token_masked: str
    branch: str
    notebook_path: str
    webhook_id: int | None
    webhook_url: str | None
    created_at: datetime | str
    is_active: bool


class RepoCreatedResponse(BaseModel):
    """Response after creating a repo."""

    repo_id: str
    webhook_url: str
    status: str = "webhook_created"


class PipelineResponse(BaseModel):
    """Pipeline read representation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    repo_id: str
    status: str
    commit_sha: str
    started_at: datetime | str | None
    finished_at: datetime | str | None
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

    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    model_name: str
    version: str
    accuracy: float
    endpoint_url: str
    deployed_at: datetime | str
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

    model_config = ConfigDict(protected_namespaces=())

    status: str
    redis: str
    mlflow: str
    model_server: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str


# ---------------------------------------------------------------------------
# ROBLE dict -> Response schema converters
# ---------------------------------------------------------------------------

def repo_from_roble(data: dict) -> RepoResponse:
    """Convert a ROBLE repositories dict to RepoResponse."""
    return RepoResponse(
        id=data["_id"],
        github_url=data.get("github_url", ""),
        github_token_masked=data.get("github_token_masked", ""),
        branch=data.get("branch", "main"),
        notebook_path=data.get("notebook_path", ""),
        webhook_id=data.get("webhook_id"),
        webhook_url=data.get("webhook_url"),
        created_at=data.get("created_at", ""),
        is_active=data.get("is_active", True),
    )


def pipeline_from_roble(data: dict) -> PipelineResponse:
    """Convert a ROBLE pipelines dict to PipelineResponse."""
    return PipelineResponse(
        id=data.get("pipeline_uuid", data.get("_id", "")),
        repo_id=data.get("repo_id", ""),
        status=data.get("status", "queued"),
        commit_sha=data.get("commit_sha", ""),
        started_at=data.get("started_at"),
        finished_at=data.get("finished_at"),
        phases=data.get("phases") or [],
        metrics=data.get("metrics") or {},
    )


def deployment_from_roble(data: dict) -> ModelDeploymentResponse:
    """Convert a ROBLE model_deployments dict to ModelDeploymentResponse."""
    return ModelDeploymentResponse(
        model_name=data.get("model_name", ""),
        version=data.get("version", "1"),
        accuracy=float(data.get("accuracy", 0.0)),
        endpoint_url=data.get("endpoint_url", ""),
        deployed_at=data.get("deployed_at", ""),
        is_active=data.get("is_active", True),
        pipeline_id=data.get("pipeline_id"),
    )
