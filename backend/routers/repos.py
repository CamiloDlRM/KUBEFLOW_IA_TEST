"""Repository management endpoints.

Register, list, and delete GitHub repositories with automatic webhook setup.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.github_credentials import encrypt_token, repo_token
from core.ownership import filter_repos_by_owner, get_visible_repo_or_404, linked_projects
from core.security import get_current_user
from db import get_session
from models.schemas import (
    BranchInfo,
    LinkedNotebookResponse,
    MessageResponse,
    ModelDeployment,
    NotebookCellsResponse,
    Pipeline,
    PipelineInputRequest,
    PipelineInputResponse,
    Project,
    RepoCreateRequest,
    RepoCreatedResponse,
    RepoResponse,
    Repository,
    TriggerPipelineRequest,
    User,
    WebhookAccepted,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/repos", tags=["repositories"])


@router.post(
    "",
    response_model=RepoCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a repository",
)
async def create_repo(
    body: RepoCreateRequest,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> RepoCreatedResponse:
    """Register a GitHub repository and create a push webhook.

    The webhook URL is constructed from the backend's public URL.
    The GitHub token is masked before storage. The caller becomes the owner of
    the repository, and therefore the only non-admin user able to see it (and
    everything derived from it: pipelines, datasets, deployments, insights).
    """
    from core.github import create_webhook, parse_repo_url

    try:
        owner, name = parse_repo_url(body.github_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    canonical_url = f"https://github.com/{owner}/{name}"
    duplicate = session.exec(
        select(Repository).where(
            Repository.owner_id == current_user.id,
            Repository.github_url.in_([canonical_url, f"{canonical_url}.git"]),
            Repository.is_active == True,  # noqa: E712
        )
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This repository is already registered for your account.",
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
            # A new repository has no project yet, so nothing may run on push.
            # Linking it to a project enables the hook (routers/projects.py).
            active=False,
        )
    except Exception as exc:
        logger.error("repo.webhook_creation_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to create GitHub webhook: {exc}",
        )

    masked_token = f"****{token[-4:]}" if len(token) >= 4 else "****"

    repo = Repository(
        owner_id=current_user.id,
        github_url=canonical_url,
        github_token_masked=masked_token,
        github_token_encrypted=encrypt_token(token, settings),
        webhook_id=hook_data.get("id"),
        webhook_url=webhook_url,
        is_active=True,
    )
    session.add(repo)
    session.commit()
    session.refresh(repo)

    logger.info(
        "repo.created",
        repo_id=repo.id,
        github_url=body.github_url,
        owner_id=repo.owner_id,
    )

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
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[RepoResponse]:
    """Return the repositories the caller owns (admins get every repository).

    Each one lists the notebooks active projects have linked from it: only a
    linked notebook can run pipelines.
    """
    statement = filter_repos_by_owner(select(Repository), current_user)
    repos = session.exec(statement).all()
    repo_ids = [r.id for r in repos]
    projects = session.exec(
        select(Project)
        .where(Project.repo_id.in_(repo_ids), Project.is_active == True)  # type: ignore[union-attr]  # noqa: E712
        .order_by(Project.id)  # type: ignore[arg-type]
    ).all() if repo_ids else []

    # Oldest first, so the newest run per project wins the dict; in-flight
    # runs are written last so they win over a deployed model's run.
    project_ids = [p.id for p in projects]
    deployed = session.exec(
        select(Pipeline)
        .join(ModelDeployment, ModelDeployment.pipeline_id == Pipeline.id)
        .where(Pipeline.project_id.in_(project_ids), ModelDeployment.is_active == True)  # type: ignore[union-attr]  # noqa: E712
        .order_by(ModelDeployment.deployed_at)
    ).all() if project_ids else []
    in_flight = session.exec(
        select(Pipeline)
        .where(Pipeline.project_id.in_(project_ids), Pipeline.status.in_(["queued", "running"]))  # type: ignore[union-attr]
        .order_by(Pipeline.started_at)
    ).all() if project_ids else []
    # Keyed by notebook too: a run from the project's previous notebook is not
    # a run of the one it links now.
    active = {(p.project_id, p.notebook_path): p.id for p in [*deployed, *in_flight]}

    def render(repo: Repository) -> RepoResponse:
        response = RepoResponse.model_validate(repo)
        response.notebooks = [
            LinkedNotebookResponse(
                project_id=p.id,  # type: ignore[arg-type]
                project_name=p.name,
                branch=p.branch,
                notebook_path=p.notebook_path,
                active_pipeline_id=active.get((p.id, p.notebook_path)),
            )
            for p in projects
            if p.repo_id == repo.id
        ]
        return response

    return [render(r) for r in repos]


@router.delete(
    "/{repo_id}",
    response_model=MessageResponse,
    summary="Delete a repository",
)
async def delete_repo(
    repo_id: int,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Delete a repository and remove its GitHub webhook.

    Only the owner (or an admin) may delete it; for anybody else the
    repository is reported as non-existent.

    Args:
        repo_id: Database ID of the repository.
    """
    repo = get_visible_repo_or_404(session, repo_id, current_user)

    # Attempt to delete GitHub webhook
    if repo.webhook_id:
        try:
            from core.github import delete_webhook

            token = repo_token(repo, settings)
            await delete_webhook(repo.github_url, token, repo.webhook_id)
        except Exception as exc:
            logger.warning(
                "repo.webhook_delete_failed",
                repo_id=repo_id,
                error=str(exc),
            )

    # Archived projects too: a link to a deleted row would fail on restore.
    for project in session.exec(select(Project).where(Project.repo_id == repo.id)).all():
        project.repo_id = None
        project.notebook_path = ""
        session.add(project)
    session.delete(repo)
    session.commit()
    logger.info("repo.deleted", repo_id=repo_id)

    return MessageResponse(message=f"Repository {repo_id} deleted.")


