"""Incremental extraction from an external system.

This is the head of the data pipeline. A :class:`~models.schemas.DataSource`
names a database, a query and a watermark column; this module runs that query
for the slice not yet seen, writes the rows to a file, and reports what it
found.

Three things here are deliberate and worth knowing before changing them.

**The watermark is bound, never interpolated.** The extraction SQL carries the
token ``:watermark`` and SQLAlchemy binds it as a parameter. The SQL itself is
supplied by whoever registered the source, so it is trusted by definition — but
the watermark is data that came back from a previous run, and data does not get
to become SQL.

**The watermark tracks entry time, not business time.** A row for Monday's
procedure that is keyed in on Thursday has a business date already behind the
mark. Watermarking the business date drops it, silently, and the pipeline
reports success. The source's ``watermark_column`` must therefore be the
system's own insert timestamp; ``hospital/README.md`` measures what the wrong
choice costs on the sample data (6% of rows lost outright).

**Rows are streamed and profiled as they go.** Neither the file nor the profile
is built from a materialised list: an extraction is expected to be larger than
the process that runs it.
"""
from __future__ import annotations

import csv
import math
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, Iterator

import structlog
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from models.schemas import DataSource

logger = structlog.get_logger(__name__)

#: Bound at the start of a full backfill, when no watermark has been set yet.
#: A sentinel rather than a branch keeps one SQL statement working for both the
#: first run and every later one.
EPOCH: Final[str] = "1900-01-01T00:00:00+00:00"

#: The token the extraction SQL must contain.
WATERMARK_TOKEN: Final[str] = ":watermark"

#: Values kept per column when working out what it contains. Bounded so a
#: high-cardinality column cannot grow the profile without limit.
_TOP_VALUES: Final[int] = 10
_MAX_DISTINCT_TRACKED: Final[int] = 5_000


class IngestionError(Exception):
    """Extraction could not be completed."""


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------


def resolve_password(source: DataSource) -> str:
    """Read the source's password from the environment.

    The platform stores the *name* of the variable, never its value, so a dump
    of ``data_sources`` discloses no credential and rotating one needs no write
    to the database. The cost is that a source cannot be used unless an
    operator has already provisioned the variable — which is the intended
    behaviour: registering a source is not the same authority as being granted
    access to it.
    """
    if not source.password_env:
        return ""
    password = os.getenv(source.password_env, "")
    if not password:
        raise IngestionError(
            f"the environment variable {source.password_env!r} named by this "
            "source is not set on the worker, so it cannot authenticate"
        )
    return password


def build_engine(source: DataSource, password: str) -> Engine:
    """Open a connection to the external system."""
    if source.kind != "postgres":
        raise IngestionError(f"unsupported source kind {source.kind!r}")

    from urllib.parse import quote_plus

    auth = quote_plus(source.username)
    if password:
        auth = f"{auth}:{quote_plus(password)}"

    url = f"postgresql+psycopg2://{auth}@{source.host}:{source.port}/{source.database}"
    # pool_pre_ping because the source is somebody else's database and may have
    # dropped the connection between runs without telling us.
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 15})


# ---------------------------------------------------------------------------
# Profiling
# ---------------------------------------------------------------------------


