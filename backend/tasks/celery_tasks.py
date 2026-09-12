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
    """Extract the unseen slice of a data source and carry it through the layers.

    One run walks the medallion end to end: the rows land in **bronze** exactly
    as the source gave them, are promoted to **silver** by the cleaning
    standard, and the silver object is registered as the repository's dataset
    so everything downstream — the pipeline mounting it as ``DATASET_PATH``,
    the notebook reading it — is unchanged.

    Bronze is uploaded *before* silver is built. The extraction is the only
    irreversible part of this, because the watermark moves past those rows; if
    the cleaning then fails, the rows must still be recoverable. Doing it the
    other way round would mean a bug in a cleaning rule could lose data that
    the source will never hand over again.

    No retries. An extraction is not idempotent from the caller's point of
    view: a retry after a partial upload would land a second dataset covering
    an overlapping slice, and duplicated training rows are harder to notice
    than a failed run. Failures are recorded on the run and re-queued by hand.

    Args:
        source_id: The source to extract from.
        run_id: The ``IngestionRun`` recording this attempt.
    """
    from sqlmodel import Session, create_engine, select

    from core import medallion
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
            destination = Path(tmpdir) / f"bronze-{run_id}.parquet"
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

            # Bronze first, and before anything is cleaned. The watermark is
            # about to move past these rows; if the cleaning fails afterwards
            # they must still be recoverable from storage.
            landed = _through_the_layers(
                engine,
                repo_id=snapshot.repo_id,
                source_id=source_id,
                run_id=run_id,
                bronze_path=result.path,
                workdir=Path(tmpdir),
                text_column=snapshot.normalize_text_column,
                code_column=snapshot.normalize_code_column,
                log=log,
            )
            layer_key = landed["layer_key"]
            normalization: dict[str, Any] = landed["normalization"]
            quality_report = landed["quality_report"]
            gold = landed["gold"]

            size_bytes = gold["path"].stat().st_size
            digest = _sha256_of(gold["path"])

            stamp = f"{started:%Y%m%dT%H%M%S}"
            filename = f"{_slug(gold['name']) or 'gold'}-v{gold['version']}-{stamp}.parquet"
            bucket = gold["bucket"]
            object_key = gold["object_key"]

        with Session(engine) as session:
            dataset = Dataset(
                repo_id=snapshot.repo_id,
                name=filename,
                description=(
                    f"Gold v{gold['version']}, {gold['rows']:,} rows. Rebuilt after "
                    f"extracting {result.rows:,} new row(s) from {snapshot.name!r} "
                    f"recorded after {result.watermark_before}."
                    + (
                        f" {normalization['filled']:,} codes filled in, "
                        f"{normalization['unresolved']:,} left unresolved."
                        if normalization.get("filled") is not None
                        else ""
                    )
                ),
                bucket=bucket,
                object_key=object_key,
                content_type=medallion.PARQUET_CONTENT_TYPE,
                size_bytes=size_bytes,
                checksum=digest,
                is_active=True,
                origin="ingestion",
                ingestion_run_id=run_id,
                profile=result.profile,
                profiled_rows=result.rows,
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

            # Read the id out while the session is still open. commit()
            # expires every instance it manages, so touching dataset.id after
            # this block would try to refresh a detached object and raise —
            # marking a run that fully succeeded as failed, with its watermark
            # already advanced so the retry finds nothing.
            dataset_id = dataset.id

            run = session.get(IngestionRun, run_id)
            if run:
                run.status = "success"
                run.finished_at = datetime.now(timezone.utc)
                run.rows_extracted = result.rows
                run.watermark_before = result.watermark_before
                run.watermark_after = result.watermark_after
                run.dataset_id = dataset_id
                run.profile = result.profile
                run.normalization = normalization
                run.bronze_key = layer_key
                run.silver_key = layer_key
                run.quality_report = quality_report
                session.add(run)
            session.commit()

        log.info(
            "ingestion.completed",
            rows=result.rows,
            dataset_id=dataset_id,
            watermark_after=result.watermark_after,
        )
        return {"status": "success", "rows": result.rows, "dataset_id": dataset_id}

    except Exception as exc:  # noqa: BLE001 — recorded on the run
        log.error("ingestion.failed", error=str(exc))
        _update_run(
            status="failed",
            finished_at=datetime.now(timezone.utc),
            error=str(exc)[:2000],
        )
        return {"status": "failed", "error": str(exc)}


def _through_the_layers(
    engine: Any,
    *,
    repo_id: int,
    source_id: int,
    run_id: str,
    bronze_path: Path,
    workdir: Path,
    text_column: str,
    code_column: str,
    log: Any,
) -> dict[str, Any]:
    """Carry one landed file from bronze to a rebuilt gold table.

    Shared by both doors into the platform. A file somebody uploaded and a
    slice extracted from a database differ in how they arrive and in nothing
    after that: the same cleaning standard, the same report, the same gold. Two
    implementations of this would drift, and the first thing to drift would be
    the report — which is the part a reader is being asked to trust.

    Bronze is uploaded before silver is built, because building silver is where
    a bug would lose data that the source may not hand over twice.
    """
    from core import medallion

    layer_key = medallion.bronze_key(repo_id, source_id, run_id)
    medallion.upload_parquet("bronze", layer_key, bronze_path)
    log.info("layers.bronze_written", key=layer_key)

    # The cleaning standard, then code normalisation. Normalisation runs here
    # rather than as a pipeline phase: the data lands once and is trained on
    # many times, so coding it per training run would repeat the same work —
    # and the same provider calls — for an answer that cannot change.
    build = medallion.promote_to_silver(
        bronze_path,
        workdir / f"silver-{run_id}.parquet",
        text_column=text_column,
        code_column=code_column,
    )
    quality_report = build.report.summary()
    medallion.upload_parquet("silver", layer_key, build.path)
    log.info(
        "layers.silver_written",
        key=layer_key,
        rows=build.rows,
        cells_changed=quality_report["cells_changed"],
    )

    # Gold is rebuilt from the project's whole silver history, not from what
    # just arrived. Without this, landing a slice would register a dataset
    # containing only the newest rows and a model retrained on it would forget
    # everything before them.
    gold = _rebuild_gold(engine, repo_id, workdir, log)

    return {
        "layer_key": layer_key,
        "normalization": build.normalization,
        "quality_report": quality_report,
        "silver_rows": build.rows,
        "gold": gold,
    }


@celery_app.task(
    bind=True,
    name="tasks.celery_tasks.ingest_upload",
    max_retries=0,
)
def ingest_upload(self: Any, dataset_id: int) -> dict[str, Any]:
    """Carry an uploaded file through the layers, like any other arrival.

    Before this, an upload went straight to the datasets bucket and became the
    repository's active dataset: no cleaning standard, no types, no quality
    report, no diff, and absent from gold. Two doors into the platform, one of
    which skipped everything the platform is for — and worse, the two competed
    for the single active-dataset slot, so uploading silently replaced a gold
    table with a raw file and said nothing.

    The upload keeps its own ``Dataset`` row as the record of what arrived. The
    active dataset becomes gold, the same as for an extraction.

    Failures leave that upload row active. That is deliberate: the file is
    stored and usable, and degrading to the old behaviour beats leaving a
    project with nothing to train on because the cleaning could not parse a
    spreadsheet.
    """
    from sqlmodel import Session, create_engine, select

    from core import medallion, storage
    from core.tabular import TabularError, to_bronze
    from models.schemas import DataSource, Dataset, IngestionRun

    log = logger.bind(dataset_id=dataset_id)
    engine = create_engine(settings.database_url, echo=False)
    started = datetime.now(timezone.utc)
    run_id: str | None = None

    try:
        with Session(engine) as session:
            dataset = session.get(Dataset, dataset_id)
            if not dataset:
                raise RuntimeError(f"dataset {dataset_id} no longer exists")
            repo_id = dataset.repo_id
            filename = dataset.name
            bucket, object_key = dataset.bucket, dataset.object_key

            source = _upload_source(session, repo_id, filename)
            source_id = source.id
            run = IngestionRun(source_id=source_id, status="running", started_at=started)
            session.add(run)
            session.commit()
            session.refresh(run)
            run_id = run.id

        with tempfile.TemporaryDirectory() as tmpdir:
            local = Path(tmpdir) / (Path(filename).name or "upload")
            storage.download_to_path(bucket, object_key, str(local))

            bronze_path = Path(tmpdir) / f"bronze-{run_id}.parquet"
            extension = local.suffix.lower()
            rows, _columns = to_bronze(local, extension, bronze_path)
            if rows == 0:
                raise TabularError("the file contained no rows")

            landed = _through_the_layers(
                engine,
                repo_id=repo_id,
                source_id=source_id,
                run_id=run_id,
                bronze_path=bronze_path,
                workdir=Path(tmpdir),
                # An upload names no text/code pair, so no coding is attempted.
                # The structural and domain tiers still run, which is the part
                # that applies whatever the file turns out to contain.
                text_column="",
                code_column="",
                log=log,
            )
            gold = landed["gold"]
            size_bytes = gold["path"].stat().st_size
            digest = _sha256_of(gold["path"])

        stamp = f"{started:%Y%m%dT%H%M%S}"
        with Session(engine) as session:
            trained_on = Dataset(
                repo_id=repo_id,
                name=f"{_slug(gold['name']) or 'gold'}-v{gold['version']}-{stamp}.parquet",
                description=(
                    f"Gold v{gold['version']}, {gold['rows']:,} rows. Rebuilt after "
                    f"{filename!r} was uploaded and cleaned "
                    f"({rows:,} rows in, {landed['silver_rows']:,} kept)."
                ),
                bucket=gold["bucket"],
                object_key=gold["object_key"],
                content_type=medallion.PARQUET_CONTENT_TYPE,
                size_bytes=size_bytes,
                checksum=digest,
                is_active=True,
                origin="ingestion",
                ingestion_run_id=run_id,
                profile={},
                profiled_rows=0,
            )
            for other in session.exec(
                select(Dataset).where(
                    Dataset.repo_id == repo_id,
                    Dataset.is_active == True,  # noqa: E712
                )
            ).all():
                other.is_active = False
                session.add(other)
            session.add(trained_on)
            session.commit()
            session.refresh(trained_on)
            trained_on_id = trained_on.id

            run = session.get(IngestionRun, run_id)
            if run:
                run.status = "success"
                run.finished_at = datetime.now(timezone.utc)
                run.rows_extracted = rows
                run.dataset_id = trained_on_id
                run.bronze_key = landed["layer_key"]
                run.silver_key = landed["layer_key"]
                run.quality_report = landed["quality_report"]
                run.normalization = landed["normalization"]
                session.add(run)
            session.commit()

        log.info("upload.layered", rows=rows, gold_version=gold["version"])
        return {"status": "success", "rows": rows, "dataset_id": trained_on_id}

    except Exception as exc:  # noqa: BLE001 — recorded on the run
        log.error("upload.layering_failed", error=str(exc))
        if run_id:
            with Session(engine) as session:
                run = session.get(IngestionRun, run_id)
                if run:
                    run.status = "failed"
                    run.finished_at = datetime.now(timezone.utc)
                    run.error = str(exc)[:2000]
                    session.add(run)
                    session.commit()
        return {"status": "failed", "error": str(exc)}


def _upload_source(session: Any, repo_id: int, filename: str) -> Any:
    """Find or create the pseudo-source that uploads of ``filename`` land under.

    Uploads are modelled as a ``DataSource`` of kind ``upload`` so that every
    downstream part — the layer summary, the diff, the gold relations, the key
    layout — works on them without knowing they came through a different door.
    The alternative was a parallel set of special cases in each of those, which
    is how the two paths diverged in the first place.

    One pseudo-source *per filename*, not per project. Re-uploading
    ``admissions.csv`` next month adds to that stream, which is what silver
    accumulating is for; uploading ``patients.csv`` makes a second table that
    gold can join against the first. That matches what the filename already
    means to the person choosing it.
    """
    from sqlmodel import select

    from models.schemas import DataSource

    stem = Path(filename).stem or "upload"
    existing = session.exec(
        select(DataSource).where(
            DataSource.repo_id == repo_id,
            DataSource.kind == "upload",
            DataSource.name == stem,
        )
    ).first()
    if existing:
        return existing

    source = DataSource(repo_id=repo_id, name=stem, kind="upload", is_active=True)
    session.add(source)
    session.commit()
    session.refresh(source)
    return source


@celery_app.task(
    bind=True,
    name="tasks.celery_tasks.rebuild_gold",
    max_retries=0,
)
def rebuild_gold(self: Any, repo_id: int) -> dict[str, Any]:
    """Rebuild a project's gold table against its current definition.

    Gold is a function of two things: the silver layer and the definition.
    Extractions change the first, and this covers the second — without it,
    editing the definition would leave gold stale until new rows happened to
    arrive, which for a source that is already up to date could be never.

    Failures are recorded on the gold table rather than raised, because the
    definition has already been saved by the time this runs: the user needs to
    see *why* their query did not build, next to the query.
    """
    from sqlmodel import Session, create_engine, select

    from models.schemas import GoldTable

    log = logger.bind(repo_id=repo_id)
    engine = create_engine(settings.database_url, echo=False)

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            gold = _rebuild_gold(engine, repo_id, Path(tmpdir), log)
        return {"status": "success", "version": gold["version"], "rows": gold["rows"]}
    except Exception as exc:  # noqa: BLE001 — recorded on the table
        log.error("gold.rebuild_failed", error=str(exc))
        with Session(engine) as session:
            table = session.exec(
                select(GoldTable).where(GoldTable.repo_id == repo_id)
            ).first()
            if table:
                table.build_error = str(exc)[:2000]
                session.add(table)
                session.commit()
        return {"status": "failed", "error": str(exc)}


def _relation_name(source_id: int, source_name: str) -> str:
    """Return the SQL name a source's silver is queried under.

    Derived from the source's own name so a gold definition reads as
    ``FROM hospital_his`` rather than ``FROM source_7``, with the id appended
    because two sources in a project may be called the same thing and a
    relation name has to be unique. Names are what the AI will be shown and
    what a person will type, so they are worth making legible.
    """
    import re as _re

    slug = _re.sub(r"[^a-z0-9]+", "_", (source_name or "").lower()).strip("_")
    return f"{slug}_{source_id}" if slug else f"source_{source_id}"


def _rebuild_gold(engine: Any, repo_id: int, workdir: Path, log: Any) -> dict[str, Any]:
    """Rebuild the project's gold table from the whole of its silver.

    Every silver object of every source in the project is fetched and exposed
    to DuckDB as one relation per source; the project's definition — or the
    default union when it has not written one — is executed over them and the
    result is written as the next version.

    The whole history is downloaded on each build. That is the honest cost of
    rebuilding rather than appending, and it is the right trade at this scale:
    a project's silver is a watermarked slice of a source, not a warehouse. It
    is also the first thing to change if it stops being true — DuckDB can read
    the objects in place over S3, which removes the download without changing
    anything else here.
    """
    from sqlmodel import Session, select

    from core import gold as gold_module
    from core import medallion
    from models.schemas import DataSource, GoldTable

    with Session(engine) as session:
        sources = session.exec(
            select(DataSource).where(DataSource.repo_id == repo_id)
        ).all()
        names = {source.id: _relation_name(source.id or 0, source.name) for source in sources}

        table = session.exec(
            select(GoldTable).where(GoldTable.repo_id == repo_id)
        ).first()
        if table is None:
            table = GoldTable(repo_id=repo_id)
            session.add(table)
            session.commit()
            session.refresh(table)
        definition = table.sql
        table_name = table.name
        table_id = table.id
        next_version = table.version + 1

    # Fetch every silver object, grouped by the source that produced it.
    silver_root = workdir / "silver"
    relations: dict[str, list[Path]] = {}
    for source_id, name in names.items():
        if source_id is None:
            continue
        objects = medallion.list_layer(
            "silver", medallion.stream_prefix(repo_id, source_id)
        )
        paths: list[Path] = []
        for index, item in enumerate(objects):
            local = silver_root / name / f"part-{index:05d}.parquet"
            medallion.download_parquet("silver", item.key, local)
            paths.append(local)
        if paths:
            relations[name] = paths

    sql = definition or gold_module.default_sql(sorted(relations))
    destination = workdir / "gold.parquet"
    build, _ = gold_module.build(relations, sql, destination)

    object_key = medallion.gold_key(repo_id, table_name, next_version)
    bucket = medallion.upload_parquet("gold", object_key, destination)

    with Session(engine) as session:
        stored = session.get(GoldTable, table_id)
        if stored:
            stored.version = next_version
            stored.bucket = bucket
            stored.object_key = object_key
            stored.rows = build.rows
            stored.columns = build.columns
            stored.relations = build.relations
            stored.built_at = datetime.now(timezone.utc)
            stored.build_error = ""
            session.add(stored)
            session.commit()

    log.info(
        "gold.rebuilt",
        repo_id=repo_id,
        version=next_version,
        rows=build.rows,
        relations=build.relations,
        definition="default" if not definition else "project",
    )
    return {
        "name": table_name,
        "version": next_version,
        "bucket": bucket,
        "object_key": object_key,
        "rows": build.rows,
        "columns": build.columns,
        "path": destination,
    }


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
