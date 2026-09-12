"""Tests for reading an uploaded file into bronze.

Almost all of these are about what the reader must *not* do. The convenient way
to read a CSV infers types on the way in, and those inferences are decisions —
made before anything has been recorded about the file as it arrived, and
different from the ones the cleaning standard would make and report. A bronze
layer built that way shows pandas' guesses as if they were the source's values.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from core.medallion import read_head, read_schema, row_count
from core.tabular import TabularError, to_bronze


def csv_file(tmp_path: Path, body: str, name: str = "upload.csv") -> Path:
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    return path


def test_a_csv_lands_as_text_with_its_columns(tmp_path):
    source = csv_file(tmp_path, "patient_id,age\np1,44\np2,39\n")
    rows, columns = to_bronze(source, ".csv", tmp_path / "bronze.parquet")

    assert rows == 2
    assert columns == ["patient_id", "age"]
    assert set(read_schema(tmp_path / "bronze.parquet").values()) == {"string"}


def test_a_leading_zero_survives_the_read(tmp_path):
    """pandas would read this column as integers and 007 would become 7."""
    source = csv_file(tmp_path, "postcode\n05001\n11001\n")
    to_bronze(source, ".csv", tmp_path / "bronze.parquet")

    _, values = read_head(tmp_path / "bronze.parquet")
    assert [row[0] for row in values] == ["05001", "11001"]


def test_a_placeholder_and_an_empty_cell_stay_different(tmp_path):
    """The default reader makes NA, N/A, null and an empty cell the same value.

    Two of those are the source leaving a cell blank and three are it writing a
    placeholder in. The cleaning standard reports them differently on purpose,
    so the reader must not settle it first.
    """
    # Two columns on purpose: in a single-column file an empty value and a
    # blank line are the same bytes, and pandas drops blank lines — correctly,
    # since a truly empty line is not a row.
    source = csv_file(tmp_path, "id,code\n1,NA\n2,\n3,null\n4,80146002\n")
    to_bronze(source, ".csv", tmp_path / "bronze.parquet")

    _, values = read_head(tmp_path / "bronze.parquet")
    assert [row[1] for row in values] == ["NA", "", "null", "80146002"]


def test_a_number_is_not_turned_into_a_float(tmp_path):
    """A column of counts read as floats arrives as 3.0 admissions."""
    source = csv_file(tmp_path, "admissions\n1\n2\n13\n")
    to_bronze(source, ".csv", tmp_path / "bronze.parquet")

    _, values = read_head(tmp_path / "bronze.parquet")
    assert [row[0] for row in values] == ["1", "2", "13"]


def test_a_date_is_not_reinterpreted(tmp_path):
    source = csv_file(tmp_path, "seen\n2024-06-14T09:00:00+00:00\n")
    to_bronze(source, ".csv", tmp_path / "bronze.parquet")

    _, values = read_head(tmp_path / "bronze.parquet")
    assert values[0][0] == "2024-06-14T09:00:00+00:00"


def test_a_larger_file_than_one_batch_is_written_whole(tmp_path):
    body = "n\n" + "\n".join(str(index) for index in range(25_000)) + "\n"
    to_bronze(csv_file(tmp_path, body), ".csv", tmp_path / "bronze.parquet")
    assert row_count(tmp_path / "bronze.parquet") == 25_000


def test_a_parquet_upload_is_rendered_as_text_like_any_other(tmp_path):
    """Its types came from whoever wrote it; bronze re-derives them where it
    can be seen rather than inheriting a claim it did not check."""
    from core.medallion import write_typed

    typed = tmp_path / "typed.parquet"
    write_typed(["age"], {"age": [44, 39]}, {"age": "integer"}, typed)

    to_bronze(typed, ".parquet", tmp_path / "bronze.parquet")
    assert read_schema(tmp_path / "bronze.parquet")["age"] == "string"


def test_a_file_with_no_rows_writes_nothing(tmp_path):
    source = csv_file(tmp_path, "patient_id,age\n")
    rows, _ = to_bronze(source, ".csv", tmp_path / "bronze.parquet")

    assert rows == 0
    assert not (tmp_path / "bronze.parquet").exists()


def test_an_unreadable_file_says_what_it_could_not_do(tmp_path):
    source = tmp_path / "broken.parquet"
    source.write_text("this is not parquet")
    with pytest.raises(TabularError, match="could not read the file"):
        to_bronze(source, ".parquet", tmp_path / "bronze.parquet")


def test_an_unsupported_format_is_refused_by_name(tmp_path):
    with pytest.raises(TabularError, match="'.docx' files"):
        to_bronze(tmp_path / "x.docx", ".docx", tmp_path / "bronze.parquet")
