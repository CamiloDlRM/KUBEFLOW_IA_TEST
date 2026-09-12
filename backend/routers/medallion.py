"""Endpoints for looking at a project's three layers, and defining gold.

A medallion architecture whose layers cannot be seen is a directory naming
convention. These routes exist so the difference between bronze, silver and
gold is something a user observes — the same rows, three times, with a report
of what changed between each — rather than something the documentation asserts.

Two decisions about cost are worth knowing.

The **summary** reads no data at all. Row counts per layer are already recorded
when they are produced — on the ingestion run for bronze and silver, on the
gold table for gold — so the overview costs one object listing per layer and
would cost the same if a project held a hundred million rows.

The **preview** reads exactly one object, and only its first row group. Parquet
makes that a bounded read whatever the file's size.
"""
from __future__ import annotations

import tempfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from core import gold as gold_module
from core import medallion
from core.ownership import get_visible_project_or_404
from core.security import get_current_user
from db import get_session
from models.schemas import (
    DataSource,
    DiffColumnResponse,
    DiffRowResponse,
    GoldDefinitionRequest,
    GoldPreviewRequest,
    GoldPreviewResponse,
    GoldSuggestRequest,
    GoldSuggestResponse,
    GoldTable,
    IngestionRun,
    LayerDiffResponse,
    LayerPreviewResponse,
    LayerStreamResponse,
    LayerSummaryResponse,
    MedallionResponse,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/projects", tags=["medallion"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _relation_name(source_id: int, source_name: str) -> str:
    """The name a source's silver is queried under. Mirrors the worker's."""
    from tasks.celery_tasks import _relation_name as worker_name

    return worker_name(source_id, source_name)


def _sources_of(session: Session, project_id: int) -> list[DataSource]:
    return list(
        session.exec(select(DataSource).where(DataSource.project_id == project_id)).all()
    )


def _runs_by_source(session: Session, source_ids: list[int]) -> dict[int, list[IngestionRun]]:
    """Successful runs, grouped by source. These carry the row counts."""
    if not source_ids:
        return {}
    runs = session.exec(
        select(IngestionRun).where(
            IngestionRun.source_id.in_(source_ids),  # type: ignore[attr-defined]
            IngestionRun.status == "success",
        )
    ).all()
    grouped: dict[int, list[IngestionRun]] = {}
    for run in runs:
        grouped.setdefault(run.source_id, []).append(run)
    return grouped


def _gold_of(session: Session, project_id: int) -> GoldTable | None:
    return session.exec(select(GoldTable).where(GoldTable.project_id == project_id)).first()


def _summarise(
    layer: str, project_id: int, sources: list[DataSource], runs: dict[int, list[IngestionRun]]
) -> LayerSummaryResponse:
    """Describe bronze or silver without reading a single row."""
    summary = LayerSummaryResponse(layer=layer, bucket=medallion.bucket_for(layer))
    sizes: dict[str, int] = {}
    stamps: list[datetime] = []

    for source in sources:
        if source.id is None:
            continue
        objects = medallion.list_layer(layer, medallion.stream_prefix(project_id, source.id))
        stream = LayerStreamResponse(
            source_id=source.id,
            source_name=source.name,
            relation=_relation_name(source.id, source.name),
            objects=len(objects),
            size_bytes=sum(item.size_bytes for item in objects),
        )
        for item in objects:
            if item.last_modified:
                stamps.append(item.last_modified)
            sizes[item.key] = item.size_bytes

        for run in runs.get(source.id, []):
            # Only runs that actually landed in this layer are counted. A run
            # made before the medallion existed succeeded and has a row count,
            # but its output went to the datasets bucket — counting it here
            # would put rows in a layer that does not hold them, and the card
            # would report more rows than its own file list can account for.
            if not (run.bronze_key if layer == "bronze" else run.silver_key):
                continue

            if layer == "bronze":
                stream.rows += run.rows_extracted
            else:
                # Silver's count is what survived cleaning, which is not the
                # extracted count: duplicate rows were removed. Reporting the
                # extracted number here would make the layers look identical
                # and hide the one thing this view exists to show.
                #
                # `or {}` guards a run that landed without a report. Falling
                # back to the extracted count is the honest answer there: the
                # rows are in the layer, we just cannot say how many the
                # cleaning removed.
                report = run.quality_report or {}
                stream.rows += int(report.get("rows_out", run.rows_extracted))

        if stream.objects or stream.rows:
            summary.streams.append(stream)
        summary.objects += stream.objects
        summary.rows += stream.rows
        summary.size_bytes += stream.size_bytes

    summary.last_updated = max(stamps) if stamps else None
    return summary


def _summarise_gold(project_id: int, table: GoldTable | None) -> LayerSummaryResponse:
    summary = LayerSummaryResponse(layer="gold", bucket=medallion.bucket_for("gold"))
    if table is None:
        return summary

    # The definition is reported whether or not it has ever been built. A
    # project that has just written a query and not yet run an extraction would
    # otherwise be told it is still on the default, which is the opposite of
    # what it just did.
    summary.is_default_definition = not table.sql
    summary.version = table.version
    summary.build_error = table.build_error
    if table.sql:
        summary.sql = table.sql
    elif table.relations:
        # Show the default expanded rather than blank, so the user can read
        # what is actually running before deciding to replace it.
        summary.sql = gold_module.default_sql(sorted(table.relations))

    if not table.object_key:
        return summary

    objects = medallion.list_layer("gold", medallion.gold_prefix(project_id, table.name))
    summary.objects = len(objects)
    summary.size_bytes = sum(item.size_bytes for item in objects)
    summary.rows = table.rows
    summary.last_updated = table.built_at
    summary.streams = [
        LayerStreamResponse(relation=name, rows=rows)
        for name, rows in sorted(table.relations.items())
    ]
    return summary


def _silver_paths(project_id: int, sources: list[DataSource], workdir: Path) -> dict[str, list[Path]]:
    """Fetch every silver object of the project, grouped by relation name."""
    relations: dict[str, list[Path]] = {}
    for source in sources:
        if source.id is None:
            continue
        name = _relation_name(source.id, source.name)
        paths: list[Path] = []
        for index, item in enumerate(
            medallion.list_layer("silver", medallion.stream_prefix(project_id, source.id))
        ):
            local = workdir / name / f"part-{index:05d}.parquet"
            medallion.download_parquet("silver", item.key, local)
            paths.append(local)
        if paths:
            relations[name] = paths
    return relations


# ---------------------------------------------------------------------------
# Viewing the layers
# ---------------------------------------------------------------------------


@router.get(
    "/{project_id}/medallion",
    response_model=MedallionResponse,
    summary="The three layers of a project, side by side",
)
async def get_medallion(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MedallionResponse:
    get_visible_project_or_404(session, project_id, current_user)

    sources = _sources_of(session, project_id)
    runs = _runs_by_source(session, [s.id for s in sources if s.id is not None])
    table = _gold_of(session, project_id)

    return MedallionResponse(
        project_id=project_id,
        bronze=_summarise("bronze", project_id, sources, runs),
        silver=_summarise("silver", project_id, sources, runs),
        gold=_summarise_gold(project_id, table),
    )


@router.get(
    "/{project_id}/medallion/{layer}/preview",
    response_model=LayerPreviewResponse,
    summary="Read the first rows of one layer",
)
async def preview_layer(
    project_id: int,
    layer: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    source_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=200),
) -> LayerPreviewResponse:
    """Return the newest object of ``layer`` and its first rows.

    The same rows appear in bronze and in silver, which is the point: put the
    two side by side and the cleaning is visible rather than asserted.
    """
    get_visible_project_or_404(session, project_id, current_user)
    if layer not in medallion.LAYERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"There is no {layer!r} layer."
        )

    if layer == "gold":
        table = _gold_of(session, project_id)
        if table is None or not table.object_key:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="This project has not built a gold table yet.",
            )
        key = table.object_key
    else:
        if source_id is not None:
            # Confirm the source belongs to this project before reading its
            # objects, or a source id from another tenant would select their
            # prefix inside a project this caller can see.
            source = session.get(DataSource, source_id)
            if source is None or source.project_id != project_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Data source {source_id} not found.",
                )
        prefix = medallion.stream_prefix(project_id, source_id)
        objects = medallion.list_layer(layer, prefix)
        if not objects:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Nothing has landed in {layer} for this project yet.",
            )
        key = objects[0].key  # list_layer returns newest first

    with tempfile.TemporaryDirectory() as tmpdir:
        local = Path(tmpdir) / "object.parquet"
        medallion.download_parquet(layer, key, local)
        schema = medallion.read_schema(local)
        total = medallion.row_count(local)
        _, rows = medallion.read_head(local, limit=limit)

    return LayerPreviewResponse(
        layer=layer,
        key=key,
        columns=[{"name": name, "type": kind} for name, kind in schema.items()],
        rows=[[_jsonable(value) for value in row] for row in rows],
        object_rows=total,
        truncated=total > len(rows),
    )


