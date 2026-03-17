"""Tests for the model management endpoints (/models).

Covers listing, prediction proxy, rollback, and deletion.
All tests use the MockRobleClient from conftest instead of db_session.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.conftest import seed_model_deployment


def _run(coro):
    """Helper to run async coroutines in sync tests."""
    return asyncio.get_event_loop().run_until_complete(coro)


# Helper to build httpx.Response with a request set (required by raise_for_status)
_FAKE_REQ = httpx.Request("POST", "http://localhost:8001")


def _resp(status, json_data=None, text=None):
    kwargs = {"status_code": status, "request": _FAKE_REQ}
    if json_data is not None:
        kwargs["json"] = json_data
    if text is not None:
        kwargs["text"] = text
    return httpx.Response(**kwargs)


def _mock_async_client(**method_mocks):
    mock_client = AsyncMock()
    for name, impl in method_mocks.items():
        setattr(mock_client, name, impl)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


class TestListModels:
    """GET /models"""

    def test_list_models_when_deployments_exist_should_return_active(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="model-a", version="1", is_active=True))
        _run(seed_model_deployment(mock_roble_client, model_name="model-b", version="2", is_active=True))

        resp = test_app.get("/models")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        names = {d["model_name"] for d in data}
        assert names == {"model-a", "model-b"}

    def test_list_models_when_no_active_should_return_empty(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="old", is_active=False))

        resp = test_app.get("/models")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_models_when_empty_db_should_return_empty(self, test_app):
        resp = test_app.get("/models")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_models_when_mixed_active_inactive_should_return_only_active(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="active-model", is_active=True))
        _run(seed_model_deployment(mock_roble_client, model_name="retired-model", is_active=False))

        resp = test_app.get("/models")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["model_name"] == "active-model"


class TestPredict:
    """POST /models/{model_name}/predict"""

    def test_predict_when_valid_input_should_return_prediction(self, test_app):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(200, {
                "prediction": [0],
                "model_name": "iris",
                "version": "1",
            })),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2]]},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["prediction"] == [0]
        assert data["model_name"] == "iris"
        assert data["version"] == "1"

    def test_predict_when_batch_input_should_return_batch_predictions(self, test_app):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(200, {
                "prediction": [0, 1, 2],
                "model_name": "iris",
                "version": "1",
            })),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2], [6.0, 2.7, 5.1, 1.6], [5.9, 3.0, 5.1, 1.8]]},
            )

        assert resp.status_code == 200
        assert resp.json()["prediction"] == [0, 1, 2]

    def test_predict_when_model_server_returns_422_should_propagate_status(self, test_app):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(422, text="Invalid input shape")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/predict",
                json={"data": [[1.0]]},
            )

        assert resp.status_code == 422

    def test_predict_when_model_server_returns_500_should_propagate_status(self, test_app):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(500, text="Internal server error")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2]]},
            )

        assert resp.status_code == 500

    def test_predict_when_model_server_unreachable_should_return_503(self, test_app):
        mock_client = _mock_async_client(
            post=AsyncMock(side_effect=httpx.ConnectError("Connection refused")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2]]},
            )

        assert resp.status_code == 503
        assert "not reachable" in resp.json()["detail"].lower()

    def test_predict_when_invalid_data_field_should_return_422(self, test_app):
        resp = test_app.post(
            "/models/iris/predict",
            json={"data": "not-a-list"},
        )

        assert resp.status_code == 422


class TestRollbackModel:
    """POST /models/{model_name}/rollback"""

    def test_rollback_when_version_exists_should_reload_and_update_active(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="iris", version="1", is_active=False))
        _run(seed_model_deployment(mock_roble_client, model_name="iris", version="2", is_active=True))

        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(200, {"status": "loaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/rollback",
                json={"version": "1"},
            )

        assert resp.status_code == 200
        assert "Rolled back" in resp.json()["message"]

    def test_rollback_when_version_exists_should_deactivate_old_and_activate_target(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="iris", version="1", is_active=False))
        v2 = _run(seed_model_deployment(mock_roble_client, model_name="iris", version="2", is_active=True))

        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(200, {"status": "loaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/rollback",
                json={"version": "1"},
            )

        assert resp.status_code == 200

        # Verify that version 2 was deactivated (check mock ROBLE state)
        all_deployments = _run(mock_roble_client.read("model_deployments"))
        v2_record = next(d for d in all_deployments if d["version"] == "2")
        v1_record = next(d for d in all_deployments if d["version"] == "1")
        assert v2_record["is_active"] is False
        assert v1_record["is_active"] is True

    def test_rollback_when_version_not_found_should_return_404(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="iris", version="2"))

        resp = test_app.post(
            "/models/iris/rollback",
            json={"version": "99"},
        )

        assert resp.status_code == 404
        assert "No deployment found" in resp.json()["detail"]

    def test_rollback_when_model_server_fails_should_return_502(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="iris", version="1", is_active=False))

        mock_client = _mock_async_client(
            post=AsyncMock(side_effect=Exception("Connection refused")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.post(
                "/models/iris/rollback",
                json={"version": "1"},
            )

        assert resp.status_code == 502
        assert "Failed to reload" in resp.json()["detail"]


class TestDeleteModel:
    """DELETE /models/{model_name}"""

    def test_delete_model_when_exists_should_deactivate_and_return_message(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="iris", is_active=True))

        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(200, {"status": "unloaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.delete("/models/iris")

        assert resp.status_code == 200
        assert "unregistered" in resp.json()["message"].lower()

    def test_delete_model_when_exists_should_mark_deployments_inactive(
        self,
        test_app,
        mock_roble_client,
    ):
        dep = _run(seed_model_deployment(mock_roble_client, model_name="iris", is_active=True))

        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(200, {"status": "unloaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            test_app.delete("/models/iris")

        # Verify deployment was deactivated in mock ROBLE
        all_deployments = _run(mock_roble_client.read("model_deployments"))
        assert all(d["is_active"] is False for d in all_deployments if d["model_name"] == "iris")

    def test_delete_model_when_model_server_fails_should_still_deactivate(
        self,
        test_app,
        mock_roble_client,
    ):
        _run(seed_model_deployment(mock_roble_client, model_name="iris", is_active=True))

        mock_client = _mock_async_client(
            delete=AsyncMock(side_effect=Exception("Connection refused")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.delete("/models/iris")

        assert resp.status_code == 200
        assert "unregistered" in resp.json()["message"].lower()

    def test_delete_model_when_no_deployments_should_still_return_200(self, test_app):
        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(200, {"status": "ok"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = test_app.delete("/models/nonexistent")

        assert resp.status_code == 200
