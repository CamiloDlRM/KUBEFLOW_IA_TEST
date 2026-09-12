"""Tests for the endpoints that make the layers visible and define gold.

Two things are pinned. First the tenant boundary, as everywhere else: another
project's layers answer 404, and a source id belonging to someone else cannot
be used to read their objects through a project the caller *can* see. Second
that the summary tells the truth about the difference between the layers —
silver reports what survived cleaning, not what was extracted, because
reporting the extracted count would make the layers look identical and hide the
one thing this view exists to show.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy import text

from core.medallion import write_typed
from models.schemas import DataSource, GoldTable, IngestionRun
from tests.conftest import DEFAULT_USER_ID, seed_project
from tests.test_ingestion_task import FakeObjectStore


@pytest.fixture()
def own_project(db_session):
    return seed_project(db_session, owner_id=DEFAULT_USER_ID)


@pytest.fixture()
def other_project(db_session):
    return seed_project(db_session, owner_id=2, name="Theirs")


def seed_source(db_session, project_id: int, name: str = "Hospital HIS") -> DataSource:
    source = DataSource(
        project_id=project_id,
        name=name,
        host="hospital-db",
        database="hospital",
        username="hospital",
        extraction_sql="SELECT 1 WHERE x > :watermark",
        watermark_column="recorded_at",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def seed_run(
    db_session, source_id: int, *, extracted: int, kept: int, landed: bool = True
) -> IngestionRun:
    key = f"project-x/source-{source_id}/run-{extracted}.parquet" if landed else ""
    run = IngestionRun(
        source_id=source_id,
        status="success",
        rows_extracted=extracted,
        bronze_key=key,
        silver_key=key,
        quality_report={"rows_in": extracted, "rows_out": kept, "cells_changed": 12},
    )
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    return run


@pytest.fixture()
def store():
    return FakeObjectStore()


@pytest.fixture()
def storage_patched(store):
    with (
        patch("core.storage.upload_fileobj", side_effect=store.upload_fileobj),
        patch("core.storage.download_to_path", side_effect=store.download_to_path),
        patch("core.storage.get_s3_client", side_effect=store.get_s3_client),
    ):
        yield store


def put_object(store, bucket: str, key: str, path: Path) -> None:
    with path.open("rb") as handle:
        store.upload_fileobj(bucket, key, handle)


def silver_file(tmp_path, name="silver.parquet", ids=("p1", "p2", "p3"), ages=(44, 39, 71)) -> Path:
    path = tmp_path / name
    write_typed(
        ["patient_id", "age"],
        {"patient_id": list(ids), "age": list(ages)},
        {"patient_id": "string", "age": "integer"},
        path,
    )
    return path


# ---------------------------------------------------------------------------
# The overview
# ---------------------------------------------------------------------------


class TestOverview:
    def test_a_project_with_nothing_ingested_reports_three_empty_layers(
        self, test_app, own_project, storage_patched
    ):
        response = test_app.get(f"/projects/{own_project.id}/medallion")

        assert response.status_code == 200
        body = response.json()
        assert [body[layer]["rows"] for layer in ("bronze", "silver", "gold")] == [0, 0, 0]
        assert body["gold"]["is_default_definition"] is True

    def test_silver_reports_what_survived_cleaning_not_what_was_extracted(
        self, test_app, db_session, own_project, storage_patched
    ):
        """Otherwise the two layers look identical and the report means nothing."""
        source = seed_source(db_session, own_project.id)
        seed_run(db_session, source.id, extracted=100, kept=97)

        body = test_app.get(f"/projects/{own_project.id}/medallion").json()

        assert body["bronze"]["rows"] == 100
        assert body["silver"]["rows"] == 97

    def test_each_source_appears_as_its_own_stream(
        self, test_app, db_session, own_project, storage_patched
    ):
        first = seed_source(db_session, own_project.id, name="Hospital HIS")
        second = seed_source(db_session, own_project.id, name="Lab results")
        seed_run(db_session, first.id, extracted=10, kept=10)
        seed_run(db_session, second.id, extracted=5, kept=4)

        body = test_app.get(f"/projects/{own_project.id}/medallion").json()

        names = {stream["source_name"] for stream in body["silver"]["streams"]}
        assert names == {"Hospital HIS", "Lab results"}
        assert body["silver"]["rows"] == 14

    def test_a_stream_is_named_the_way_a_gold_query_would_address_it(
        self, test_app, db_session, own_project, storage_patched
    ):
        source = seed_source(db_session, own_project.id, name="Hospital HIS")
        seed_run(db_session, source.id, extracted=1, kept=1)

        body = test_app.get(f"/projects/{own_project.id}/medallion").json()
        assert body["silver"]["streams"][0]["relation"] == f"hospital_his_{source.id}"

    def test_a_failed_run_contributes_no_rows(
        self, test_app, db_session, own_project, storage_patched
    ):
        source = seed_source(db_session, own_project.id)
        db_session.add(IngestionRun(source_id=source.id, status="failed", rows_extracted=40))
        db_session.commit()

        body = test_app.get(f"/projects/{own_project.id}/medallion").json()
        assert body["bronze"]["rows"] == 0

    def test_a_run_that_predates_the_layers_does_not_break_the_overview(
        self, test_app, db_session, own_project, storage_patched
    ):
        """The bug this found in production.

        ``quality_report`` was added as a nullable column with no default, so
        every run recorded before the medallion existed carries NULL — and the
        summariser called ``.get`` on it. Projects with no history answered
        fine, which is why it survived every test here: the ones that seed a
        run always seed a report with it.
        """
        source = seed_source(db_session, own_project.id)
        run = seed_run(db_session, source.id, extracted=100, kept=97)
        # Set it the way the database does, not the way the model would.
        db_session.execute(
            text("UPDATE ingestion_runs SET quality_report = NULL WHERE id = :id"),
            {"id": run.id},
        )
        db_session.commit()

        response = test_app.get(f"/projects/{own_project.id}/medallion")

        assert response.status_code == 200
        # It landed in the layer, so its rows count; with no report to read,
        # silver falls back to the extracted number rather than to zero.
        assert response.json()["silver"]["rows"] == 100

    def test_a_run_that_never_landed_in_a_layer_is_not_counted_in_it(
        self, test_app, db_session, own_project, storage_patched
    ):
        """Runs from before the medallion wrote their output to the datasets
        bucket. Counting them here would make the card claim more rows than its
        own file list can account for — which is what production did."""
        source = seed_source(db_session, own_project.id)
        seed_run(db_session, source.id, extracted=15_884, kept=15_880, landed=False)
        seed_run(db_session, source.id, extracted=100, kept=97)

        body = test_app.get(f"/projects/{own_project.id}/medallion").json()

        assert body["bronze"]["rows"] == 100
        assert body["silver"]["rows"] == 97

    def test_a_deactivated_source_still_reports_the_objects_it_left_behind(
        self, test_app, db_session, own_project, storage_patched
    ):
        """Its rows are still in storage and still in gold; hiding them would
        make the totals stop adding up."""
        source = seed_source(db_session, own_project.id)
        seed_run(db_session, source.id, extracted=100, kept=97)
        source.is_active = False
        db_session.add(source)
        db_session.commit()

        body = test_app.get(f"/projects/{own_project.id}/medallion").json()
        assert body["silver"]["rows"] == 97

    def test_another_tenants_project_is_not_found(self, test_app, other_project, storage_patched):
        assert test_app.get(f"/projects/{other_project.id}/medallion").status_code == 404

    def test_an_admin_sees_every_project(self, admin_app, other_project, storage_patched):
        assert admin_app.get(f"/projects/{other_project.id}/medallion").status_code == 200


# ---------------------------------------------------------------------------
# Looking inside a layer
# ---------------------------------------------------------------------------


class TestPreview:
    def test_the_newest_object_of_a_layer_is_returned_with_its_types(
        self, test_app, db_session, own_project, storage_patched, tmp_path
    ):
        source = seed_source(db_session, own_project.id)
        put_object(
            storage_patched, "silver",
            f"project-{own_project.id}/source-{source.id}/run-a.parquet",
            silver_file(tmp_path),
        )

        response = test_app.get(f"/projects/{own_project.id}/medallion/silver/preview")

        assert response.status_code == 200
        body = response.json()
        assert body["object_rows"] == 3
        assert {"name": "age", "type": "int64"} in body["columns"]
        assert body["rows"][0] == ["p1", 44]

    def test_a_layer_with_nothing_in_it_says_so(
        self, test_app, own_project, storage_patched
    ):
        response = test_app.get(f"/projects/{own_project.id}/medallion/bronze/preview")
        assert response.status_code == 404
        assert "landed in bronze" in response.json()["detail"]

    def test_there_is_no_fourth_layer(self, test_app, own_project, storage_patched):
        response = test_app.get(f"/projects/{own_project.id}/medallion/platinum/preview")
        assert response.status_code == 404

    def test_a_source_from_another_project_cannot_be_read_through_this_one(
        self, test_app, db_session, own_project, other_project, storage_patched, tmp_path
    ):
        """The project is visible; the source id is not the caller's to use."""
        theirs = seed_source(db_session, other_project.id, name="Theirs")
        put_object(
            storage_patched, "silver",
            f"project-{other_project.id}/source-{theirs.id}/run-a.parquet",
            silver_file(tmp_path),
        )

        response = test_app.get(
            f"/projects/{own_project.id}/medallion/silver/preview", params={"source_id": theirs.id}
        )
        assert response.status_code == 404

    def test_gold_says_it_has_not_been_built_rather_than_returning_nothing(
        self, test_app, own_project, storage_patched
    ):
        response = test_app.get(f"/projects/{own_project.id}/medallion/gold/preview")
        assert response.status_code == 404
        assert "gold table yet" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Bronze and silver side by side
