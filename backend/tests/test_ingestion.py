"""Tests for incremental extraction from an external source.

Driven against SQLite rather than Postgres: everything under test here — the
watermark arithmetic, the parameter binding, the streaming profile — is
database-independent, and the one part that is not (``build_engine``) is a URL
built from four fields. Requiring a live Postgres to test the logic would mean
the logic went untested.

The case that matters most is ``test_late_arriving_row_is_picked_up``. It is
the reason the source carries an entry timestamp separate from its business
date, and the bug it guards against fails silently.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from core.ingestion import (
    EPOCH,
    ColumnProfile,
    IngestionError,
    extract,
    validate_sql,
)
from models.schemas import DataSource

# Business date and entry date deliberately disagree, as they do in the source.
ROWS = [
    # (id, clinical_date,  recorded_at,          procedure_text,      cost)
    (1, "2024-01-10", "2024-01-10T09:00:00", "Appendectomy (procedure)", 1200.5),
    (2, "2024-01-11", "2024-01-12T10:30:00", "APPENDECTOMY", 1180.0),
    (3, "2024-01-12", "2024-01-13T08:15:00", "Appendect.", None),
    (4, "2024-02-01", "2024-02-03T14:00:00", "Colonoscopy (procedure)", 890.25),
    (5, "2024-02-02", "2024-02-02T16:45:00", "  colonoscopy  ", 905.0),
]

EXTRACTION_SQL = """
    SELECT id, clinical_date, recorded_at, procedure_text, cost
    FROM procedures
    WHERE recorded_at > :watermark
    ORDER BY recorded_at
"""


@pytest.fixture()
def source_engine():
    """An in-memory stand-in for the hospital's own database."""
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE procedures ("
                "  id INTEGER PRIMARY KEY,"
                "  clinical_date TEXT,"
                "  recorded_at TEXT,"
                "  procedure_text TEXT,"
                "  cost REAL)"
            )
        )
        for row in ROWS:
            connection.execute(
                text(
                    "INSERT INTO procedures VALUES "
                    "(:id, :clinical_date, :recorded_at, :procedure_text, :cost)"
                ),
                dict(zip(["id", "clinical_date", "recorded_at", "procedure_text", "cost"], row)),
            )
    yield engine
    engine.dispose()


def make_source(**overrides) -> DataSource:
    defaults = dict(
        id=1,
        repo_id=1,
        name="Hospital HIS",
        kind="postgres",
        extraction_sql=EXTRACTION_SQL,
        watermark_column="recorded_at",
        watermark_value="",
    )
    defaults.update(overrides)
    return DataSource(**defaults)


def insert_row(engine, row) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO procedures VALUES "
                "(:id, :clinical_date, :recorded_at, :procedure_text, :cost)"
            ),
            dict(zip(["id", "clinical_date", "recorded_at", "procedure_text", "cost"], row)),
        )


class TestValidation:
    def test_sql_without_the_watermark_token_is_refused(self):
        with pytest.raises(IngestionError, match="must reference"):
            validate_sql("SELECT * FROM procedures")

    def test_empty_sql_is_refused(self):
        with pytest.raises(IngestionError, match="empty"):
            validate_sql("   ")

    def test_sql_not_returning_the_watermark_column_is_refused(
        self, source_engine, tmp_path
    ):
        source = make_source(
            extraction_sql="SELECT id, cost FROM procedures WHERE recorded_at > :watermark"
        )
        with pytest.raises(IngestionError, match="watermark column"):
            extract(source, tmp_path / "out.csv", engine=source_engine)

    def test_source_without_a_watermark_column_is_refused(self, source_engine, tmp_path):
        source = make_source(watermark_column="")
        with pytest.raises(IngestionError, match="watermark column"):
            extract(source, tmp_path / "out.csv", engine=source_engine)

    def test_unsupported_kind_is_refused(self):
        from core.ingestion import build_engine

        with pytest.raises(IngestionError, match="unsupported source kind"):
            build_engine(make_source(kind="oracle"), "")


