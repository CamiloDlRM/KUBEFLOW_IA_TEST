"""Tests for the model-server endpoints.

Covers model loading, prediction, unloading, and listing.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch


class TestLoadModel:
    """POST /internal/load/{model_name}"""

    def test_load_model_when_valid_run_id_should_load_into_memory(
        self,
        model_server_client,
    ):
        mock_client_instance = MagicMock()
        mock_client_instance.download_artifacts.return_value = "/tmp/test-models/model.joblib"

        mock_model = MagicMock()
        mock_model.predict.return_value = [0]

        mock_path_instance = MagicMock()
        mock_path_instance.is_dir.return_value = False

        with (
            patch("mlflow.set_tracking_uri"),
            patch("mlflow.tracking.MlflowClient", return_value=mock_client_instance),
            patch("joblib.load", return_value=mock_model),
            patch("pathlib.Path", return_value=mock_path_instance),
        ):
            resp = model_server_client.post(
                "/internal/load/test-model",
                json={"mlflow_run_id": "run-abc123", "version": "1"},
            )

        assert resp.status_code == 200
        assert "loaded successfully" in resp.json()["message"]

    def test_load_model_when_mlflow_fails_should_return_500(
        self,
        model_server_client,
    ):
        mock_client_instance = MagicMock()
        mock_client_instance.download_artifacts.side_effect = Exception("MLflow down")

        with (
            patch("mlflow.set_tracking_uri"),
            patch("mlflow.tracking.MlflowClient", return_value=mock_client_instance),
        ):
            resp = model_server_client.post(
                "/internal/load/broken-model",
                json={"mlflow_run_id": "run-fail", "version": "1"},
            )

        assert resp.status_code == 500
        assert "Failed to load model" in resp.json()["detail"]


class TestPredict:
    """POST /predict/{model_name}"""

    def test_predict_when_model_loaded_should_return_predictions(
        self,
        model_server_client,
        loaded_model,
    ):
        resp = model_server_client.post(
            "/predict/test-model",
            json={"data": [[5.1, 3.5, 1.4, 0.2]]},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["prediction"] == [0, 1, 2]
        assert data["model_name"] == "test-model"
        assert data["version"] == "1"

    def test_predict_when_model_not_found_should_return_404(
        self,
        model_server_client,
    ):
        resp = model_server_client.post(
            "/predict/nonexistent-model",
            json={"data": [[1.0, 2.0, 3.0, 4.0]]},
        )

        assert resp.status_code == 404
        assert "not loaded" in resp.json()["detail"]

    def test_predict_when_model_fails_should_return_500(
        self,
        model_server_client,
        loaded_model,
        mock_model,
    ):
        mock_model.predict.side_effect = ValueError("Shape mismatch")

        resp = model_server_client.post(
            "/predict/test-model",
            json={"data": [[1.0]]},
        )

        assert resp.status_code == 500
        assert "Prediction failed" in resp.json()["detail"]


class TestUnloadModel:
    """DELETE /models/{model_name}"""

    def test_unload_model_when_exists_should_remove_from_memory(
        self,
        model_server_client,
        loaded_model,
    ):
        resp = model_server_client.delete("/models/test-model")

        assert resp.status_code == 200
        assert "unloaded" in resp.json()["message"]

        # Verify it is gone
        resp2 = model_server_client.get("/models")
        assert resp2.status_code == 200
        assert len(resp2.json()) == 0

    def test_unload_model_when_not_found_should_return_404(
        self,
        model_server_client,
    ):
        resp = model_server_client.delete("/models/nonexistent")

        assert resp.status_code == 404


class TestListModels:
    """GET /models"""

    def test_list_models_when_models_loaded_should_return_all(
        self,
        model_server_client,
        loaded_model,
    ):
        resp = model_server_client.get("/models")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["model_name"] == "test-model"
        assert data[0]["version"] == "1"
        assert data[0]["mlflow_run_id"] == "run-abc123"

    def test_list_models_when_empty_should_return_empty_list(
        self,
        model_server_client,
    ):
        resp = model_server_client.get("/models")

        assert resp.status_code == 200
        assert resp.json() == []


class TestHealthEndpoints:
    """GET /health and /ready"""

    def test_health_should_return_ok(self, model_server_client):
        resp = model_server_client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_ready_when_no_models_should_return_no_models(self, model_server_client):
        resp = model_server_client.get("/ready")
        assert resp.status_code == 200
        assert resp.json()["status"] == "no_models"
        assert resp.json()["models_loaded"] == 0

    def test_ready_when_models_loaded_should_return_ok(
        self, model_server_client, loaded_model
    ):
        resp = model_server_client.get("/ready")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
        assert resp.json()["models_loaded"] == 1
