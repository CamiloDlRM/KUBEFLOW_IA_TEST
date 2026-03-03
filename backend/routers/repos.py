"""Repository management endpoints.

Register, list, and delete GitHub repositories with automatic webhook setup.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from models.schemas import (
    MessageResponse,
    RepoCreateRequest,
    RepoCreatedResponse,
    RepoResponse,
    Repository,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/repos", tags=["repositories"])


def _get_session(settings: AppSettings = Depends(get_settings)) -> Session:
    """Yield a SQLModel session."""
    from sqlmodel import create_engine

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as session:
        yield session


@router.post(
    "",
    response_model=RepoCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a repository",
)
async def create_repo(
    body: RepoCreateRequest,
    settings: AppSettings = Depends(get_settings),
    session: Session = Depends(_get_session),
) -> RepoCreatedResponse:
    """Register a GitHub repository and create a push webhook.

    The webhook URL is constructed from the backend's public URL.
    The GitHub token is masked before storage.
    """
    from core.github import create_webhook

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

    repo = Repository(
        github_url=body.github_url,
        github_token_masked=masked_token,
        branch=body.branch,
        notebook_path=body.notebook_path,
        webhook_id=hook_data.get("id"),
        webhook_url=webhook_url,
        is_active=True,
    )
    session.add(repo)
    session.commit()
    session.refresh(repo)

    logger.info("repo.created", repo_id=repo.id, github_url=body.github_url)

    return RepoCreatedResponse(
        repo_id=repo.id,  # type: ignore[arg-type]
        webhook_url=webhook_url,
    )


@router.get(
    "",
    response_model=list[RepoResponse],
    summary="List repositories",
)
async def list_repos(
    session: Session = Depends(_get_session),
) -> list[RepoResponse]:
    """Return all registered repositories."""
    repos = session.exec(select(Repository)).all()
    return [RepoResponse.model_validate(r) for r in repos]


@router.delete(
    "/{repo_id}",
    response_model=MessageResponse,
    summary="Delete a repository",
)
async def delete_repo(
    repo_id: int,
    settings: AppSettings = Depends(get_settings),
    session: Session = Depends(_get_session),
) -> MessageResponse:
    """Delete a repository and remove its GitHub webhook.

    Args:
        repo_id: Database ID of the repository.
    """
    repo = session.get(Repository, repo_id)
    if not repo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Repository {repo_id} not found.",
        )

    # Attempt to delete GitHub webhook
    if repo.webhook_id:
        try:
            from core.github import delete_webhook

            token = settings.github_token
            await delete_webhook(repo.github_url, token, repo.webhook_id)
        except Exception as exc:
            logger.warning(
                "repo.webhook_delete_failed",
                repo_id=repo_id,
                error=str(exc),
            )

    session.delete(repo)
    session.commit()
    logger.info("repo.deleted", repo_id=repo_id)

    return MessageResponse(message=f"Repository {repo_id} deleted.")