class TestIncrementalExtraction:
    def test_first_run_backfills_everything(self, source_engine, tmp_path):
        destination = tmp_path / "out.csv"
        result = extract(make_source(), destination, engine=source_engine)

        assert result.rows == len(ROWS)
        assert result.watermark_before == EPOCH
        assert result.watermark_after == "2024-02-03T14:00:00"
        assert destination.exists()
        assert destination.read_text(encoding="utf-8").splitlines()[0].startswith("id,")

    def test_second_run_extracts_only_what_is_new(self, source_engine, tmp_path):
        first = extract(make_source(), tmp_path / "a.csv", engine=source_engine)

        insert_row(source_engine, (6, "2024-03-01", "2024-03-01T11:00:00", "Biopsy", 300.0))
        second = extract(
            make_source(watermark_value=first.watermark_after),
            tmp_path / "b.csv",
            engine=source_engine,
        )

        assert second.rows == 1
        assert second.watermark_after == "2024-03-01T11:00:00"
        body = (tmp_path / "b.csv").read_text(encoding="utf-8")
        assert "Biopsy" in body
        assert "Appendectomy" not in body

    def test_run_with_nothing_new_produces_no_file(self, source_engine, tmp_path):
        first = extract(make_source(), tmp_path / "a.csv", engine=source_engine)
        destination = tmp_path / "b.csv"

        second = extract(
            make_source(watermark_value=first.watermark_after),
            destination,
            engine=source_engine,
        )

        assert second.rows == 0
        assert second.path is None
        assert not destination.exists(), "an empty extraction must not leave a file behind"

    def test_run_with_nothing_new_leaves_the_watermark_untouched(
        self, source_engine, tmp_path
    ):
        first = extract(make_source(), tmp_path / "a.csv", engine=source_engine)
        second = extract(
            make_source(watermark_value=first.watermark_after),
            tmp_path / "b.csv",
            engine=source_engine,
        )
        assert second.watermark_after == first.watermark_after

    def test_late_arriving_row_is_picked_up(self, source_engine, tmp_path):
        """The bug the entry timestamp exists to prevent.

        A procedure performed in January but keyed in during March has a
        business date far behind the mark. Watermarking the business date drops
        it and reports success; watermarking the entry date catches it.
        """
        first = extract(make_source(), tmp_path / "a.csv", engine=source_engine)

        # Clinical date well before the watermark, entry date after it.
        insert_row(
            source_engine,
            (7, "2024-01-05", "2024-03-15T09:00:00", "Late-entered procedure", 42.0),
        )

        second = extract(
            make_source(watermark_value=first.watermark_after),
            tmp_path / "b.csv",
            engine=source_engine,
        )

        assert second.rows == 1, "a row entered after the mark must not be skipped"
        assert "Late-entered" in (tmp_path / "b.csv").read_text(encoding="utf-8")

    def test_business_date_watermark_would_have_lost_it(self, source_engine, tmp_path):
        """The counter-case, pinned so the distinction cannot quietly regress."""
        business_sql = (
            "SELECT id, clinical_date, recorded_at, procedure_text, cost "
            "FROM procedures WHERE clinical_date > :watermark ORDER BY clinical_date"
        )
        source = make_source(extraction_sql=business_sql, watermark_column="clinical_date")
        first = extract(source, tmp_path / "a.csv", engine=source_engine)

        insert_row(
            source_engine,
            (7, "2024-01-05", "2024-03-15T09:00:00", "Late-entered procedure", 42.0),
        )

        second = extract(
            make_source(
                extraction_sql=business_sql,
                watermark_column="clinical_date",
                watermark_value=first.watermark_after,
            ),
            tmp_path / "b.csv",
            engine=source_engine,
        )

        assert second.rows == 0, (
            "this documents the failure mode: watermarking the business date "
            "silently drops the late entry and still reports success"
        )

    def test_max_rows_leaves_a_resumable_watermark(self, source_engine, tmp_path):
        first = extract(make_source(), tmp_path / "a.csv", engine=source_engine, max_rows=2)
        assert first.rows == 2

        second = extract(
            make_source(watermark_value=first.watermark_after),
            tmp_path / "b.csv",
            engine=source_engine,
        )
        assert first.rows + second.rows == len(ROWS), "no row may be lost or duplicated"


