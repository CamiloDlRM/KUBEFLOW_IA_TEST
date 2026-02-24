"""GitHub webhook receiver endpoint.

Verifies HMAC-SHA256 signatures and enqueues pipeline runs for qualifying
push events that modify notebook files on the configured branch.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.github import verify_webhook_signature
from core.pipeline import get_pipeline_runner
from models.schemas import Pipeline, Repository, WebhookAccepted

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/webhook", tags=["webhook"])


def _get_session(settings: AppSettings = Depends(get_settings)) -> Session:
    from sqlmodel import create_engine

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as session:
        yield session


@router.post(
    "/github",
    response_model=WebhookAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Receive GitHub push events",
)
async def github_webhook(
    request: Request,
    settings: AppSettings = Depends(get_settings),
    session: Session = Depends(_get_session),
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

    repo = repos[0]

    # Check branch
    if repo.branch != branch:
        logger.info(
            "webhook.branch_mismatch",
            expected=repo.branch,
            received=branch,
        )
        raise HTTPException(
            status_code=status.HTTP_200_OK,
            detail=f"Push to branch '{branch}' ignored (monitoring '{repo.branch}').",
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

    # Create pipeline record
    pipeline = Pipeline(
        repo_id=repo.id,  # type: ignore[arg-type]
        status="queued",
        commit_sha=commit_sha,
    )
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)

    # Enqueue pipeline run
    runner = get_pipeline_runner()
    await runner.run(pipeline.id, repo.id, commit_sha)  # type: ignore[arg-type]

    logger.info(
        "webhook.pipeline_queued",
        pipeline_id=pipeline.id,
        repo_id=repo.id,
    )

    return WebhookAccepted(pipeline_id=pipeline.id)