def _jsonable(value: Any) -> Any:
    """Render a Parquet value for JSON without pretending it is something else."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


@router.get(
    "/{project_id}/medallion/diff",
    response_model=LayerDiffResponse,
    summary="Bronze and silver side by side, for one extraction",
)
async def diff_layers(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    source_id: int | None = None,
    run_id: str | None = None,
    limit: int = Query(default=25, ge=1, le=200),
) -> LayerDiffResponse:
    """Pair each bronze row with the silver row built from it.

    The counts in the quality report say *how much* changed. This says *what*,
    on the actual rows — which is the only form of the claim a person can check
    rather than take on trust.

    Pairing is possible because a run's bronze and silver objects are the same
    key in two buckets and the cleaning preserves row order. The one rule that
    breaks a positional pairing is deduplication, so it records which rows it
    removed; past the number it tracks, the pairing is by position and the
    response says so.
    """
    get_visible_project_or_404(session, project_id, current_user)

    statement = select(IngestionRun).where(
        IngestionRun.status == "success",
        IngestionRun.silver_key != "",
    )
    if run_id:
        statement = statement.where(IngestionRun.id == run_id)
    sources = {s.id: s for s in _sources_of(session, project_id)}
    if source_id is not None:
        if source_id not in sources:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Data source {source_id} not found.",
            )
        statement = statement.where(IngestionRun.source_id == source_id)
    else:
        statement = statement.where(
            IngestionRun.source_id.in_(list(sources))  # type: ignore[attr-defined]
        )

    run = session.exec(
        statement.order_by(IngestionRun.started_at.desc().nullslast())  # type: ignore[union-attr]
    ).first()
    if run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No extraction has been through the layers yet.",
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        bronze = medallion.download_parquet(
            "bronze", run.bronze_key, Path(tmpdir) / "bronze.parquet"
        )
        silver = medallion.download_parquet(
            "silver", run.silver_key, Path(tmpdir) / "silver.parquet"
        )
        bronze_schema = medallion.read_schema(bronze)
        silver_schema = medallion.read_schema(silver)
        bronze_total = medallion.row_count(bronze)
        silver_total = medallion.row_count(silver)

        removed, truncated = _removed_rows(run.quality_report or {})
        # Read enough bronze rows to still produce `limit` pairs after the
        # removed ones are accounted for.
        take = limit + len(removed & set(range(limit + len(removed))))
        _, bronze_rows = medallion.read_head(bronze, limit=take)
        _, silver_rows = medallion.read_head(silver, limit=limit)

    columns = _pair_columns(
        bronze_schema, silver_schema, (run.quality_report or {}).get("renamed", {})
    )
    rows = _pair_rows(columns, bronze_rows, silver_rows, removed, limit)

    return LayerDiffResponse(
        run_id=run.id,
        source_id=run.source_id,
        key=run.silver_key,
        columns=columns,
        rows=rows,
        bronze_rows=bronze_total,
        silver_rows=silver_total,
        approximate=truncated,
    )


def _removed_rows(report: dict[str, Any]) -> tuple[set[int], bool]:
    """Which bronze rows the cleaning removed, and whether the list is partial."""
    for rule in report.get("rules", []):
        if rule.get("rule") == "deduplicate_rows":
            return set(rule.get("removed_rows", [])), bool(
                rule.get("removed_rows_truncated")
            )
    return set(), False


def _pair_columns(
    bronze_schema: dict[str, str],
    silver_schema: dict[str, str],
    renamed: dict[str, str],
) -> list[DiffColumnResponse]:
    """Line the two schemas up, following the renames the cleaning recorded."""
    paired: list[DiffColumnResponse] = []
    claimed: set[str] = set()

    for name, kind in bronze_schema.items():
        target = renamed.get(name, name)
        if target in silver_schema:
            claimed.add(target)
            change = "kept"
            if target != name:
                change = "renamed"
            elif silver_schema[target] != kind:
                change = "retyped"
            paired.append(
                DiffColumnResponse(
                    bronze=name,
                    silver=target,
                    bronze_type=kind,
                    silver_type=silver_schema[target],
                    change=change,
                )
            )
        else:
            # Dropped: the column held nothing in any row.
            paired.append(
                DiffColumnResponse(bronze=name, bronze_type=kind, change="dropped")
            )

    # Whatever silver has that bronze did not: the coding step's audit columns.
    for name, kind in silver_schema.items():
        if name not in claimed:
            paired.append(
                DiffColumnResponse(silver=name, silver_type=kind, change="added")
            )
    return paired


def _classify(before: Any, after: Any) -> str:
    """Say what happened to one cell.

    ``type`` is its own answer rather than being folded into ``same``: casting
    ``"12261"`` to ``12261`` renders identically, and a diff that called that
    unchanged would hide the single most common thing the cleaning does.
    """
    if before is None and after is None:
        return "same"
    if after is None:
        return "null"
    if before is None:
        return "value"
    if str(before) == str(after):
        return "same" if type(before) is type(after) else "type"
    return "value"


def _pair_rows(
    columns: list[DiffColumnResponse],
    bronze_rows: list[list[Any]],
    silver_rows: list[list[Any]],
    removed: set[int],
    limit: int,
) -> list[DiffRowResponse]:
    """Walk both sides together, skipping the rows the cleaning removed."""
    bronze_index = {column.bronze: position for position, column in enumerate(columns) if column.bronze}
    silver_index = {column.silver: position for position, column in enumerate(columns) if column.silver}
    bronze_order = [name for name in bronze_index]
    silver_order = [name for name in silver_index]

    paired: list[DiffRowResponse] = []
    silver_cursor = 0
    for row_number, bronze_row in enumerate(bronze_rows):
        if len(paired) >= limit:
            break
        left = [None] * len(columns)
        for position, name in enumerate(bronze_order):
            left[bronze_index[name]] = _jsonable(bronze_row[position])

        if row_number in removed:
            paired.append(
                DiffRowResponse(
                    row=row_number,
                    bronze=left,
                    silver=[],
                    cells=["absent"] * len(columns),
                    removed=True,
                )
            )
            continue

        if silver_cursor >= len(silver_rows):
            break
        silver_row = silver_rows[silver_cursor]
        silver_cursor += 1

        right = [None] * len(columns)
        for position, name in enumerate(silver_order):
            right[silver_index[name]] = _jsonable(silver_row[position])

        cells = []
        for position, column in enumerate(columns):
            if column.bronze is None:
                cells.append("value" if right[position] is not None else "same")
            elif column.silver is None:
                cells.append("absent")
            else:
                cells.append(_classify(left[position], right[position]))

        paired.append(
            DiffRowResponse(row=row_number, bronze=left, silver=right, cells=cells)
        )
    return paired


# ---------------------------------------------------------------------------
# Defining gold
# ---------------------------------------------------------------------------


@router.get(
    "/{project_id}/medallion/gold/relations",
    summary="What a gold definition can be written against",
)
async def gold_relations(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict[str, Any]:
    """Return each silver stream's columns, types and row count.

    This is the schema a person — or the model — writes a query against, so it
    has to be available without reading the data itself.
    """
    get_visible_project_or_404(session, project_id, current_user)
    sources = _sources_of(session, project_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        relations = _silver_paths(project_id, sources, Path(tmpdir))
        if not relations:
            return {"relations": {}, "default_sql": ""}
        described = gold_module.describe_relations(relations)

    return {"relations": described, "default_sql": gold_module.default_sql(sorted(described))}


@router.post(
    "/{project_id}/medallion/gold/preview",
    response_model=GoldPreviewResponse,
    summary="Run a candidate gold definition without saving it",
)
async def preview_gold(
    project_id: int,
    body: GoldPreviewRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> GoldPreviewResponse:
    """Execute a definition and return its row count and first rows.

    Nothing is stored and no version is created. This exists because SQL that
    parses, runs and returns an empty table is the most common way a definition
    goes wrong — especially one a model wrote — and a row count with a few rows
    beside it is the cheapest way to catch it before it becomes the table
    everything trains on.
    """
    get_visible_project_or_404(session, project_id, current_user)
    sources = _sources_of(session, project_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        relations = _silver_paths(project_id, sources, Path(tmpdir))
        if not relations:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="There is no silver data to query yet — run an extraction first.",
            )
        try:
            result, rows = gold_module.build(
                relations, body.sql, Path(tmpdir) / "candidate.parquet", preview_rows=body.limit
            )
        except gold_module.GoldError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            )

        return GoldPreviewResponse(
            columns=result.columns,
            rows=[[_jsonable(value) for value in row] for row in rows],
            total_rows=result.rows,
            relations=result.relations,
            sql=body.sql,
        )


@router.put(
    "/{project_id}/medallion/gold",
    response_model=LayerSummaryResponse,
    summary="Set the project's gold definition",
)
async def set_gold_definition(
    project_id: int,
    body: GoldDefinitionRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> LayerSummaryResponse:
    """Store the definition. It takes effect on the next extraction.

    An empty ``sql`` restores the default — everything the project's sources
    have landed — which is stored as emptiness rather than as generated SQL so
    that connecting another source changes the table without anyone editing it.

    The definition is validated here rather than only at build time: a query
    that will fail on every future extraction should be rejected while the
    person writing it still has the context to fix it.
    """
    get_visible_project_or_404(session, project_id, current_user)

    if body.sql.strip():
        try:
            gold_module.validate_sql(body.sql)
        except gold_module.GoldError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            )

    table = _gold_of(session, project_id)
    if table is None:
        table = GoldTable(project_id=project_id)
    table.sql = body.sql.strip()
    table.name = body.name
    table.build_error = ""
    session.add(table)
    session.commit()
    session.refresh(table)

    # Rebuild now rather than at the next extraction. Gold is a function of the
    # silver layer and the definition; an extraction covers changes to the
    # first, and this covers the second. Waiting would leave the table stale
    # until new rows happened to arrive — which, for a source that is already
    # up to date, could be never.
    from tasks.celery_tasks import rebuild_gold

    rebuild_gold.apply_async(args=[project_id])

    logger.info(
        "gold.definition_set",
        project_id=project_id,
        default=not table.sql,
        length=len(table.sql),
    )
    return _summarise_gold(project_id, table)


@router.post(
    "/{project_id}/medallion/gold/suggest",
    response_model=GoldSuggestResponse,
    summary="Ask the model to write a gold definition",
)
async def suggest_gold(
    project_id: int,
    body: GoldSuggestRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> GoldSuggestResponse:
    """Turn a description of the wanted table into SQL.

    The model is given the silver schema and the question, and returns a query.
    It is never given the data and never returns rows: what comes back is
    checked by :func:`core.gold.validate_sql`, shown to the user, and only runs
    if they run it. A model that hands back data has to be trusted; a model that
    hands back a query can be read, run twice and diffed.
    """
    get_visible_project_or_404(session, project_id, current_user)
    sources = _sources_of(session, project_id)

    with tempfile.TemporaryDirectory() as tmpdir:
        relations = _silver_paths(project_id, sources, Path(tmpdir))
        if not relations:
            return GoldSuggestResponse(
                error="There is no silver data to describe yet — run an extraction first."
            )
        described = gold_module.describe_relations(relations)

    from core.ai_gold import GoldSuggestionError, suggest_definition

    try:
        suggestion = suggest_definition(described, body.question)
    except GoldSuggestionError as exc:
        return GoldSuggestResponse(error=str(exc))

    return GoldSuggestResponse(sql=suggestion.sql, explanation=suggestion.explanation)
