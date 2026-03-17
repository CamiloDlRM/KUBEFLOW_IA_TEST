"""GitHub webhook receiver endpoint.

Verifies HMAC-SHA256 signatures and enqueues pipeline runs for qualifying
push events that modify notebook files on the configured branch.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
import structlog

from core.config import AppSettings, get_settings
from core.github import verify_webhook_signature
from core.pipeline import get_pipeline_runner
from core.roble_client import RobleClient
from models.schemas import WebhookAccepted

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])


def _get_roble(request: Request) -> RobleClient:
    return request.app.state.roble


@router.post(
    "/github",
    response_model=WebhookAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Receive GitHub push events",
)
async def github_webhook(
    request: Request,
    settings: AppSettings = Depends(get_settings),
    roble: RobleClient = Depends(_get_roble),
    x_hub_signature_256: str = Header(default=""),
    x_github_event: str = Header(default=""),
) -> WebhookAccepted:
    """Receive and process a GitHub push webhook event."""
    body = await request.body()

    # Verify signature
    if not verify_webhook_signature(body, x_hub_signature_256, settings.github_webhook_secret):
        logger.warning("webhook.invalid_signature")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature.",
        )

    # Only process push events
    if x_github_event != "push":
        logger.info("webhook.ignored_event", event_type=x_github_event)
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail=f"Event '{x_github_event}' ignored.",
        )

    payload: dict[str, Any] = await request.json()

    # Extract repo URL and branch
    repo_url: str = payload.get("repository", {}).get("html_url", "")
    ref: str = payload.get("ref", "")
    branch = ref.replace("refs/heads/", "")
    commit_sha: str = payload.get("after", "")

    logger.info(
        "webhook.push_received",
        repo_url=repo_url,
        branch=branch,
        commit_sha=commit_sha,
    )

    # Find matching repository
    repos = await roble.read("repositories", {"github_url": repo_url, "is_active": "true"})

    if not repos:
        # Try with .git suffix variant
        repos = await roble.read("repositories", {"github_url": f"{repo_url}.git", "is_active": "true"})

    if not repos:
        logger.info("webhook.no_matching_repo", repo_url=repo_url)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No registered repository matches this webhook.",
        )

    repo = repos[0]

    # Check branch
    if repo.get("branch") != branch:
        logger.info(
            "webhook.branch_mismatch",
            expected=repo.get("branch"),
            received=branch,
        )
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail=f"Push to branch '{branch}' ignored (monitoring '{repo.get('branch')}').",
        )

    # Check if push modifies a .ipynb file
    modified_files: list[str] = []
    for commit_data in payload.get("commits", []):
        modified_files.extend(commit_data.get("added", []))
        modified_files.extend(commit_data.get("modified", []))

    notebook_changed = any(f.endswith(".ipynb") for f in modified_files)
    if not notebook_changed:
        logger.info("webhook.no_notebook_changes", files=modified_files)
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail="No notebook files modified in this push.",
        )

    repo_id = repo["_id"]

    # Deduplication: skip if an identical run is already queued or running
    existing_pipelines = await roble.read("pipelines", {
        "repo_id": repo_id,
        "commit_sha": commit_sha,
    })
    existing = [
        p for p in existing_pipelines
        if p.get("status") in ("queued", "running")
    ]

    if existing:
        existing_uuid = existing[0].get("pipeline_uuid", existing[0].get("_id"))
        logger.info(
            "webhook.duplicate_pipeline_skipped",
            existing_pipeline_id=existing_uuid,
            repo_id=repo_id,
            commit_sha=commit_sha,
        )
        return WebhookAccepted(
            status="already_queued",
            pipeline_id=existing_uuid,
        )

    # Create pipeline record
    pipeline_uuid = str(uuid.uuid4())
    pipeline_record = {
        "pipeline_uuid": pipeline_uuid,
        "repo_id": repo_id,
        "status": "queued",
        "commit_sha": commit_sha,
        "started_at": None,
        "finished_at": None,
        "phases": [],
        "metrics": {},
    }
    await roble.insert("pipelines", [pipeline_record])

    # Enqueue pipeline run (use pipeline_uuid as Celery task_id)
    runner = get_pipeline_runner()
    await runner.run(pipeline_uuid, repo_id, commit_sha)

    logger.info(
        "webhook.pipeline_queued",
        pipeline_id=pipeline_uuid,
        repo_id=repo_id,
    )

    return WebhookAccepted(pipeline_id=pipeline_uuid)
