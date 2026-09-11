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
from celery.signals import worker_process_init, worker_shutting_down

from core.config import get_settings
from core.metrics import (
    pipeline_finished,
    pipeline_started,
    record_advisor_analysis,
    record_pipeline_phase,
    record_pipeline_run,
    start_worker_metrics_server,
)

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
# Prometheus exporter bootstrap
# ---------------------------------------------------------------------------

@worker_process_init.connect
def _on_worker_process_init(**kwargs: Any) -> None:
    """Start the Prometheus exporter inside each forked worker child.

    ``worker_process_init`` (not ``celeryd_init``) is used on purpose: with the
    prefork pool the tasks — and therefore the counters — live in the *child*
    processes, so an exporter started in the parent would serve an empty
    registry. Every child races for port 9100; the first one wins and the rest
    log a warning (see ``start_worker_metrics_server``).
    """
    try:
        start_worker_metrics_server()
    except Exception as exc:  # noqa: BLE001 — instrumentation is best-effort
        logger.warning("metrics.worker_exporter_bootstrap_failed", error=str(exc))


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
    """Update pipeline record in the database via SQLModel (sync context)."""
    from sqlmodel import Session, select
    from models.schemas import Pipeline
    from db import engine

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


def _download_notebook_for_analysis(repo: Any, ref: str) -> dict[str, Any]:
    """Fetch the repo's training notebook from GitHub at a given ref."""
    import base64

    import httpx

    from core.github import parse_repo_url

    owner, repo_name = parse_repo_url(repo.github_url)
    headers = {
        "Authorization": f"Bearer {settings.github_token or ''}",
        "Accept": "application/vnd.github+json",
    }
    clean_nb_path = repo.notebook_path.strip("/")
    nb_url = (
        f"https://api.github.com/repos/{owner}/{repo_name}"
        f"/contents/{clean_nb_path}"
    )
    resp = httpx.get(
        nb_url,
        headers=headers,
        params={"ref": ref},
        timeout=60,
        follow_redirects=True,
    )
    resp.raise_for_status()
    return json.loads(base64.b64decode(resp.json()["content"]))


def _enqueue_analysis(pipeline_id: str) -> None:
    """Create an insight record and queue the AI analysis task."""
    from core.ai_advisor import advisor_configured

    if not advisor_configured(settings):
        logger.info("ai_advisor.skipped", pipeline_id=pipeline_id)
        record_advisor_analysis(settings.ai_advisor_provider, "skipped")
        return

    try:
        from sqlmodel import Session, create_engine
        from models.schemas import PipelineInsight

        engine = create_engine(settings.database_url, echo=False)
        with Session(engine) as session:
            insight = PipelineInsight(pipeline_id=pipeline_id, status="pending")
            session.add(insight)
            session.commit()
            session.refresh(insight)
            insight_id = insight.id

        analyze_pipeline.apply_async(args=[pipeline_id, insight_id])
        logger.info(
            "ai_advisor.enqueued", pipeline_id=pipeline_id, insight_id=insight_id
        )
    except Exception as exc:
        # The advisor is best-effort: never fail the pipeline because of it.
        logger.warning("ai_advisor.enqueue_failed", pipeline_id=pipeline_id, error=str(exc))


