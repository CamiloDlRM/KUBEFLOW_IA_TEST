"""Shared pytest fixtures for the MLOps backend test suite.

Provides a mock RobleClient, FastAPI test client,
mock Redis, mock Celery tasks, and sample data fixtures.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Environment overrides (must be set before importing app modules)
# ---------------------------------------------------------------------------
os.environ["GITHUB_WEBHOOK_SECRET"] = "test-secret"
os.environ["GITHUB_TOKEN"] = "ghp_test1234567890abcdef"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["MLFLOW_TRACKING_URI"] = "http://localhost:5000"
os.environ["MODEL_SERVER_URL"] = "http://localhost:8001"
os.environ["FRONTEND_URL"] = "http://localhost:3000"
os.environ["AUTO_DEPLOY_ON_SUCCESS"] = "true"
os.environ["MIN_ACCURACY_THRESHOLD"] = "0.70"
os.environ["RUNNER_BACKEND"] = "celery"
os.environ["ROBLE_AUTH_URL"] = "https://roble-api.openlab.uninorte.edu.co/auth/:mlops_platform_1d2a289c51"
os.environ["ROBLE_DB_URL"] = "https://roble-api.openlab.uninorte.edu.co/database/:mlops_platform_1d2a289c51"
os.environ["ROBLE_EMAIL"] = "test@test.com"
os.environ["ROBLE_PASSWORD"] = "testpass"

# Clear lru_cache so settings reload with test env vars
from core.config import get_settings

get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Mock ROBLE client
# ---------------------------------------------------------------------------

class MockRobleClient:
    """In-memory mock of RobleClient for testing."""

    def __init__(self):
        self._tables: dict[str, list[dict]] = {
            "repositories": [],
            "pipelines": [],
            "model_deployments": [],
        }
        self._id_counter = 0

    def _next_id(self) -> str:
        self._id_counter += 1
        return f"roble_{self._id_counter:04d}"

    async def _ensure_authenticated(self) -> None:
        pass

    async def create_table(self, table_name, description, columns):
        if table_name not in self._tables:
            self._tables[table_name] = []
        return {}

    async def table_exists(self, table_name) -> bool:
        return table_name in self._tables

    async def insert(self, table_name: str, records: list[dict]) -> list[dict]:
        result = []
        for record in records:
            record = dict(record)
            record["_id"] = self._next_id()
            self._tables.setdefault(table_name, []).append(record)
            result.append(record)
        return result

    async def read(self, table_name: str, filters: dict | None = None) -> list[dict]:
        records = self._tables.get(table_name, [])
        if not filters:
            return list(records)
        result = []
        for r in records:
            match = True
            for k, v in filters.items():
                val = r.get(k)
                # Handle bool comparison with string "true"/"false"
                if isinstance(val, bool) and isinstance(v, str):
                    if v.lower() == "true" and not val:
                        match = False
                    elif v.lower() == "false" and val:
                        match = False
                elif str(val) != str(v):
                    match = False
            if match:
                result.append(r)
        return result

    async def read_one(self, table_name: str, id_column: str, id_value: str) -> dict | None:
        records = await self.read(table_name, {id_column: id_value})
        return records[0] if records else None

    async def update(self, table_name: str, id_column: str, id_value: str, updates: dict) -> dict:
        records = self._tables.get(table_name, [])
        for r in records:
            if str(r.get(id_column)) == str(id_value):
                r.update(updates)
                return r
        return {}

    async def delete(self, table_name: str, id_column: str, id_value: str) -> dict:
        records = self._tables.get(table_name, [])
        self._tables[table_name] = [
            r for r in records if str(r.get(id_column)) != str(id_value)
        ]
        return {}

    async def read_paginated(self, table_name, page, size, sort_key=None, sort_reverse=True):
        all_records = await self.read(table_name)
        total = len(all_records)
        if sort_key:
            all_records.sort(key=lambda r: r.get(sort_key) or "", reverse=sort_reverse)
        offset = (page - 1) * size
        items = all_records[offset:offset + size]
        return items, total


@pytest.fixture(scope="function")
def mock_roble_client():
    """Return a fresh MockRobleClient for each test."""
    return MockRobleClient()


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def test_app(mock_roble_client):
    """Return a FastAPI TestClient with the mock RobleClient on app.state."""
    from main import app

    # Override _get_roble dependency in all routers
    from routers.repos import _get_roble as repos_get_roble
    from routers.pipelines import _get_roble as pipelines_get_roble
    from routers.webhook import _get_roble as webhook_get_roble
    from routers.models import _get_roble as models_get_roble

    app.dependency_overrides[repos_get_roble] = lambda: mock_roble_client
    app.dependency_overrides[pipelines_get_roble] = lambda: mock_roble_client
    app.dependency_overrides[webhook_get_roble] = lambda: mock_roble_client
    app.dependency_overrides[models_get_roble] = lambda: mock_roble_client

    # Also set on app.state for any code that accesses it directly
    app.state.roble = mock_roble_client

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


async def seed_repo(mock_roble: MockRobleClient, **kwargs) -> dict:
    """Insert a Repository record into the mock ROBLE and return it."""
    defaults = {
        "github_url": "https://github.com/testuser/testrepo",
        "github_token_masked": "****cdef",
        "branch": "main",
        "notebook_path": "notebooks/train.ipynb",
        "webhook_id": 12345,
        "webhook_url": "http://localhost:3000/api/webhook/github",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
    }
    defaults.update(kwargs)
    result = await mock_roble.insert("repositories", [defaults])
    return result[0]


async def seed_pipeline(mock_roble: MockRobleClient, repo_id: str, **kwargs) -> dict:
    """Insert a Pipeline record into the mock ROBLE and return it."""
    defaults = {
        "pipeline_uuid": str(uuid.uuid4()),
        "repo_id": repo_id,
        "status": "queued",
        "commit_sha": "abc123def456789",
        "started_at": None,
        "finished_at": None,
        "phases": [],
        "metrics": {},
    }
    defaults.update(kwargs)
    result = await mock_roble.insert("pipelines", [defaults])
    return result[0]


async def seed_model_deployment(mock_roble: MockRobleClient, **kwargs) -> dict:
    """Insert a ModelDeployment record into the mock ROBLE and return it."""
    defaults = {
        "model_name": "iris-classifier",
        "version": "1",
        "accuracy": 0.95,
        "endpoint_url": "http://localhost:8001/predict/iris-classifier",
        "deployed_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
        "pipeline_id": None,
    }
    defaults.update(kwargs)
    result = await mock_roble.insert("model_deployments", [defaults])
    return result[0]
