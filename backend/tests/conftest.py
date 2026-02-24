"""Shared pytest fixtures for the MLOps backend test suite.

Provides a clean in-memory SQLite database, FastAPI test client,
mock Redis, mock Celery tasks, and sample data fixtures.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timezone
from typing import Any, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Environment overrides (must be set before importing app modules)
# ---------------------------------------------------------------------------
os.environ["DATABASE_URL"] = "sqlite:///./test_mlops.db"
os.environ["GITHUB_WEBHOOK_SECRET"] = "test-secret"
os.environ["GITHUB_TOKEN"] = "ghp_test1234567890abcdef"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["MLFLOW_TRACKING_URI"] = "http://localhost:5000"
os.environ["MODEL_SERVER_URL"] = "http://localhost:8001"
os.environ["FRONTEND_URL"] = "http://localhost:3000"
os.environ["AUTO_DEPLOY_ON_SUCCESS"] = "true"
os.environ["MIN_ACCURACY_THRESHOLD"] = "0.70"
os.environ["RUNNER_BACKEND"] = "celery"

# Clear lru_cache so settings reload with test env vars
from core.config import get_settings

get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Database fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def db_engine():
    """Create a shared in-memory SQLite engine usable across threads.

    Uses StaticPool and check_same_thread=False so FastAPI's sync
    dependency injection (running in a threadpool) can share the same
    in-memory database with the test thread.
    """
    # Import all SQLModel table classes so metadata knows about them
    from models.schemas import Repository, Pipeline, ModelDeployment  # noqa: F401

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    yield engine
    SQLModel.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture(scope="function")
def db_session(db_engine) -> Generator[Session, None, None]:
    """Yield a SQLModel Session bound to the shared in-memory engine."""
    with Session(db_engine) as session:
        yield session


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def test_app(db_engine):
    """Return a FastAPI TestClient with dependency overrides for the DB session.

    All routers' _get_session dependencies are overridden to yield sessions
    from the shared in-memory engine.
    """
    from main import app

    def _override_session():
        with Session(db_engine) as session:
            yield session

    # Override all session dependencies across routers
    from routers.repos import _get_session as repos_get_session
    from routers.pipelines import _get_session as pipelines_get_session
    from routers.webhook import _get_session as webhook_get_session
    from routers.models import _get_session as models_get_session

    app.dependency_overrides[repos_get_session] = _override_session
    app.dependency_overrides[pipelines_get_session] = _override_session
    app.dependency_overrides[webhook_get_session] = _override_session
    app.dependency_overrides[models_get_session] = _override_session

    client = TestClient(app, raise_server_exceptions=False)
    yield client

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Mock external services
# ---------------------------------------------------------------------------

@pytest.fixture()
def mock_redis():
    """Return a MagicMock that replaces Redis interactions."""
    mock = MagicMock()
    mock.ping.return_value = True
    mock.lrange.return_value = []
    mock.publish.return_value = 1
    mock.rpush.return_value = 1
    mock.expire.return_value = True
    return mock


@pytest.fixture()
def mock_celery():
    """Mock the Celery run_pipeline task."""
    with patch("tasks.celery_tasks.run_pipeline") as mock_task:
        mock_task.apply_async = MagicMock(return_value=MagicMock(id="mock-task-id"))
        yield mock_task


@pytest.fixture()
def mock_github_create_webhook():
    """Mock core.github.create_webhook to return a successful response."""
    with patch("core.github.create_webhook", new_callable=AsyncMock) as mock:
        mock.return_value = {
            "id": 12345,
            "name": "web",
            "active": True,
            "events": ["push"],
            "config": {
                "url": "http://localhost:3000/api/webhook/github",
                "content_type": "json",
            },
        }
        yield mock


@pytest.fixture()
def mock_github_delete_webhook():
    """Mock core.github.delete_webhook."""
    with patch("core.github.delete_webhook", new_callable=AsyncMock) as mock:
        yield mock


@pytest.fixture()
def mock_pipeline_runner():
    """Mock the pipeline runner returned by get_pipeline_runner."""
    runner = MagicMock()
    runner.run = AsyncMock()
    with patch("routers.webhook.get_pipeline_runner", return_value=runner):
        yield runner


# ---------------------------------------------------------------------------
# Sample data fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def sample_webhook_payload() -> dict[str, Any]:
    """A realistic GitHub push webhook payload."""
    return {
        "ref": "refs/heads/main",
        "after": "abc123def456789",
        "repository": {
            "html_url": "https://github.com/testuser/testrepo",
            "full_name": "testuser/testrepo",
        },
        "commits": [
            {
                "id": "abc123",
                "added": ["notebooks/train.ipynb"],
                "modified": [],
                "removed": [],
            }
        ],
    }


@pytest.fixture()
def sample_notebook() -> dict[str, Any]:
    """A valid notebook with all required mlops tags."""
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [
            {
                "cell_type": "code",
                "metadata": {"tags": ["mlops:config"]},
                "source": [
                    'MODEL_NAME = "iris-classifier"\n',
                    'VERSION = "1"\n',
                ],
                "outputs": [],
            },
            {
                "cell_type": "code",
                "metadata": {"tags": ["mlops:preprocessing"]},
                "source": ["import pandas as pd\n"],
                "outputs": [],
            },
            {
                "cell_type": "code",
                "metadata": {"tags": ["mlops:training"]},
                "source": ["model.fit(X_train, y_train)\n"],
                "outputs": [],
            },
            {
                "cell_type": "code",
                "metadata": {"tags": ["mlops:export"]},
                "source": ["joblib.dump(model, MODEL_OUTPUT_PATH)\n"],
                "outputs": [],
            },
        ],
    }


def make_webhook_signature(payload: bytes, secret: str = "test-secret") -> str:
    """Generate a valid HMAC-SHA256 signature for a webhook payload."""
    digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def seed_repo(session: Session, **kwargs) -> "Repository":
    """Insert a Repository record into the session and return it."""
    from models.schemas import Repository

    defaults = {
        "github_url": "https://github.com/testuser/testrepo",
        "github_token_masked": "****cdef",
        "branch": "main",
        "notebook_path": "notebooks/train.ipynb",
        "webhook_id": 12345,
        "webhook_url": "http://localhost:3000/api/webhook/github",
        "is_active": True,
    }
    defaults.update(kwargs)
    repo = Repository(**defaults)
    session.add(repo)
    session.commit()
    session.refresh(repo)
    return repo


def seed_pipeline(session: Session, repo_id: int, **kwargs) -> "Pipeline":
    """Insert a Pipeline record into the session and return it."""
    from models.schemas import Pipeline

    defaults = {
        "repo_id": repo_id,
        "status": "queued",
        "commit_sha": "abc123def456789",
        "phases": [],
        "metrics": {},
    }
    defaults.update(kwargs)
    pipeline = Pipeline(**defaults)
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    return pipeline


def seed_model_deployment(session: Session, **kwargs) -> "ModelDeployment":
    """Insert a ModelDeployment record into the session and return it."""
    from models.schemas import ModelDeployment

    defaults = {
        "model_name": "iris-classifier",
        "version": "1",
        "accuracy": 0.95,
        "endpoint_url": "http://localhost:8001/predict/iris-classifier",
        "is_active": True,
        "pipeline_id": None,
    }
    defaults.update(kwargs)
    deployment = ModelDeployment(**defaults)
    session.add(deployment)
    session.commit()
    session.refresh(deployment)
    return deployment
