"""Repository management endpoints.

Register, list, and delete GitHub repositories with automatic webhook setup.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.github_credentials import encrypt_token, mask_token, repo_token, user_token
from core.ownership import filter_repos_by_owner, get_visible_repo_or_404, linked_projects
from core.security import get_current_user
from db import get_session
from models.schemas import (
    BranchInfo,
    LinkedNotebookResponse,
    MessageResponse,
    NotebookEditorCell,
    NotebookEditorResponse,
    NotebookReviewRequest,
    NotebookReviewResponse,
    NotebookSaveRequest,
    NotebookSaveResponse,
    ModelDeployment,
    Pipeline,
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

    # A token in the body keeps the old per-repository behaviour. Otherwise the
    # repository follows its owner's sign-in token, so renewing it fixes all.
    owner_token = "" if body.github_token else user_token(session, current_user, settings)
    token = body.github_token or owner_token or settings.github_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A GitHub token is required: set yours in Settings.",
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

    repo = Repository(
        owner_id=current_user.id,
        github_url=canonical_url,
        github_token_masked=mask_token(token),
        github_token_encrypted="" if owner_token else encrypt_token(token, settings),
        uses_owner_token=bool(owner_token),
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


def _require_notebook_path(path: str) -> str:
    """Only notebooks are edited here: never another file of the repository."""
    cleaned = path.strip().strip("/")
    if not cleaned.lower().endswith(".ipynb") or ".." in cleaned.split("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .ipynb notebooks can be edited.",
        )
    return cleaned


def _github_error(action: str, exc: Exception) -> HTTPException:
    """What GitHub answered, in words the editor can show."""
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            detail = (
                f"GitHub refused to {action}: the token has no write access to this repository "
                "(or the branch is protected)."
            )
        elif code == 404:
            detail = f"GitHub could not {action}: the notebook or the branch was not found."
        else:
            detail = f"GitHub could not {action} (HTTP {code})."
    else:
        detail = f"Failed to {action}: {exc}"
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


@router.get(
    "/{repo_id}/notebook",
    response_model=NotebookEditorResponse,
    summary="Open a notebook for editing",
)
async def read_repo_notebook(
    repo_id: int,
    branch: str,
    path: str,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotebookEditorResponse:
    """Return the notebook's cells (text and tags, no outputs) as ``branch`` has them now."""
    import json

    from core.github import get_file
    from core.notebook_edit import editor_cells

    repo = get_visible_repo_or_404(session, repo_id, current_user)
    notebook_path = _require_notebook_path(path)
    try:
        raw, sha = await get_file(repo.github_url, repo_token(repo, settings), branch, notebook_path)
    except Exception as exc:
        logger.error("repo.read_notebook_failed", repo_id=repo_id, branch=branch, error=str(exc))
        raise _github_error("read the notebook", exc) from exc
    try:
        notebook = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This file is not a valid notebook (its JSON cannot be read).",
        ) from exc

    linked = [
        project.name
        for project in linked_projects(session, repo)
        if project.branch == branch and project.notebook_path.strip("/") == notebook_path
    ]
    return NotebookEditorResponse(
        branch=branch,
        notebook_path=notebook_path,
        sha=sha,
        cells=[NotebookEditorCell(**cell) for cell in editor_cells(notebook)],
        linked_projects=linked,
    )


@router.put(
    "/{repo_id}/notebook",
    response_model=NotebookSaveResponse,
    summary="Commit an edited notebook to its branch",
)
async def save_repo_notebook(
    repo_id: int,
    body: NotebookSaveRequest,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotebookSaveResponse:
    """Swap the edited cells into the notebook and push it to the branch it came from.

    The edits are applied to the file as GitHub has it now, and only if that
    is still the version the editor opened (``sha``): a commit made meanwhile
    is never overwritten.
    """
    import json

    from core.github import FileChangedError, get_file, put_file
    from core.notebook_edit import apply_edits, serialize

    repo = get_visible_repo_or_404(session, repo_id, current_user)
    notebook_path = _require_notebook_path(body.notebook_path)
    token = repo_token(repo, settings)
    changed_elsewhere = HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="The notebook changed on GitHub since you opened it. Reload to get the latest version.",
    )
    try:
        raw, sha = await get_file(repo.github_url, token, body.branch, notebook_path)
    except Exception as exc:
        logger.error("repo.save_notebook_read_failed", repo_id=repo_id, error=str(exc))
        raise _github_error("read the notebook", exc) from exc
    if sha != body.sha:
        raise changed_elsewhere

    notebook = json.loads(raw)
    try:
        changed = apply_edits(notebook, {edit.index: edit.source for edit in body.cells})
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if changed == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="There are no changes to save.",
        )

    message = body.message.strip() or f"Update {notebook_path} from Maia"
    try:
        commit_sha, new_sha = await put_file(
            repo.github_url, token, body.branch, notebook_path, serialize(notebook), message, sha
        )
    except FileChangedError as exc:
        raise changed_elsewhere from exc
    except Exception as exc:
        logger.error("repo.save_notebook_failed", repo_id=repo_id, branch=body.branch, error=str(exc))
        raise _github_error("save the notebook", exc) from exc

    logger.info(
        "repo.notebook_saved",
        repo_id=repo_id,
        branch=body.branch,
        path=notebook_path,
        commit_sha=commit_sha,
        changed_cells=changed,
        user_id=current_user.id,
    )
    return NotebookSaveResponse(commit_sha=commit_sha, sha=new_sha, changed_cells=changed)


