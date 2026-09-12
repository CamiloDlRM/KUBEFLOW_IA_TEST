"""Tests for the Celery task that carries one extraction through the layers.

This file exists because of a bug that reached production. Every part of the
ingestion was tested — extraction, normalisation, the API, the UI — and the
task that strings them together was not. It extracted 15,884 rows, normalised
them, stored both copies and created the dataset, then raised on the last line
while reading ``dataset.id`` from an instance the second ``commit()`` had
expired. The run was recorded as ``failed``.

That is the worst shape a bug can take here: the watermark had already
advanced, so the obvious response — run it again — returned zero rows and made
it look as though nothing worked at all.

So these drive the real task. Only its edges are replaced: the source database
and object storage. Storage is replaced with an in-memory store rather than a
mock that records calls, because the task now reads back what it wrote — gold
is rebuilt from the silver objects of every earlier run — and a mock that only
records would make the most important test in this file impossible to write.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from core.ingestion import ExtractionResult
from core.medallion import BronzeWriter, iter_rows
from models.schemas import DataSource, Dataset, GoldTable, IngestionRun

EXTRACTED = [
    {"id": "1", "procedure_text": "Appendectomy (procedure)", "procedure_code": "111"},
    {"id": "2", "procedure_text": "Appendectomy (procedure)", "procedure_code": "111"},
    {"id": "3", "procedure_text": "APPENDECTOMY", "procedure_code": ""},
    {"id": "4", "procedure_text": "patient sent home", "procedure_code": ""},
    # A byte-for-byte repeat of the first row, so the layered run has something
    # real to deduplicate. Silver should land four rows, not five.
    {"id": "1", "procedure_text": "Appendectomy (procedure)", "procedure_code": "111"},
]


def write_bronze(path: Path, rows: list[dict]) -> Path:
    columns = list(rows[0])
    with BronzeWriter(path, columns) as writer:
        for row in rows:
            writer.write(row[name] for name in columns)
    return path


@pytest.fixture()
def extracted(tmp_path) -> Path:
    return write_bronze(tmp_path / "extract.parquet", EXTRACTED)


# ---------------------------------------------------------------------------
# An object store the task can write to and read back from
# ---------------------------------------------------------------------------


class FakeObjectStore:
    """Enough of S3 for the task: put, get, and list by prefix."""

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    # -- the three functions core.storage exposes ---------------------------

    def upload_fileobj(self, bucket, key, fileobj, content_type="application/octet-stream"):
        self.objects[(bucket, key)] = fileobj.read()

    def download_to_path(self, bucket, key, dest_path):
        payload = self.objects.get((bucket, key))
        if payload is None:
            from core.storage import ObjectNotFoundError

            raise ObjectNotFoundError(f"{key} not in {bucket}")
        path = Path(dest_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return str(path)

    def get_s3_client(self):
        return _FakeClient(self)

    # -- assertions -------------------------------------------------------

    def keys_in(self, bucket: str) -> list[str]:
        return sorted(key for stored, key in self.objects if stored == bucket)


class _FakePaginator:
    def __init__(self, store: FakeObjectStore) -> None:
        self._store = store

    def paginate(self, Bucket: str, Prefix: str = ""):  # noqa: N803 — boto3's spelling
        contents = [
            {"Key": key, "Size": len(payload), "LastModified": datetime.now(timezone.utc)}
            for (bucket, key), payload in self._store.objects.items()
            if bucket == Bucket and key.startswith(Prefix)
        ]
        yield {"Contents": contents}


class _FakeClient:
    def __init__(self, store: FakeObjectStore) -> None:
        self._store = store

    def get_paginator(self, _name: str):
        return _FakePaginator(self._store)


@pytest.fixture()
def store():
    return FakeObjectStore()


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


def run_task(db_engine, store, source_id: int, run_id: str, extraction: ExtractionResult):
    """Execute the real task with its edges replaced."""
    from tasks.celery_tasks import run_ingestion

    with (
        patch("sqlmodel.create_engine", return_value=db_engine),
        patch("core.ingestion.extract", return_value=extraction),
        patch("core.storage.upload_fileobj", side_effect=store.upload_fileobj),
        patch("core.storage.download_to_path", side_effect=store.download_to_path),
        patch("core.storage.get_s3_client", side_effect=store.get_s3_client),
    ):
        return run_ingestion(source_id, run_id)


@pytest.fixture()
def queued_run(db_session, source):
    run = IngestionRun(source_id=source.id, status="queued")
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    return run


def extraction_of(path: Path, *, rows: int = 5, before: str = "", after: str = "2024-06-14T09:00:00"):
    return ExtractionResult(
        rows=rows,
        watermark_before=before,
        watermark_after=after,
        columns=list(EXTRACTED[0]),
        profile={"procedure_text": {"count": rows}},
        path=path,
    )


class TestSuccessfulRun:
    def test_a_run_that_did_everything_is_recorded_as_success(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        """The regression. It used to store everything and then report failure."""
        outcome = run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        assert outcome["status"] == "success"
        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        assert run.status == "success"
        assert run.error == ""
        assert run.dataset_id is not None

    def test_the_dataset_is_created_and_active(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        dataset = db_session.get(Dataset, run.dataset_id)
        assert dataset.origin == "ingestion"
        assert dataset.ingestion_run_id == queued_run.id
        assert dataset.is_active

    def test_the_dataset_points_at_gold_not_at_the_slice_just_extracted(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        """Training on the newest slice alone is the mistake the layers prevent."""
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        dataset = db_session.get(Dataset, run.dataset_id)
        assert dataset.bucket == "gold"
        assert dataset.object_key == store.keys_in("gold")[0]

    def test_the_watermark_advances_on_the_source(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        assert db_session.get(DataSource, source.id).watermark_value == "2024-06-14T09:00:00"

    def test_normalisation_is_applied_and_summarised(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        summary = db_session.get(IngestionRun, queued_run.id).normalization
        assert summary["already_coded"] == 2
        assert summary["filled"] == 1, "APPENDECTOMY should be placed"
        assert summary["unresolved"] == 1, "the unrelated row should be refused"


class TestTheLayers:
    def test_the_same_slice_lands_in_bronze_and_in_silver(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        assert run.bronze_key and run.silver_key
        assert store.keys_in("bronze") == [run.bronze_key]
        assert store.keys_in("silver") == [run.silver_key]

    def test_bronze_is_written_before_silver_is_built(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        """The watermark moves past these rows; a cleaning bug must not lose them."""
        from core import medallion

        with patch.object(
            medallion, "promote_to_silver", side_effect=RuntimeError("cleaning blew up")
        ):
            outcome = run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        assert outcome["status"] == "failed"
        assert store.keys_in("bronze"), "the extract must survive a failure after it"

    def test_a_failure_after_extraction_leaves_the_watermark_where_it_was(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        from core import medallion

        with patch.object(
            medallion, "promote_to_silver", side_effect=RuntimeError("cleaning blew up")
        ):
            run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        assert db_session.get(DataSource, source.id).watermark_value == ""

    def test_the_quality_report_says_what_changed_between_the_layers(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        report = db_session.get(IngestionRun, queued_run.id).quality_report
        assert report["rows_in"] == 5 and report["rows_out"] == 4
        assert report["types"]["id"] == "integer"
        assert any(rule["rule"] == "deduplicate_rows" for rule in report["rules"])

    def test_silver_carries_the_types_the_report_claimed(
        self, db_engine, db_session, store, source, queued_run, extracted, tmp_path
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        local = tmp_path / "silver.parquet"
        store.download_to_path("silver", run.silver_key, local)

        from core.medallion import read_schema

        assert read_schema(local)["id"] == "int64"


class TestGold:
    def test_gold_is_built_and_versioned(
        self, db_engine, db_session, store, source, queued_run, extracted
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        gold = db_session.query(GoldTable).filter(GoldTable.repo_id == source.repo_id).one()
        assert gold.version == 1
        assert gold.rows == 4, "the duplicate row was removed on the way into silver"
        assert gold.build_error == ""

    def test_a_second_run_rebuilds_gold_from_both_slices(
        self, db_engine, db_session, store, source, queued_run, tmp_path
    ):
        """The whole point of silver accumulating: the model keeps the history."""
        first = write_bronze(tmp_path / "first.parquet", EXTRACTED)
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(first))

        later = [
            {"id": "5", "procedure_text": "Colonoscopy (procedure)", "procedure_code": "222"},
            {"id": "6", "procedure_text": "COLONOSCOPY", "procedure_code": ""},
        ]
        second_run = IngestionRun(source_id=source.id, status="queued")
        db_session.add(second_run)
        db_session.commit()
        db_session.refresh(second_run)

        second = write_bronze(tmp_path / "second.parquet", later)
        run_task(
            db_engine,
            store,
            source.id,
            second_run.id,
            ExtractionResult(2, "2024-06-14T09:00:00", "2024-06-20T09:00:00", list(later[0]), {}, second),
        )

        db_session.expire_all()
        gold = db_session.query(GoldTable).filter(GoldTable.repo_id == source.repo_id).one()
        assert gold.version == 2
        assert gold.rows == 6, "4 from the first slice plus 2 from the second"
        assert len(store.keys_in("silver")) == 2, "silver accumulates rather than replacing"

    def test_a_project_definition_replaces_the_default_union(
        self, db_engine, db_session, store, source, queued_run, extracted, tmp_path
    ):
        db_session.add(
            GoldTable(
                repo_id=source.repo_id,
                name="gold",
                sql="SELECT procedure_code, count(*) AS n FROM hospital_his_1 GROUP BY 1",
            )
        )
        db_session.commit()

        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        gold = db_session.query(GoldTable).filter(GoldTable.repo_id == source.repo_id).one()
        assert gold.columns == ["procedure_code", "n"]

    def test_the_gold_object_holds_the_rows_it_reported(
        self, db_engine, db_session, store, source, queued_run, extracted, tmp_path
    ):
        run_task(db_engine, store, source.id, queued_run.id, extraction_of(extracted))

        db_session.expire_all()
        gold = db_session.query(GoldTable).filter(GoldTable.repo_id == source.repo_id).one()
        local = tmp_path / "gold.parquet"
        store.download_to_path(gold.bucket, gold.object_key, local)
        assert len(list(iter_rows(local))) == gold.rows


class TestEmptyRun:
    def test_nothing_new_is_a_success_with_no_dataset(
        self, db_engine, db_session, store, source, queued_run
    ):
        """The steady state of an incremental pipeline, not a failure."""
        extraction = ExtractionResult(0, "2024-06-14T09:00:00", "2024-06-14T09:00:00", [], {}, None)

        outcome = run_task(db_engine, store, source.id, queued_run.id, extraction)

        assert outcome["status"] == "success"
        assert store.objects == {}
        db_session.expire_all()
        run = db_session.get(IngestionRun, queued_run.id)
        assert run.status == "success"
        assert run.dataset_id is None

    def test_an_empty_run_leaves_the_watermark_alone(
        self, db_engine, db_session, store, source, queued_run
    ):
        """So a row entered later with an earlier timestamp is still picked up."""
        extraction = ExtractionResult(0, "2024-06-14T09:00:00", "2024-06-14T09:00:00", [], {}, None)
        run_task(db_engine, store, source.id, queued_run.id, extraction)

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
