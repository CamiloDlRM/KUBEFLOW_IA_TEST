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

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from core.ownership import (
    assert_repo_access,
    filter_projects_by_owner,
    get_visible_project_or_404,
    get_visible_repo_or_404,
)
from core.security import get_current_user
from db import get_session
from models.schemas import (
    DataSource,
    GoldTable,
    MessageResponse,
    Project,
    ProjectCreateRequest,
    ProjectRepositoryResponse,
    ProjectResponse,
    ProjectUpdateRequest,
    Repository,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/projects", tags=["projects"])


def _render(session: Session, project: Project) -> ProjectResponse:
    """Describe a project with the two counts its card needs."""
    repository = session.exec(
        select(Repository).where(
            Repository.project_id == project.id,
            Repository.is_active == True,  # noqa: E712
        )
    ).first()

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
            ProjectRepositoryResponse.model_validate(repository) if repository else None
        ),
        sources=sources,
        gold_rows=gold.rows if gold else 0,
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
) -> ProjectResponse:
    """Attach a repository the caller already owns.

    Both sides are checked: a caller who can see the project is not thereby
    entitled to attach somebody else's repository to it, which would make that
    repository's pipelines run under this project's roof.

    A repository belongs to one project at a time. Moving it is allowed and is
    what re-linking does, but it is logged, because it changes which data the
    notebook will be handed.
    """
    project = get_visible_project_or_404(session, project_id, current_user)
    repo = get_visible_repo_or_404(session, repo_id, current_user)
    assert_repo_access(repo, current_user)

    if repo.project_id not in (None, project.id):
        logger.info(
            "project.repository_moved",
            repo_id=repo.id,
            from_project=repo.project_id,
            to_project=project.id,
        )

    repo.project_id = project.id
    # Keep the two owners equal: the project decides, and every existing route
    # reads the repository's column.
    repo.owner_id = project.owner_id
    session.add(repo)
    session.commit()

    logger.info("project.repository_linked", project_id=project.id, repo_id=repo.id)
    return _render(session, project)


@router.delete(
    "/{project_id}/repository",
    response_model=ProjectResponse,
    summary="Unlink the repository from a project",
)
async def unlink_repository(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectResponse:
    """Detach the code. The data factory is untouched — it was never the repo's."""
    project = get_visible_project_or_404(session, project_id, current_user)
    repo = session.exec(
        select(Repository).where(Repository.project_id == project.id)
    ).first()
    if repo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This project has no repository linked.",
        )

    repo.project_id = None
    session.add(repo)
    session.commit()

    logger.info("project.repository_unlinked", project_id=project.id, repo_id=repo.id)
    return _render(session, project)


@router.delete(
    "/{project_id}", response_model=MessageResponse, summary="Archive a project"
)
async def delete_project(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
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
    return MessageResponse(message=f"Project {project_id} archived.")
