"""Tests for the model management endpoints (/models).

Covers listing, prediction proxy, rollback, and deletion.

These tests drive the API through ``admin_app`` rather than ``test_app``:
``seed_model_deployment`` creates *legacy* rows with no ``pipeline_id``, which
since multi-tenancy landed cannot be attributed to a repository owner and are
therefore restricted to admins (fail closed). The member's view of /models —
only deployments produced by pipelines of their own repositories — is covered
in ``test_ownership.py``.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from tests.conftest import seed_model_deployment

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
        admin_app,
        db_session,
    ):
        seed_model_deployment(db_session, model_name="model-a", version="1", is_active=True)
        seed_model_deployment(db_session, model_name="model-b", version="2", is_active=True)

        resp = admin_app.get("/models")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        names = {d["model_name"] for d in data}
        assert names == {"model-a", "model-b"}

    def test_list_models_when_no_active_should_return_empty(
        self,
        admin_app,
        db_session,
    ):
        seed_model_deployment(db_session, model_name="old", is_active=False)

        resp = admin_app.get("/models")

        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_models_when_empty_db_should_return_empty(self, admin_app):
        resp = admin_app.get("/models")

        assert resp.status_code == 200
        assert resp.json() == []


class TestPredict:
    """POST /models/{model_name}/predict"""

    def test_predict_when_valid_input_should_return_prediction(self, admin_app):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(200, {
                "prediction": [0],
                "model_name": "iris",
                "version": "1",
            })),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2]]},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["prediction"] == [0]
        assert data["model_name"] == "iris"

    def test_predict_when_model_server_returns_error_should_propagate_status(self, admin_app):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(422, text="Invalid input shape")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/iris/predict",
                json={"data": [[1.0]]},
            )

        assert resp.status_code == 422

    def test_predict_when_model_not_loaded_should_reload_and_retry(
        self, admin_app, db_session
    ):
        """A model-server restart loses in-memory models: predict must reload
        the model from MLflow using the stored run id and retry."""
        seed_model_deployment(
            db_session,
            model_name="iris",
            version="1",
            is_active=True,
            mlflow_run_id="run-abc",
        )

        mock_client = _mock_async_client(
            post=AsyncMock(
                side_effect=[
                    _resp(404, {"detail": "Model 'iris' is not loaded."}),
                    _resp(200, {"status": "loaded"}),
                    _resp(
                        200,
                        {"prediction": [0], "model_name": "iris", "version": "1"},
                    ),
                ]
            ),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2]]},
            )

        assert resp.status_code == 200
        assert resp.json()["prediction"] == [0]
        # 3 calls: failed predict, reload, successful retry
        assert mock_client.post.call_count == 3
        reload_call = mock_client.post.call_args_list[1]
        assert "/internal/load/iris" in reload_call.args[0]
        assert reload_call.kwargs["json"]["mlflow_run_id"] == "run-abc"

    def test_predict_when_not_loaded_and_no_deployment_should_return_404(
        self, admin_app
    ):
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(404, {"detail": "not loaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/ghost/predict",
                json={"data": [[1.0]]},
            )

        assert resp.status_code == 404
        assert "No active deployment" in resp.json()["detail"]

    def test_predict_when_model_server_unreachable_should_return_503(self, admin_app):
        mock_client = _mock_async_client(
            post=AsyncMock(side_effect=httpx.ConnectError("Connection refused")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/iris/predict",
                json={"data": [[5.1, 3.5, 1.4, 0.2]]},
            )

        assert resp.status_code == 503
        assert "not reachable" in resp.json()["detail"].lower()


class TestRollbackModel:
    """POST /models/{model_name}/rollback"""

    def test_rollback_when_version_exists_should_reload_and_update_active(
        self, admin_app, db_session
    ):
        seed_model_deployment(
            db_session,
            model_name="iris",
            version="1",
            is_active=False,
            mlflow_run_id="run-v1",
        )
        seed_model_deployment(
            db_session,
            model_name="iris",
            version="2",
            is_active=True,
            mlflow_run_id="run-v2",
        )

        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(200, {"status": "loaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/iris/rollback",
                json={"version": "1"},
            )

        assert resp.status_code == 200
        assert "Rolled back" in resp.json()["message"]
        # The model-server must receive the REAL MLflow run id of the target version
        load_call = mock_client.post.call_args
        assert load_call.kwargs["json"]["mlflow_run_id"] == "run-v1"

    def test_rollback_when_run_id_unknown_should_return_409(
        self, admin_app, db_session
    ):
        # Legacy deployment: no mlflow_run_id stored and no pipeline_id to
        # backfill from — the rollback cannot locate the artifact.
        seed_model_deployment(db_session, model_name="iris", version="1", is_active=False)

        resp = admin_app.post(
            "/models/iris/rollback",
            json={"version": "1"},
        )

        assert resp.status_code == 409
        assert "could not be determined" in resp.json()["detail"]

    def test_rollback_when_version_not_found_should_return_404(
        self, admin_app, db_session
    ):
        seed_model_deployment(db_session, model_name="iris", version="2")

        resp = admin_app.post(
            "/models/iris/rollback",
            json={"version": "99"},
        )

        assert resp.status_code == 404
        assert "No deployment found" in resp.json()["detail"]

    def test_rollback_when_model_server_fails_should_return_502(
        self, admin_app, db_session
    ):
        seed_model_deployment(
            db_session,
            model_name="iris",
            version="1",
            is_active=False,
            mlflow_run_id="run-v1",
        )

        mock_client = _mock_async_client(
            post=AsyncMock(side_effect=Exception("Connection refused")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.post(
                "/models/iris/rollback",
                json={"version": "1"},
            )

        assert resp.status_code == 502
        assert "Failed to reload" in resp.json()["detail"]


class TestDeleteModel:
    """DELETE /models/{model_name}"""

    def test_delete_model_when_exists_should_deactivate_and_return_message(
        self, admin_app, db_session
    ):
        seed_model_deployment(db_session, model_name="iris", is_active=True)

        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(200, {"status": "unloaded"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.delete("/models/iris")

        assert resp.status_code == 200
        assert "unregistered" in resp.json()["message"].lower()

    def test_delete_model_when_model_server_fails_should_still_deactivate(
        self, admin_app, db_session
    ):
        seed_model_deployment(db_session, model_name="iris", is_active=True)

        mock_client = _mock_async_client(
            delete=AsyncMock(side_effect=Exception("Connection refused")),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.delete("/models/iris")

        assert resp.status_code == 200
        assert "unregistered" in resp.json()["message"].lower()

    def test_delete_model_when_no_deployments_should_still_return_200(self, admin_app):
        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(200, {"status": "ok"})),
        )

        with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
            resp = admin_app.delete("/models/nonexistent")

        assert resp.status_code == 200
