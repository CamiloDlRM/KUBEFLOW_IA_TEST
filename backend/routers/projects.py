"""Project endpoints: the container the rest of the work hangs off.

A project is created with a name and nothing else. That is the point — before
this existed you needed a GitHub URL before you could connect a database, which
put the code first in a process where the data usually comes first and takes
longest.

Linking a repository is a separate act, and an undoable one. Unlinking leaves
the data factory exactly as it was, because the repository was only ever the
code.
"""
from __future__ import annotations

import re
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from core.config import AppSettings, get_settings
from core.github_credentials import repo_token
from core.notebook_parser import MODEL_NAME_PATTERN
from core.ownership import (
    assert_repo_access,
    filter_projects_by_owner,
    get_visible_project_or_404,
    get_visible_repo_or_404,
    linked_projects,
)
from core.security import get_current_user
from db import get_session
from models.schemas import (
    DataSource,
    Dataset,
    GoldTable,
    MessageResponse,
    NotebookCellsResponse,
    PipelineInputRequest,
    PipelineInputResponse,
    Project,
    ProjectCreateRequest,
    ProjectDatasetResponse,
    ProjectRunRequest,
    ProjectRepositoryResponse,
    ProjectResponse,
    ProjectUpdateRequest,
    Repository,
    User,
    WebhookAccepted,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/projects", tags=["projects"])


def _active_dataset(session: Session, project_id: int | None) -> Dataset | None:
    """The dataset a pipeline of this project is handed (same lookup as the worker)."""
    return session.exec(
        select(Dataset)
        .where(Dataset.project_id == project_id, Dataset.is_active == True)  # noqa: E712
        .order_by(Dataset.created_at.desc())  # type: ignore[union-attr]
    ).first()


def _render(session: Session, project: Project) -> ProjectResponse:
    """Describe a project with the two counts its card needs."""
    repository = _linked_repo(session, project)

    sources = len(
        session.exec(
            select(DataSource).where(
                DataSource.project_id == project.id,
                DataSource.is_active == True,  # noqa: E712
                DataSource.kind != "upload",
            )
        ).all()
    )
    gold = session.exec(
        select(GoldTable).where(GoldTable.project_id == project.id)
    ).first()

    return ProjectResponse(
        id=project.id or 0,
        name=project.name,
        description=project.description,
        owner_id=project.owner_id,
        created_at=project.created_at,
        repository=(
            ProjectRepositoryResponse(
                id=repository.id,  # type: ignore[arg-type]
                github_url=repository.github_url,
                branch=project.branch,
                notebook_path=project.notebook_path,
            )
            if repository
            else None
        ),
        sources=sources,
        gold_rows=gold.rows if gold else 0,
        active_dataset=(
            ProjectDatasetResponse.model_validate(dataset)
            if (dataset := _active_dataset(session, project.id))
            else None
        ),
    )

def _linked_repo(session: Session, project: Project) -> Repository | None:
    """The repository the project's notebook lives in, if it links one."""
    if project.repo_id is None:
        return None
    repo = session.get(Repository, project.repo_id)
    return repo if repo is not None and repo.is_active else None


async def _sync_webhook(
    session: Session, repo: Repository | None, settings: AppSettings
) -> None:
    """Mirror "does any active project link a notebook of this repository?"
    onto its GitHub webhook.

    Best-effort: the webhook handler already ignores pushes no project links,
    so a GitHub failure only leaves the flag stale and must not undo the
    link/unlink the user asked for.
    """
    if repo is None or not repo.webhook_id:
        return
    from core.github import set_webhook_active

    active = bool(linked_projects(session, repo))

    try:
        await set_webhook_active(
            repo.github_url, repo_token(repo, settings), repo.webhook_id, active
        )
    except Exception as exc:  # noqa: BLE001 - best-effort by design
        logger.warning(
            "project.webhook_sync_failed", repo_id=repo.id, active=active, error=str(exc)
        )

@router.get("", response_model=list[ProjectResponse], summary="List projects")
async def list_projects(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ProjectResponse]:
    statement = filter_projects_by_owner(
        select(Project).where(Project.is_active == True),  # noqa: E712
        current_user,
    )
    return [
        _render(session, project)
        for project in session.exec(statement.order_by(Project.created_at.desc())).all()  # type: ignore[union-attr]
    ]


@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start a project",
)
async def create_project(
    body: ProjectCreateRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    project = Project(
        name=body.name.strip(),
        description=body.description.strip(),
        owner_id=current_user.id,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    logger.info("project.created", project_id=project.id, owner_id=current_user.id)
    return _render(session, project)


@router.get("/{project_id}", response_model=ProjectResponse, summary="Get one project")
async def get_project(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    return _render(session, get_visible_project_or_404(session, project_id, current_user))


@router.patch("/{project_id}", response_model=ProjectResponse, summary="Rename a project")
async def update_project(
    project_id: int,
    body: ProjectUpdateRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    project = get_visible_project_or_404(session, project_id, current_user)
    if body.name is not None:
        project.name = body.name.strip()
    if body.description is not None:
        project.description = body.description.strip()
    session.add(project)
    session.commit()
    session.refresh(project)
    return _render(session, project)


@router.put(
    "/{project_id}/repository",
    response_model=ProjectResponse,
    summary="Link a repository to a project",
)
async def link_repository(
    project_id: int,
    repo_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
    branch: str = "main",
    notebook_path: str = "",
) -> ProjectResponse:
    """Link one notebook of a repository the caller already owns.

    Both sides are checked: a caller who can see the project is not thereby
    entitled to attach somebody else's repository to it, which would make that
    repository's pipelines run under this project's roof.

    The unit is the notebook: several projects may share a repository, but a
    notebook runs in one project only. Re-linking replaces the project's
    previous notebook.
    """
    project = get_visible_project_or_404(session, project_id, current_user)
    repo = get_visible_repo_or_404(session, repo_id, current_user)
    assert_repo_access(repo, current_user)
    path = notebook_path.strip().strip("/")
    if not path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select a notebook before linking the repository to a project.",
        )
    # Pipelines are visible through their repository's owner, so a project of
    # someone else would run notebooks whose runs it could never see.
    if repo.owner_id != project.owner_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The repository and the project belong to different owners.",
        )
    taken = session.exec(
        select(Project).where(
            Project.repo_id == repo.id,
            Project.notebook_path == path,
            Project.is_active == True,  # noqa: E712
            Project.id != project.id,
        )
    ).first()
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Notebook '{path}' is already linked to project '{taken.name}'.",
        )

    previous = _linked_repo(session, project)
    project.repo_id = repo.id
    project.branch = branch.strip() or "main"
    project.notebook_path = path
    session.add(project)
    session.commit()

    logger.info(
        "project.notebook_linked", project_id=project.id, repo_id=repo.id, notebook_path=path
    )
    await _sync_webhook(session, repo, settings)
    if previous is not None and previous.id != repo.id:
        await _sync_webhook(session, previous, settings)
    return _render(session, project)


@router.post(
    "/{project_id}/run",
    response_model=WebhookAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Run the project's notebook on its gold data",
)
async def run_project(
    project_id: int,
    body: ProjectRunRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> WebhookAccepted:
    """Launch a pipeline of the linked notebook, producing ``model_name``.

    The same conditions the "Run pipeline" button shows are enforced here: a
    linked notebook and a built gold layer. The run uses the linked branch; the
    version is assigned by the worker.
    """
    from routers.repos import launch_pipeline

    project = get_visible_project_or_404(session, project_id, current_user)
    model_name = body.model_name.strip()
    if not re.fullmatch(MODEL_NAME_PATTERN, model_name):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Model name may only use letters, digits, '_', '.' or '-' (max 200).",
        )
    repo = _linked_repo(session, project)
    if repo is None or not project.notebook_path:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Link a repository and select a notebook before running a pipeline.",
        )
    # A chosen layer is checked by the worker when it resolves it.
    if not (project.pipeline_input or {}).get("layer") and _active_dataset(session, project.id) is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Build the gold layer in the Data Factory before running a pipeline.",
        )

    return await launch_pipeline(
        repo, project, project.branch, settings, session, requested_model_name=model_name
    )