@dataclass
class ColumnProfile:
    """What one column turned out to contain.

    Accumulated a row at a time rather than computed from a loaded frame: the
    point of profiling is to describe extractions too large to hold.
    """

    name: str
    count: int = 0
    nulls: int = 0
    blanks: int = 0
    numeric: int = 0
    _distinct: set[str] = field(default_factory=set, repr=False)
    _distinct_overflowed: bool = False
    _top: Counter = field(default_factory=Counter, repr=False)
    minimum: float | None = None
    maximum: float | None = None
    _sum: float = 0.0
    _sum_squares: float = 0.0
    min_length: int | None = None
    max_length: int | None = None

    def observe(self, value: Any) -> None:
        self.count += 1
        if value is None:
            self.nulls += 1
            return

        as_text = str(value).strip() if not isinstance(value, str) else value.strip()
        if not as_text:
            self.blanks += 1
            return

        if not self._distinct_overflowed:
            self._distinct.add(as_text)
            if len(self._distinct) > _MAX_DISTINCT_TRACKED:
                self._distinct_overflowed = True
                self._distinct.clear()
        self._top[as_text] += 1

        length = len(as_text)
        self.min_length = length if self.min_length is None else min(self.min_length, length)
        self.max_length = length if self.max_length is None else max(self.max_length, length)

        number = _as_number(value)
        if number is not None:
            self.numeric += 1
            self._sum += number
            self._sum_squares += number * number
            self.minimum = number if self.minimum is None else min(self.minimum, number)
            self.maximum = number if self.maximum is None else max(self.maximum, number)

    def summary(self) -> dict[str, Any]:
        """Render the profile, including what it could not determine."""
        present = self.count - self.nulls - self.blanks
        result: dict[str, Any] = {
            "count": self.count,
            "nulls": self.nulls,
            "null_rate": round(self.nulls / self.count, 4) if self.count else 0.0,
            "blanks": self.blanks,
            "inferred_type": self._inferred_type(present),
        }

        if self._distinct_overflowed:
            # Say so rather than reporting the cap as though it were the answer.
            result["distinct"] = None
            result["distinct_note"] = f"more than {_MAX_DISTINCT_TRACKED:,}"
        else:
            result["distinct"] = len(self._distinct)
            if present:
                result["uniqueness"] = round(len(self._distinct) / present, 4)

        if self.numeric and present:
            mean = self._sum / self.numeric
            variance = max(self._sum_squares / self.numeric - mean * mean, 0.0)
            result["min"] = self.minimum
            result["max"] = self.maximum
            result["mean"] = round(mean, 6)
            result["stddev"] = round(math.sqrt(variance), 6)

        if self.min_length is not None:
            result["min_length"] = self.min_length
            result["max_length"] = self.max_length

        result["top_values"] = [
            {"value": value, "count": count} for value, count in self._top.most_common(_TOP_VALUES)
        ]
        return result

    def _inferred_type(self, present: int) -> str:
        """Best guess at what this column holds.

        A guess, and labelled as one: the source stores measurements as text,
        so "numeric" here means "every value parsed as a number", not "the
        column is declared numeric".
        """
        if not present:
            return "empty"
        if self.numeric == present:
            return "numeric"
        if self.numeric:
            return "mixed"
        if not self._distinct_overflowed and len(self._distinct) <= max(2, present // 50):
            return "categorical"
        return "text"


_NUMERIC = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _as_number(value: Any) -> float | None:
    """Return ``value`` as a float when it genuinely is one."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, str) and _NUMERIC.match(value.strip()):
        try:
            return float(value)
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


@dataclass
class ExtractionResult:
    """What one run of an extraction produced."""

    rows: int
    watermark_before: str
    watermark_after: str
    columns: list[str]
    profile: dict[str, Any]
    path: Path | None


def _serialise(value: Any) -> Any:
    """Render one value for the CSV the pipeline will read."""
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _watermark_of(value: Any) -> str | None:
    """Normalise a watermark cell to comparable ISO text."""
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value).strip() or None


def validate_sql(sql: str) -> None:
    """Reject extraction SQL that cannot work before a run is started.

    Cheap to check here and confusing to diagnose later: an extraction without
    the watermark token silently re-reads the whole source on every run, which
    looks like success and quietly multiplies the data.
    """
    if not sql.strip():
        raise IngestionError("the extraction SQL is empty")
    if WATERMARK_TOKEN not in sql:
        raise IngestionError(
            f"the extraction SQL must reference {WATERMARK_TOKEN} — without it "
            "every run would re-read the entire source instead of only what is new"
        )


def extract(
    source: DataSource,
    destination: Path,
    *,
    password: str | None = None,
    max_rows: int | None = None,
    engine: Engine | None = None,
) -> ExtractionResult:
    """Run one incremental extraction and write it to ``destination``.

    Args:
        source: The registered source to read from.
        destination: CSV file to write. Not created when no rows come back.
        password: Overrides the environment lookup (used by tests).
        max_rows: Stop after this many rows, leaving the watermark where those
            rows reached so the next run resumes cleanly.
        engine: Pre-built engine (used by tests).

    Returns:
        The row count, the watermark before and after, and the column profile.

    Raises:
        IngestionError: The source is misconfigured or unreachable.
    """
    validate_sql(source.extraction_sql)
    if not source.watermark_column:
        raise IngestionError("the source does not name a watermark column")

    before = source.watermark_value or EPOCH
    owned_engine = engine is None
    engine = engine or build_engine(
        source, password if password is not None else resolve_password(source)
    )

    profiles: dict[str, ColumnProfile] = {}
    columns: list[str] = []
    high_water = before
    rows_written = 0
    handle = None
    writer = None

    try:
        with engine.connect() as connection:
            # Server-side cursor: the point of streaming is defeated if the
            # driver buffers the whole result before we see the first row.
            result = connection.execution_options(stream_results=True, max_row_buffer=1000).execute(
                text(source.extraction_sql), {"watermark": before}
            )
            columns = list(result.keys())
            if source.watermark_column not in columns:
                raise IngestionError(
                    f"the extraction SQL does not return the watermark column "
                    f"{source.watermark_column!r}; without it the next run "
                    "cannot know where this one stopped"
                )
            profiles = {name: ColumnProfile(name) for name in columns}

            for row in result:
                if max_rows is not None and rows_written >= max_rows:
                    logger.info(
                        "ingestion.truncated",
                        source_id=source.id,
                        max_rows=max_rows,
                        note="watermark left at the last row written",
                    )
                    break

                mapping = row._mapping  # noqa: SLF001 — SQLAlchemy's public row mapping
                if handle is None:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    handle = destination.open("w", encoding="utf-8", newline="")
                    writer = csv.writer(handle)
                    writer.writerow(columns)

                for name in columns:
                    profiles[name].observe(mapping[name])

                mark = _watermark_of(mapping[source.watermark_column])
                if mark and mark > high_water:
                    high_water = mark

                assert writer is not None
                writer.writerow([_serialise(mapping[name]) for name in columns])
                rows_written += 1
    except IngestionError:
        raise
    except Exception as exc:  # noqa: BLE001 — surfaced to the run record
        raise IngestionError(f"extraction failed: {exc}") from exc
    finally:
        if handle is not None:
            handle.close()
        if owned_engine:
            engine.dispose()

    logger.info(
        "ingestion.extracted",
        source_id=source.id,
        rows=rows_written,
        watermark_before=before,
        watermark_after=high_water,
    )

    return ExtractionResult(
        rows=rows_written,
        watermark_before=before,
        # An extraction that found nothing must leave the mark untouched, so a
        # later row entered with an earlier timestamp is still picked up.
        watermark_after=high_water if rows_written else before,
        columns=columns,
        profile={name: profile.summary() for name, profile in profiles.items()}
        if rows_written
        else {},
        path=destination if rows_written else None,
    )


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------


#: Rows returned by a preview. Small on purpose: this runs against somebody
#: else's production database while a person waits on a form.
DEFAULT_PREVIEW_ROWS: Final[int] = 10


@dataclass
class PreviewResult:
    """A look at what an extraction would return, before running one."""

    columns: list[str]
    rows: list[list[Any]]
    profile: dict[str, Any]
    truncated: bool


def preview(
    source: DataSource,
    *,
    limit: int = DEFAULT_PREVIEW_ROWS,
    password: str | None = None,
    engine: Engine | None = None,
) -> PreviewResult:
    """Run the extraction SQL for a handful of rows and return them.

    Exists because writing an extraction blind is a bad way to work: you pick a
    table, a watermark column and a text/code pair from memory, point it at a
    hospital's live database and find out afterwards. This answers the four
    questions that were previously answered by running it for real — do the
    credentials work, is the SQL valid, what columns come back, and what does
    the data actually look like.

    Nothing is stored and no watermark moves. The watermark is bound to the
    epoch so the preview shows the beginning of the range a first extraction
    would take, rather than whatever happens to be newest.

    Args:
        source: The source to preview. It need not have been saved.
        limit: Rows to return.
        password: Overrides the environment lookup (used by tests).
        engine: Pre-built engine (used by tests).

    Raises:
        IngestionError: The source is misconfigured or unreachable.
    """
    validate_sql(source.extraction_sql)

    owned_engine = engine is None
    engine = engine or build_engine(
        source, password if password is not None else resolve_password(source)
    )

    # Wrap rather than trust the query to limit itself: an extraction is
    # written to return everything, and "just add LIMIT" is exactly the edit
    # somebody forgets before pointing it at a production database.
    inner = source.extraction_sql.strip().rstrip(";").strip()
    wrapped = f"SELECT * FROM (\n{inner}\n) AS preview_sample LIMIT :preview_limit"

    try:
        with engine.connect() as connection:
            result = connection.execute(
                text(wrapped), {"watermark": EPOCH, "preview_limit": limit + 1}
            )
            columns = list(result.keys())
            fetched = [row._mapping for row in result]  # noqa: SLF001
    except IngestionError:
        raise
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller verbatim
        raise IngestionError(f"preview failed: {exc}") from exc
    finally:
        if owned_engine:
            engine.dispose()

    truncated = len(fetched) > limit
    fetched = fetched[:limit]

    profiles = {name: ColumnProfile(name) for name in columns}
    rows: list[list[Any]] = []
    for mapping in fetched:
        for name in columns:
            profiles[name].observe(mapping[name])
        rows.append([_serialise(mapping[name]) for name in columns])

    logger.info(
        "ingestion.previewed", source_id=source.id, rows=len(rows), columns=len(columns)
    )
    return PreviewResult(
        columns=columns,
        rows=rows,
        profile={name: profile.summary() for name, profile in profiles.items()},
        truncated=truncated,
    )
