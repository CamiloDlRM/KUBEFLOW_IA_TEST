"""GitHub webhook receiver endpoint.

Verifies HMAC-SHA256 signatures and enqueues pipeline runs for qualifying
push events that modify notebook files on the configured branch.
"""
from __future__ import annotations

from typing import Any

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.github import verify_webhook_signature
from core.ownership import linked_projects
from core.pipeline import get_pipeline_runner
from db import get_session
from models.schemas import Pipeline, Repository, WebhookAccepted

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post(
    "/github",
    response_model=WebhookAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Receive GitHub push events",
)
async def github_webhook(
    request: Request,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    x_hub_signature_256: str = Header(default=""),
    x_github_event: str = Header(default=""),
) -> WebhookAccepted:
    """Receive and process a GitHub push webhook event.

    Verifies the HMAC-SHA256 signature, checks if the push modifies a
    notebook file on the monitored branch, and enqueues a pipeline run.
    """
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
    repos = session.exec(
        select(Repository).where(
            Repository.github_url == repo_url,
            Repository.is_active == True,
        )
    ).all()

    if not repos:
        # Try with .git suffix variant
        repos = session.exec(
            select(Repository).where(
                Repository.github_url == f"{repo_url}.git",
                Repository.is_active == True,
            )
        ).all()

    if not repos:
        logger.info("webhook.no_matching_repo", repo_url=repo_url)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No registered repository matches this webhook.",
        )

    # A pipeline trains on its project's data: a notebook no active project
    # links has nothing to run, whatever GitHub's own webhook flag says.
    # Several accounts may register the same URL, so every row is considered.
    links = [(repo, project) for repo in repos for project in linked_projects(session, repo)]
    if not links:
        logger.info("webhook.repo_without_project", repo_url=repo_url)
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail="Push ignored: repository is not in a project.",
        )

    on_branch = [(repo, project) for repo, project in links if project.branch == branch]
    if not on_branch:
        logger.info(
            "webhook.branch_mismatch",
            expected=sorted({p.branch for _, p in links}),
            received=branch,
        )
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail=f"Push to branch '{branch}' ignored (no notebook is linked on it).",
        )

    modified_files: set[str] = set()
    for commit_data in payload.get("commits", []):
        modified_files.update(commit_data.get("added", []))
        modified_files.update(commit_data.get("modified", []))

    # Only the notebooks whose own file changed: one project's push must not
    # retrain every other notebook that happens to live in the same repository.
    changed = [(repo, project) for repo, project in on_branch if project.notebook_path in modified_files]
    if not changed:
        logger.info("webhook.no_notebook_changes", files=sorted(modified_files))
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail="No notebook files modified in this push.",
        )

    runner = get_pipeline_runner()
    accepted: list[str] = []
    for repo, project in changed:
        # Deduplication: skip if an identical run is already queued or running
        existing = session.exec(
            select(Pipeline).where(
                Pipeline.project_id == project.id,
                Pipeline.commit_sha == commit_sha,
                Pipeline.status.in_(["queued", "running"]),  # type: ignore[union-attr]
            )
        ).first()
        if existing:
            logger.info(
                "webhook.duplicate_pipeline_skipped",
                existing_pipeline_id=existing.id,
                project_id=project.id,
                commit_sha=commit_sha,
            )
            continue

        pipeline = Pipeline(
            repo_id=repo.id,  # type: ignore[arg-type]
            project_id=project.id,
            notebook_path=project.notebook_path,
            status="queued",
            commit_sha=commit_sha,
            branch=branch,
        )
        session.add(pipeline)
        session.commit()
        session.refresh(pipeline)

        await runner.run(pipeline.id, repo.id, commit_sha)  # type: ignore[arg-type]
        logger.info(
            "webhook.pipeline_queued",
            pipeline_id=pipeline.id,
            repo_id=repo.id,
            project_id=project.id,
        )
        accepted.append(pipeline.id)

    if not accepted:
        return WebhookAccepted(status="already_queued", pipeline_id=existing.id)  # type: ignore[union-attr]
    return WebhookAccepted(pipeline_id=accepted[0], pipeline_ids=accepted)
