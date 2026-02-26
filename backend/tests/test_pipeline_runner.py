"""Tests for core/pipeline.py -- PipelineRunner implementations.

Covers CeleryPipelineRunner.run/get_status/cancel,
KubernetesPipelineRunner (NotImplementedError), and get_pipeline_runner factory.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.pipeline import (
    CeleryPipelineRunner,
    KubernetesPipelineRunner,
    get_pipeline_runner,
)


class TestCeleryPipelineRunner:
    """CeleryPipelineRunner methods."""

    @pytest.mark.asyncio
    async def test_run_when_called_should_apply_async_to_celery(self):
        runner = CeleryPipelineRunner()
        mock_task = MagicMock()
        mock_task.apply_async = MagicMock()

        with patch("core.pipeline.CeleryPipelineRunner.run.__module__", "core.pipeline"):
            with patch(
                "tasks.celery_tasks.run_pipeline", mock_task
            ):
                await runner.run("pid-123", 1, "abc123")

        mock_task.apply_async.assert_called_once_with(
            args=["pid-123", 1, "abc123"],
            task_id="pid-123",
        )

    @pytest.mark.asyncio
    async def test_get_status_when_called_should_return_celery_state(self):
        runner = CeleryPipelineRunner()
        mock_result = MagicMock()
        mock_result.state = "SUCCESS"
        mock_app = MagicMock()
        mock_app.AsyncResult.return_value = mock_result

        with patch("tasks.celery_tasks.celery_app", mock_app):
            status = await runner.get_status("pid-123")

        assert status == "SUCCESS"
        mock_app.AsyncResult.assert_called_once_with("pid-123")

    @pytest.mark.asyncio
    async def test_cancel_when_called_should_revoke_celery_task(self):
        runner = CeleryPipelineRunner()
        mock_app = MagicMock()

        with patch("tasks.celery_tasks.celery_app", mock_app):
            result = await runner.cancel("pid-123")

        assert result is True
        mock_app.control.revoke.assert_called_once_with(
            "pid-123", terminate=True, signal="SIGTERM"
        )


class TestKubernetesPipelineRunner:
    """KubernetesPipelineRunner -- all methods raise NotImplementedError."""

    @pytest.mark.asyncio
    async def test_run_when_called_should_raise_not_implemented(self):
        runner = KubernetesPipelineRunner()
        with pytest.raises(NotImplementedError, match="Kubernetes runner"):
            await runner.run("pid", 1, "sha")

    @pytest.mark.asyncio
    async def test_get_status_when_called_should_raise_not_implemented(self):
        runner = KubernetesPipelineRunner()
        with pytest.raises(NotImplementedError):
            await runner.get_status("pid")

    @pytest.mark.asyncio
    async def test_cancel_when_called_should_raise_not_implemented(self):
        runner = KubernetesPipelineRunner()
        with pytest.raises(NotImplementedError):
            await runner.cancel("pid")


class TestGetPipelineRunner:
    """get_pipeline_runner() factory."""

    def test_get_pipeline_runner_when_celery_backend_should_return_celery_runner(self):
        from core.config import AppSettings

        fake_settings = AppSettings(runner_backend="celery")
        with patch("core.pipeline.get_settings", return_value=fake_settings):
            runner = get_pipeline_runner()

        assert isinstance(runner, CeleryPipelineRunner)

    def test_get_pipeline_runner_when_kubernetes_backend_should_return_k8s_runner(self):
        from core.config import AppSettings

        fake_settings = AppSettings(runner_backend="kubernetes")
        with patch("core.pipeline.get_settings", return_value=fake_settings):
            runner = get_pipeline_runner()

        assert isinstance(runner, KubernetesPipelineRunner)
