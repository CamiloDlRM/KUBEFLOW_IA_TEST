"""Reading an uploaded file into the bronze layer.

An upload arrives as a CSV, a spreadsheet or a Parquet file. Bronze holds
Parquet with every column as text, so this is the adapter between the two — and
its job is the same one bronze always has: preserve what the file said, decide
nothing.

That turns out to be most of the work, because the obvious way to read a CSV
does the opposite. ``pandas.read_csv`` infers types on the way in, and the
inferences it makes are not the ones the cleaning standard would make: it turns
``"007"`` into ``7``, an all-digit identifier into an integer, an empty cell and
the string ``"NA"`` into the same ``NaN``. Every one of those is a decision, and
every one of them happens before anything has been recorded about the file as
it arrived — so the diff between bronze and silver would show pandas' guesses
as though they were the source's own values.

So everything is read as text with no inference at all, and the standard makes
the decisions afterwards, where they are counted and reported.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Final, Iterator

import structlog

logger = structlog.get_logger(__name__)

__all__ = ["TabularError", "SUPPORTED_EXTENSIONS", "to_bronze"]


class TabularError(RuntimeError):
    """An uploaded file could not be read as a table."""


SUPPORTED_EXTENSIONS: Final[frozenset[str]] = frozenset(
    {".csv", ".parquet", ".json", ".jsonl", ".xlsx"}
)

#: Rows converted at a time. Bounds memory for a large upload without making
#: the per-row work any more complicated.
_BATCH: Final[int] = 10_000


def _read_text_frame(path: Path, extension: str) -> Any:
    """Load the file as a frame of strings, inferring nothing.

    ``keep_default_na=False`` is the important argument, and it is easy to miss:
    without it pandas reads the empty cell, ``"NA"``, ``"N/A"``, ``"null"`` and
    ``"NaN"`` as the same missing value. Two of those are the source leaving a
    cell blank and three are the source writing a placeholder into it, and the
    cleaning standard reports them differently on purpose. Letting the reader
    collapse them would settle the question before bronze had recorded it.
    """
    import pandas as pd

    try:
        if extension == ".csv":
            return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[])
        if extension == ".parquet":
            # Already typed, and those types came from whoever wrote the file
            # rather than from a guess — but bronze stores text, so they are
            # rendered and the standard re-derives them where it can be seen.
            return pd.read_parquet(path).astype(str)
        if extension == ".jsonl":
            return pd.read_json(path, lines=True, dtype=str, convert_dates=False)
        if extension == ".json":
            return pd.read_json(path, dtype=str, convert_dates=False)
        if extension == ".xlsx":
            return pd.read_excel(path, dtype=str, keep_default_na=False, na_values=[])
    except ImportError as exc:
        raise TabularError(
            f"the engine needed to read '{extension}' files is not installed: {exc}"
        ) from exc
    except Exception as exc:  # noqa: BLE001 — surfaced to the run record
        raise TabularError(f"could not read the file as {extension}: {exc}") from exc

    raise TabularError(f"'{extension}' files cannot be read as a table")


def _rows(frame: Any, columns: list[str]) -> Iterator[list[Any]]:
    """Yield the frame's rows as lists of text, a batch at a time."""
    total = len(frame)
    for start in range(0, total, _BATCH):
        block = frame.iloc[start : start + _BATCH]
        data = {name: block[name].tolist() for name in columns}
        for index in range(len(block)):
            yield [_cell(data[name][index]) for name in columns]


def _cell(value: Any) -> str | None:
    """Render one value for bronze, keeping a genuine absence absent."""
    if value is None:
        return None
    # pandas represents a missing value as NaN, which is a float and compares
    # unequal to itself. Reached for Parquet and JSON inputs, where the reader
    # cannot be told to leave missingness alone.
    if isinstance(value, float) and value != value:
        return None
    return value if isinstance(value, str) else str(value)


def to_bronze(path: Path, extension: str, destination: Path) -> tuple[int, list[str]]:
    """Convert an uploaded file into a bronze Parquet object.

    Args:
        path: The uploaded file on local disk.
        extension: Its lowercase extension, including the dot.
        destination: Parquet file to write. Not created for an empty table.

    Returns:
        ``(rows written, column names)``.

    Raises:
        TabularError: The file could not be read, or has no columns.
    """
    from core.medallion import BronzeWriter

    if extension not in SUPPORTED_EXTENSIONS:
        raise TabularError(f"'{extension}' files cannot be read as a table")

    frame = _read_text_frame(path, extension)
    columns = [str(name) for name in frame.columns]
    if not columns:
        raise TabularError("the file has no columns")

    written = 0
    with BronzeWriter(destination, columns) as writer:
        for row in _rows(frame, list(frame.columns)):
            writer.write(row)
            written += 1

    logger.info("tabular.to_bronze", rows=written, columns=len(columns), format=extension)
    return written, columns
