"""Tests for the record of who viewed a health project's rows (core.access_log).

What is pinned: in a general project nothing is recorded and nothing
changes; in a health project every view that showed rows is recorded with
who, what and how many, an administrator looking at someone else's project
is marked as such, a refused request records nothing, and the preview of an
external source never shows an identifier.
"""
from __future__ import annotations

from unittest.mock import patch

from sqlmodel import select

from core.ingestion import PreviewResult
from models.schemas import DataAccess, Dataset
from tests.test_medallion_api import diffed, own_project, storage_patched, store  # noqa: F401
from tests.test_privacy import mark_health


def accesses(db_session):
    return db_session.exec(select(DataAccess).order_by(DataAccess.id)).all()


class TestAGeneralProject:
    def test_nothing_is_recorded(self, test_app, db_session, own_project, diffed):
        assert test_app.get(f"/projects/{own_project.id}/medallion/silver/preview").status_code == 200
        assert test_app.get(f"/projects/{own_project.id}/medallion/steps").status_code == 200

        assert accesses(db_session) == []


class TestAHealthProject:
    def test_every_view_of_rows_is_recorded(self, test_app, db_session, own_project, diffed):
        mark_health(db_session, own_project)

        test_app.get(f"/projects/{own_project.id}/medallion/silver/preview")
        test_app.get(f"/projects/{own_project.id}/medallion/diff")
        test_app.get(f"/projects/{own_project.id}/medallion/steps")

        recorded = accesses(db_session)
        assert [entry.action for entry in recorded] == ["layer_preview", "bronze_silver_diff", "cleaning_steps"]
        assert all(entry.username and not entry.as_admin for entry in recorded)
        assert recorded[0].rows > 0
        assert recorded[0].resource.startswith("silver")

    def test_an_administrator_looking_is_marked_as_such(self, admin_app, db_session, own_project, diffed):
        mark_health(db_session, own_project)

        assert admin_app.get(f"/projects/{own_project.id}/medallion/silver/preview").status_code == 200

        assert accesses(db_session)[0].as_admin is True

    def test_a_refused_request_records_nothing(self, other_member_app, db_session, own_project, diffed):
        mark_health(db_session, own_project)

        assert other_member_app.get(f"/projects/{own_project.id}/medallion/silver/preview").status_code == 404

        assert accesses(db_session) == []

    def test_a_dataset_preview_is_recorded_against_its_project(
        self, test_app, db_session, own_project, storage_patched, tmp_path
    ):
        from tests.test_medallion_api import silver_file

        mark_health(db_session, own_project)
        path = silver_file(tmp_path)
        with path.open("rb") as handle:
            storage_patched.upload_fileobj("datasets", "d/one.parquet", handle)
        dataset = Dataset(project_id=own_project.id, name="one.parquet", bucket="datasets",
                          object_key="d/one.parquet", origin="ingestion")
        db_session.add(dataset)
        db_session.commit()

        with patch("routers.datasets.download_to_path", side_effect=storage_patched.download_to_path):
            response = test_app.get(f"/datasets/{dataset.id}/preview")

        assert response.status_code == 200, response.text
        assert accesses(db_session)[0].action == "dataset_preview"
        assert accesses(db_session)[0].project_id == own_project.id

    def test_a_failure_to_record_never_fails_the_view(self, test_app, db_session, own_project, diffed):
        mark_health(db_session, own_project)

        with patch("core.access_log.record_access", side_effect=RuntimeError("db down")):
            response = test_app.get(f"/projects/{own_project.id}/medallion/silver/preview")

        assert response.status_code == 200

    def test_the_record_is_shown_with_the_privacy_settings(self, test_app, db_session, own_project, diffed):
        mark_health(db_session, own_project)
        test_app.get(f"/projects/{own_project.id}/medallion/silver/preview")

        body = test_app.get(f"/projects/{own_project.id}/privacy").json()

        assert body["access_total"] == 1
        assert body["access"][0]["action"] == "layer_preview"


RAW = PreviewResult(
    columns=["patient_id", "first_name", "ssn", "encounter_text"],
    rows=[["P1", "Ana", "999-12-3456", "Checkup"]],
    profile={"first_name": {"top_values": [{"value": "Ana", "count": 1}]}, "ssn": {"top_values": [{"value": "999-12-3456", "count": 1}]}},
    truncated=False,
)

PREVIEW = {
    "host": "hospital-db",
    "database": "hospital",
    "username": "hospital",
    "password_env": "HOSPITAL_DB_PASSWORD",
    "extraction_sql": "SELECT * FROM patients WHERE recorded_at > :watermark",
}


class TestTheSourcePreview:
    def test_a_health_project_never_sees_an_identifier(self, test_app, db_session, own_project):
        mark_health(db_session, own_project)

        with patch("routers.sources.preview", return_value=RAW), patch("routers.sources._check_password_env"):
            body = test_app.post("/sources/preview", json={"project_id": own_project.id, **PREVIEW}).json()

        assert body["columns"] == ["patient_id", "ssn", "encounter_text"]
        assert body["rows"][0][0].startswith("ps_") and body["rows"][0][1].startswith("ps_")
        assert body["rows"][0][2] == "Checkup"
        assert "Ana" not in str(body) and "999-12-3456" not in str(body)
        assert accesses(db_session)[0].action == "source_preview"

    def test_a_general_project_sees_the_source_as_it_is(self, test_app, db_session, own_project):
        with patch("routers.sources.preview", return_value=RAW), patch("routers.sources._check_password_env"):
            body = test_app.post("/sources/preview", json={"project_id": own_project.id, **PREVIEW}).json()

        assert body["rows"] == RAW.rows
        assert accesses(db_session) == []
