"""Celery task definitions for ML pipeline execution.

The main task ``run_pipeline`` orchestrates:
  1. Notebook download from GitHub
  2. Tag validation with nbformat
  3. Execution via papermill with injected parameters
  4. MLflow model registration
  5. Optional auto-deployment to the model-server

All state is stored in Redis (pipeline phases) and MLflow (model artifacts).
"""
from __future__ import annotations

import json
import os
import signal
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import structlog
from celery import Celery
from celery.signals import worker_shutting_down

from core.config import get_settings

settings = get_settings()

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Celery application
# ---------------------------------------------------------------------------

celery_app = Celery(
    "mlops_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=86400,  # 24h TTL
    task_routes={
        "tasks.celery_tasks.run_pipeline": {"queue": "pipelines"},
    },
)

# ---------------------------------------------------------------------------
# Graceful SIGTERM handling
# ---------------------------------------------------------------------------

_shutting_down = False


@worker_shutting_down.connect
def _on_shutdown(**kwargs: Any) -> None:
    global _shutting_down
    _shutting_down = True
    logger.info("celery.worker_shutting_down")


# ---------------------------------------------------------------------------
# Redis helpers for pipeline state
# ---------------------------------------------------------------------------

def _get_redis():
    """Return a Redis client from the Celery broker URL."""
    import redis

    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def _publish_phase(
    pipeline_id: str,
    phase_name: str,
    status: str,
    logs: str = "",
) -> None:
    """Publish a pipeline phase update to Redis for WebSocket consumers."""
    r = _get_redis()
    payload = {
        "pipeline_id": pipeline_id,
        "phase": phase_name,
        "status": status,
        "logs": logs,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    r.publish(f"pipeline:{pipeline_id}:logs", json.dumps(payload))
    # Also store in a list for late joiners
    r.rpush(f"pipeline:{pipeline_id}:phases", json.dumps(payload))
    r.expire(f"pipeline:{pipeline_id}:phases", 86400)


def _update_pipeline_db(
    pipeline_id: str,
    *,
    status: str | None = None,
    phases: list[dict[str, Any]] | None = None,
    metrics: dict[str, Any] | None = None,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
) -> None:
    """Update pipeline record in SQLite via SQLModel (sync context)."""
    from sqlmodel import Session, create_engine, select
    from models.schemas import Pipeline

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as session:
        stmt = select(Pipeline).where(Pipeline.id == pipeline_id)
        pipeline = session.exec(stmt).first()
        if not pipeline:
            logger.error("pipeline.not_found_in_db", pipeline_id=pipeline_id)
            return
        if status is not None:
            pipeline.status = status
        if phases is not None:
            pipeline.phases = phases
        if metrics is not None:
            pipeline.metrics = metrics
        if started_at is not None:
            pipeline.started_at = started_at
        if finished_at is not None:
            pipeline.finished_at = finished_at
        session.add(pipeline)
        session.commit()


# ---------------------------------------------------------------------------
# Main pipeline task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    name="tasks.celery_tasks.run_pipeline",
    max_retries=1,
    default_retry_delay=30,
    acks_late=True,
)
def run_pipeline(
    self: Any,
    pipeline_id: str,
    repo_id: int,
    commit_sha: str,
) -> dict[str, Any]:
    """Execute a full ML pipeline for a given repository and commit.

    Steps:
        1. Download notebook from GitHub
        2. Validate required MLOps tags
        3. Execute notebook with papermill (injecting parameters)
        4. Register model in MLflow
        5. Auto-deploy if criteria met

    Args:
        pipeline_id: UUID of the pipeline record.
        repo_id: Repository database ID.
        commit_sha: Git commit SHA that triggered the run.

    Returns:
        Dict with final status and metrics.
    """
    import httpx
    import nbformat
    import papermill as pm

    from sqlmodel import Session, create_engine, select
    from models.schemas import Repository, ModelDeployment
    from core.notebook_parser import validate_required_tags, extract_config

    log = logger.bind(pipeline_id=pipeline_id, repo_id=repo_id, commit_sha=commit_sha)
    phases: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {}

    engine = create_engine(settings.database_url, echo=False)

    def _phase(name: str, status: str, logs: str = "") -> None:
        ts = datetime.now(timezone.utc).isoformat()
        entry = {"name": name, "status": status, "timestamp": ts, "logs": logs}
        phases.append(entry)
        _publish_phase(pipeline_id, name, status, logs)
        _update_pipeline_db(pipeline_id, phases=phases)

    try:
        # Mark running
        _update_pipeline_db(
            pipeline_id,
            status="running",
            started_at=datetime.now(timezone.utc),
        )

        # Phase 1: Download notebook
        _phase("download", "running")
        log.info("pipeline.phase.download.start")

        with Session(engine) as session:
            repo = session.exec(
                select(Repository).where(Repository.id == repo_id)
            ).first()
            if not repo:
                raise ValueError(f"Repository {repo_id} not found.")

        # Sync download (we are in a Celery worker, not async)
        from core.github import parse_repo_url
        import base64

        owner, repo_name = parse_repo_url(repo.github_url)
        token = settings.github_token or ""
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        }
        nb_url = (
            f"https://api.github.com/repos/{owner}/{repo_name}"
            f"/contents/{repo.notebook_path}"
        )
        resp = httpx.get(
            nb_url,
            headers=headers,
            params={"ref": repo.branch},
            timeout=60,
        )
        resp.raise_for_status()
        nb_content = base64.b64decode(resp.json()["content"])
        notebook = json.loads(nb_content)
        _phase("download", "success")
        log.info("pipeline.phase.download.done")

        if _shutting_down:
            raise SystemExit("Worker shutting down")

        # Phase 2: Validate tags
        _phase("validate", "running")
        log.info("pipeline.phase.validate.start")
        validate_required_tags(notebook)
        config = extract_config(notebook)
        model_name = config["model_name"]
        model_version = config["version"]
        _phase("validate", "success")
        log.info("pipeline.phase.validate.done", model_name=model_name)

        if _shutting_down:
            raise SystemExit("Worker shutting down")

        # Phase 3: Execute notebook with papermill
        _phase("execute", "running")
        log.info("pipeline.phase.execute.start")

        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, "input.ipynb")
            output_path = os.path.join(tmpdir, "output.ipynb")
            model_output_path = os.path.join(tmpdir, "model.joblib")

            # Write notebook to disk
            with open(input_path, "w") as f:
                json.dump(notebook, f)

            # Execute with papermill
            pm.execute_notebook(
                input_path,
                output_path,
                parameters={
                    "MODEL_OUTPUT_PATH": model_output_path,
                    "PIPELINE_ID": pipeline_id,
                    "MLFLOW_TRACKING_URI": settings.mlflow_tracking_uri,
                },
                cwd=tmpdir,
            )

            # Read output notebook for cell logs
            with open(output_path, "r") as f:
                output_nb = nbformat.read(f, as_version=4)

            cell_logs = []
            for i, cell in enumerate(output_nb.cells):
                if cell.cell_type == "code":
                    outputs_text = ""
                    for out in cell.get("outputs", []):
                        if "text" in out:
                            outputs_text += out["text"]
                        elif "data" in out and "text/plain" in out["data"]:
                            outputs_text += out["data"]["text/plain"]
                    cell_logs.append({"cell": i, "output": outputs_text[:2000]})

            _phase("execute", "success", json.dumps(cell_logs[:20]))
            log.info("pipeline.phase.execute.done")

            if _shutting_down:
                raise SystemExit("Worker shutting down")

            # Phase 4: Register in MLflow
            _phase("register", "running")
            log.info("pipeline.phase.register.start")

            import mlflow

            mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
            mlflow.set_experiment(f"mlops-{model_name}")

            with mlflow.start_run(run_name=f"{model_name}-{pipeline_id[:8]}") as run:
                mlflow.set_tag("pipeline_id", pipeline_id)
                mlflow.set_tag("commit_sha", commit_sha)
                mlflow.set_tag("model_name", model_name)
                mlflow.set_tag("version", model_version)

                # Log model artifact if it exists
                if os.path.exists(model_output_path):
                    mlflow.log_artifact(model_output_path, artifact_path="model")

                # Read metrics from output notebook (look for mlflow logged metrics)
                try:
                    client = mlflow.tracking.MlflowClient()
                    run_data = client.get_run(run.info.run_id).data
                    metrics = dict(run_data.metrics)
                except Exception:
                    metrics = {}

                accuracy = metrics.get("accuracy", 0.0)
                mlflow_run_id = run.info.run_id

            _phase("register", "success")
            log.info(
                "pipeline.phase.register.done",
                mlflow_run_id=mlflow_run_id,
                accuracy=accuracy,
            )

            # Phase 5: Auto-deploy
            deployed = False
            if (
                settings.auto_deploy_on_success
                and accuracy >= settings.min_accuracy_threshold
            ):
                _phase("deploy", "running")
                log.info("pipeline.phase.deploy.start", accuracy=accuracy)

                try:
                    deploy_resp = httpx.post(
                        f"{settings.model_server_url}/internal/load/{model_name}",
                        json={
                            "mlflow_run_id": mlflow_run_id,
                            "version": model_version,
                        },
                        timeout=120,
                    )
                    deploy_resp.raise_for_status()

                    endpoint_url = (
                        f"{settings.model_server_url}/predict/{model_name}"
                    )

                    # Save deployment record
                    with Session(engine) as session:
                        # Deactivate previous deployments of same model
                        from sqlmodel import select as sel
                        prev = session.exec(
                            sel(ModelDeployment).where(
                                ModelDeployment.model_name == model_name,
                                ModelDeployment.is_active == True,
                            )
                        ).all()
                        for p in prev:
                            p.is_active = False
                            session.add(p)

                        deployment = ModelDeployment(
                            model_name=model_name,
                            version=model_version,
                            accuracy=accuracy,
                            endpoint_url=endpoint_url,
                            is_active=True,
                            pipeline_id=pipeline_id,
                        )
                        session.add(deployment)
                        session.commit()

                    deployed = True
                    _phase("deploy", "success")
                    log.info("pipeline.phase.deploy.done", endpoint_url=endpoint_url)
                except Exception as exc:
                    _phase("deploy", "failed", str(exc))
                    log.warning("pipeline.phase.deploy.failed", error=str(exc))
            else:
                reason = "auto_deploy disabled" if not settings.auto_deploy_on_success else f"accuracy {accuracy} < {settings.min_accuracy_threshold}"
                log.info("pipeline.deploy.skipped", reason=reason)

        # Mark success
        metrics["deployed"] = deployed
        _update_pipeline_db(
            pipeline_id,
            status="success",
            phases=phases,
            metrics=metrics,
            finished_at=datetime.now(timezone.utc),
        )
        _publish_phase(pipeline_id, "complete", "success")
        log.info("pipeline.completed", metrics=metrics)
        return {"status": "success", "metrics": metrics}

    except SystemExit:
        _update_pipeline_db(
            pipeline_id,
            status="failed",
            phases=phases,
            finished_at=datetime.now(timezone.utc),
        )
        _publish_phase(pipeline_id, "shutdown", "failed", "Worker shutting down")
        log.warning("pipeline.interrupted_by_shutdown")
        return {"status": "failed", "reason": "worker_shutdown"}

    except Exception as exc:
        log.exception("pipeline.failed", error=str(exc))
        _phase("error", "failed", str(exc))
        _update_pipeline_db(
            pipeline_id,
            status="failed",
            phases=phases,
            metrics=metrics,
            finished_at=datetime.now(timezone.utc),
        )
        return {"status": "failed", "error": str(exc)}
