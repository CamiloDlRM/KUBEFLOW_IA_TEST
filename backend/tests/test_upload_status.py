"""Tests for following an uploaded file through the layers.

The upload answers as soon as the file is stored; the worker does the rest.
Pinned here: each state of that is reported for the file it belongs to, an
upload from before runs were linked still finds its run, and the worker links
the run so the next one does not have to be found.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from models.schemas import DataSource, Dataset, IngestionRun
from tests.conftest import OTHER_USER_ID, seed_project
from tests.test_ingestion_task import FakeObjectStore

ARRIVED = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)


@pytest.fixture()
def project(db_session):
    return seed_project(db_session)


def upload(db_session, project, name="admissions.csv", *, run=None, minutes_ago=0):
    row = Dataset(
        project_id=project.id,
        name=name,
        bucket="datasets",
        object_key=f"project-{project.id}/{name}",
        size_bytes=30_825,
        origin="upload",
        created_at=ARRIVED - timedelta(minutes=minutes_ago),
        ingestion_run_id=run.id if run else None,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def pseudo_source(db_session, project, stem="admissions"):
    source = DataSource(project_id=project.id, name=stem, kind="upload")
    db_session.add(source)
    db_session.commit()
    db_session.refresh(source)
    return source


def layering(db_session, source, status, **fields):
    run = IngestionRun(source_id=source.id, status=status, started_at=ARRIVED + timedelta(seconds=5), **fields)
    db_session.add(run)
    db_session.commit()
    db_session.refresh(run)
    return run


class TestStatuses:
    def test_a_file_the_worker_has_not_reached_is_queued(self, test_app, db_session, project):
        upload(db_session, project)

        [status] = test_app.get(f"/projects/{project.id}/uploads").json()

        assert (status["name"], status["status"]) == ("admissions.csv", "queued")
        assert status["rows_in"] is None

    def test_a_layered_file_says_how_many_rows_reached_bronze_and_silver(self, test_app, db_session, project):
        source = pseudo_source(db_session, project)
        run = layering(db_session, source, "success", rows_extracted=800,
                       quality_report={"rows_in": 800, "rows_out": 798})
        upload(db_session, project, run=run)

        [status] = test_app.get(f"/projects/{project.id}/uploads").json()

        assert status["status"] == "success"
        assert (status["rows_in"], status["rows_kept"]) == (800, 798)
        assert (status["source_id"], status["source_name"]) == (source.id, "admissions")

    def test_a_failure_carries_its_reason(self, test_app, db_session, project):
        run = layering(db_session, pseudo_source(db_session, project), "failed",
                       error="the file contained no rows")
        upload(db_session, project, run=run)

        [status] = test_app.get(f"/projects/{project.id}/uploads").json()

        assert status["status"] == "failed"
        assert status["error"] == "the file contained no rows"

    def test_an_upload_from_before_runs_were_linked_still_finds_its_run(self, test_app, db_session, project):
        source = pseudo_source(db_session, project)
        layering(db_session, source, "success", rows_extracted=12, quality_report={"rows_out": 12})
        upload(db_session, project)  # no ingestion_run_id

        [status] = test_app.get(f"/projects/{project.id}/uploads").json()

        assert (status["status"], status["rows_kept"]) == ("success", 12)

    def test_only_uploads_are_listed_newest_first(self, test_app, db_session, project):
        upload(db_session, project, "old.csv", minutes_ago=30)
        upload(db_session, project, "new.csv")
        db_session.add(Dataset(project_id=project.id, name="gold-v3.parquet", origin="ingestion"))
        db_session.commit()

        names = [s["name"] for s in test_app.get(f"/projects/{project.id}/uploads").json()]

        assert names == ["new.csv", "old.csv"]

    def test_another_members_uploads_are_not_listed(self, other_member_app, db_session, project):
        upload(db_session, project)

        assert other_member_app.get(f"/projects/{project.id}/uploads").status_code == 404


class TestTheWorkerLinksItsRun:
    def test_ingest_upload_names_the_run_on_the_upload(self, db_engine, db_session, project, tmp_path):
        from core.config import get_settings
        from tasks.celery_tasks import ingest_upload

        store = FakeObjectStore()
        bucket = get_settings().minio_bucket_datasets
        csv = tmp_path / "admissions.csv"
        csv.write_text("patient_id,age\np1,44\np2,39\n", encoding="utf-8")
        with csv.open("rb") as handle:
            store.upload_fileobj(bucket, "project-1/admissions.csv", handle)
        row = Dataset(project_id=project.id, name="admissions.csv", bucket=bucket,
                      object_key="project-1/admissions.csv", origin="upload", is_active=True)
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)

        with (
            patch("sqlmodel.create_engine", return_value=db_engine),
            patch("core.storage.upload_fileobj", side_effect=store.upload_fileobj),
            patch("core.storage.download_to_path", side_effect=store.download_to_path),
            patch("core.storage.get_s3_client", side_effect=store.get_s3_client),
        ):
            outcome = ingest_upload(row.id)

        assert outcome["status"] == "success", outcome
        db_session.refresh(row)
        run = db_session.get(IngestionRun, row.ingestion_run_id)
        assert run is not None and run.status == "success"
