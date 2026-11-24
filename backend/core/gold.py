"""The gold layer: one query across silver, materialised as one table.

Silver is per-source and accumulating: every extraction adds an object beside
the ones before it. That is the right shape for storage and the wrong shape for
training, because a model wants one table, and a project usually has more than
one source — patients here, encounters there, procedures in a third.

Gold is where they meet. It is defined by a **query**, executed by DuckDB
directly over the silver Parquet files, and it is rebuilt in full on every
change rather than appended to. Rebuilding is not laziness: a table that is one
row per patient cannot be maintained by appending, because a new encounter
changes a row that already exists.

The default query is a union of everything a source has ever landed, so a
project that has defined nothing still trains on its whole history rather than
on the last slice. A project that wants more — a join across sources, an
aggregate, one row per patient — replaces it with a query of its own.

**The query is the artefact, and it is never generated data.** When the AI
writes a gold definition it writes SQL, which is then read, executed and
reported on by the platform. It never returns rows. A model that hands back
data is a model you have to trust; a model that hands back a query is one you
can check, run twice, and diff.

**The query runs sealed.** A definition is written by a project member or a
model and then executed in the worker (and in the API, for previews), next to
the database password, the encryption key and the object-store credentials.
DuckDB can read any file or URL it is pointed at, so the silver relations are
copied into memory first and the connection is then cut off from the file
system and the network, with its configuration locked, before a single line of
the definition runs. :func:`validate_sql` refuses the obvious attempts early
and with a clear message; the sealed connection is what makes the rest fail.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final, Sequence

import structlog

logger = structlog.get_logger(__name__)

__all__ = [
    "GoldError",
    "GoldBuild",
    "default_sql",
    "validate_sql",
    "build",
    "describe_relations",
]


class GoldError(RuntimeError):
    """A gold table could not be defined or built."""


#: Statements that must never appear in a gold definition. The query runs
#: against a throwaway in-process database that has already been sealed off
#: from files and the network (see :func:`_seal`) — but a definition is written
#: once and run on every extraction afterwards, and "the engine would have
#: stopped it" is not a sentence worth having to say.
_FORBIDDEN: Final[tuple[str, ...]] = (
    "attach", "copy", "create", "delete", "drop", "export", "insert", "install",
    "load", "pragma", "set", "update", "call", "import",
)

#: Functions that read files, URLs or the process environment. A gold
#: definition reads the project's silver relations and nothing else, so a call
#: to any of these is refused by name. This is defence in depth: the sealed
#: connection already refuses every one of them, but a refusal at save time
#: names the problem, where a failure at build time only reports it.
_FILE_FUNCTIONS: Final[tuple[str, ...]] = (
    # Plain files.
    "read_text", "read_blob", "glob",
    # CSV.
    "read_csv", "read_csv_auto", "sniff_csv",
    # JSON.
    "read_json", "read_json_auto", "read_json_objects", "read_json_objects_auto",
    "read_ndjson", "read_ndjson_auto", "read_ndjson_objects",
    # Parquet, including the metadata readers, which open the file too.
    "read_parquet", "parquet_scan", "parquet_metadata", "parquet_schema",
    "parquet_file_metadata", "parquet_kv_metadata",
    # Table formats and extension scanners — files, object stores, databases.
    "iceberg_scan", "iceberg_metadata", "iceberg_snapshots", "delta_scan",
    "sqlite_scan", "postgres_scan", "mysql_scan", "st_read",
    # The environment is where the secrets are.
    "getenv",
)

#: A call to one of :data:`_FILE_FUNCTIONS`: bare, schema-qualified
#: (``main.read_text``) or quoted (``"read_text"``), with any whitespace before
#: the parenthesis. Longest names first so the reported name is the whole one.
_FILE_FUNCTION_CALL = re.compile(
    r"\b("
    + "|".join(re.escape(name) for name in sorted(_FILE_FUNCTIONS, key=len, reverse=True))
    + r')"?\s*\('
)

#: A path used directly as a table: ``FROM '/etc/passwd.csv'`` or
#: ``JOIN "s3://bucket/x.parquet"``. DuckDB turns either into a file scan
#: without any function being named, so the name check above cannot see it.
#: Only quoted text that looks like a path counts — a separator, an extension
#: or a glob — so ``IS DISTINCT FROM 'closed'`` and ``EXTRACT(year FROM
#: '2024-01-01'::date)`` are left alone. A comma join (``FROM a, 'x.csv'``)
#: is not caught here; the sealed connection refuses it all the same.
_PATH_AS_TABLE = re.compile(
    r"""\b(?:from|join)\s*(?:'[^']*[/\\.*?]|"[^"]*[/\\.*?])"""
)

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

#: Rows pulled from DuckDB at a time when writing the result.
_BATCH: Final[int] = 10_000


def _strip_comments(sql: str) -> str:
    """Remove SQL comments so they cannot hide a forbidden statement."""
    without_block = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", without_block)


def validate_sql(sql: str) -> None:
    """Refuse a gold definition that is not a single read-only query.

    Checked before the query is stored, not only before it is run: a definition
    that will fail on every future extraction should be rejected by the person
    writing it, while they still have the context to fix it.
    """
    body = _strip_comments(sql).strip().rstrip(";").strip()
    if not body:
        raise GoldError("the gold definition is empty")

    if ";" in body:
        raise GoldError(
            "a gold definition is one query; split statements are not accepted "
            "because only the first would define the table"
        )

    lowered = body.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise GoldError("a gold definition must start with SELECT or WITH")

    for word in _FORBIDDEN:
        if re.search(rf"\b{word}\b", lowered):
            raise GoldError(
                f"a gold definition may only read: {word.upper()} is not allowed"
            )

    call = _FILE_FUNCTION_CALL.search(lowered)
    if call:
        raise GoldError(
            "a gold definition may only read the project's silver relations: "
            f"{call.group(1)}() reads files, URLs or the environment and is not allowed"
        )

    if _PATH_AS_TABLE.search(lowered):
        raise GoldError(
            "a gold definition may only read the project's silver relations: "
            "reading a file or URL by its path is not allowed"
        )


def default_sql(relations: Sequence[str]) -> str:
    """The definition a project gets before it writes one of its own.

    One relation: everything that source has landed, in full. Several: the same
    per source, stacked by column name, so a project with three sources still
    produces one table rather than failing to produce any. ``BY NAME`` rather
    than positional, because two sources agreeing on a column count is a
    coincidence, not a schema.

    This is a starting point and is meant to be replaced. Stacking sources with
    different meanings is rarely the table anyone wants — it is just the one
    that is always correct to build.
    """
    if not relations:
        raise GoldError("there is no silver data to build a gold table from")
    if len(relations) == 1:
        return f"SELECT * FROM {relations[0]}"
    return "\nUNION ALL BY NAME\n".join(f"SELECT * FROM {name}" for name in relations)


@dataclass
class GoldBuild:
    """What one build of a gold table produced."""

    path: Path
    rows: int
    columns: list[str]
    sql: str
    relations: dict[str, int]

    def summary(self) -> dict[str, Any]:
        return {
            "rows": self.rows,
            "columns": self.columns,
            "sql": self.sql,
            "relations": self.relations,
        }


def _seal(connection: Any) -> None:
    """Cut a connection off from everything but the tables it already holds.

    After this the connection cannot read or write a file, reach a URL, attach
    a database, install or load an extension, or scan a Python object by name —
    and, because the configuration is locked, it cannot undo any of that
    either. DuckDB only allows external access to be switched *off* while a
    database is open, and ``lock_configuration`` refuses every later ``SET``
    and ``RESET``, so the order below matters: the lock goes last.
    """
    # Already implied by disabling external access in the Python client, but
    # that coupling is an implementation detail; this one is said out loud.
    connection.execute("SET python_enable_replacements = false")
    connection.execute("SET enable_external_access = false")
    connection.execute("SET lock_configuration = true")


def _connect(relations: dict[str, Sequence[Path]]) -> Any:
    """Open a sealed in-memory DuckDB holding one table per silver relation.

    The relations are materialised as tables, not views over the Parquet
    files, because a view reads its files when it is queried — which would be
    after the connection is sealed, by which point no file can be read. Copying
    them in first means nothing on this connection needs the file system once
    a gold definition is allowed to run on it.
    """
    import duckdb

    for name in relations:
        if not _IDENTIFIER.match(name):
            raise GoldError(f"{name!r} is not a usable relation name")

    connection = duckdb.connect(":memory:")
    try:
        for name, paths in relations.items():
            if not paths:
                continue
            # The name is interpolated (an identifier cannot be bound) and was
            # checked against _IDENTIFIER above; the file list is bound.
            # union_by_name because a source's schema can widen between
            # extractions — a column added to the hospital table last month is
            # present in the newer objects and absent from the older ones, and
            # positional union would silently shift every value one column left.
            connection.execute(
                f"CREATE TABLE {name} AS "
                "SELECT * FROM read_parquet(?, union_by_name := true)",
                [[str(path) for path in paths]],
            )
        _seal(connection)
    except Exception:
        connection.close()
        raise
    return connection


def describe_relations(relations: dict[str, Sequence[Path]]) -> dict[str, Any]:
    """Return each relation's columns, types and row count.

    This is what a gold definition is written against — by a person in the UI
    or by the AI — so it has to be available without reading the data itself.
    """
    connection = _connect(relations)
    try:
        described: dict[str, Any] = {}
        for name in relations:
            if not relations[name]:
                continue
            columns = connection.execute(f"DESCRIBE {name}").fetchall()
            rows = connection.execute(f"SELECT count(*) FROM {name}").fetchone()
            described[name] = {
                "columns": [
                    {"name": column[0], "type": column[1]} for column in columns
                ],
                "rows": int(rows[0]) if rows else 0,
            }
        return described
    finally:
        connection.close()


def build(
    relations: dict[str, Sequence[Path]],
    sql: str,
    destination: Path,
    *,
    preview_rows: int = 0,
) -> tuple[GoldBuild, list[list[Any]]]:
    """Run a gold definition over silver and write the result to Parquet.

    Returns the build and, when ``preview_rows`` is non-zero, its first rows.
    The preview exists for the moment before a definition is saved: SQL that
    parses, runs and returns an empty table is the most common way an
    AI-written definition goes wrong, and a row count with a few rows beside it
    is the cheapest way to catch it.

    Raises:
        GoldError: The definition is not a read-only query, or it failed.
    """
    validate_sql(sql)
    connection = _connect(relations)
    try:
        counts = {
            name: int(connection.execute(f"SELECT count(*) FROM {name}").fetchone()[0])
            for name in relations
            if relations[name]
        }
        destination.parent.mkdir(parents=True, exist_ok=True)
        body = _strip_comments(sql).strip().rstrip(";").strip()

        import pyarrow as pa
        import pyarrow.parquet as pq

        # The result leaves DuckDB as Arrow and is written by pyarrow, never by
        # a COPY: the connection is sealed and cannot write a file — which is
        # the point. It is fetched batch by batch rather than materialised,
        # because a gold definition is written by a person or a model and can
        # be an unguarded cross join; the result should be able to exceed the
        # worker without taking it out.
        reader = connection.execute(f"SELECT * FROM (\n{body}\n) AS gold").fetch_record_batch(
            _BATCH
        )
        schema = reader.schema
        columns = list(schema.names)

        destination.parent.mkdir(parents=True, exist_ok=True)
        writer = pq.ParquetWriter(destination, schema, compression="snappy")
        rows = 0
        preview: list[list[Any]] = []
        try:
            for batch in reader:
                writer.write_batch(batch)
                if preview_rows and len(preview) < preview_rows:
                    head = batch.slice(0, preview_rows - len(preview)).to_pydict()
                    preview.extend(
                        [head[name][index] for name in columns]
                        for index in range(len(head[columns[0]]) if columns else 0)
                    )
                rows += batch.num_rows
        finally:
            writer.close()

        if rows == 0:
            # An empty result still has to leave a readable file: "the query
            # returned nothing" and "the build did not happen" are different
            # answers, and only one of them is a bug.
            pq.write_table(pa.Table.from_batches([], schema=schema), destination)
    except GoldError:
        raise
    except Exception as exc:  # noqa: BLE001 — the message is the whole point
        raise GoldError(f"the gold definition failed: {exc}") from exc
    finally:
        connection.close()

    logger.info("gold.built", rows=rows, columns=len(columns), relations=list(relations))
    return (
        GoldBuild(
            path=destination, rows=rows, columns=columns, sql=sql, relations=counts
        ),
        preview,
    )