@router.delete(
    "/{project_id}/repository",
    response_model=ProjectResponse,
    summary="Unlink the repository from a project",
)
async def unlink_repository(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> ProjectResponse:
    """Detach the code. The data factory is untouched — it was never the repo's."""
    project = get_visible_project_or_404(session, project_id, current_user)
    if project.repo_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This project has no repository linked.",
        )

    repo = session.get(Repository, project.repo_id)
    project.repo_id = None
    project.notebook_path = ""
    session.add(project)
    session.commit()

    logger.info("project.repository_unlinked", project_id=project.id, repo_id=repo and repo.id)
    await _sync_webhook(session, repo, settings)
    return _render(session, project)


@router.delete(
    "/{project_id}", response_model=MessageResponse, summary="Archive a project"
)
async def delete_project(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> MessageResponse:
    """Archive rather than delete.

    A project's datasets are the lineage of models that may still be deployed,
    and its layers are objects in storage. Removing the row would leave those
    unable to say what they came from, which is the thing this platform exists
    to avoid.
    """
    project = get_visible_project_or_404(session, project_id, current_user)
    project.is_active = False
    session.add(project)
    session.commit()

    logger.info("project.archived", project_id=project_id)
    await _sync_webhook(session, _linked_repo(session, project), settings)
    return MessageResponse(message=f"Project {project_id} archived.")


@router.get(
    "/{project_id}/notebook",
    response_model=NotebookCellsResponse,
    summary="The linked notebook's code by phase, as its branch has it now",
)
async def get_project_notebook(
    project_id: int,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    branch: str = "",
) -> NotebookCellsResponse:
    """Read the project's notebook from GitHub and split it by phase.

    A run records the code it executed; this is the code the *next* run will
    execute, which is what there is to show before the first one.
    """
    import httpx

    from core.github import download_notebook
    from core.notebook_parser import notebook_cells

    project = get_visible_project_or_404(session, project_id, current_user)
    repo = _linked_repo(session, project)
    path = project.notebook_path.strip("/")
    if repo is None or not path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This project has no notebook selected.",
        )
    ref = branch.strip() or project.branch
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
        logger.error("project.notebook_failed", project_id=project_id, branch=ref, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to read the notebook from GitHub: {exc}",
        ) from exc
    return NotebookCellsResponse(branch=ref, notebook_path=path, cells=notebook_cells(notebook))