class TestParameterBinding:
    def test_watermark_is_bound_not_interpolated(self, source_engine, tmp_path):
        """A watermark carrying SQL must be compared, not executed.

        The value comes back from a previous run — it is data, and data does
        not get to become SQL.

        The date in the payload is chosen so the two outcomes differ. Bound, it
        is one long string that sorts after every timestamp in the table, so
        nothing matches. Interpolated, the clause would close early and become
        ``recorded_at > '2024-09-01' OR '1'='1'`` — a tautology returning every
        row. An earlier date would return everything either way and the test
        would pass without proving anything.
        """
        hostile = "2024-09-01' OR '1'='1"
        result = extract(
            make_source(watermark_value=hostile), tmp_path / "out.csv", engine=source_engine
        )

        assert result.rows == 0, (
            "the payload was executed as SQL: a bound comparison against this "
            "string matches nothing, a tautology matches everything"
        )

        with source_engine.connect() as connection:
            surviving = connection.execute(text("SELECT COUNT(*) FROM procedures")).scalar()
        assert surviving == len(ROWS), "the source table must be untouched"

    def test_a_benign_watermark_still_filters_normally(self, source_engine, tmp_path):
        """Guards the test above from passing for the wrong reason.

        If extraction were broken and always returned nothing, the injection
        test would pass. This pins that a plain watermark does filter.
        """
        result = extract(
            make_source(watermark_value="2024-01-12T00:00:00"),
            tmp_path / "out.csv",
            engine=source_engine,
        )
        # Rows 2-5: everything recorded after midnight on the 12th.
        assert result.rows == 4


class TestProfiling:
    def test_profile_covers_every_column(self, source_engine, tmp_path):
        result = extract(make_source(), tmp_path / "out.csv", engine=source_engine)
        assert set(result.profile) == {
            "id",
            "clinical_date",
            "recorded_at",
            "procedure_text",
            "cost",
        }

    def test_nulls_are_counted(self, source_engine, tmp_path):
        result = extract(make_source(), tmp_path / "out.csv", engine=source_engine)
        cost = result.profile["cost"]
        assert cost["nulls"] == 1
        assert cost["null_rate"] == round(1 / len(ROWS), 4)

    def test_numeric_columns_get_statistics(self, source_engine, tmp_path):
        result = extract(make_source(), tmp_path / "out.csv", engine=source_engine)
        cost = result.profile["cost"]
        assert cost["inferred_type"] == "numeric"
        assert cost["min"] == 890.25
        assert cost["max"] == 1200.5

    def test_free_text_is_not_reported_as_numeric(self, source_engine, tmp_path):
        result = extract(make_source(), tmp_path / "out.csv", engine=source_engine)
        assert result.profile["procedure_text"]["inferred_type"] in {"text", "categorical"}

    def test_top_values_expose_the_variants_of_one_term(self, source_engine, tmp_path):
        """What the normalisation step is for, visible in the profile."""
        result = extract(make_source(), tmp_path / "out.csv", engine=source_engine)
        values = {entry["value"] for entry in result.profile["procedure_text"]["top_values"]}
        assert {"Appendectomy (procedure)", "APPENDECTOMY", "Appendect."} <= values

    def test_empty_extraction_has_no_profile(self, source_engine, tmp_path):
        first = extract(make_source(), tmp_path / "a.csv", engine=source_engine)
        second = extract(
            make_source(watermark_value=first.watermark_after),
            tmp_path / "b.csv",
            engine=source_engine,
        )
        assert second.profile == {}


class TestColumnProfile:
    """Unit-level checks on the accumulator, away from any database."""

    def test_whitespace_only_counts_as_blank_not_null(self):
        profile = ColumnProfile("x")
        profile.observe("   ")
        summary = profile.summary()
        assert summary["blanks"] == 1
        assert summary["nulls"] == 0

    def test_booleans_are_not_treated_as_numbers(self):
        profile = ColumnProfile("flag")
        for value in (True, False, True):
            profile.observe(value)
        assert profile.summary()["inferred_type"] != "numeric"

    def test_mixed_columns_are_labelled_mixed(self):
        profile = ColumnProfile("value")
        for value in ("128", "7.2", "Negative", "90"):
            profile.observe(value)
        assert profile.summary()["inferred_type"] == "mixed"

    def test_high_cardinality_reports_that_it_stopped_counting(self):
        profile = ColumnProfile("id")
        for i in range(6_000):
            profile.observe(str(i))
        summary = profile.summary()
        assert summary["distinct"] is None
        assert "more than" in summary["distinct_note"]

    def test_low_cardinality_is_categorical(self):
        profile = ColumnProfile("gender")
        for i in range(200):
            profile.observe("M" if i % 2 else "F")
        assert profile.summary()["inferred_type"] == "categorical"


