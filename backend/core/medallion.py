"""The medallion layout: where data lands, in what shape, and under what rules.

Three layers, each with a different promise. The promises are the point — a
layer that cannot say what it guarantees is a folder, not an architecture.

**Bronze — what the source said.** One object per extraction, every column
stored as text, nulls preserved, nothing corrected. Written once and never
rewritten. Its value is precisely that it is *not* clean: when the cleaning
rules are improved, silver is rebuilt from bronze rather than re-extracted from
a source whose watermark has already moved past those rows.

**Silver — what the data means.** Bronze passed through the cleaning standard
(:mod:`core.cleaning`): whitespace and sentinel nulls resolved, types cast,
categories folded to one spelling, free text coded. One object per extraction
as well, so silver *accumulates* — the second run adds its slice beside the
first rather than replacing it. Reading all of a source's silver is reading one
path with a wildcard, which is what makes an incremental pipeline actually
incremental.

**Gold — what the project answers.** A modelled table built by a query across
silver, rebuilt in full each time rather than appended to. Rebuilding is what
lets it join several sources: a table that is one row per patient cannot be
maintained by appending, because a new encounter changes a row that already
exists.

Everything is Parquet. That is not a preference. Silver claims to have cast
``recorded_at`` to a timestamp and ``age`` to an integer; written back out as
CSV those casts survive only as a promise in a report, because the next reader
parses text again and may reach different conclusions. Parquet carries the
schema with the data, so the claim is checkable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, Iterable, Iterator, Sequence

import structlog

from core import storage
from core.config import get_settings

logger = structlog.get_logger(__name__)

__all__ = [
    "LAYERS",
    "MedallionError",
    "bucket_for",
    "bronze_key",
    "silver_key",
    "stream_prefix",
    "gold_key",
    "gold_prefix",
    "BronzeWriter",
    "LayerObject",
    "list_layer",
    "read_head",
    "read_schema",
    "row_count",
    "upload_parquet",
    "download_parquet",
]

#: In order. The order is meaningful: data only ever moves left to right.
LAYERS: Final[tuple[str, str, str]] = ("bronze", "silver", "gold")

#: Rows buffered before a row group is flushed. Large enough that the file has
#: usable row-group statistics, small enough that an extraction bigger than
#: memory still writes.
_ROW_GROUP: Final[int] = 10_000


class MedallionError(RuntimeError):
    """A layer could not be read or written."""


# ---------------------------------------------------------------------------
# Where things live
# ---------------------------------------------------------------------------


def bucket_for(layer: str) -> str:
    """Return the bucket backing ``layer``."""
    settings = get_settings()
    try:
        return {
            "bronze": settings.minio_bucket_bronze,
            "silver": settings.minio_bucket_silver,
            "gold": settings.minio_bucket_gold,
        }[layer]
    except KeyError:
        raise MedallionError(f"unknown layer {layer!r}; expected one of {', '.join(LAYERS)}")


_UNSAFE = re.compile(r"[^a-z0-9_-]+")


def slugify(value: str, *, fallback: str = "unnamed") -> str:
    """Return ``value`` as a lowercase key-safe segment."""
    slug = _UNSAFE.sub("-", (value or "").strip().lower()).strip("-")
    return slug[:60] or fallback


def bronze_key(repo_id: int, source_id: int, run_id: str) -> str:
    """Object key for one extraction's bronze landing."""
    return f"project-{repo_id}/source-{source_id}/run-{slugify(run_id, fallback='run')}.parquet"


def silver_key(repo_id: int, source_id: int, run_id: str) -> str:
    """Object key for one extraction's cleaned slice.

    Deliberately the same shape as the bronze key: a silver object and the
    bronze object it was built from are the same path in two buckets, so the
    lineage of any row is readable without consulting a table.
    """
    return f"project-{repo_id}/source-{source_id}/run-{slugify(run_id, fallback='run')}.parquet"


def stream_prefix(repo_id: int, source_id: int | None = None) -> str:
    """Prefix covering one source's whole history, or the project's.

    The same shape in bronze and in silver, because the keys are the same
    strings in different buckets.

    This is what makes silver behave as one table: every run's object sits
    under a common prefix, and a reader takes ``prefix + '*.parquet'``. No
    compaction step, no manifest to keep in step.
    """
    if source_id is None:
        return f"project-{repo_id}/"
    return f"project-{repo_id}/source-{source_id}/"