def _describe_input(session: Session, project: Project) -> PipelineInputResponse:
    """The project's choice and what it resolves to, or why it does not."""
    from core import medallion, pipeline_input

    response = PipelineInputResponse(choice=dict(project.pipeline_input or {}))
    try:
        choice = pipeline_input.InputChoice.parse(project.pipeline_input)
        if choice.layer:
            resolved = pipeline_input.resolve(session, project.id, choice)
            response.resolved = resolved.as_dict() if resolved else None
    except (pipeline_input.InputError, medallion.MedallionError) as exc:
        response.error = str(exc)
    return response


@router.get(
    "/{project_id}/pipeline-input",
    response_model=PipelineInputResponse,
    summary="What this project's pipeline trains on",
)
def get_pipeline_input(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PipelineInputResponse:
    """Return the choice, and what it would mount if a run started now.

    A choice that no longer resolves is reported in ``error`` rather than as a
    failed request: the project still exists and so does its choice, and the
    view needs both to show what went stale.
    """
    project = get_visible_project_or_404(session, project_id, current_user)
    return _describe_input(session, project)


@router.put(
    "/{project_id}/pipeline-input",
    response_model=PipelineInputResponse,
    summary="Choose what this project's pipeline trains on",
)
def set_pipeline_input(
    project_id: int,
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

    project = get_visible_project_or_404(session, project_id, current_user)
    try:
        choice = pipeline_input.InputChoice.parse(body.model_dump())
        if choice.layer:
            pipeline_input.resolve(session, project.id, choice)
    except pipeline_input.InputError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except medallion.MedallionError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Object storage could not be read: {exc}",
        )

    project.pipeline_input = choice.as_dict()
    session.add(project)
    session.commit()
    session.refresh(project)
    logger.info("project.pipeline_input.set", project_id=project_id, choice=project.pipeline_input)
    return _describe_input(session, project)
