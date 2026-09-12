"""Tests for the medallion layout: keys, bronze fidelity and silver typing.

The important ones here are about *fidelity*, not plumbing. Bronze exists so
that silver can be rebuilt without going back to a source whose watermark has
moved on; a bronze layer that quietly loses the difference between a null and
an empty string cannot do that, and the loss is invisible until someone
computes a null rate months later.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from core import medallion
from core.cleaning import Table, clean
from core.medallion import (
    BronzeWriter,
    MedallionError,
    bronze_key,
    gold_key,
    gold_prefix,
    read_head,
    read_schema,
    row_count,
    silver_key,
    stream_prefix,
    slugify,
    write_typed,
)


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------


def test_a_bronze_and_a_silver_object_share_one_path():
    """Lineage readable from the key alone: same path, two buckets."""
    assert bronze_key(4, 7, "abc") == silver_key(4, 7, "abc")


def test_a_run_lands_under_its_source_which_lands_under_its_project():
    key = bronze_key(4, 7, "abc")
    assert key.startswith(stream_prefix(4, 7))
    assert stream_prefix(4, 7).startswith(stream_prefix(4))


def test_gold_is_versioned_rather_than_overwritten():
    """A model was trained on one build; an overwritten table cannot say which."""
    assert gold_key(4, "Patient Summary", 1) != gold_key(4, "Patient Summary", 2)
    assert gold_key(4, "Patient Summary", 2).startswith(gold_prefix(4, "Patient Summary"))


def test_versions_sort_in_order_as_text():
    """v0002 before v0010 — the order object listings actually use."""
    assert sorted([gold_key(1, "t", 10), gold_key(1, "t", 2)])[0] == gold_key(1, "t", 2)


def test_a_hostile_name_cannot_escape_its_prefix():
    assert "/" not in slugify("../../etc/passwd")
    assert gold_key(4, "../../../secrets", 1).startswith("project-4/")


def test_an_unknown_layer_is_refused_by_name():
    with pytest.raises(MedallionError, match="unknown layer"):
        medallion.bucket_for("platinum")


# ---------------------------------------------------------------------------
# Bronze
# ---------------------------------------------------------------------------


def test_bronze_keeps_a_null_and_an_empty_string_apart(tmp_path: Path):
    """The CSV this replaced wrote both as nothing, so every null rate lied."""
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["code"]) as writer:
        writer.write([None])
        writer.write([""])

    _, rows = read_head(path)
    assert rows == [[None], [""]]


def test_bronze_stores_every_column_as_text(tmp_path: Path):
    """Bronze must not assert a type it has not verified."""
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["n", "when"]) as writer:
        writer.write([42, datetime(2024, 6, 14, tzinfo=timezone.utc)])

    assert set(read_schema(path).values()) == {"string"}


def test_bronze_renders_a_timestamp_losslessly(tmp_path: Path):
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["when"]) as writer:
        writer.write([datetime(2024, 6, 14, 9, 30, tzinfo=timezone.utc)])

    _, rows = read_head(path)
    assert datetime.fromisoformat(rows[0][0]) == datetime(2024, 6, 14, 9, 30, tzinfo=timezone.utc)


def test_an_extraction_with_no_rows_leaves_no_file_behind(tmp_path: Path):
    """An empty object in bronze would read as 'we extracted nothing, twice'."""
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["code"]):
        pass
    assert not path.exists()


def test_bronze_writes_more_rows_than_one_row_group(tmp_path: Path):
    """The point of streaming is defeated if it only works below the buffer."""
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["n"]) as writer:
        for index in range(25_000):
            writer.write([index])

    assert row_count(path) == 25_000


def test_a_bronze_file_needs_columns():
    with pytest.raises(MedallionError, match="no columns"):
        BronzeWriter(Path("unused.parquet"), [])


def test_read_head_returns_at_most_what_was_asked_for(tmp_path: Path):
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["n"]) as writer:
        for index in range(100):
            writer.write([index])

    _, rows = read_head(path, limit=5)
    assert len(rows) == 5


def test_row_count_does_not_need_to_read_the_rows(tmp_path: Path):
    path = tmp_path / "bronze.parquet"
    with BronzeWriter(path, ["n"]) as writer:
        for index in range(1234):
            writer.write([index])
    assert row_count(path) == 1234


def test_a_file_that_is_not_parquet_fails_with_its_name(tmp_path: Path):
    broken = tmp_path / "not-parquet.parquet"
    broken.write_text("id,name\n1,x\n")
    with pytest.raises(MedallionError, match="not-parquet.parquet"):
        read_schema(broken)


# ---------------------------------------------------------------------------
# Silver
# ---------------------------------------------------------------------------


def test_the_silver_schema_carries_the_types_the_cleaning_claimed(tmp_path: Path):
    """Otherwise the cast survives only as a sentence in a report."""
    table = Table(
        columns=["age", "weight", "admitted", "recorded_at", "code"],
        data={
            "age": ["44", "39"],
            "weight": ["70.5", "82"],
            "admitted": ["true", "false"],
            "recorded_at": ["2024-06-14T09:00:00+00:00", "2024-06-15T10:00:00+00:00"],
            "code": ["80146002", "73761001"],
        },
    )
    report = clean(table)

    path = tmp_path / "silver.parquet"
    write_typed(table.columns, table.data, report.types, path)

    schema = read_schema(path)
    assert schema["age"] == "int64"
    assert schema["weight"] == "double"
    assert schema["admitted"] == "bool"
    assert schema["recorded_at"].startswith("timestamp")
    assert schema["code"] == "int64"


def test_a_date_column_is_stored_as_a_date_not_a_timestamp(tmp_path: Path):
    path = tmp_path / "silver.parquet"
    write_typed(["born_on"], {"born_on": [date(1980, 3, 2)]}, {"born_on": "date"}, path)
    assert read_schema(path)["born_on"] == "date32[day]"


def test_mixed_awareness_timestamps_are_stored_without_inventing_a_zone(tmp_path: Path):
    """Attaching UTC to a timestamp whose zone was never recorded invents a fact."""
    path = tmp_path / "silver.parquet"
    values = [datetime(2024, 6, 14, 9, tzinfo=timezone.utc), datetime(2024, 6, 15, 10)]
    write_typed(["seen"], {"seen": values}, {"seen": "timestamp"}, path)
    assert read_schema(path)["seen"] == "timestamp[us]"


def test_all_aware_timestamps_keep_their_zone(tmp_path: Path):
    path = tmp_path / "silver.parquet"
    values = [datetime(2024, 6, 14, 9, tzinfo=timezone.utc)]
    write_typed(["seen"], {"seen": values}, {"seen": "timestamp"}, path)
    assert read_schema(path)["seen"] == "timestamp[us, tz=UTC]"


def test_a_column_that_resists_its_cast_falls_back_to_text_without_failing(tmp_path: Path):
    """The rows are real; losing the extraction over one column is a bad trade."""
    path = tmp_path / "silver.parquet"
    types = {"n": "integer"}
    write_typed(["n"], {"n": ["not a number"]}, types, path)

    assert read_schema(path)["n"] == "string"
    # And the report is corrected, rather than continuing to claim integer.
    assert types["n"] == "string"


def test_nulls_survive_the_typed_write(tmp_path: Path):
    path = tmp_path / "silver.parquet"
    write_typed(["age"], {"age": [40, None, 55]}, {"age": "integer"}, path)
    _, rows = read_head(path)
    assert [row[0] for row in rows] == [40, None, 55]


def test_a_bronze_file_can_be_cleaned_into_silver_end_to_end(tmp_path: Path):
    bronze = tmp_path / "bronze.parquet"
    with BronzeWriter(bronze, ["Patient ID", "Edad", "Sexo"]) as writer:
        writer.write(["001", "44", "H"])
        writer.write(["002", "N/A", "M"])

    columns, rows = read_head(bronze)
    table = Table.from_rows([dict(zip(columns, row)) for row in rows], columns)
    report = clean(table)

    silver = tmp_path / "silver.parquet"
    write_typed(table.columns, table.data, report.types, silver)

    schema = read_schema(silver)
    assert schema["patient_id"] == "string"  # leading zero is part of the value
    assert schema["edad"] == "int64"
    _, silver_rows = read_head(silver)
    assert silver_rows == [["001", 44, "male"], ["002", None, "female"]]