def gold_key(repo_id: int, table: str, version: int) -> str:
    """Object key for one build of a gold table.

    Versioned rather than overwritten: a model trained last month was trained
    on a particular build, and a gold table that is redefined in place cannot
    answer which one.
    """
    return f"project-{repo_id}/{slugify(table, fallback='table')}/v{version:04d}.parquet"


def gold_prefix(repo_id: int, table: str | None = None) -> str:
    """Prefix covering a project's gold tables, or one table's versions."""
    if table is None:
        return f"project-{repo_id}/"
    return f"project-{repo_id}/{slugify(table, fallback='table')}/"


# ---------------------------------------------------------------------------
# Writing bronze
# ---------------------------------------------------------------------------


def _as_text(value: Any) -> str | None:
    """Render one extracted value for bronze.

    Everything becomes text, and ``None`` stays ``None``. Both halves matter.
    Text because bronze must not assert a type it has not verified — the source
    column may be declared numeric and hold ``'N/A'``. ``None`` because a null
    and an empty string are different facts about the source, and the CSV this
    replaced could not tell them apart: it wrote both as nothing, so every null
    arrived in silver as a blank and the null rate in the profile was a
    fiction.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


class BronzeWriter:
    """Streams rows into a Parquet file whose columns are all text.

    Used as a context manager. The file is created on the first row, so an
    extraction that finds nothing new leaves no empty object behind:

        with BronzeWriter(path, columns) as writer:
            for row in rows:
                writer.write(row)
        writer.rows  # what was written
    """

    def __init__(self, destination: Path, columns: Sequence[str]) -> None:
        if not columns:
            raise MedallionError("cannot write a bronze file with no columns")
        self.destination = destination
        self.columns = list(columns)
        self.rows = 0
        self._buffer: list[list[str | None]] = []
        self._writer: Any = None
        self._schema: Any = None

    def __enter__(self) -> "BronzeWriter":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def write(self, values: Iterable[Any]) -> None:
        """Append one row, given in column order."""
        self._buffer.append([_as_text(value) for value in values])
        self.rows += 1
        if len(self._buffer) >= _ROW_GROUP:
            self._flush()

    def close(self) -> None:
        """Flush and close. Safe to call twice."""
        if self._buffer:
            self._flush()
        if self._writer is not None:
            self._writer.close()
            self._writer = None

    # -- internals ----------------------------------------------------------

    def _flush(self) -> None:
        import pyarrow as pa
        import pyarrow.parquet as pq

        if self._schema is None:
            self._schema = pa.schema([pa.field(name, pa.string()) for name in self.columns])
            self.destination.parent.mkdir(parents=True, exist_ok=True)
            # Snappy rather than zstd: the pipeline reads these far more often
            # than it writes them, and snappy decompresses several times faster
            # for a few percent more space.
            self._writer = pq.ParquetWriter(
                self.destination, self._schema, compression="snappy"
            )

        columns = list(zip(*self._buffer)) if self._buffer else []
        batch = pa.Table.from_arrays(
            [pa.array(list(column), type=pa.string()) for column in columns],
            schema=self._schema,
        )
        self._writer.write_table(batch)
        self._buffer.clear()


# ---------------------------------------------------------------------------
# Writing silver
# ---------------------------------------------------------------------------

def _timestamps_to_utc(values: list[Any]) -> tuple[list[Any], bool]:
    """Return the column with one consistent tz-awareness, and which it is.

    Parquet needs a single timestamp type for the column, and a source can
    return both — a timestamptz and a plain timestamp read through the same
    query. Aware values are converted to UTC. If any value is naive, the whole
    column is stored without a zone, because attaching UTC to a timestamp whose
    zone was never recorded would invent a fact rather than preserve one.
    """
    from datetime import timezone as _tz

    has_naive = any(
        isinstance(value, datetime) and value.tzinfo is None for value in values if value is not None
    )
    converted: list[Any] = []
    for value in values:
        if not isinstance(value, datetime):
            converted.append(value)
        elif value.tzinfo is None:
            converted.append(value)
        elif has_naive:
            converted.append(value.astimezone(_tz.utc).replace(tzinfo=None))
        else:
            converted.append(value.astimezone(_tz.utc))
    return converted, not has_naive


def write_typed(
    columns: Sequence[str],
    data: dict[str, list[Any]],
    types: dict[str, str],
    destination: Path,
) -> None:
    """Write a cleaned table to Parquet with the types the cleaning claimed.

    A column whose values do not fit the declared type falls back to text with
    a warning rather than failing the run. Losing an extraction because one
    column resisted its cast would be a poor trade: the rows are real, and the
    report says what the column turned out to be.
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    fields = []
    arrays = []
    for name in columns:
        declared = types.get(name, "string")
        values = data[name]
        if declared == "timestamp":
            values, aware = _timestamps_to_utc(values)
            arrow_type = pa.timestamp("us", tz="UTC") if aware else pa.timestamp("us")
        else:
            arrow_type = {
                "integer": pa.int64(),
                "decimal": pa.float64(),
                "boolean": pa.bool_(),
                "date": pa.date32(),
                "string": pa.string(),
            }.get(declared, pa.string())
        try:
            array = pa.array(values, type=arrow_type)
        except (pa.ArrowInvalid, pa.ArrowTypeError, ValueError, OverflowError) as exc:
            logger.warning(
                "medallion.cast_fell_back", column=name, declared=declared, error=str(exc)
            )
            arrow_type = pa.string()
            array = pa.array([None if value is None else str(value) for value in values], type=arrow_type)
            types[name] = "string"
        fields.append(pa.field(name, arrow_type))
        arrays.append(array)

    destination.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_arrays(arrays, schema=pa.schema(fields))
    pq.write_table(table, destination, compression="snappy")


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def read_schema(path: Path) -> dict[str, str]:
    """Return ``{column: arrow type}`` for a Parquet file.

    This is what makes the silver claim auditable: the report says a column was
    cast to a timestamp, and this says what the stored file actually holds.
    """
    import pyarrow.parquet as pq

    try:
        schema = pq.read_schema(path)
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller
        raise MedallionError(f"could not read the schema of {path.name}: {exc}") from exc
    return {field.name: str(field.type) for field in schema}


