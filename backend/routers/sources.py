"""Data source endpoints: register an external system and extract from it.

A source belongs to a repository, so it inherits that repository's owner and
every route here is filtered the same way as the rest of the platform —
somebody else's source answers 404, not 403, so its existence is not disclosed
either.

One thing to be aware of when reading this: ``extraction_sql`` is SQL supplied
by the caller and executed against the external system. That is the point of
the feature — an extraction is a query — but it means registering a source is
a privileged act, bounded by the credential the source names. See
``core.ingestion`` for why the credential itself is never stored here.
"""
from __future__ import annotations

from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from core.ingestion import IngestionError, validate_sql
from core.ownership import get_visible_repo_or_404, restrict_by_repo
from core.security import get_current_user
from db import get_session
from models.schemas import (
    DataSource,
    DataSourceCreateRequest,
    DataSourceResponse,
    IngestionRun,
    IngestionRunResponse,
    MessageResponse,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/sources", tags=["sources"])


def _get_source_or_404(session: Session, source_id: int, user: User) -> DataSource:
    """Return the source, or 404 when the caller may not see it."""
    source = session.get(DataSource, source_id)
    if source is not None:
        # Visibility is inherited from the repository, so this also covers a
        # source whose repository was transferred to somebody else.
        try:
            get_visible_repo_or_404(session, source.repo_id, user)
        except HTTPException:
            source = None
    if source is None or not source.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Data source {source_id} not found.",
        )
    return source


@router.get("", response_model=list[DataSourceResponse], summary="List data sources")
async def list_sources(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[DataSourceResponse]:
    """Return the data sources of repositories the caller can see."""
    statement = restrict_by_repo(
        select(DataSource).where(DataSource.is_active == True),  # noqa: E712
        DataSource.repo_id,
        session,
        current_user,
    )
    return [
        DataSourceResponse.model_validate(source) for source in session.exec(statement).all()
    ]


@router.post(
    "",
    response_model=DataSourceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register an external data source",
)
async def create_source(
    body: DataSourceCreateRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DataSourceResponse:
    """Register a system to extract from.

    The SQL is validated for the watermark token before the source is stored:
    an extraction without it silently re-reads the whole source on every run,
    which looks like success while multiplying the data. Better to refuse at
    registration than to discover it from a training set that has grown.
    """
    get_visible_repo_or_404(session, body.repo_id, current_user)

    try:
        validate_sql(body.extraction_sql)
    except IngestionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    source = DataSource(
        repo_id=body.repo_id,
        name=body.name,
        kind=body.kind,
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password_env=body.password_env,
        extraction_sql=body.extraction_sql,
        watermark_column=body.watermark_column,
    )
    session.add(source)
    session.commit()
    session.refresh(source)

    logger.info(
        "source.created", source_id=source.id, repo_id=source.repo_id, kind=source.kind
    )
    return DataSourceResponse.model_validate(source)


@router.get(
    "/{source_id}", response_model=DataSourceResponse, summary="Get one data source"
)
async def get_source(
    source_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DataSourceResponse:
    return DataSourceResponse.model_validate(
        _get_source_or_404(session, source_id, current_user)
    )


@router.post(
    "/{source_id}/ingest",
    response_model=IngestionRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Run an incremental extraction",
)
async def trigger_ingestion(
    source_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> IngestionRunResponse:
    """Queue an extraction of everything recorded since the last run.

    Refuses while one is already in flight: two concurrent extractions would
    both read from the same watermark and land overlapping datasets, and
    duplicated training rows are considerably harder to notice than a rejected
    request.
    """
    source = _get_source_or_404(session, source_id, current_user)

    in_flight = session.exec(
        select(IngestionRun).where(
            IngestionRun.source_id == source_id,
            IngestionRun.status.in_(["queued", "running"]),  # type: ignore[attr-defined]
        )
    ).first()
    if in_flight:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"An extraction is already in progress for this source "
                f"(run {in_flight.id})."
            ),
        )

    run = IngestionRun(source_id=source_id, status="queued")
    session.add(run)
    session.commit()
    session.refresh(run)

    from tasks.celery_tasks import run_ingestion

    run_ingestion.apply_async(args=[source_id, run.id])
    logger.info("ingestion.enqueued", source_id=source_id, run_id=run.id)
    return IngestionRunResponse.model_validate(run)


@router.get(
    "/{source_id}/runs",
    response_model=list[IngestionRunResponse],
    summary="List extractions of a source",
)
async def list_runs(
    source_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    limit: int = 50,
) -> list[IngestionRunResponse]:
    """Return this source's extraction history, newest first.

    This is the lineage record: which slice of the source produced which
    dataset, and therefore which rows a model was trained on.
    """
    _get_source_or_404(session, source_id, current_user)
    runs = session.exec(
        select(IngestionRun)
        .where(IngestionRun.source_id == source_id)
        .order_by(IngestionRun.started_at.desc().nullslast())  # type: ignore[union-attr]
        .limit(max(1, min(limit, 200)))
    ).all()
    return [IngestionRunResponse.model_validate(run) for run in runs]


@router.delete(
    "/{source_id}", response_model=MessageResponse, summary="Deactivate a data source"
)
async def delete_source(
    source_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Deactivate a source, keeping its runs.

    Soft delete on purpose: the ingestion runs reference it, and they are the
    lineage of datasets that may still be training models. Removing the row
    would leave those datasets unable to say where they came from.
    """
    source = _get_source_or_404(session, source_id, current_user)
    source.is_active = False
    session.add(source)
    session.commit()

    logger.info("source.deactivated", source_id=source_id)
    return MessageResponse(message=f"Data source {source_id} deactivated.")
