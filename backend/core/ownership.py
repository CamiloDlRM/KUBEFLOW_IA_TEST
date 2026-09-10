"""Multi-tenancy helpers: who is allowed to see which resource.

Every user-facing resource of the platform hangs off a :class:`Repository`::

    Repository ──< Pipeline ──< PipelineInsight
        │              └──< ModelDeployment
        └──< Dataset

so a single rule governs all of them:

    **a member only sees the repositories they own; an admin sees everything.**

These helpers centralise that rule so each router expresses it in one line
instead of re-implementing (and eventually mis-implementing) it.

Why 404 and not 403
-------------------
When a member touches a resource owned by somebody else the API answers
``404 Not Found``, never ``403 Forbidden``. A 403 is an *acknowledgement that
the id exists*: an attacker could walk the sequential ``/repos/{id}`` space and
map out how many repositories other tenants own, when they were created and
which ids to target next, purely from the status code. Answering 404 makes
another tenant's repository indistinguishable from one that never existed, so
nothing leaks across the tenant boundary. The trade-off is a slightly less
informative error for the rare legitimate case (an admin demoted to member
following an old link), which is an acceptable price.

Orphan rows fail closed
-----------------------
``repositories.owner_id`` is nullable: migration ``0007`` adopts pre-existing
rows into the first admin account, but a deployment with no admin at all (or a
row inserted out of band) can still end up with ``owner_id IS NULL``. Such a
repository — and everything derived from it — is treated as visible to admins
only. Failing closed keeps unowned data from silently becoming public to every
member; an admin can always re-assign it.
"""
from __future__ import annotations

from typing import Any, Sequence

import structlog
from fastapi import HTTPException, status
from sqlmodel import Session, select

from models.schemas import ModelDeployment, Pipeline, Repository, User

logger = structlog.get_logger(__name__)

#: Value of ``User.role`` that grants platform-wide visibility.
ADMIN_ROLE = "admin"


# ---------------------------------------------------------------------------
# Predicates
# ---------------------------------------------------------------------------

def is_admin(user: User | None) -> bool:
    """Return ``True`` when ``user`` has the platform-wide admin role.

    Args:
        user: The authenticated user (``None`` is never an admin).
    """
    return user is not None and user.role == ADMIN_ROLE


def owns_repo(repo: Repository | None, user: User) -> bool:
    """Return ``True`` when ``user`` is the recorded owner of ``repo``.

    Repositories with ``owner_id IS NULL`` are considered owned by nobody (see
    the module docstring): this returns ``False`` for them.
    """
    if repo is None or repo.owner_id is None:
        return False
    return repo.owner_id == user.id


def can_access_repo(repo: Repository | None, user: User) -> bool:
    """Return ``True`` when ``user`` may see/manage ``repo`` (admin or owner)."""
    return is_admin(user) or owns_repo(repo, user)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