# ---------------------------------------------------------------------------
# AI analysis task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    name="tasks.celery_tasks.analyze_pipeline",
    max_retries=1,
    default_retry_delay=30,
)
def analyze_pipeline(self: Any, pipeline_id: str, insight_id: int) -> dict[str, Any]:
    """Generate AI feedback for a finished pipeline run.

    Gathers the run's metrics/phases, the notebook source at the run's commit,
    and the metric history of previous runs on the same repo, then asks Claude
    for improvement recommendations and stores the Markdown report.
    """
    from sqlmodel import Session, create_engine, select
    from models.schemas import Pipeline, PipelineInsight, Repository

    from core.ai_advisor import generate_insight

    log = logger.bind(pipeline_id=pipeline_id, insight_id=insight_id)
    engine = create_engine(settings.database_url, echo=False)
    advisor_started_at = time.perf_counter()

    def _update_insight(**fields: Any) -> None:
        with Session(engine) as session:
            insight = session.get(PipelineInsight, insight_id)
            if not insight:
                return
            for key, value in fields.items():
                setattr(insight, key, value)
            session.add(insight)
            session.commit()

    try:
        from core.ai_advisor import advisor_label

        _update_insight(status="generating", model=advisor_label(settings))

        with Session(engine) as session:
            pipeline = session.get(Pipeline, pipeline_id)
            if not pipeline:
                raise ValueError(f"Pipeline {pipeline_id} not found.")
            repo = session.get(Repository, pipeline.repo_id)
            if not repo:
                raise ValueError(f"Repository {pipeline.repo_id} not found.")

            history = session.exec(
                select(Pipeline)
                .where(
                    Pipeline.repo_id == pipeline.repo_id,
                    Pipeline.id != pipeline_id,
                )
                .order_by(Pipeline.started_at.desc())  # type: ignore[union-attr]
                .limit(10)
            ).all()
            history_data = [
                {
                    "id": h.id,
                    "status": h.status,
                    "metrics": h.metrics,
                    "finished_at": h.finished_at.isoformat() if h.finished_at else None,
                }
                for h in history
            ]
            pipeline_data = {
                "status": pipeline.status,
                "metrics": pipeline.metrics,
                "phases": pipeline.phases,
                "commit_sha": pipeline.commit_sha,
            }

        notebook = _download_notebook_for_analysis(
            repo, pipeline_data["commit_sha"] or repo.branch
        )

        report = generate_insight(
            notebook=notebook,
            status=pipeline_data["status"],
            metrics=pipeline_data["metrics"],
            phases=pipeline_data["phases"],
            history=history_data,
            commit_sha=pipeline_data["commit_sha"] or "HEAD",
        )

        _update_insight(
            status="ready",
            content=report,
            finished_at=datetime.now(timezone.utc),
        )
        log.info("ai_advisor.completed", report_chars=len(report))
        record_advisor_analysis(
            settings.ai_advisor_provider,
            "success",
            time.perf_counter() - advisor_started_at,
        )
        return {"status": "ready"}

    except Exception as exc:
        log.exception("ai_advisor.failed", error=str(exc))
        _update_insight(
            status="failed",
            error=str(exc),
            finished_at=datetime.now(timezone.utc),
        )
        record_advisor_analysis(
            settings.ai_advisor_provider,
            "failed",
            time.perf_counter() - advisor_started_at,
        )
        return {"status": "failed", "error": str(exc)}


# ---------------------------------------------------------------------------
# Apply-suggestions task (AI pushes an improved notebook to a branch)
# ---------------------------------------------------------------------------

AI_BRANCH_NAME = "testing-ia-agent"


