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

from core.ingestion import IngestionError, preview, validate_sql
from core.ownership import get_visible_repo_or_404, restrict_by_repo
from core.security import get_current_user
from db import get_session
from models.schemas import (
    DataSource,
    DataSourceCreateRequest,
    DataSourcePreviewRequest,
    DataSourcePreviewResponse,
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
    """Return the external systems of repositories the caller can see.

    Uploads are modelled as sources so the medallion machinery treats both
    doors alike, but they are not listed here: this endpoint backs the panel
    for *connecting* a system, and a pseudo-source with no host, no credential
    and no query would be an entry the user cannot act on. They appear where
    they are meaningful — as a stream in the layers, and as a relation gold can
    query.
    """
    statement = restrict_by_repo(
        select(DataSource).where(
            DataSource.is_active == True,  # noqa: E712
            DataSource.kind != "upload",
        ),
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
        normalize_text_column=body.normalize_text_column,
        normalize_code_column=body.normalize_code_column,
    )
    session.add(source)
    session.commit()
    session.refresh(source)

    logger.info(
        "source.created", source_id=source.id, repo_id=source.repo_id, kind=source.kind
    )
    return DataSourceResponse.model_validate(source)


@router.post(
    "/preview",
    response_model=DataSourcePreviewResponse,
    summary="See what an extraction would return, without running one",
)
async def preview_source(
    body: DataSourcePreviewRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> DataSourcePreviewResponse:
    """Run the query for a handful of rows and return them.

    Nothing is stored and no watermark moves, so this is safe to call while
    still writing the query. It answers the four questions that previously
    could only be answered by running a real extraction against a live
    database: whether the credentials work, whether the SQL is valid, which
    columns come back, and what the data looks like.

    Declared before ``/{source_id}`` because FastAPI matches routes in order
    and ``preview`` would otherwise be read as a source id.

    The caller must own the repository, and the connection still depends on a
    credential an operator provisioned — so this grants no authority that
    registering a source and running it did not already grant.
    """
    get_visible_repo_or_404(session, body.repo_id, current_user)

    candidate = DataSource(
        repo_id=body.repo_id,
        kind=body.kind,
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password_env=body.password_env,
        extraction_sql=body.extraction_sql,
        watermark_column="",
    )

    try:
        result = preview(candidate, limit=body.limit)
    except IngestionError as exc:
        # The reason is the whole value of this endpoint: a wrong table name, a
        # missing credential and an unreachable host must read differently.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )

    logger.info(
        "source.previewed",
        repo_id=body.repo_id,
        host=body.host,
        rows=len(result.rows),
        columns=len(result.columns),
    )
    return DataSourcePreviewResponse(
        columns=result.columns,
        rows=result.rows,
        profile=result.profile,
        truncated=result.truncated,
    )


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
    if source.kind == "upload":
        # It has no host, no credential and no query. Extracting from it would
        # fail deep inside the worker with "unsupported source kind"; refusing
        # here says the actual reason.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This is an uploaded file, not a connected system. It is "
                "re-processed by uploading it again."
            ),
        )

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
