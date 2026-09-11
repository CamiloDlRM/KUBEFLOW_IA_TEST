"""Tests for the Celery task that performs an ingestion.

This file exists because of a bug that reached production. Every part of the
ingestion was tested — extraction, normalisation, the API, the UI — and the
task that strings them together was not. It extracted 15,884 rows, normalised
them, stored both copies and created the dataset, then raised on the last line
while reading ``dataset.id`` from an instance the second ``commit()`` had
expired. The run was recorded as ``failed``.

That is the worst shape a bug can take here: the watermark had already
advanced, so the obvious response — run it again — returned zero rows and made
it look as though nothing worked at all.

So these drive the real task. Only its edges are replaced: the source database,
object storage, and the engine it would otherwise build for itself.
"""
from __future__ import annotations

import csv
from pathlib import Path
from unittest.mock import patch

import pytest

from core.ingestion import ExtractionResult
from models.schemas import DataSource, Dataset, IngestionRun

EXTRACTED = [
    {"id": "1", "procedure_text": "Appendectomy (procedure)", "procedure_code": "111"},
    {"id": "2", "procedure_text": "Appendectomy (procedure)", "procedure_code": "111"},
    {"id": "3", "procedure_text": "APPENDECTOMY", "procedure_code": ""},
    {"id": "4", "procedure_text": "patient sent home", "procedure_code": ""},
]


@pytest.fixture()
def extracted_csv(tmp_path) -> Path:
    path = tmp_path / "extract.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(EXTRACTED[0]))
        writer.writeheader()
        writer.writerows(EXTRACTED)
    return path


@pytest.fixture()
def source(db_session):
    from tests.conftest import DEFAULT_USER_ID, seed_repo

    repo = seed_repo(db_session, owner_id=DEFAULT_USER_ID)
    source = DataSource(
        repo_id=repo.id,
        name="Hospital HIS",
        kind="postgres",
        host="hospital-db",
        database="hospital",
        username="hospital",
        password_env="HOSPITAL_DB_PASSWORD",
        extraction_sql="SELECT * FROM procedures WHERE recorded_at > :watermark",
        watermark_column="recorded_at",
        normalize_text_column="procedure_text",
        normalize_code_column="procedure_code",
    )
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def run_task(db_engine, source_id: int, run_id: str, extraction: ExtractionResult):
    """Execute the real task with its edges replaced."""
    from tasks.celery_tasks import run_ingestion

    uploads: list[tuple[str, str]] = []

    def _record_upload(bucket, key, fileobj, content_type):
        uploads.append((bucket, key))

    with (
        patch("sqlmodel.create_engine", return_value=db_engine),
        patch("core.ingestion.extract", return_value=extraction),
        patch("core.storage.upload_fileobj", side_effect=_record_upload),
    ):
        result = run_ingestion(source_id, run_id)
    return result, uploads


@pytest.fixture()
def queued_run(db_session, source):
    run = IngestionRun(source_id=source.id, status="queued")
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    return run