@celery_app.task(
    bind=True,
    name="tasks.celery_tasks.apply_insight",
    max_retries=0,
)
def apply_insight(self: Any, pipeline_id: str, insight_id: int) -> dict[str, Any]:
    """Apply an insight's recommendations to the notebook and push them.

    The configured LLM rewrites the affected notebook cells based on the
    stored feedback report; the result is committed to the
    ``testing-ia-agent`` branch (created from the run's branch, or reset to
    it if it already exists) so the user can review the diff and launch a
    pipeline from that branch.
    """
    from sqlmodel import Session, create_engine

    from core.ai_advisor import generate_improved_notebook
    from core.github import commit_file, get_branch_head, upsert_branch
    from models.schemas import Pipeline, PipelineInsight, Repository

    log = logger.bind(pipeline_id=pipeline_id, insight_id=insight_id)
    engine = create_engine(settings.database_url, echo=False)

    def _update_insight(**fields: Any) -> None:
        with Session(engine) as session:
            insight = session.get(PipelineInsight, insight_id)
            if not insight:
                return
            for key, value in fields.items():
                setattr(insight, key, value)
            session.add(insight)
            session.commit()

    try:
        _update_insight(apply_status="applying", apply_error="")

        with Session(engine) as session:
            insight = session.get(PipelineInsight, insight_id)
            if not insight or insight.status != "ready" or not insight.content:
                raise ValueError("Insight is not ready; nothing to apply.")
            pipeline = session.get(Pipeline, pipeline_id)
            if not pipeline:
                raise ValueError(f"Pipeline {pipeline_id} not found.")
            repo = session.get(Repository, pipeline.repo_id)
            if not repo:
                raise ValueError(f"Repository {pipeline.repo_id} not found.")
            report = insight.content
            base_branch = pipeline.branch or repo.branch
            commit_ref = pipeline.commit_sha or base_branch

        token = settings.github_token
        if not token:
            raise ValueError("GITHUB_TOKEN is not configured; cannot push.")

        # 1. Notebook as it was for this run
        notebook = _download_notebook_for_analysis(repo, commit_ref)

        # 2. LLM applies the report's recommendations
        patched, commit_message = generate_improved_notebook(
            notebook=notebook, report=report
        )

        # 3. Create/reset the AI branch from the run's base branch and push
        base_sha = get_branch_head(repo.github_url, token, base_branch)
        upsert_branch(repo.github_url, token, AI_BRANCH_NAME, base_sha)
        commit_sha = commit_file(
            repo.github_url,
            token,
            AI_BRANCH_NAME,
            repo.notebook_path,
            json.dumps(patched, indent=1, ensure_ascii=False).encode("utf-8"),
            f"{commit_message}\n\nGenerado por el AI Training Advisor "
            f"(insight #{insight_id}, pipeline {pipeline_id[:8]})",
        )

        _update_insight(
            apply_status="pushed",
            apply_branch=AI_BRANCH_NAME,
            apply_commit_sha=commit_sha,
        )
        log.info("ai_advisor.apply.pushed", branch=AI_BRANCH_NAME, commit_sha=commit_sha)
        return {"status": "pushed", "branch": AI_BRANCH_NAME, "commit_sha": commit_sha}

    except Exception as exc:
        log.exception("ai_advisor.apply.failed", error=str(exc))
        _update_insight(apply_status="failed", apply_error=str(exc))
        return {"status": "failed", "error": str(exc)}


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

    from sqlmodel import Session, select
    from models.schemas import Dataset, Pipeline, Repository, ModelDeployment
    from core.notebook_parser import validate_required_tags, extract_config
    from db import engine

    log = logger.bind(pipeline_id=pipeline_id, repo_id=repo_id, commit_sha=commit_sha)
    phases: list[dict[str, Any]] = []
    metrics: dict[str, Any] = {}

    # --- Prometheus instrumentation (best-effort, never fails the run) ---
    run_started_at = time.perf_counter()
    phase_started_at: dict[str, float] = {}
    pipeline_started()

    def _record_phase_metric(name: str, status: str) -> None:
        """Record phase counters/duration without ever raising."""
        try:
            if status == "running":
                phase_started_at[name] = time.perf_counter()
                return
            started = phase_started_at.pop(name, None)
            duration = None if started is None else time.perf_counter() - started
            record_pipeline_phase(name, status, duration)
        except Exception as exc:  # noqa: BLE001 — instrumentation is best-effort
            log.warning("metrics.phase_record_failed", phase=name, error=str(exc))

    def _phase(name: str, status: str, logs: str = "") -> None:
        ts = datetime.now(timezone.utc).isoformat()
        entry = {"name": name, "status": status, "timestamp": ts, "logs": logs}
        phases.append(entry)
        _record_phase_metric(name, status)
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

        with Session(engine) as session:
            repo = session.exec(
                select(Repository).where(Repository.id == repo_id)
            ).first()
            if not repo:
                raise ValueError(f"Repository {repo_id} not found.")
            pipeline_row = session.get(Pipeline, pipeline_id)
            run_branch = (pipeline_row.branch if pipeline_row else "") or repo.branch

        # Sync download (we are in a Celery worker, not async)
        from core.github import parse_repo_url
        import base64

        owner, repo_name = parse_repo_url(repo.github_url)
        token = settings.github_token or ""
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        }
        # Sanitise notebook_path: strip leading/trailing slashes to avoid
        # double-slash in the URL (e.g. /contents//?ref=main).
        clean_nb_path = repo.notebook_path.strip("/")
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
            params={"ref": run_branch},
            timeout=60,
            follow_redirects=True,
        )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise ValueError(
                    f"Notebook not found at '{clean_nb_path}' in repo "
                    f"{owner}/{repo_name} (branch: {run_branch}). "
                    f"Check the notebook_path setting for repository {repo_id}."
                ) from exc
            raise
        nb_content = base64.b64decode(resp.json()["content"])
        notebook = json.loads(nb_content)
        _phase("download", "success", f"Notebook '{clean_nb_path}' downloaded successfully from {owner}/{repo_name}@{run_branch}")
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

            # Phase 3a: Mount the repository's active dataset (if any).
            # The dataset is downloaded from MinIO into this same temporary
            # directory and its local path is injected as DATASET_PATH, so the
            # notebook never handles S3 credentials.
            dataset_path: str | None = None
            _phase("dataset", "running", "Looking up the repository's active dataset...")

            with Session(engine) as session:
                active_dataset = session.exec(
                    select(Dataset)
                    .where(
                        Dataset.repo_id == repo_id,
                        Dataset.is_active == True,  # noqa: E712
                    )
                    .order_by(Dataset.created_at.desc())  # type: ignore[union-attr]
                ).first()
                dataset_info: dict[str, Any] | None = (
                    {
                        "id": active_dataset.id,
                        "name": active_dataset.name,
                        "bucket": active_dataset.bucket,
                        "object_key": active_dataset.object_key,
                        "size_bytes": active_dataset.size_bytes,
                    }
                    if active_dataset
                    else None
                )

            if dataset_info:
                from core.storage import download_to_path, sanitize_filename

                dataset_dir = os.path.join(tmpdir, "dataset")
                os.makedirs(dataset_dir, exist_ok=True)
                dataset_path = os.path.join(
                    dataset_dir, sanitize_filename(dataset_info["name"] or "dataset")
                )
                try:
                    download_to_path(
                        dataset_info["bucket"], dataset_info["object_key"], dataset_path
                    )
                except Exception as exc:
                    message = (
                        f"Failed to download dataset '{dataset_info['name']}' "
                        f"(id={dataset_info['id']}, "
                        f"s3://{dataset_info['bucket']}/{dataset_info['object_key']}): {exc}"
                    )
                    _phase("dataset", "failed", message)
                    log.error(
                        "pipeline.phase.dataset.failed",
                        dataset_id=dataset_info["id"],
                        error=str(exc),
                    )
                    raise ValueError(message) from exc

                _phase(
                    "dataset",
                    "success",
                    f"Dataset '{dataset_info['name']}' (id={dataset_info['id']}, "
                    f"{dataset_info['size_bytes']} bytes) mounted at {dataset_path}. "
                    "Injected as papermill parameter DATASET_PATH.",
                )
                log.info(
                    "pipeline.phase.dataset.mounted",
                    dataset_id=dataset_info["id"],
                    dataset_path=dataset_path,
                )
            else:
                _phase(
                    "dataset",
                    "success",
                    "No active dataset for this repository; "
                    "DATASET_PATH was not injected.",
                )
                log.info("pipeline.phase.dataset.none", repo_id=repo_id)

            # Start the MLflow run BEFORE papermill so the notebook logs
            # metrics into this same run (avoids the 0.0 accuracy bug).
            #
            # IMPORTANT: We use MlflowClient for all post-papermill
            # operations (log_artifact, set_tag, get_run) because the
            # notebook's `with mlflow.start_run(run_id=...)` block calls
            # mlflow.end_run() when it exits, which closes our active run.
            # MlflowClient operates by run_id directly and does not depend
            # on an active run context.
            mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
            mlflow.set_experiment(f"mlops-{model_name}")

            # Guard: end any lingering active run left by a previous task
            # in this reused worker process (Celery forks share global state).
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

            # Execute with papermill — pass run_id so the notebook
            # logs metrics into the same MLflow run.
            parameters: dict[str, Any] = {
                "MODEL_OUTPUT_PATH": model_output_path,
                "PIPELINE_ID": pipeline_id,
                "MLFLOW_TRACKING_URI": settings.mlflow_tracking_uri,
                "MLFLOW_RUN_ID": mlflow_run_id,
            }
            # Only injected when the repository has an active dataset, so
            # notebooks without a DATASET_PATH parameter keep working.
            if dataset_path:
                parameters["DATASET_PATH"] = dataset_path

            pm.execute_notebook(
                input_path,
                output_path,
                parameters=parameters,
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
            # Re-use the run that was started before papermill — the
            # notebook already logged metrics (accuracy, etc.) into it.
            _phase("register", "running", "Registering model artifact in MLflow...")
            log.info("pipeline.phase.register.start")

            # Log model artifact via MlflowClient (run_id-based, does not
            # require an active run context — safe after papermill ends the
            # run the notebook opened with `with mlflow.start_run()`).
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

            # Ensure the MLflow run is terminated (no-op if already ended
            # by the notebook).
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
                            mlflow_run_id=mlflow_run_id,
                            is_active=True,
                            pipeline_id=pipeline_id,
                        )
                        session.add(deployment)
                        session.commit()

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
        record_pipeline_run("success", time.perf_counter() - run_started_at)
        _enqueue_analysis(pipeline_id)
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
        record_pipeline_run("failed", time.perf_counter() - run_started_at)
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
        record_pipeline_run("failed", time.perf_counter() - run_started_at)
        _enqueue_analysis(pipeline_id)
        return {"status": "failed", "error": str(exc)}

    finally:
        pipeline_finished()


