"""Repository management endpoints.

Register, list, and delete GitHub repositories with automatic webhook setup.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
import structlog

from core.config import AppSettings, get_settings
from core.roble_client import RobleClient
from models.schemas import (
    MessageResponse,
    RepoCreateRequest,
    RepoCreatedResponse,
    RepoResponse,
    repo_from_roble,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/repos", tags=["repositories"])


def _get_roble(request: Request) -> RobleClient:
    """Return the ROBLE client from app state."""
    return request.app.state.roble


@router.post(
    "",
    response_model=RepoCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a repository",
)
async def create_repo(
    body: RepoCreateRequest,
    settings: AppSettings = Depends(get_settings),
    roble: RobleClient = Depends(_get_roble),
) -> RepoCreatedResponse:
    """Register a GitHub repository and create a push webhook."""
    from core.github import create_webhook

    clean_notebook_path = body.notebook_path.strip().strip("/")
    if not clean_notebook_path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="notebook_path must not be empty.",
        )

    token = body.github_token or settings.github_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A GitHub token is required (via body or GITHUB_TOKEN env).",
        )

    webhook_url = f"{settings.backend_public_url.rstrip('/')}/webhook/github"

    try:
        hook_data = await create_webhook(
            repo_url=body.github_url,
            token=token,
            webhook_url=webhook_url,
            secret=settings.github_webhook_secret,
        )
    except Exception as exc:
        logger.error("repo.webhook_creation_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to create GitHub webhook: {exc}",
        )

    masked_token = f"****{token[-4:]}" if len(token) >= 4 else "****"

    record = {
        "github_url": body.github_url,
        "github_token_masked": masked_token,
        "branch": body.branch,
        "notebook_path": body.notebook_path,
        "webhook_id": hook_data.get("id"),
        "webhook_url": webhook_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
    }

    result = await roble.insert("repositories", [record])
    repo_id = result[0]["_id"] if result and "_id" in result[0] else ""

    logger.info("repo.created", repo_id=repo_id, github_url=body.github_url)

    return RepoCreatedResponse(
        repo_id=repo_id,
        webhook_url=webhook_url,
    )


@router.get(
    "",
    response_model=list[RepoResponse],
    summary="List repositories",
)
async def list_repos(
    roble: RobleClient = Depends(_get_roble),
) -> list[RepoResponse]:
    """Return all registered repositories."""
    records = await roble.read("repositories")
    return [repo_from_roble(r) for r in records]


@router.delete(
    "/{repo_id}",
    response_model=MessageResponse,
    summary="Delete a repository",
)
async def delete_repo(
    repo_id: str,
    settings: AppSettings = Depends(get_settings),
    roble: RobleClient = Depends(_get_roble),
) -> MessageResponse:
    """Delete a repository and remove its GitHub webhook."""
    repo = await roble.read_one("repositories", "_id", repo_id)
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Repository {repo_id} not found.",
        )

    # Attempt to delete GitHub webhook
    webhook_id = repo.get("webhook_id")
    if webhook_id:
        try:
            from core.github import delete_webhook

            token = settings.github_token
            await delete_webhook(repo["github_url"], token, webhook_id)
        except Exception as exc:
            logger.warning(
                "repo.webhook_delete_failed",
                repo_id=repo_id,
                error=str(exc),
            )

    await roble.delete("repositories", "_id", repo_id)
    logger.info("repo.deleted", repo_id=repo_id)

    return MessageResponse(message=f"Repository {repo_id} deleted.")