def row_count(path: Path) -> int:
    """Return the number of rows without reading them.

    Parquet keeps the count in its footer, so this is a metadata read whatever
    the file size.
    """
    import pyarrow.parquet as pq

    try:
        return int(pq.ParquetFile(path).metadata.num_rows)
    except Exception as exc:  # noqa: BLE001
        raise MedallionError(f"could not count the rows of {path.name}: {exc}") from exc


def read_head(path: Path, limit: int = 20) -> tuple[list[str], list[list[Any]]]:
    """Return the first ``limit`` rows as ``(columns, rows)``.

    Reads one row group rather than the file: a preview of a layer must not
    cost the whole layer.
    """
    import pyarrow.parquet as pq

    try:
        parquet = pq.ParquetFile(path)
        columns = [field.name for field in parquet.schema_arrow]
        rows: list[list[Any]] = []
        for batch in parquet.iter_batches(batch_size=max(1, limit)):
            table = batch.to_pydict()
            for index in range(batch.num_rows):
                rows.append([table[name][index] for name in columns])
                if len(rows) >= limit:
                    return columns, rows
            break
        return columns, rows
    except MedallionError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise MedallionError(f"could not read {path.name}: {exc}") from exc


def columns_of(path: Path) -> list[str]:
    """Return the column names of a Parquet file, reading only its footer."""
    return list(read_schema(path))


def iter_rows(path: Path) -> Iterator[dict[str, Any]]:
    """Yield every row of a Parquet file as a dict, a row group at a time."""
    import pyarrow.parquet as pq

    parquet = pq.ParquetFile(path)
    columns = [field.name for field in parquet.schema_arrow]
    for batch in parquet.iter_batches(batch_size=_ROW_GROUP):
        data = batch.to_pydict()
        for index in range(batch.num_rows):
            yield {name: data[name][index] for name in columns}


# ---------------------------------------------------------------------------
# Bronze -> silver
# ---------------------------------------------------------------------------


@dataclass
class SilverBuild:
    """What promoting one bronze object to silver produced."""

    path: Path
    rows: int
    columns: list[str]
    report: Any  # core.cleaning.CleaningReport
    normalization: dict[str, Any]