@router.get(
    "/{repo_id}/branches",
    response_model=list[BranchInfo],
    summary="List the repository's branches",
)
async def list_repo_branches(
    repo_id: int,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[BranchInfo]:
    """Return the branches of the repository (via the GitHub API).

    Restricted to the repository's owner (and admins).
    """
    from core.github import list_branches

    repo = get_visible_repo_or_404(session, repo_id, current_user)
    try:
        branches = await list_branches(repo.github_url, repo_token(repo, settings))
    except Exception as exc:
        logger.error("repo.list_branches_failed", repo_id=repo_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to list branches from GitHub: {exc}",
        )
    return [BranchInfo(**b) for b in branches]


@router.get("/{repo_id}/notebooks", response_model=list[str])
async def list_repo_notebooks(
    repo_id: int,
    branch: str,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[str]:
    """Explore notebook files currently present in a repository branch."""
    from core.github import list_notebooks

    repo = get_visible_repo_or_404(session, repo_id, current_user)
    try:
        return await list_notebooks(repo.github_url, repo_token(repo, settings), branch)
    except Exception as exc:
        logger.error("repo.list_notebooks_failed", repo_id=repo_id, branch=branch, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to list notebooks from GitHub: {exc}",
        ) from exc


async def launch_pipeline(
    repo: Repository,
    project: Project,
    branch: str,
    settings: AppSettings,
    session: Session,
    requested_model_name: str | None = None,
) -> WebhookAccepted:
    """Pin ``branch`` to its HEAD commit and enqueue a run of ``project``'s notebook.

    Shared by the repository trigger and the project's "Run pipeline". Callers
    have already checked access and that ``project`` links a notebook of ``repo``.
    """
    from core.pipeline import get_pipeline_runner

    # Resolve the branch HEAD so the run is pinned to a concrete commit
    from core.github import list_branches

    try:
        branches = await list_branches(repo.github_url, repo_token(repo, settings))
    except Exception as exc:
        logger.error("repo.trigger_branch_lookup_failed", repo_id=repo.id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to resolve branch '{branch}' on GitHub: {exc}",
        )
    match = next((b for b in branches if b["name"] == branch), None)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Branch '{branch}' does not exist in the repository.",
        )
    commit_sha = match["commit_sha"]

    # Deduplication: skip if an identical run is already queued or running
    existing = session.exec(
        select(Pipeline).where(
            Pipeline.project_id == project.id,
            Pipeline.commit_sha == commit_sha,
            Pipeline.status.in_(["queued", "running"]),  # type: ignore[union-attr]
        )
    ).first()
    if existing:
        return WebhookAccepted(status="already_queued", pipeline_id=existing.id)

    pipeline = Pipeline(
        repo_id=repo.id,  # type: ignore[arg-type]
        project_id=project.id,
        notebook_path=project.notebook_path,
        status="queued",
        commit_sha=commit_sha,
        branch=branch,
        requested_model_name=requested_model_name,
    )
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)

    runner = get_pipeline_runner()
    await runner.run(pipeline.id, repo.id, commit_sha)  # type: ignore[arg-type]

    logger.info(
        "pipeline.triggered_manually",
        pipeline_id=pipeline.id,
        repo_id=repo.id,
        branch=branch,
        commit_sha=commit_sha,
        requested_model_name=requested_model_name,
    )
    return WebhookAccepted(pipeline_id=pipeline.id)