# ---------------------------------------------------------------------------


class TestDiff:
    """The counts say how much changed; this says what, on the actual rows.

    Every assertion here is about a claim a reader can check with their eyes,
    which is the whole reason the view exists.
    """

    @pytest.fixture()
    def diffed(self, db_session, own_project, storage_patched, tmp_path):
        """One extraction carried through the layers, with a removed row."""
        from core.cleaning import Table, clean
        from core.medallion import BronzeWriter, write_typed

        source = seed_source(db_session, own_project.id)
        raw = [
            # Renamed column, whitespace to trim, a sentinel null, a cast.
            {"Patient ID": "p1", "Procedure Text": "  Hospice  care ", "Edad": "44", "Notes": None},
            {"Patient ID": "p2", "Procedure Text": "Colonoscopy", "Edad": "N/A", "Notes": None},
            # Byte-for-byte repeat of the first row.
            {"Patient ID": "p1", "Procedure Text": "  Hospice  care ", "Edad": "44", "Notes": None},
            {"Patient ID": "p3", "Procedure Text": "Appendectomy", "Edad": "71", "Notes": None},
        ]
        columns = list(raw[0])
        bronze = tmp_path / "bronze.parquet"
        with BronzeWriter(bronze, columns) as writer:
            for row in raw:
                writer.write(row[name] for name in columns)

        table = Table.from_rows(raw, columns)
        report = clean(table)
        silver = tmp_path / "silver.parquet"
        write_typed(table.columns, table.data, report.types, silver)

        key = f"project-{own_project.id}/source-{source.id}/run-d.parquet"
        put_object(storage_patched, "bronze", key, bronze)
        put_object(storage_patched, "silver", key, silver)

        run = IngestionRun(
            source_id=source.id,
            status="success",
            rows_extracted=len(raw),
            bronze_key=key,
            silver_key=key,
            quality_report=report.summary(),
            started_at=datetime.now(timezone.utc),
        )
        db_session.add(run)
        db_session.commit()
        db_session.refresh(run)
        return run

    def test_a_cast_reads_as_a_type_change_not_as_unchanged(
        self, test_app, own_project, diffed
    ):
        """"44" and 44 render identically — a diff that called that unchanged
        would hide the most common thing the cleaning does."""
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        position = next(
            index for index, c in enumerate(body["columns"]) if c["silver"] == "edad"
        )
        assert body["rows"][0]["cells"][position] == "type"
        assert body["rows"][0]["bronze"][position] == "44"
        assert body["rows"][0]["silver"][position] == 44

    def test_a_whitespace_correction_reads_as_a_value_change(
        self, test_app, own_project, diffed
    ):
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        position = next(
            index for index, c in enumerate(body["columns"]) if c["silver"] == "procedure_text"
        )
        assert body["rows"][0]["cells"][position] == "value"
        assert body["rows"][0]["bronze"][position] == "  Hospice  care "
        assert body["rows"][0]["silver"][position] == "Hospice care"

    def test_a_sentinel_becoming_null_reads_as_a_null(self, test_app, own_project, diffed):
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        position = next(
            index for index, c in enumerate(body["columns"]) if c["silver"] == "edad"
        )
        assert body["rows"][1]["cells"][position] == "null"
        assert body["rows"][1]["silver"][position] is None

    def test_a_renamed_column_is_one_column_with_two_names(
        self, test_app, own_project, diffed
    ):
        """Not a drop and an add, which is what a naive schema comparison gives."""
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        renamed = [c for c in body["columns"] if c["change"] == "renamed"]
        assert {"Patient ID", "Procedure Text", "Edad"} <= {c["bronze"] for c in renamed}
        assert all(c["silver"] for c in renamed)

    def test_an_empty_column_shows_as_dropped(self, test_app, own_project, diffed):
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        dropped = [c for c in body["columns"] if c["change"] == "dropped"]
        assert [c["bronze"] for c in dropped] == ["Notes"]
        assert dropped[0]["silver"] is None

    def test_the_column_carries_the_type_on_each_side(self, test_app, own_project, diffed):
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        edad = next(c for c in body["columns"] if c["silver"] == "edad")
        assert edad["bronze_type"] == "string"
        assert edad["silver_type"] == "int64"

    def test_a_removed_row_has_no_silver_side(self, test_app, own_project, diffed):
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        removed = [row for row in body["rows"] if row["removed"]]
        assert len(removed) == 1
        assert removed[0]["row"] == 2
        assert removed[0]["silver"] == []

    def test_rows_after_a_removal_stay_aligned(self, test_app, own_project, diffed):
        """The reason deduplication records which rows it removed. Aligning by
        position alone would pair bronze row 3 with silver row 2 and report
        every cell of both as changed."""
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()

        last = body["rows"][-1]
        assert last["row"] == 3
        position = next(
            index for index, c in enumerate(body["columns"]) if c["silver"] == "patient_id"
        )
        assert last["bronze"][position] == "p3"
        assert last["silver"][position] == "p3"

    def test_the_row_counts_of_both_objects_are_reported(
        self, test_app, own_project, diffed
    ):
        body = test_app.get(f"/projects/{own_project.id}/medallion/diff").json()
        assert body["bronze_rows"] == 4
        assert body["silver_rows"] == 3
        assert body["approximate"] is False

    def test_a_project_with_nothing_through_the_layers_says_so(
        self, test_app, own_project, storage_patched
    ):
        response = test_app.get(f"/projects/{own_project.id}/medallion/diff")
        assert response.status_code == 404
        assert "been through the layers" in response.json()["detail"]

    def test_another_tenant_cannot_read_this_diff(self, other_member_app, own_project, diffed):
        assert (
            other_member_app.get(f"/projects/{own_project.id}/medallion/diff").status_code == 404
        )

    def test_a_source_from_another_project_is_not_found(
        self, test_app, db_session, own_project, other_project, diffed
    ):
        theirs = seed_source(db_session, other_project.id, name="Theirs")
        response = test_app.get(
            f"/projects/{own_project.id}/medallion/diff", params={"source_id": theirs.id}
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Defining gold
# ---------------------------------------------------------------------------


class TestGoldDefinition:
    @pytest.fixture()
    def with_silver(self, db_session, own_project, storage_patched, tmp_path):
        source = seed_source(db_session, own_project.id, name="Patients")
        put_object(
            storage_patched, "silver",
            f"project-{own_project.id}/source-{source.id}/run-a.parquet",
            silver_file(tmp_path),
        )
        return source

    def test_the_relations_a_definition_can_use_are_listed_with_their_types(
        self, test_app, own_project, with_silver
    ):
        body = test_app.get(f"/projects/{own_project.id}/medallion/gold/relations").json()

        relation = f"patients_{with_silver.id}"
        assert body["relations"][relation]["rows"] == 3
        types = {c["name"]: c["type"] for c in body["relations"][relation]["columns"]}
        assert types["age"] == "BIGINT"
        assert relation in body["default_sql"]

    def test_a_candidate_definition_can_be_run_without_saving_it(
        self, test_app, db_session, own_project, with_silver
    ):
        relation = f"patients_{with_silver.id}"
        response = test_app.post(
            f"/projects/{own_project.id}/medallion/gold/preview",
            json={"sql": f"SELECT patient_id FROM {relation} WHERE age > 40", "limit": 5},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total_rows"] == 2
        assert body["relations"][relation] == 3
        # Nothing was stored: no version exists yet.
        assert db_session.get(GoldTable, 1) is None

    def test_a_definition_that_returns_nothing_still_reports_its_inputs(
        self, test_app, own_project, with_silver
    ):
        """The most common way an AI-written query goes wrong."""
        relation = f"patients_{with_silver.id}"
        body = test_app.post(
            f"/projects/{own_project.id}/medallion/gold/preview",
            json={"sql": f"SELECT * FROM {relation} WHERE age > 500"},
        ).json()

        assert body["total_rows"] == 0
        assert body["relations"][relation] == 3, "the inputs were not empty; the query was wrong"

    def test_a_destructive_definition_is_refused(self, test_app, own_project, with_silver):
        response = test_app.post(
            f"/projects/{own_project.id}/medallion/gold/preview",
            json={"sql": "DROP TABLE patients"},
        )
        assert response.status_code == 422

    def test_a_definition_is_stored(self, test_app, db_session, own_project, with_silver):
        relation = f"patients_{with_silver.id}"
        with patch("tasks.celery_tasks.rebuild_gold.apply_async"):
            response = test_app.put(
                f"/projects/{own_project.id}/medallion/gold",
                json={"sql": f"SELECT patient_id FROM {relation}", "name": "cohort"},
            )

        assert response.status_code == 200
        assert response.json()["is_default_definition"] is False
        db_session.expire_all()
        stored = db_session.query(GoldTable).filter(GoldTable.project_id == own_project.id).one()
        assert stored.name == "cohort"
        assert relation in stored.sql

    def test_saving_a_definition_rebuilds_gold_rather_than_waiting(
        self, test_app, own_project, with_silver
    ):
        """Gold is a function of silver and the definition. An extraction
        covers changes to the first; nothing else covered the second, so a
        project whose source was up to date would keep a stale table."""
        relation = f"patients_{with_silver.id}"
        with patch("tasks.celery_tasks.rebuild_gold.apply_async") as queued:
            test_app.put(
                f"/projects/{own_project.id}/medallion/gold",
                json={"sql": f"SELECT patient_id FROM {relation}", "name": "gold"},
            )

        queued.assert_called_once_with(args=[own_project.id])

    def test_saving_clears_the_error_left_by_the_previous_definition(
        self, test_app, db_session, own_project, with_silver
    ):
        db_session.add(
            GoldTable(project_id=own_project.id, sql="SELECT * FROM gone", build_error="no such table")
        )
        db_session.commit()

        with patch("tasks.celery_tasks.rebuild_gold.apply_async"):
            body = test_app.put(
                f"/projects/{own_project.id}/medallion/gold",
                json={"sql": f"SELECT patient_id FROM patients_{with_silver.id}", "name": "gold"},
            ).json()

        assert body["build_error"] == ""

    def test_an_invalid_definition_is_refused_at_the_point_of_writing_it(
        self, test_app, own_project, with_silver
    ):
        """Not at build time, when the person who wrote it has moved on."""
        response = test_app.put(
            f"/projects/{own_project.id}/medallion/gold",
            json={"sql": "DELETE FROM patients", "name": "gold"},
        )
        assert response.status_code == 422

    def test_clearing_the_definition_restores_the_default(
        self, test_app, db_session, own_project, with_silver
    ):
        relation = f"patients_{with_silver.id}"
        with patch("tasks.celery_tasks.rebuild_gold.apply_async"):
            test_app.put(
                f"/projects/{own_project.id}/medallion/gold",
                json={"sql": f"SELECT patient_id FROM {relation}", "name": "gold"},
            )
            response = test_app.put(
                f"/projects/{own_project.id}/medallion/gold", json={"sql": "", "name": "gold"}
            )

        assert response.json()["is_default_definition"] is True
        db_session.expire_all()
        assert db_session.query(GoldTable).filter(GoldTable.project_id == own_project.id).one().sql == ""

    def test_another_tenant_cannot_define_this_projects_gold(
        self, other_member_app, own_project, with_silver
    ):
        response = other_member_app.put(
            f"/projects/{own_project.id}/medallion/gold", json={"sql": "", "name": "gold"}
        )
        assert response.status_code == 404

    def test_a_project_with_no_silver_cannot_preview_a_definition(
        self, test_app, own_project, storage_patched
    ):
        response = test_app.post(
            f"/projects/{own_project.id}/medallion/gold/preview", json={"sql": "SELECT 1"}
        )
        assert response.status_code == 422
        assert "run an extraction first" in response.json()["detail"]


# ---------------------------------------------------------------------------
# Asking the model for a definition
# ---------------------------------------------------------------------------


class TestSuggestion:
    @pytest.fixture()
    def with_silver(self, db_session, own_project, storage_patched, tmp_path):
        source = seed_source(db_session, own_project.id, name="Patients")
        put_object(
            storage_patched, "silver",
            f"project-{own_project.id}/source-{source.id}/run-a.parquet",
            silver_file(tmp_path),
        )
        return source

    def test_the_model_returns_sql_and_the_platform_runs_it(
        self, test_app, own_project, with_silver
    ):
        relation = f"patients_{with_silver.id}"
        reply = f'{{"sql": "SELECT patient_id FROM {relation}", "explanation": "One row per patient."}}'

        with patch("core.ai_gold._BACKENDS", {"anthropic": lambda *a, **k: reply}), patch(
            "core.ai_gold.advisor_configured", return_value=True
        ):
            response = test_app.post(
                f"/projects/{own_project.id}/medallion/gold/suggest",
                json={"question": "one row per patient"},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["sql"] == f"SELECT patient_id FROM {relation}"
        assert body["error"] == ""

    def test_a_suggestion_that_is_not_a_read_is_refused_before_it_is_shown(
        self, test_app, own_project, with_silver
    ):
        reply = '{"sql": "DROP TABLE patients", "explanation": "tidying up"}'

        with patch("core.ai_gold._BACKENDS", {"anthropic": lambda *a, **k: reply}), patch(
            "core.ai_gold.advisor_configured", return_value=True
        ):
            body = test_app.post(
                f"/projects/{own_project.id}/medallion/gold/suggest",
                json={"question": "clean this up"},
            ).json()

        assert body["sql"] == ""
        assert "refused" in body["error"]

    def test_no_provider_configured_is_a_reason_not_an_empty_editor(
        self, test_app, own_project, with_silver
    ):
        with patch("core.ai_gold.advisor_configured", return_value=False):
            body = test_app.post(
                f"/projects/{own_project.id}/medallion/gold/suggest",
                json={"question": "one row per patient"},
            ).json()

        assert body["sql"] == ""
        assert "No AI provider is configured" in body["error"]

    def test_a_project_with_no_silver_is_told_why(self, test_app, own_project, storage_patched):
        body = test_app.post(
            f"/projects/{own_project.id}/medallion/gold/suggest",
            json={"question": "one row per patient"},
        ).json()
        assert "run an extraction first" in body["error"]

    def test_another_tenant_cannot_ask_about_this_projects_schema(
        self, other_member_app, own_project, with_silver
    ):
        response = other_member_app.post(
            f"/projects/{own_project.id}/medallion/gold/suggest", json={"question": "anything"}
        )
        assert response.status_code == 404
