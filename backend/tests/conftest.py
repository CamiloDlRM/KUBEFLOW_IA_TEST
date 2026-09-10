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
from typing import TYPE_CHECKING, Any, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

if TYPE_CHECKING:  # import-free at runtime: the env overrides below must run
    # before any application module is imported for real.
    from models.schemas import (
        Dataset,
        ModelDeployment,
        Pipeline,
        Repository,
        User,
    )

# ---------------------------------------------------------------------------
# Environment overrides (must be set before importing app modules)
# ---------------------------------------------------------------------------
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["GITHUB_WEBHOOK_SECRET"] = "test-secret"
os.environ["GITHUB_TOKEN"] = "ghp_test1234567890abcdef"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["MLFLOW_TRACKING_URI"] = "http://localhost:5000"
os.environ["MODEL_SERVER_URL"] = "http://localhost:8001"
os.environ["FRONTEND_URL"] = "http://localhost:3000"
os.environ["AUTO_DEPLOY_ON_SUCCESS"] = "true"
os.environ["MIN_ACCURACY_THRESHOLD"] = "0.70"
os.environ["RUNNER_BACKEND"] = "celery"
os.environ["JWT_SECRET_KEY"] = "test-jwt-secret"

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
    from models.schemas import (  # noqa: F401
        Dataset,
        ModelDeployment,
        Pipeline,
        PipelineInsight,
        Repository,
        User,
    )

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

#: Id of the member impersonated by the default ``test_app`` client. Seed
#: helpers default their ``owner_id`` to it so a plain ``seed_repo(...)`` is
#: owned by the user making the requests.
DEFAULT_USER_ID = 1

#: Id of the member impersonated by ``other_member_app`` — the "other tenant".
OTHER_USER_ID = 2

#: Id of the admin impersonated by ``admin_app``.
ADMIN_USER_ID = 3


def make_user(user_id: int, role: str = "member", username: str | None = None) -> "User":
    """Build an unsaved User row for the auth dependency override."""
    from models.schemas import User

    return User(
        id=user_id,
        username=username or f"user{user_id}",
        hashed_password="",
        role=role,
        is_active=True,
    )


class _ClientAs(TestClient):
    """TestClient that pins ``get_current_user`` to one user on every request.

    All clients share the same FastAPI ``app`` object (and therefore the same
    ``dependency_overrides`` dict), so a test using two clients at once — the
    whole point of the ownership tests — cannot rely on the override being set
    once at fixture time: the last fixture built would win for everybody.
    Re-applying it per request keeps each client's identity stable.
    """

    def __init__(self, app, user, **kwargs) -> None:
        super().__init__(app, **kwargs)
        self._app = app
        self._user = user

    def request(self, *args, **kwargs):  # type: ignore[override]
        from core.security import get_current_user

        self._app.dependency_overrides[get_current_user] = lambda: self._user
        return super().request(*args, **kwargs)


def _build_client(db_engine, user: "User") -> TestClient:
    """Return a TestClient whose requests are authenticated as ``user``."""
    from main import app
    import db as db_module
    from core.security import get_current_user

    def _override_session():
        with Session(db_engine) as session:
            yield session

    app.dependency_overrides[db_module.get_session] = _override_session
    app.dependency_overrides[get_current_user] = lambda: user
    return _ClientAs(app, user, raise_server_exceptions=False)


@pytest.fixture(scope="function")
def test_app(db_engine):
    """TestClient authenticated as the default *member* (id ``DEFAULT_USER_ID``).

    Overrides:
    - db.get_session → in-memory SQLite session
    - core.security.get_current_user → member user id 1 ("testuser")

    Since multi-tenancy landed, this client only sees resources owned by user
    1 — which is exactly what the seed helpers create by default.
    """
    from main import app

    client = _build_client(
        db_engine, make_user(DEFAULT_USER_ID, "member", "testuser")
    )
    yield client

    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def other_member_app(db_engine):
    """TestClient authenticated as a *different* member (id ``OTHER_USER_ID``).

    Used to assert that one member cannot reach another member's resources.
    """
    from main import app

    client = _build_client(
        db_engine, make_user(OTHER_USER_ID, "member", "otheruser")
    )
    yield client

    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def admin_app(db_engine):
    """TestClient authenticated as an *admin* (id ``ADMIN_USER_ID``).

    Admins bypass the ownership filter, so this fixture is also what the
    endpoints that operate on unowned/legacy rows are exercised with.
    """
    from main import app

    client = _build_client(db_engine, make_user(ADMIN_USER_ID, "admin", "adminuser"))
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
    """Insert a Repository record into the session and return it.

    ``owner_id`` defaults to ``DEFAULT_USER_ID`` so a seeded repository (and
    everything derived from it) is visible to the ``test_app`` client. Pass
    ``owner_id=OTHER_USER_ID`` to seed another tenant's repository, or
    ``owner_id=None`` for a legacy row that no member owns.
    """
    from models.schemas import Repository

    defaults = {
        "owner_id": DEFAULT_USER_ID,
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


def seed_dataset(session: Session, repo_id: int, **kwargs) -> "Dataset":
    """Insert a Dataset record into the session and return it."""
    from models.schemas import Dataset

    defaults = {
        "repo_id": repo_id,
        "name": "train.csv",
        "description": "seeded dataset",
        "bucket": "datasets",
        "object_key": f"repo-{repo_id}/00000000-0000-0000-0000-000000000000/train.csv",
        "content_type": "text/csv",
        "size_bytes": 128,
        "checksum": "0" * 64,
        "uploaded_by": None,
        "is_active": True,
    }
    defaults.update(kwargs)
    dataset = Dataset(**defaults)
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


def seed_model_deployment(session: Session, **kwargs) -> "ModelDeployment":
    """Insert a ModelDeployment record into the session and return it.

    ``pipeline_id`` defaults to ``None``, i.e. a *legacy* deployment that
    cannot be traced back to a repository owner. Those are visible to admins
    only, so tests that seed them must drive the API through ``admin_app``;
    pass ``pipeline_id=<a pipeline id>`` to make a deployment owned like its
    repository.
    """
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