@router.get(
    "/{repo_id}/notebook",
    response_model=NotebookCellsResponse,
    summary="The notebook's code by phase, as a branch has it now",
)
async def get_repo_notebook(
    repo_id: int,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    branch: str = "",
) -> NotebookCellsResponse:
    """Read the repository's notebook from GitHub and split it by phase.

    A run records the code it executed; this is the code the *next* run will
    execute, which is what there is to show before the first one.
    """
    import httpx

    from core.github import download_notebook
    from core.notebook_parser import notebook_cells

    repo = get_visible_repo_or_404(session, repo_id, current_user)
    ref = branch.strip() or repo.branch
    path = repo.notebook_path.strip("/")
    if not path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This repository has no notebook selected.",
        )
    try:
        notebook = await download_notebook(repo.github_url, repo_token(repo, settings), ref, path)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No notebook at '{path}' on branch '{ref}'.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"GitHub refused the notebook: {exc}",
        ) from exc
    except Exception as exc:
        logger.error("repo.notebook_failed", repo_id=repo_id, branch=ref, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to read the notebook from GitHub: {exc}",
        ) from exc
    return NotebookCellsResponse(branch=ref, notebook_path=path, cells=notebook_cells(notebook))


@router.post(
    "/{repo_id}/trigger",
    response_model=WebhookAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Launch a pipeline manually from a chosen branch",
)
async def trigger_pipeline(
    repo_id: int,
    body: TriggerPipelineRequest,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> WebhookAccepted:
    """Run the training pipeline on demand, from any branch of the repo.

    Unlike the webhook flow, this does not require a push event: it resolves
    the branch's HEAD commit and enqueues the run directly. Only the owner of
    the repository (or an admin) may launch a run on it.

    It runs the repository's one linked notebook. With several linked there is
    no telling which was meant, so the project's own "Run pipeline" is asked
    for instead of guessing.
    """
    repo = get_visible_repo_or_404(session, repo_id, current_user)
    projects = linked_projects(session, repo)
    if not projects:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Link a notebook of this repository to a project before running a pipeline.",
        )
    if len(projects) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Several projects link notebooks of this repository; run it from the project.",
        )
    (project,) = projects

    return await launch_pipeline(
        repo, project, body.branch.strip() or project.branch, settings, session
    )

def _describe_input(session: Session, repo: Repository) -> PipelineInputResponse:
    """The repository's choice and what it resolves to, or why it does not."""
    from core import medallion, pipeline_input

    response = PipelineInputResponse(choice=dict(repo.pipeline_input or {}))
    try:
        choice = pipeline_input.InputChoice.parse(repo.pipeline_input)
        if choice.layer and repo.project_id is not None:
            resolved = pipeline_input.resolve(session, repo.project_id, choice)
            response.resolved = resolved.as_dict() if resolved else None
    except (pipeline_input.InputError, medallion.MedallionError) as exc:
        response.error = str(exc)
    return response


@router.get(
    "/{repo_id}/pipeline-input",
    response_model=PipelineInputResponse,
    summary="What this repository's pipeline trains on",
)
def get_pipeline_input(
    repo_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PipelineInputResponse:
    """Return the choice, and what it would mount if a run started now.

    A choice that no longer resolves is reported in ``error`` rather than as a
    failed request: the repository still exists and so does its choice, and
    the view needs both to show what went stale.
    """
    repo = get_visible_repo_or_404(session, repo_id, current_user)
    return _describe_input(session, repo)


@router.put(
    "/{repo_id}/pipeline-input",
    response_model=PipelineInputResponse,
    summary="Choose what this repository's pipeline trains on",
)
def set_pipeline_input(
    repo_id: int,
    body: PipelineInputRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PipelineInputResponse:
    """Point the pipeline at a layer: gold, or one source's silver or bronze.

    The choice is resolved before it is stored, so one that names nothing is
    refused here, when someone is looking, rather than at the start of a run
    nobody is watching. An empty layer goes back to the active dataset.
    """
    from core import medallion, pipeline_input

    repo = get_visible_repo_or_404(session, repo_id, current_user)
    try:
        choice = pipeline_input.InputChoice.parse(body.model_dump())
        if choice.layer:
            if repo.project_id is None:
                raise pipeline_input.InputError(
                    "this repository is not in a project, so it has no layers to train on"
                )
            pipeline_input.resolve(session, repo.project_id, choice)
    except pipeline_input.InputError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except medallion.MedallionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Object storage could not be read: {exc}",
        )

    repo.pipeline_input = choice.as_dict()
    session.add(repo)
    session.commit()
    session.refresh(repo)
    logger.info("repo.pipeline_input.set", repo_id=repo_id, choice=repo.pipeline_input)
    return _describe_input(session, repo)
