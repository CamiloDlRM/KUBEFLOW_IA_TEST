"""Tests for main.py -- health, readiness, lifespan, and exception handler.

Covers the /health and /ready endpoints, plus the global unhandled
exception handler.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx


class TestHealth:
    """GET /health"""

    def test_health_when_called_should_return_ok(self, test_app):
        resp = test_app.get("/health")

        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestReady:
    """GET /ready"""

    def _patch_ready(self, redis_ok=True, mlflow_status=200, model_status=200,
                     mlflow_exc=None, model_exc=None, redis_exc=None):
        """Return a context-manager stack that patches redis and httpx for /ready."""
        import contextlib

        @contextlib.contextmanager
        def _ctx():
            mock_redis_instance = MagicMock()
            if redis_exc:
                mock_redis_instance.ping.side_effect = redis_exc
            else:
                mock_redis_instance.ping.return_value = True

            responses = []
            if mlflow_exc:
                responses.append(mlflow_exc)
            else:
                responses.append(httpx.Response(mlflow_status, json={}))
            if model_exc:
                responses.append(model_exc)
            else:
                responses.append(httpx.Response(model_status, json={}))

            async def mock_get(url, **kwargs):
                item = responses.pop(0)
                if isinstance(item, Exception):
                    raise item
                return item

            with patch("redis.Redis.from_url", return_value=mock_redis_instance):
                with patch("httpx.AsyncClient") as mock_client_cls:
                    mock_client = AsyncMock()
                    mock_client.get = mock_get
                    mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
                    mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
                    yield

        return _ctx()

    def test_ready_when_all_services_up_should_return_ok(self, test_app):
        with self._patch_ready():
            resp = test_app.get("/ready")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["redis"] == "ok"
        assert data["mlflow"] == "ok"
        assert data["model_server"] == "ok"

    def test_ready_when_redis_down_should_return_degraded(self, test_app):
        with self._patch_ready(redis_exc=Exception("Connection refused")):
            resp = test_app.get("/ready")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "degraded"
        assert data["redis"] == "unreachable"

    def test_ready_when_mlflow_down_should_return_degraded(self, test_app):
        with self._patch_ready(mlflow_exc=Exception("unreachable")):
            resp = test_app.get("/ready")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "degraded"
        assert data["mlflow"] == "unreachable"

    def test_ready_when_model_server_unhealthy_should_return_degraded(self, test_app):
        with self._patch_ready(model_status=503):
            resp = test_app.get("/ready")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "degraded"
        assert data["model_server"] == "unhealthy"

    def test_ready_when_all_services_down_should_return_degraded(self, test_app):
        with self._patch_ready(
            redis_exc=Exception("down"),
            mlflow_exc=Exception("down"),
            model_exc=Exception("down"),
        ):
            resp = test_app.get("/ready")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "degraded"
        assert data["redis"] == "unreachable"
        assert data["mlflow"] == "unreachable"
        assert data["model_server"] == "unreachable"


class TestUnhandledException:
    """Global exception handler"""

    def test_unhandled_exception_when_endpoint_raises_should_return_500(self, test_app):
        from main import app
        from fastapi import APIRouter

        error_router = APIRouter()

        @error_router.get("/test-error")
        async def raise_error():
            raise RuntimeError("unexpected failure")

        app.include_router(error_router)

        resp = test_app.get("/test-error")

        assert resp.status_code == 500
        assert resp.json()["detail"] == "Internal server error."
