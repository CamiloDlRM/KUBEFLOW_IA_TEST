"""Celery task definitions for ML pipeline execution.

The main task ``run_pipeline`` orchestrates:
  1. Notebook download from GitHub
  2. Tag validation with nbformat
  3. Execution via papermill with injected parameters
  4. MLflow model registration
  5. Optional auto-deployment to the model-server

All state is stored in Redis (pipeline phases) and MLflow (model artifacts).
Database persistence uses ROBLE REST API via RobleClientSync.
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


def _get_roble_sync():
    """Create a RobleClientSync instance."""
    from core.roble_client import RobleClientSync

    return RobleClientSync(
        auth_base_url=settings.roble_auth_url,
        db_base_url=settings.roble_db_url,
        email=settings.roble_email,
        password=settings.roble_password,
    )


def _update_pipeline_db(
    pipeline_id: str,
    *,
    status: str | None = None,
    phases: list[dict[str, Any]] | None = None,
    metrics: dict[str, Any] | None = None,
    started_at: datetime | None = None,
    finished_at: datetime | None = None,
) -> None:
    """Update pipeline record in ROBLE via sync client."""
    roble = _get_roble_sync()

    updates: dict[str, Any] = {}
    if status is not None:
        updates["status"] = status
    if phases is not None:
        updates["phases"] = phases
    if metrics is not None:
        updates["metrics"] = metrics
    if started_at is not None:
        updates["started_at"] = started_at.isoformat()
    if finished_at is not None:
        updates["finished_at"] = finished_at.isoformat()

    if not updates:
        return

    # Find the pipeline by pipeline_uuid
    records = roble.read("pipelines", {"pipeline_uuid": pipeline_id})
    if not records:
        logger.error("pipeline.not_found_in_db", pipeline_id=pipeline_id)
        return

    roble_id = records[0]["_id"]
    roble.update("pipelines", "_id", roble_id, updates)


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
    repo_id: str,
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
        pipeline_id: UUID of the pipeline (pipeline_uuid).
        repo_id: ROBLE _id of the associated repository.
        commit_sha: Git commit SHA that triggered the run.

    Returns:
        Dict with final status and metrics.
    """
    import httpx
    import nbformat
    import papermill as pm

    from core.notebook_parser import validate_required_tags, extract_config

    log = logger.bind(pipeline_id=pipeline_id, repo_id=repo_id, commit_sha=commit_sha)
    phases: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {}

    roble = _get_roble_sync()

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
        _phase("download", "running", "Downloading notebook from GitHub...")
        log.info("pipeline.phase.download.start")

        repo = roble.read_one("repositories", "_id", repo_id)
        if not repo:
            raise ValueError(f"Repository {repo_id} not found.")

        # Sync download (we are in a Celery worker, not async)
        from core.github import parse_repo_url
        import base64

        owner, repo_name = parse_repo_url(repo["github_url"])
        token = settings.github_token or ""
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        }
        clean_nb_path = repo["notebook_path"].strip("/")
        if not clean_nb_path:
            raise ValueError(
                f"Repository {repo_id} has an empty notebook_path. "
                "A valid notebook_path is required (e.g. 'train.ipynb' or 'notebooks/train.ipynb')."
            )
        nb_url = (
            f"https://api.github.com/repos/{owner}/{repo_name}"
            f"/contents/{clean_nb_path}"
        )
        resp = httpx.get(
            nb_url,
            headers=headers,
            params={"ref": repo.get("branch", "main")},
            timeout=60,
            follow_redirects=True,
        )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ValueError(
                    f"Notebook not found at '{clean_nb_path}' in repo "
                    f"{owner}/{repo_name} (branch: {repo.get('branch', 'main')}). "
                    f"Check the notebook_path setting for repository {repo_id}."
                ) from exc
            raise
        nb_content = base64.b64decode(resp.json()["content"])
        notebook = json.loads(nb_content)
        _phase("download", "success", f"Notebook '{clean_nb_path}' downloaded successfully from {owner}/{repo_name}@{repo.get('branch', 'main')}")
        log.info("pipeline.phase.download.done")

        if _shutting_down:
            raise SystemExit("Worker shutting down")

        # Phase 2: Validate tags
        _phase("validate", "running", "Validating notebook tags and configuration...")
        log.info("pipeline.phase.validate.start")
        validate_required_tags(notebook)
        config = extract_config(notebook)
        model_name = config["model_name"]
        model_version = config["version"]
        _phase("validate", "success", f"Notebook validated. Model: {model_name} v{model_version}")
        log.info("pipeline.phase.validate.done", model_name=model_name)

        if _shutting_down:
            raise SystemExit("Worker shutting down")

        # Phase 3: Execute notebook with papermill
        _phase("execute", "running", "Executing notebook with papermill...")
        log.info("pipeline.phase.execute.start")

        import mlflow

        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, "input.ipynb")
            output_path = os.path.join(tmpdir, "output.ipynb")
            model_output_path = os.path.join(tmpdir, "model.joblib")

            # Write notebook to disk
            with open(input_path, "w") as f:
                json.dump(notebook, f)

            mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
            mlflow.set_experiment(f"mlops-{model_name}")

            # Guard: end any lingering active run
            if mlflow.active_run():
                log.warning(
                    "pipeline.mlflow.stale_run_cleanup",
                    stale_run_id=mlflow.active_run().info.run_id,
                )
                mlflow.end_run()

            mlflow_run = mlflow.start_run(run_name=f"{model_name}-{pipeline_id[:8]}")
            mlflow_run_id = mlflow_run.info.run_id

            client = mlflow.tracking.MlflowClient()
            client.set_tag(mlflow_run_id, "pipeline_id", pipeline_id)
            client.set_tag(mlflow_run_id, "commit_sha", commit_sha)
            client.set_tag(mlflow_run_id, "model_name", model_name)
            client.set_tag(mlflow_run_id, "version", model_version)

            log.info(
                "pipeline.mlflow_run.started",
                mlflow_run_id=mlflow_run_id,
            )

            pm.execute_notebook(
                input_path,
                output_path,
                parameters={
                    "MODEL_OUTPUT_PATH": model_output_path,
                    "PIPELINE_ID": pipeline_id,
                    "MLFLOW_TRACKING_URI": settings.mlflow_tracking_uri,
                    "MLFLOW_RUN_ID": mlflow_run_id,
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
            _phase("register", "running", "Registering model artifact in MLflow...")
            log.info("pipeline.phase.register.start")

            if os.path.exists(model_output_path):
                client.log_artifact(mlflow_run_id, model_output_path, artifact_path="model")
                log.info(
                    "pipeline.artifact.logged",
                    mlflow_run_id=mlflow_run_id,
                    artifact=model_output_path,
                )
            else:
                log.warning(
                    "pipeline.artifact.missing",
                    mlflow_run_id=mlflow_run_id,
                    expected_path=model_output_path,
                )

            # Read metrics that the notebook logged into this run
            try:
                run_data = client.get_run(mlflow_run_id).data
                metrics = dict(run_data.metrics)
            except Exception:
                metrics = {}

            accuracy = metrics.get("accuracy", 0.0)

            try:
                client.set_terminated(mlflow_run_id)
            except Exception:
                pass

            _phase("register", "success", f"Model registered in MLflow run {mlflow_run_id}. Accuracy: {accuracy:.4f}")
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
                _phase("deploy", "running", f"Deploying model '{model_name}' to model server...")
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

                    # Deactivate previous deployments of same model
                    prev = roble.read("model_deployments", {
                        "model_name": model_name,
                        "is_active": "true",
                    })
                    for p in prev:
                        roble.update("model_deployments", "_id", p["_id"], {"is_active": False})

                    # Save deployment record
                    roble.insert("model_deployments", [{
                        "model_name": model_name,
                        "version": model_version,
                        "accuracy": accuracy,
                        "endpoint_url": endpoint_url,
                        "deployed_at": datetime.now(timezone.utc).isoformat(),
                        "is_active": True,
                        "pipeline_id": pipeline_id,
                    }])

                    deployed = True
                    _phase("deploy", "success", f"Model deployed successfully. Endpoint: {endpoint_url}")
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
        _publish_phase(pipeline_id, "complete", "success", "Pipeline completed successfully.")
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