def promote_to_silver(
    bronze_path: Path,
    destination: Path,
    *,
    text_column: str = "",
    code_column: str = "",
) -> SilverBuild:
    """Build one silver object from one bronze object.

    The cleaning standard first, then code normalisation if the source asks for
    it. That order is not interchangeable: the vocabulary is learned from the
    text of rows that already carry a code, and learning it from untrimmed,
    variously-cased text teaches it the damage as well as the term.

    Coding is attempted but never allowed to fail the build. The rows are real
    either way, and a silver object that says which step it could not complete
    is more useful than no silver object at all.

    The bronze object is read into memory. That is a real bound and it is the
    right one for now — an extraction is a watermarked slice, not a whole
    database — but it is the first thing to revisit if a source ever lands a
    slice larger than the worker.
    """
    from core.cleaning import Table, clean
    from core.normalization import normalize_rows

    columns = columns_of(bronze_path)
    rows = list(iter_rows(bronze_path))
    table = Table.from_rows(rows, columns)

    # The code column is exempted from type inference: it is an identifier, and
    # the coding step below writes text into it. Without this a SNOMED column
    # of pure digits is cast to an integer and the run fails at the final
    # write, after all the expensive work has already been done.
    report = clean(table, keep_as_text=[code_column] if code_column else [])

    normalization: dict[str, Any] = {}
    if text_column and code_column:
        # The cleaning renamed columns, so the source's configured names have
        # to be followed through the rename map rather than used as given.
        text_name = report.renamed.get(text_column, text_column)
        code_name = report.renamed.get(code_column, code_column)
        try:
            as_rows = table.to_rows()
            summary = normalize_rows(
                as_rows, text_column=text_name, code_column=code_name
            )
            normalization = summary.summary()
            rebuilt_columns = list(as_rows[0].keys()) if as_rows else table.columns
            table = Table.from_rows(as_rows, rebuilt_columns)
            # The two audit columns are new, so they carry no inferred type yet.
            report.types.setdefault(f"{code_name}_method", "string")
            report.types.setdefault(f"{code_name}_confidence", "decimal")
            report.columns_out = len(table.columns)
        except Exception as exc:  # noqa: BLE001 — recorded, not raised
            logger.warning("medallion.normalization_failed", error=str(exc))
            normalization = {"error": str(exc)[:500]}

    write_typed(table.columns, table.data, report.types, destination)

    logger.info(
        "medallion.promoted",
        rows_in=report.rows_in,
        rows_out=report.rows_out,
        cells_changed=report.cells_changed,
    )
    return SilverBuild(
        path=destination,
        rows=table.rows,
        columns=list(table.columns),
        report=report,
        normalization=normalization,
    )


# ---------------------------------------------------------------------------
# Object storage
# ---------------------------------------------------------------------------

PARQUET_CONTENT_TYPE: Final[str] = "application/vnd.apache.parquet"


def upload_parquet(layer: str, key: str, path: Path) -> str:
    """Upload ``path`` into ``layer`` at ``key``. Returns the bucket."""
    bucket = bucket_for(layer)
    with path.open("rb") as handle:
        storage.upload_fileobj(bucket, key, handle, PARQUET_CONTENT_TYPE)
    logger.info(
        "medallion.written", layer=layer, bucket=bucket, key=key, bytes=path.stat().st_size
    )
    return bucket


def download_parquet(layer: str, key: str, destination: Path) -> Path:
    """Fetch one layer object to the local filesystem."""
    storage.download_to_path(bucket_for(layer), key, str(destination))
    return destination


@dataclass
class LayerObject:
    """One object sitting in a layer."""

    key: str
    size_bytes: int
    last_modified: datetime | None


def list_layer(layer: str, prefix: str) -> list[LayerObject]:
    """List what is in ``layer`` under ``prefix``, newest first.

    A missing bucket lists as empty rather than raising: a project that has
    never reached gold has no gold bucket yet, and that is a state to display,
    not an error.
    """
    from botocore.exceptions import BotoCoreError, ClientError

    bucket = bucket_for(layer)
    client = storage.get_s3_client()
    objects: list[LayerObject] = []
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                objects.append(
                    LayerObject(
                        key=item["Key"],
                        size_bytes=int(item.get("Size", 0)),
                        last_modified=item.get("LastModified"),
                    )
                )
    except ClientError as exc:
        if storage._is_not_found(exc):  # noqa: SLF001 — same package
            return []
        raise MedallionError(f"could not list {layer}: {exc}") from exc
    except BotoCoreError as exc:
        raise MedallionError(f"could not list {layer}: {exc}") from exc

    objects.sort(key=lambda item: (item.last_modified is None, item.last_modified), reverse=True)
    return objects