#: About 50,000 tokens: what one review may send to the AI provider.
_MAX_REVIEW_CHARS = 200_000


@router.post(
    "/{repo_id}/notebook/review",
    response_model=NotebookReviewResponse,
    summary="Have Maia review the cells open in the editor",
)
async def review_repo_notebook(
    repo_id: int,
    body: NotebookReviewRequest,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotebookReviewResponse:
    """Maia's comment on one cell (``focus_index``) or on the whole notebook, and the code she proposes.

    Reads and writes nothing on GitHub: the cells come from the editor, unsaved
    edits included, and her proposals go back to it as drafts for the user to
    keep or discard. Restricted to repositories the caller can see.
    """
    from fastapi.concurrency import run_in_threadpool

    from core.ai_advisor import advisor_configured, review_cells

    get_visible_repo_or_404(session, repo_id, current_user)
    if body.focus_index is not None and body.focus_index not in {cell.index for cell in body.cells}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cell {body.focus_index} is not one of the cells sent.",
        )
    cells = [cell.model_dump() for cell in body.cells]

    def too_long() -> bool:
        return sum(len(cell["source"]) for cell in cells) > _MAX_REVIEW_CHARS

    if too_long() and body.focus_index is not None:
        # Too long to send whole: the selected cell goes alone.
        cells = [cell for cell in cells if cell["index"] == body.focus_index]
    if too_long():
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="This notebook is too long to review at once. Select one cell and ask again.",
        )
    if not advisor_configured(settings):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"AI advisor provider '{settings.ai_advisor_provider}' is not "
                "configured on the server (missing API key or base URL)."
            ),
        )

    try:
        # shortcut: the request stays open for as long as the model takes; move to
        # Celery and polling, as insights do, if that starts timing out.
        review = await run_in_threadpool(
            review_cells, cells=cells, focus_index=body.focus_index, error=body.error
        )
    except Exception as exc:
        logger.error("repo.review_notebook_failed", repo_id=repo_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Maia could not review the notebook: {exc}",
        ) from exc
    return NotebookReviewResponse(**review)


async def launch_pipeline(
    repo: Repository,
    project: Project,
    branch: str,
    settings: AppSettings,
    session: Session,
    requested_model_name: str | None = None,
    parameters: dict[str, Any] | None = None,
) -> WebhookAccepted:
    """Pin ``branch`` to its HEAD commit and enqueue a run of ``project``'s notebook.

    Shared by the repository trigger and the project's "Run pipeline". Callers
    have already checked access and that ``project`` links a notebook of ``repo``.
    """
    from core.pipeline import get_pipeline_runner

    # One run per project at a time: while one is queued or running, hand back
    # that one instead of starting another, so the caller can follow it.
    existing = session.exec(
        select(Pipeline).where(
            Pipeline.project_id == project.id,
            Pipeline.status.in_(["queued", "running"]),  # type: ignore[union-attr]
        )
    ).first()
    if existing:
        return WebhookAccepted(status="already_queued", pipeline_id=existing.id)

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

    pipeline = Pipeline(
        repo_id=repo.id,  # type: ignore[arg-type]
        project_id=project.id,
        notebook_path=project.notebook_path,
        status="queued",
        commit_sha=commit_sha,
        branch=branch,
        requested_model_name=requested_model_name,
        parameters=parameters or {},
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