class TestPasswordResolution:
    def test_missing_environment_variable_is_a_clear_error(self, monkeypatch):
        from core.ingestion import resolve_password

        monkeypatch.delenv("SOME_SOURCE_PASSWORD", raising=False)
        with pytest.raises(IngestionError, match="is not set on the worker"):
            resolve_password(make_source(password_env="SOME_SOURCE_PASSWORD"))

    def test_password_comes_from_the_environment(self, monkeypatch):
        from core.ingestion import resolve_password

        monkeypatch.setenv("SOME_SOURCE_PASSWORD", "s3cret")
        assert resolve_password(make_source(password_env="SOME_SOURCE_PASSWORD")) == "s3cret"

    def test_no_variable_named_means_no_password(self):
        from core.ingestion import resolve_password

        assert resolve_password(make_source(password_env="")) == ""


class TestPreview:
    """Looking at the source before committing to an extraction.

    The route this covers exists because writing an extraction blind is a bad
    way to work: you pick a table, a watermark column and a text/code pair from
    memory, point it at a live database and find out afterwards.
    """

    def test_preview_returns_rows_and_columns(self, source_engine, tmp_path):
        from core.ingestion import preview

        result = preview(make_source(), engine=source_engine)

        assert result.columns == ["id", "clinical_date", "recorded_at", "procedure_text", "cost"]
        assert len(result.rows) == len(ROWS)

    def test_preview_is_capped(self, source_engine):
        from core.ingestion import preview

        result = preview(make_source(), limit=2, engine=source_engine)

        assert len(result.rows) == 2
        assert result.truncated, "the caller has to know more rows exist"

    def test_the_cap_is_applied_even_when_the_query_has_none(self, source_engine):
        """The query is written to return everything; wrapping it is the point.

        "Just add a LIMIT" is exactly the edit somebody forgets before pointing
        a query at a production database.
        """
        from core.ingestion import preview

        assert "limit" not in make_source().extraction_sql.lower()
        assert len(preview(make_source(), limit=1, engine=source_engine).rows) == 1

    def test_not_truncated_when_the_source_fits(self, source_engine):
        from core.ingestion import preview

        assert not preview(make_source(), limit=50, engine=source_engine).truncated

    def test_preview_profiles_the_sample(self, source_engine):
        """So the text and code columns can be chosen from what is there."""
        from core.ingestion import preview

        profile = preview(make_source(), engine=source_engine).profile

        assert profile["cost"]["inferred_type"] == "numeric"
        assert profile["cost"]["nulls"] == 1
        assert profile["procedure_text"]["inferred_type"] in {"text", "categorical"}

    def test_preview_does_not_need_a_watermark_column(self, source_engine):
        """It runs before the source is configured, so it cannot require one."""
        from core.ingestion import preview

        assert preview(make_source(watermark_column=""), engine=source_engine).rows

    def test_preview_shows_the_start_of_the_range(self, source_engine):
        """Bound to the epoch: a first extraction begins at the beginning."""
        from core.ingestion import preview

        result = preview(make_source(watermark_value="2024-12-01"), engine=source_engine)
        assert len(result.rows) == len(ROWS), (
            "a stored watermark must not narrow what the preview shows"
        )

    def test_invalid_sql_is_reported_not_raised_as_a_crash(self, source_engine):
        from core.ingestion import IngestionError, preview

        source = make_source(
            extraction_sql="SELECT * FROM does_not_exist WHERE x > :watermark"
        )
        with pytest.raises(IngestionError, match="preview failed"):
            preview(source, engine=source_engine)

    def test_sql_without_the_watermark_token_is_refused(self, source_engine):
        from core.ingestion import IngestionError, preview

        with pytest.raises(IngestionError, match="must reference"):
            preview(make_source(extraction_sql="SELECT 1"), engine=source_engine)

    def test_a_trailing_semicolon_does_not_break_the_wrapper(self, source_engine):
        from core.ingestion import preview

        source = make_source(extraction_sql=EXTRACTION_SQL.strip() + " ;  ")
        assert preview(source, engine=source_engine).rows