# ---------------------------------------------------------------------------
# Ingestion
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="tasks.celery_tasks.run_ingestion",
    max_retries=0,
    default_retry_delay=60,
)
def run_ingestion(self: Any, source_id: int, run_id: str) -> dict[str, Any]:
    """Extract the unseen slice of a data source and land it as a dataset.

    The result is an ordinary ``Dataset`` in MinIO, so everything downstream —
    the pipeline mounting it as ``DATASET_PATH``, the notebook reading it — is
    unchanged. The ingestion adds a step in front of the existing machinery
    rather than a parallel path beside it.

    No retries. An extraction is not idempotent from the caller's point of
    view: a retry after a partial upload would land a second dataset covering
    an overlapping slice, and duplicated training rows are harder to notice
    than a failed run. Failures are recorded on the run and re-queued by hand.

    Args:
        source_id: The source to extract from.
        run_id: The ``IngestionRun`` recording this attempt.
    """
    from sqlmodel import Session, create_engine, select

    from core import storage
    from core.ingestion import IngestionError, extract
    from models.schemas import DataSource, Dataset, IngestionRun

    log = logger.bind(source_id=source_id, run_id=run_id)
    engine = create_engine(settings.database_url, echo=False)
    started = datetime.now(timezone.utc)

    def _update_run(**fields: Any) -> None:
        with Session(engine) as session:
            run = session.get(IngestionRun, run_id)
            if not run:
                return
            for key, value in fields.items():
                setattr(run, key, value)
            session.add(run)
            session.commit()

    try:
        _update_run(status="running", started_at=started)

        with Session(engine) as session:
            source = session.get(DataSource, source_id)
            if not source:
                raise IngestionError(f"data source {source_id} no longer exists")
            # Detach a copy: the extraction is long, and holding a session open
            # across it would pin a connection for its whole duration.
            snapshot = DataSource(**source.model_dump())

        with tempfile.TemporaryDirectory() as tmpdir:
            destination = Path(tmpdir) / f"ingestion-{run_id}.csv"
            result = extract(snapshot, destination)

            if result.rows == 0:
                # Not a failure: an incremental run with nothing new is the
                # expected steady state. No dataset is produced, and crucially
                # the watermark is left where it was so a row entered later
                # with an earlier timestamp is still picked up.
                _update_run(
                    status="success",
                    finished_at=datetime.now(timezone.utc),
                    rows_extracted=0,
                    watermark_before=result.watermark_before,
                    watermark_after=result.watermark_after,
                )
                log.info("ingestion.no_new_rows")
                return {"status": "success", "rows": 0}

            assert result.path is not None
            size_bytes = result.path.stat().st_size
            digest = _sha256_of(result.path)

            filename = f"{_slug(snapshot.name) or 'ingestion'}-{started:%Y%m%dT%H%M%S}.csv"
            bucket = settings.minio_bucket_datasets
            object_key = storage.build_dataset_key(snapshot.repo_id, filename)

            with result.path.open("rb") as handle:
                storage.upload_fileobj(bucket, object_key, handle, "text/csv")

        with Session(engine) as session:
            dataset = Dataset(
                repo_id=snapshot.repo_id,
                name=filename,
                description=(
                    f"Ingested from {snapshot.name!r}: {result.rows:,} rows "
                    f"recorded after {result.watermark_before}."
                ),
                bucket=bucket,
                object_key=object_key,
                content_type="text/csv",
                size_bytes=size_bytes,
                checksum=digest,
                is_active=True,
            )
            # One active dataset per repository, same rule as an upload.
            for other in session.exec(
                select(Dataset).where(
                    Dataset.repo_id == snapshot.repo_id,
                    Dataset.is_active == True,  # noqa: E712
                )
            ).all():
                other.is_active = False
                session.add(other)
            session.add(dataset)
            session.commit()
            session.refresh(dataset)

            # The watermark advances only now, after the rows are durably in
            # object storage. Advancing it earlier would skip the slice on the
            # next run if the upload failed — losing data silently, which is
            # the failure mode this whole design is built to avoid.
            source = session.get(DataSource, source_id)
            if source:
                source.watermark_value = result.watermark_after
                session.add(source)

            run = session.get(IngestionRun, run_id)
            if run:
                run.status = "success"
                run.finished_at = datetime.now(timezone.utc)
                run.rows_extracted = result.rows
                run.watermark_before = result.watermark_before
                run.watermark_after = result.watermark_after
                run.dataset_id = dataset.id
                run.profile = result.profile
                session.add(run)
            session.commit()

        log.info(
            "ingestion.completed",
            rows=result.rows,
            dataset_id=dataset.id,
            watermark_after=result.watermark_after,
        )
        return {"status": "success", "rows": result.rows, "dataset_id": dataset.id}

    except Exception as exc:  # noqa: BLE001 — recorded on the run
        log.error("ingestion.failed", error=str(exc))
        _update_run(
            status="failed",
            finished_at=datetime.now(timezone.utc),
            error=str(exc)[:2000],
        )
        return {"status": "failed", "error": str(exc)}


def _sha256_of(path: Path) -> str:
    """Checksum a file without reading it all into memory."""
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1_048_576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _slug(value: str) -> str:
    """Reduce a source name to something safe inside a filename."""
    import re

    return re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-").lower()[:40]
