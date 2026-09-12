"""Tests for the data source endpoints.

Two things are pinned here. First, that a source inherits its project's
owner, so one tenant cannot see, extract from or delete another's — a source
carries a query and a credential reference, so a leak here is worse than a
leak of the data it produces. Second, that an extraction cannot be started
twice concurrently, because two runs from the same watermark land overlapping
datasets and duplicated training rows are hard to notice after the fact.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from tests.conftest import DEFAULT_USER_ID, seed_project

VALID_SQL = "SELECT id, recorded_at FROM procedures WHERE recorded_at > :watermark"


def source_payload(project_id: int, **overrides) -> dict:
    body = {
        "project_id": project_id,
        "name": "Hospital HIS",
        "kind": "postgres",
        "host": "hospital-db",
        "port": 5432,
        "database": "hospital",
        "username": "hospital",
        "password_env": "HOSPITAL_DB_PASSWORD",
        "extraction_sql": VALID_SQL,
        "watermark_column": "recorded_at",
    }
    body.update(overrides)
    return body


@pytest.fixture()
def own_project(db_session):
    return seed_project(db_session, owner_id=DEFAULT_USER_ID)


@pytest.fixture()
def other_project(db_session):
    return seed_project(db_session, owner_id=2, name="Theirs")


def create_source(client, project_id: int, **overrides):
    return client.post("/sources", json=source_payload(project_id, **overrides))


class TestCreateSource:
    def test_create_on_own_project_should_return_201(self, test_app, own_project):
        resp = create_source(test_app, own_project.id)

        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Hospital HIS"
        assert body["watermark_value"] == "", "a new source starts with a full backfill"

    def test_response_carries_no_credential(self, test_app, own_project):
        body = create_source(test_app, own_project.id).json()
        # The variable *name* is public; there is no secret to leak because
        # none is stored.
        assert body["password_env"] == "HOSPITAL_DB_PASSWORD"
        assert "password" not in {key.lower() for key in body} - {"password_env"}

    def test_create_on_another_members_project_should_return_404(
        self, test_app, other_project
    ):
        assert create_source(test_app, other_project.id).status_code == 404

    def test_sql_without_the_watermark_token_should_return_422(self, test_app, own_project):
        resp = create_source(
            test_app, own_project.id, extraction_sql="SELECT * FROM procedures"
        )
        assert resp.status_code == 422
        assert "watermark" in resp.json()["detail"].lower()

    def test_password_env_must_look_like_a_variable_name(self, test_app, own_project):
        """Guards against somebody pasting the password itself into the field."""
        resp = create_source(test_app, own_project.id, password_env="hunter2!")
        assert resp.status_code == 422

    def test_unsupported_kind_is_rejected(self, test_app, own_project):
        assert create_source(test_app, own_project.id, kind="oracle").status_code == 422


class TestSourceIsolation:
    def test_list_shows_only_own_sources(self, test_app, other_member_app, own_project, other_project):
        create_source(test_app, own_project.id)
        create_source(other_member_app, other_project.id)

        mine = test_app.get("/sources").json()
        theirs = other_member_app.get("/sources").json()

        assert [s["project_id"] for s in mine] == [own_project.id]
        assert [s["project_id"] for s in theirs] == [other_project.id]

    def test_get_another_members_source_should_return_404(
        self, test_app, other_member_app, other_project
    ):
        source_id = create_source(other_member_app, other_project.id).json()["id"]
        assert test_app.get(f"/sources/{source_id}").status_code == 404

    def test_ingest_another_members_source_should_return_404(
        self, test_app, other_member_app, other_project
    ):
        source_id = create_source(other_member_app, other_project.id).json()["id"]
        with patch("tasks.celery_tasks.run_ingestion.apply_async") as enqueue:
            resp = test_app.post(f"/sources/{source_id}/ingest")
        assert resp.status_code == 404
        # A refused request must not queue work: the 404 would otherwise hide
        # an extraction that still ran against somebody else's source.
        enqueue.assert_not_called()

    def test_list_runs_of_another_members_source_should_return_404(
        self, test_app, other_member_app, other_project
    ):
        source_id = create_source(other_member_app, other_project.id).json()["id"]
        assert test_app.get(f"/sources/{source_id}/runs").status_code == 404

    def test_delete_another_members_source_should_return_404(
        self, test_app, other_member_app, other_project
    ):
        source_id = create_source(other_member_app, other_project.id).json()["id"]
        assert test_app.delete(f"/sources/{source_id}").status_code == 404

    def test_admin_can_see_every_source(self, admin_app, other_member_app, other_project):
        create_source(other_member_app, other_project.id)
        assert len(admin_app.get("/sources").json()) == 1

    def test_missing_source_and_forbidden_source_are_indistinguishable(
        self, test_app, other_member_app, other_project
    ):
        """404 for both, so existence is not disclosed by the status code."""
        source_id = create_source(other_member_app, other_project.id).json()["id"]
        forbidden = test_app.get(f"/sources/{source_id}")
        missing = test_app.get("/sources/999999")
        assert forbidden.status_code == missing.status_code == 404


class TestTriggerIngestion:
    def test_ingest_queues_a_run(self, test_app, own_project):
        source_id = create_source(test_app, own_project.id).json()["id"]

        with patch("tasks.celery_tasks.run_ingestion.apply_async") as enqueue:
            resp = test_app.post(f"/sources/{source_id}/ingest")

        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "queued"
        assert body["rows_extracted"] == 0
        enqueue.assert_called_once()
        assert enqueue.call_args.kwargs["args"] == [source_id, body["id"]]

    def test_second_ingest_while_one_is_in_flight_should_return_409(
        self, test_app, own_project
    ):
        source_id = create_source(test_app, own_project.id).json()["id"]

        with patch("tasks.celery_tasks.run_ingestion.apply_async"):
            first = test_app.post(f"/sources/{source_id}/ingest")
            second = test_app.post(f"/sources/{source_id}/ingest")

        assert first.status_code == 202
        assert second.status_code == 409
        assert "already in progress" in second.json()["detail"]

    def test_ingest_on_missing_source_should_return_404(self, test_app):
        assert test_app.post("/sources/999999/ingest").status_code == 404


class TestListRuns:
    def test_runs_are_listed_for_own_source(self, test_app, own_project):
        source_id = create_source(test_app, own_project.id).json()["id"]
        with patch("tasks.celery_tasks.run_ingestion.apply_async"):
            test_app.post(f"/sources/{source_id}/ingest")

        runs = test_app.get(f"/sources/{source_id}/runs").json()
        assert len(runs) == 1
        assert runs[0]["source_id"] == source_id

    def test_no_runs_returns_empty_list(self, test_app, own_project):
        source_id = create_source(test_app, own_project.id).json()["id"]
        assert test_app.get(f"/sources/{source_id}/runs").json() == []

    def test_a_run_recorded_before_a_json_column_existed_is_still_listed(
        self, test_app, own_project, db_session
    ):
        """Every JSON column arrives with a migration, and the rows that predate
        it hold NULL. A response model that insists on a dict turns the whole
        history into a 500 — losing the runs that *do* have the data along with
        the ones that do not.
        """
        from sqlalchemy import text

        source_id = create_source(test_app, own_project.id).json()["id"]
        with patch("tasks.celery_tasks.run_ingestion.apply_async"):
            run_id = test_app.post(f"/sources/{source_id}/ingest").json()["id"]

        db_session.execute(
            text(
                "UPDATE ingestion_runs SET quality_report = NULL, profile = NULL, "
                "normalization = NULL WHERE id = :id"
            ),
            {"id": run_id},
        )
        db_session.commit()

        response = test_app.get(f"/sources/{source_id}/runs")

        assert response.status_code == 200
        assert response.json()[0]["quality_report"] == {}
        assert response.json()[0]["profile"] == {}


class TestDeleteSource:
    def test_delete_deactivates_rather_than_removing(self, test_app, own_project, db_session):
        from models.schemas import DataSource

        source_id = create_source(test_app, own_project.id).json()["id"]
        assert test_app.delete(f"/sources/{source_id}").status_code == 200

        # The row survives: ingestion runs reference it, and they are the
        # lineage of datasets that may still be training models.
        db_session.expire_all()
        assert db_session.get(DataSource, source_id) is not None
        assert test_app.get(f"/sources/{source_id}").status_code == 404
        assert test_app.get("/sources").json() == []


class TestNormalizationSettingsSurviveTheApi:
    """The fields the UI sends must reach the database and come back.

    This class exists because they did not. The form collected
    normalize_text_column and normalize_code_column, the request schema did
    not declare them, and Pydantic dropped them without a word — so
    normalisation could never be switched on through the API, while the
    backend that performs it was fully tested.

    Nothing caught it: the frontend tests mock the API and feed the fields
    straight in, the backend tests call normalize_file directly. Neither
    crossed the boundary where the loss happened. These do.
    """

    def test_settings_round_trip_through_create(self, test_app, own_project):
        resp = create_source(
            test_app,
            own_project.id,
            normalize_text_column="procedure_text",
            normalize_code_column="procedure_code",
        )

        assert resp.status_code == 201
        body = resp.json()
        assert body["normalize_text_column"] == "procedure_text"
        assert body["normalize_code_column"] == "procedure_code"

    def test_settings_are_persisted_not_just_echoed(self, test_app, own_project, db_session):
        from models.schemas import DataSource

        source_id = create_source(
            test_app,
            own_project.id,
            normalize_text_column="procedure_text",
            normalize_code_column="procedure_code",
        ).json()["id"]

        db_session.expire_all()
        stored = db_session.get(DataSource, source_id)
        assert stored.normalize_text_column == "procedure_text"
        assert stored.normalize_code_column == "procedure_code"

    def test_they_survive_a_reread(self, test_app, own_project):
        source_id = create_source(
            test_app,
            own_project.id,
            normalize_text_column="procedure_text",
            normalize_code_column="procedure_code",
        ).json()["id"]

        assert test_app.get(f"/sources/{source_id}").json()["normalize_text_column"] == (
            "procedure_text"
        )

    def test_omitting_them_means_no_normalisation(self, test_app, own_project):
        """They are optional: not every source has a code column to complete."""
        body = create_source(test_app, own_project.id).json()
        assert body["normalize_text_column"] == ""
        assert body["normalize_code_column"] == ""

    def test_a_run_reports_what_normalisation_did(self, test_app, own_project, db_session):
        """The summary has to reach the UI, or the panel renders nothing."""
        from models.schemas import IngestionRun

        source_id = create_source(test_app, own_project.id).json()["id"]
        summary = {
            "rows": 100,
            "already_coded": 60,
            "filled": 38,
            "unresolved": 2,
            "fill_rate": 0.95,
            "vocabulary_size": 12,
            "by_method": {"cascade:exact": 30, "cascade:fuzzy": 8},
        }
        db_session.add(
            IngestionRun(
                source_id=source_id,
                status="success",
                rows_extracted=100,
                normalization=summary,
            )
        )
        db_session.commit()

        runs = test_app.get(f"/sources/{source_id}/runs").json()
        assert runs[0]["normalization"] == summary
