"""Tests for choosing which version of a model to serve.

A version is a run that registered an artifact. The two things pinned here are
the ones the old rollback got wrong: every version can be picked by the run
that trained it — including one that never cleared the auto-deploy bar — and
picking one puts exactly that artifact in service.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from models.schemas import ModelDeployment
from tests.conftest import OTHER_USER_ID, seed_pipeline, seed_project, seed_repo
from tests.test_models import _mock_async_client, _resp

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


@pytest.fixture()
def repo(db_session):
    return seed_repo(db_session, project_id=seed_project(db_session).id)


def run(db_session, repo, version: str, accuracy: float, *, minutes_ago: int, **kwargs):
    return seed_pipeline(
        db_session,
        repo.id,
        status="success",
        model_name="encounters",
        model_version=version,
        mlflow_run_id=f"mlflow-{version}",
        metrics={"accuracy": accuracy, "f1_weighted": accuracy - 0.02, "deployed": False},
        mounted_input={"layer": "gold", "label": f"gold v{version}"},
        started_at=NOW - timedelta(minutes=minutes_ago),
        finished_at=NOW - timedelta(minutes=minutes_ago - 1),
        **kwargs,
    )


def deploy(db_session, pipeline, *, active: bool):
    deployment = ModelDeployment(
        model_name="encounters",
        version=pipeline.model_version,
        accuracy=pipeline.metrics["accuracy"],
        mlflow_run_id=pipeline.mlflow_run_id,
        pipeline_id=pipeline.id,
        is_active=active,
        deployed_at=pipeline.finished_at,
    )
    db_session.add(deployment)
    db_session.commit()
    return deployment


def serve(client, body):
    mock_client = _mock_async_client(post=AsyncMock(return_value=_resp(200, {"status": "loaded"})))
    with patch("routers.models.httpx.AsyncClient", return_value=mock_client):
        response = client.post("/models/encounters/rollback", json=body)
    return response, mock_client


class TestListing:
    def test_every_registered_run_is_a_version_newest_first(self, test_app, db_session, repo):
        first = run(db_session, repo, "1", 0.91, minutes_ago=90)
        run(db_session, repo, "2", 0.79, minutes_ago=60)  # missed the bar: never deployed
        third = run(db_session, repo, "3", 0.88, minutes_ago=30)
        deploy(db_session, first, active=False)
        deploy(db_session, third, active=True)

        versions = test_app.get("/models/encounters/versions").json()

        assert [v["version"] for v in versions] == ["3", "2", "1"]
        assert [v["is_active"] for v in versions] == [True, False, False]
        never = versions[1]
        assert never["deployed_at"] is None
        assert never["deployable"] is True
        assert never["accuracy"] == pytest.approx(0.79)
        assert never["metrics"] == {"accuracy": 0.79, "f1_weighted": pytest.approx(0.77)}
        assert never["input_label"] == "gold v2"

    def test_a_deployment_from_before_versions_were_recorded_still_shows(
        self, test_app, db_session, repo
    ):
        old = seed_pipeline(db_session, repo.id, status="success", metrics={"accuracy": 0.7})
        db_session.add(
            ModelDeployment(model_name="encounters", version="1", accuracy=0.7,
                            mlflow_run_id="mlflow-old", pipeline_id=old.id, is_active=True)
        )
        db_session.commit()

        versions = test_app.get("/models/encounters/versions").json()

        assert [(v["version"], v["is_active"], v["mlflow_run_id"]) for v in versions] == [
            ("1", True, "mlflow-old"),
        ]

    def test_another_members_versions_are_not_listed(self, other_member_app, db_session, repo):
        deploy(db_session, run(db_session, repo, "1", 0.9, minutes_ago=10), active=True)

        assert other_member_app.get("/models/encounters/versions").status_code == 404


class TestServing:
    def test_a_version_that_never_deployed_can_be_put_in_service(self, test_app, db_session, repo):
        current = run(db_session, repo, "2", 0.88, minutes_ago=30)
        deploy(db_session, current, active=True)
        skipped = run(db_session, repo, "3", 0.79, minutes_ago=10)

        response, server = serve(test_app, {"pipeline_id": skipped.id})

        assert response.status_code == 200, response.text
        assert "serving version 3" in response.json()["message"]
        assert server.post.call_args.kwargs["json"] == {"mlflow_run_id": "mlflow-3", "version": "3"}
        rows = db_session.exec(select(ModelDeployment).where(ModelDeployment.model_name == "encounters")).all()
        active = [row for row in rows if row.is_active]
        assert [(row.pipeline_id, row.version) for row in active] == [(skipped.id, "3")]

    def test_going_back_reuses_the_versions_own_row(self, test_app, db_session, repo):
        older = run(db_session, repo, "1", 0.91, minutes_ago=90)
        deploy(db_session, older, active=False)
        deploy(db_session, run(db_session, repo, "2", 0.85, minutes_ago=30), active=True)

        response, _ = serve(test_app, {"pipeline_id": older.id})

        assert response.status_code == 200
        rows = db_session.exec(select(ModelDeployment)).all()
        assert len(rows) == 2  # no duplicate row for version 1
        assert {row.version: row.is_active for row in rows} == {"1": True, "2": False}

    def test_the_old_way_of_naming_a_version_still_works(self, test_app, db_session, repo):
        older = run(db_session, repo, "1", 0.91, minutes_ago=90)
        deploy(db_session, older, active=False)
        deploy(db_session, run(db_session, repo, "2", 0.85, minutes_ago=30), active=True)

        response, server = serve(test_app, {"version": "1"})

        assert response.status_code == 200
        assert server.post.call_args.kwargs["json"]["mlflow_run_id"] == "mlflow-1"

    def test_a_request_that_names_no_version_is_refused(self, test_app, db_session, repo):
        deploy(db_session, run(db_session, repo, "1", 0.9, minutes_ago=10), active=True)

        response, server = serve(test_app, {})

        assert response.status_code == 422
        server.post.assert_not_called()

    def test_another_members_run_cannot_be_served(self, test_app, db_session, repo):
        deploy(db_session, run(db_session, repo, "1", 0.9, minutes_ago=30), active=True)
        theirs_repo = seed_repo(
            db_session,
            owner_id=OTHER_USER_ID,
            github_url="https://github.com/other/repo",
            project_id=seed_project(db_session, owner_id=OTHER_USER_ID, name="Theirs").id,
        )
        theirs = run(db_session, theirs_repo, "9", 0.99, minutes_ago=5)

        response, server = serve(test_app, {"pipeline_id": theirs.id})

        assert response.status_code == 404
        server.post.assert_not_called()


class TestNumbering:
    def test_a_run_that_never_deployed_still_takes_its_number(self, db_session, repo):
        """Otherwise the next run would reuse the number of one that never shipped."""
        from tasks.celery_tasks import next_model_version

        deploy(db_session, run(db_session, repo, "1", 0.9, minutes_ago=60), active=True)
        run(db_session, repo, "2", 0.7, minutes_ago=30)  # registered, not deployed

        assert next_model_version(db_session, "encounters") == "3"
