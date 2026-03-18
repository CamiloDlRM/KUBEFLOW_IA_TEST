"""Pipeline runner abstraction.

Provides an abstract PipelineRunner interface with concrete implementations
for Celery (production) and Kubernetes (future).
"""
from __future__ import annotations

from abc import ABC, abstractmethod

import structlog

from core.config import get_settings

logger = structlog.get_logger(__name__)


class PipelineRunner(ABC):
    """Abstract interface for executing ML pipelines."""

    @abstractmethod
    async def run(
        self,
        pipeline_id: str,
        repo_id: int,
        commit_sha: str,
    ) -> None:
        """Enqueue or launch a pipeline execution.

        Args:
            pipeline_id: UUID of the pipeline record.
            repo_id: Database ID of the associated repository.
            commit_sha: Git commit SHA that triggered the run.
        """
        ...

    @abstractmethod
    async def get_status(self, run_id: str) -> str:
        """Return the current status string for a pipeline run."""
        ...

    @abstractmethod
    async def cancel(self, run_id: str) -> bool:
        """Attempt to cancel a running pipeline. Returns True on success."""
        ...


class CeleryPipelineRunner(PipelineRunner):
    """Pipeline runner backed by Celery task queue."""

    async def run(
        self,
        pipeline_id: str,
        repo_id: int,
        commit_sha: str,
    ) -> None:
        """Send the pipeline task to the Celery worker queue."""
        from tasks.celery_tasks import run_pipeline

        run_pipeline.apply_async(
            args=[pipeline_id, repo_id, commit_sha],
            task_id=pipeline_id,
        )
        logger.info(
            "pipeline.enqueued",
            pipeline_id=pipeline_id,
            repo_id=repo_id,
            commit_sha=commit_sha,
            runner="celery",
        )

    async def get_status(self, run_id: str) -> str:
        """Check the Celery task state."""
        from tasks.celery_tasks import celery_app

        result = celery_app.AsyncResult(run_id)
        return str(result.state)

    async def cancel(self, run_id: str) -> bool:
        """Revoke the Celery task."""
        from tasks.celery_tasks import celery_app

        celery_app.control.revoke(run_id, terminate=True, signal="SIGTERM")
        logger.info("pipeline.cancelled", pipeline_id=run_id, runner="celery")
        return True


class KubernetesPipelineRunner(PipelineRunner):
    """Placeholder for a future Kubernetes-native pipeline runner."""

    async def run(
        self,
        pipeline_id: str,
        repo_id: int,
        commit_sha: str,
    ) -> None:
        raise NotImplementedError("Kubernetes runner not yet implemented.")

    async def get_status(self, run_id: str) -> str:
        raise NotImplementedError("Kubernetes runner not yet implemented.")

    async def cancel(self, run_id: str) -> bool:
        raise NotImplementedError("Kubernetes runner not yet implemented.")


def get_pipeline_runner() -> PipelineRunner:
    """Return the configured pipeline runner implementation.

    Reads ``RUNNER_BACKEND`` from settings. Defaults to ``celery``.
    """
    settings = get_settings()
    if settings.runner_backend == "kubernetes":
        return KubernetesPipelineRunner()
    return CeleryPipelineRunner()
