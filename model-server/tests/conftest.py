"""Shared fixtures for model-server tests."""
from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

os.environ["MLFLOW_TRACKING_URI"] = "http://localhost:5000"
os.environ["MODELS_BASE_PATH"] = "/tmp/test-models"
os.environ["LOG_LEVEL"] = "DEBUG"


@pytest.fixture(scope="function")
def model_server_client():
    """Return a TestClient for the model-server app with a clean model registry."""
    from server import app, _models

    _models.clear()
    client = TestClient(app, raise_server_exceptions=False)
    yield client
    _models.clear()


@pytest.fixture()
def mock_model():
    """Create a mock sklearn-like model with a predict method."""
    model = MagicMock()
    model.predict.return_value = [0, 1, 2]
    return model


@pytest.fixture()
def loaded_model(model_server_client, mock_model):
    """Pre-load a mock model into the model-server registry."""
    from server import _models, _ModelEntry

    entry = _ModelEntry(
        model=mock_model,
        model_name="test-model",
        version="1",
        mlflow_run_id="run-abc123",
    )
    _models["test-model"] = entry
    return entry