def repo_not_found(repo_id: Any) -> HTTPException:
    """Build the 404 used both for missing and for non-visible repositories."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Repository {repo_id} not found.",
    )


def pipeline_not_found(pipeline_id: Any) -> HTTPException:
    """Build the 404 used both for missing and for non-visible pipelines."""
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Pipeline {pipeline_id} not found.",
    )


# ---------------------------------------------------------------------------
# Assertions on already-loaded objects
# ---------------------------------------------------------------------------

def assert_repo_access(repo: Repository, user: User) -> Repository:
    """Return ``repo`` if ``user`` may access it, otherwise raise a 404.

    Args:
        repo: An already-loaded repository row.
        user: The authenticated user.

    Raises:
        HTTPException: 404 when the user is neither an admin nor the owner.
            404 (not 403) on purpose — see the module docstring.
    """
    if not can_access_repo(repo, user):
        logger.info(
            "ownership.repo_access_denied",
            repo_id=repo.id,
            owner_id=repo.owner_id,
            user_id=user.id,
        )
        raise repo_not_found(repo.id)
    return repo


# ---------------------------------------------------------------------------
# Fetch-and-check helpers
# ---------------------------------------------------------------------------

def get_visible_repo_or_404(
    session: Session,
    repo_id: int,
    user: User,
) -> Repository:
    """Load ``repo_id`` and return it only if ``user`` may see it.

    Raises:
        HTTPException: 404 when the repository does not exist *or* belongs to
            somebody else — the two cases are deliberately indistinguishable.
    """
    repo = session.get(Repository, repo_id)
    if repo is None:
        raise repo_not_found(repo_id)
    return assert_repo_access(repo, user)


def get_visible_pipeline_or_404(
    session: Session,
    pipeline_id: str,
    user: User,
) -> Pipeline:
    """Load ``pipeline_id`` and return it only if its repository is visible.

    Raises:
        HTTPException: 404 when the pipeline does not exist, its repository is
            gone, or that repository belongs to somebody else.
    """
    pipeline = session.get(Pipeline, pipeline_id)
    if pipeline is None:
        raise pipeline_not_found(pipeline_id)
    if is_admin(user):
        return pipeline

    repo = session.get(Repository, pipeline.repo_id)
    if not can_access_repo(repo, user):
        logger.info(
            "ownership.pipeline_access_denied",
            pipeline_id=pipeline_id,
            repo_id=pipeline.repo_id,
            user_id=user.id,
        )
        raise pipeline_not_found(pipeline_id)
    return pipeline


# ---------------------------------------------------------------------------
# Query filters
# ---------------------------------------------------------------------------

def filter_repos_by_owner(statement: Any, user: User) -> Any:
    """Restrict a ``select(Repository)`` statement to what ``user`` may see.

    Admins get the statement back untouched; members get an
    ``owner_id == user.id`` predicate (which also excludes orphan rows, since
    ``NULL = x`` is never true in SQL).

    Args:
        statement: Any select whose FROM includes ``Repository``.
        user: The authenticated user.

    Returns:
        The (possibly) filtered statement.
    """
    if is_admin(user):
        return statement
    return statement.where(Repository.owner_id == user.id)


def visible_repo_ids(session: Session, user: User) -> list[int] | None:
    """Return the repository ids ``user`` may see.

    Returns:
        ``None`` when the user is an admin, meaning *no restriction at all*
        (callers must not turn that into an empty ``IN`` clause). Otherwise the
        — possibly empty — list of the user's own repository ids.
    """
    if is_admin(user):
        return None
    rows = session.exec(
        select(Repository.id).where(Repository.owner_id == user.id)  # type: ignore[arg-type]
    ).all()
    return [r for r in rows if r is not None]


def visible_pipeline_ids(session: Session, user: User) -> list[str] | None:
    """Return the pipeline ids ``user`` may see (via their repositories).

    Returns:
        ``None`` for admins (no restriction), otherwise the list of pipeline
        ids belonging to the user's repositories.
    """
    repo_ids = visible_repo_ids(session, user)
    if repo_ids is None:
        return None
    if not repo_ids:
        return []
    rows = session.exec(
        select(Pipeline.id).where(Pipeline.repo_id.in_(repo_ids))  # type: ignore[union-attr]
    ).all()
    return [r for r in rows if r is not None]


def restrict_by_repo(statement: Any, column: Any, session: Session, user: User) -> Any:
    """Restrict ``statement`` so ``column`` (a repo FK) stays inside what ``user`` sees.

    Args:
        statement: The select to filter.
        column: The column holding the repository id (e.g. ``Pipeline.repo_id``).
        session: Active database session.
        user: The authenticated user.
    """
    repo_ids = visible_repo_ids(session, user)
    if repo_ids is None:
        return statement
    return statement.where(column.in_(repo_ids))


def restrict_by_pipeline(statement: Any, column: Any, session: Session, user: User) -> Any:
    """Restrict ``statement`` so ``column`` (a pipeline FK) stays visible to ``user``.

    Rows whose pipeline FK is ``NULL`` are dropped for members: an unlinked row
    cannot be attributed to any repository, so it fails closed (admins only).
    """
    pipeline_ids = visible_pipeline_ids(session, user)
    if pipeline_ids is None:
        return statement
    return statement.where(column.in_(pipeline_ids))


# ---------------------------------------------------------------------------
# Deployments
# ---------------------------------------------------------------------------

def can_access_deployment(
    session: Session,
    deployment: ModelDeployment,
    user: User,
) -> bool:
    """Return ``True`` when ``user`` may act on ``deployment``.

    A deployment is reached through ``pipeline_id -> Pipeline -> Repository``.
    Deployments created by the pipeline runner always carry a ``pipeline_id``;
    legacy rows that do not cannot be attributed to any owner, so they are
    restricted to admins (fail closed).
    """
    if is_admin(user):
        return True
    if not deployment.pipeline_id:
        return False
    pipeline = session.get(Pipeline, deployment.pipeline_id)
    if pipeline is None:
        return False
    return can_access_repo(session.get(Repository, pipeline.repo_id), user)


def assert_model_access(
    session: Session,
    deployments: Sequence[ModelDeployment],
    model_name: str,
    user: User,
) -> list[ModelDeployment]:
    """Return the subset of ``deployments`` visible to ``user``, or raise a 404.

    Models are addressed by name rather than by id, so a name may map to
    several deployment rows (one per version). The caller passes every row it
    found for that name; if at least one is visible the user is allowed to act
    on the model, otherwise the model is reported as non-existent.

    Args:
        session: Active database session.
        deployments: All deployment rows carrying ``model_name``.
        model_name: The model being addressed (used in the error message).
        user: The authenticated user.

    Raises:
        HTTPException: 404 when rows exist but none of them is visible.
    """
    visible = [d for d in deployments if can_access_deployment(session, d, user)]
    if deployments and not visible:
        logger.info(
            "ownership.model_access_denied",
            model_name=model_name,
            user_id=user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_name}' not found.",
        )
    return visible