class TestSuccessfulRun:
    def test_a_run_that_did_everything_is_recorded_as_success(
        self, db_engine, db_session, source, queued_run, extracted_csv
    ):
        """The regression. It used to store everything and then report failure."""
        extraction = ExtractionResult(
            rows=4,
            watermark_before="",
            watermark_after="2024-06-14T09:00:00",
            columns=list(EXTRACTED[0]),
            profile={"procedure_text": {"count": 4}},
            path=extracted_csv,
        )

        outcome, _ = run_task(db_engine, source.id, queued_run.id, extraction)

        assert outcome["status"] == "success"
        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        assert run.status == "success"
        assert run.error == ""
        assert run.dataset_id is not None

    def test_the_dataset_is_created_and_active(
        self, db_engine, db_session, source, queued_run, extracted_csv
    ):
        extraction = ExtractionResult(
            4, "", "2024-06-14T09:00:00", list(EXTRACTED[0]), {}, extracted_csv
        )
        run_task(db_engine, source.id, queued_run.id, extraction)

        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        dataset = db_session.get(Dataset, run.dataset_id)
        assert dataset.origin == "ingestion"
        assert dataset.ingestion_run_id == queued_run.id
        assert dataset.is_active

    def test_the_watermark_advances_on_the_source(
        self, db_engine, db_session, source, queued_run, extracted_csv
    ):
        extraction = ExtractionResult(
            4, "", "2024-06-14T09:00:00", list(EXTRACTED[0]), {}, extracted_csv
        )
        run_task(db_engine, source.id, queued_run.id, extraction)

        db_session.expire_all()
        assert db_session.get(DataSource, source.id).watermark_value == (
            "2024-06-14T09:00:00"
        )

    def test_normalisation_is_applied_and_summarised(
        self, db_engine, db_session, source, queued_run, extracted_csv
    ):
        extraction = ExtractionResult(
            4, "", "2024-06-14T09:00:00", list(EXTRACTED[0]), {}, extracted_csv
        )
        run_task(db_engine, source.id, queued_run.id, extraction)

        db_session.expire_all()
        summary = db_session.get(IngestionRun, queued_run.id).normalization
        assert summary["already_coded"] == 2
        assert summary["filled"] == 1, "APPENDECTOMY should be placed"
        assert summary["unresolved"] == 1, "the unrelated row should be refused"

    def test_both_the_normalised_and_raw_copies_are_stored(
        self, db_engine, db_session, source, queued_run, extracted_csv
    ):
        extraction = ExtractionResult(
            4, "", "2024-06-14T09:00:00", list(EXTRACTED[0]), {}, extracted_csv
        )
        _, uploads = run_task(db_engine, source.id, queued_run.id, extraction)

        assert len(uploads) == 2, "the pre-normalisation extract must be archived too"
        db_session.expire_all()
        assert db_session.get(IngestionRun, queued_run.id).raw_object_key


class TestEmptyRun:
    def test_nothing_new_is_a_success_with_no_dataset(
        self, db_engine, db_session, source, queued_run
    ):
        """The steady state of an incremental pipeline, not a failure."""
        extraction = ExtractionResult(0, "2024-06-14T09:00:00", "2024-06-14T09:00:00", [], {}, None)

        outcome, uploads = run_task(db_engine, source.id, queued_run.id, extraction)

        assert outcome["status"] == "success"
        assert uploads == []
        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        assert run.status == "success"
        assert run.dataset_id is None

    def test_an_empty_run_leaves_the_watermark_alone(
        self, db_engine, db_session, source, queued_run
    ):
        """So a row entered later with an earlier timestamp is still picked up."""
        extraction = ExtractionResult(0, "2024-06-14T09:00:00", "2024-06-14T09:00:00", [], {}, None)
        run_task(db_engine, source.id, queued_run.id, extraction)

        db_session.expire_all()
        assert db_session.get(DataSource, source.id).watermark_value == ""


class TestFailure:
    def test_an_extraction_error_is_recorded_on_the_run(
        self, db_engine, db_session, source, queued_run
    ):
        from core.ingestion import IngestionError
        from tasks.celery_tasks import run_ingestion

        with (
            patch("sqlmodel.create_engine", return_value=db_engine),
            patch("core.ingestion.extract", side_effect=IngestionError("cannot connect")),
        ):
            outcome = run_ingestion(source.id, queued_run.id)

        assert outcome["status"] == "failed"
        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        assert run.status == "failed"
        assert "cannot connect" in run.error

    def test_a_failed_run_does_not_advance_the_watermark(
        self, db_engine, db_session, source, queued_run
    ):
        from core.ingestion import IngestionError
        from tasks.celery_tasks import run_ingestion

        with (
            patch("sqlmodel.create_engine", return_value=db_engine),
            patch("core.ingestion.extract", side_effect=IngestionError("cannot connect")),
        ):
            run_ingestion(source.id, queued_run.id)

        db_session.expire_all()
        assert db_session.get(DataSource, source.id).watermark_value == ""
