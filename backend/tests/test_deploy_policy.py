"""Tests for a project deciding when its model deploys, and runs taking parameters.

Pinned: an unconfigured project deploys exactly as before; each way a run can
fail the policy says so in words; and a training parameter can never overwrite
a name the platform injects.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core.deploy_policy import (
    DeployPolicy,
    PolicyError,
    clean_parameters,
    decide,
)
from models.schemas import Pipeline, Project
from tests.conftest import DEFAULT_USER_ID, seed_dataset, seed_pipeline, seed_repo

DEFAULTS = DeployPolicy.defaults(auto_deploy=True, threshold=0.8)


def policy(**changes) -> DeployPolicy:
    return DeployPolicy.parse(changes, fallback=DEFAULTS)


class TestDecide:
    def test_the_defaults_are_the_old_rule(self):
        assert decide(DEFAULTS, {"accuracy": 0.85}, None)[0] is True
        deployed, reason = decide(DEFAULTS, {"accuracy": 0.79}, None)
        assert deployed is False
        assert reason == "accuracy 0.7900 missed the bar (>= 0.8)."

    def test_auto_deploy_off_waits_for_a_person(self):
        deployed, reason = decide(policy(auto_deploy=False), {"accuracy": 0.99}, None)
        assert deployed is False
        assert "deploy it from the model's Versions" in reason

    def test_any_logged_metric_can_decide(self):
        recall = policy(metric="recall", threshold=0.9)
        assert decide(recall, {"accuracy": 0.99, "recall": 0.92}, None)[0] is True
        assert decide(recall, {"accuracy": 0.99, "recall": 0.70}, None)[0] is False

    def test_a_metric_the_notebook_did_not_log_is_named(self):
        deployed, reason = decide(policy(metric="recall"), {"accuracy": 0.99}, None)
        assert deployed is False
        assert "logged no 'recall'" in reason

    def test_an_error_metric_wants_lower(self):
        rmse = policy(metric="rmse", threshold=10, direction="lower")
        assert decide(rmse, {"rmse": 8.5}, None) == (True, "rmse 8.5000 <= 10.")
        assert decide(rmse, {"rmse": 12.0}, None)[0] is False

    def test_it_can_require_beating_the_version_serving(self):
        strict = policy(must_beat_serving=True)
        deployed, reason = decide(strict, {"accuracy": 0.85}, serving=0.90)
        assert deployed is False
        assert "did not beat the version serving now (0.9000)" in reason
        assert decide(strict, {"accuracy": 0.93}, serving=0.90)[0] is True
        # Nothing serving yet: the bar alone decides.
        assert decide(strict, {"accuracy": 0.85}, serving=None)[0] is True

    def test_it_will_not_deploy_on_a_comparison_it_could_not_make(self):
        strict = policy(metric="recall", threshold=0.9, must_beat_serving=True)
        deployed, reason = decide(strict, {"recall": 0.91}, serving=None, serving_unknown=True)
        assert deployed is False
        assert "the version serving now logged no 'recall'" in reason
        # Only a policy that asks to beat it cares; and a missed bar is still the first thing said.
        assert decide(policy(metric="recall", threshold=0.9), {"recall": 0.91}, None, serving_unknown=True)[0] is True
        assert "missed the bar" in decide(strict, {"recall": 0.5}, None, serving_unknown=True)[1]


class TestParse:
    def test_missing_fields_take_the_fallback(self):
        assert DeployPolicy.parse({}, fallback=DEFAULTS) == DEFAULTS

    @pytest.mark.parametrize(
        "raw, message",
        [
            ({"direction": "sideways"}, "higher' or 'lower"),
            ({"threshold": "high"}, "must be a number"),
            ({"threshold": float("nan")}, "finite"),
            ({"metric": ""}, "which metric"),
        ],
    )
    def test_nonsense_is_refused(self, raw, message):
        with pytest.raises(PolicyError, match=message):
            DeployPolicy.parse(raw, fallback=DEFAULTS)


class TestParameters:
    def test_numbers_text_and_flags_pass(self):
        assert clean_parameters({"N_ESTIMATORS": 300, "LR": 0.05, "TARGET": "class", "BALANCED": True}) == {
            "N_ESTIMATORS": 300, "LR": 0.05, "TARGET": "class", "BALANCED": True,
        }

    @pytest.mark.parametrize("name", ["2fast", "max-depth", "a b", "x;import os"])
    def test_a_name_that_is_not_an_identifier_is_refused(self, name):
        with pytest.raises(PolicyError, match="not a usable name"):
            clean_parameters({name: 1})

    def test_the_platforms_own_names_cannot_be_overwritten(self):
        with pytest.raises(PolicyError, match="set by the platform"):
            clean_parameters({"MODEL_OUTPUT_PATH": "/tmp/elsewhere"})

    def test_structures_are_refused(self):
        with pytest.raises(PolicyError, match="number, true/false or text"):
            clean_parameters({"LAYERS": [64, 32]})


@pytest.fixture()
def project(db_session):
    project = Project(name="Encounters", owner_id=DEFAULT_USER_ID)
    db_session.add(project)
    db_session.commit()
    db_session.refresh(project)
    return project


class TestApi:
    def test_an_unconfigured_project_reports_the_platforms_policy(self, test_app, project):
        body = test_app.get(f"/projects/{project.id}/run-settings").json()

        assert body["is_default"] is True
        assert body["policy"]["metric"] == "accuracy"

    def test_metrics_and_last_parameters_come_from_its_runs(self, test_app, db_session, project):
        repo = seed_repo(db_session, project_id=project.id)
        seed_pipeline(db_session, repo.id, project_id=project.id, metrics={"accuracy": 0.9, "recall": 0.8, "deployed": True},
                      parameters={"N_ESTIMATORS": 300})

        body = test_app.get(f"/projects/{project.id}/run-settings").json()

        assert body["metrics_available"] == ["accuracy", "recall"]
        assert body["last_parameters"] == {"N_ESTIMATORS": 300}

    def test_a_partial_change_keeps_the_rest_and_reset_undoes_it(self, test_app, db_session, project):
        changed = test_app.put(
            f"/projects/{project.id}/deploy-policy", json={"metric": "recall", "threshold": 0.9}
        ).json()

        assert changed["is_default"] is False
        assert changed["policy"]["metric"] == "recall"
        assert changed["policy"]["direction"] == "higher"

        reset = test_app.put(f"/projects/{project.id}/deploy-policy", json={"reset": True}).json()
        assert reset["is_default"] is True
        db_session.refresh(project)
        assert project.deploy_policy == {}

    def test_a_bad_policy_is_refused_and_not_stored(self, test_app, db_session, project):
        response = test_app.put(f"/projects/{project.id}/deploy-policy", json={"direction": "up"})

        assert response.status_code == 422
        db_session.refresh(project)
        assert project.deploy_policy == {}

    def test_another_members_project_is_not_found(self, other_member_app, project):
        assert other_member_app.get(f"/projects/{project.id}/run-settings").status_code == 404
        assert other_member_app.put(
            f"/projects/{project.id}/deploy-policy", json={"auto_deploy": False}
        ).status_code == 404


class TestRunWithParameters:
    @pytest.fixture()
    def ready(self, db_session, project):
        runner = MagicMock()
        runner.run = AsyncMock()
        seed_repo(db_session, owner_id=DEFAULT_USER_ID, project_id=project.id)
        seed_dataset(db_session, project.id, is_active=True)
        with (
            patch("core.pipeline.get_pipeline_runner", return_value=runner),
            patch("core.github.list_branches", new=AsyncMock(return_value=[{"name": "main", "commit_sha": "abc"}])),
        ):
            yield runner

    def test_the_run_keeps_its_parameters(self, test_app, db_session, project, ready):
        response = test_app.post(
            f"/projects/{project.id}/run",
            json={"model_name": "encounters", "parameters": {"N_ESTIMATORS": 300, "BALANCED": True}},
        )

        assert response.status_code == 202, response.text
        run = db_session.get(Pipeline, response.json()["pipeline_id"])
        assert run.parameters == {"N_ESTIMATORS": 300, "BALANCED": True}

    def test_a_reserved_name_is_refused_before_anything_runs(self, test_app, project, ready):
        response = test_app.post(
            f"/projects/{project.id}/run",
            json={"model_name": "encounters", "parameters": {"DATASET_PATH": "/etc/passwd"}},
        )

        assert response.status_code == 422
        assert "set by the platform" in response.json()["detail"]
        ready.run.assert_not_awaited()


class TestTheWorkersDecision:
    """``_deploy_decision`` reads the project's policy and the version serving."""

    def test_a_run_worse_than_production_does_not_replace_it(self, db_engine, db_session, project):
        from models.schemas import ModelDeployment
        from tasks.celery_tasks import _deploy_decision

        project.deploy_policy = {"must_beat_serving": True, "threshold": 0.5}
        db_session.add(project)
        repo = seed_repo(db_session, project_id=project.id)
        serving_run = seed_pipeline(db_session, repo.id, project_id=project.id, metrics={"accuracy": 0.92})
        db_session.add(ModelDeployment(model_name="encounters", version="4", accuracy=0.92,
                                       pipeline_id=serving_run.id, is_active=True))
        db_session.commit()

        with patch("db.engine", db_engine):
            deployed, reason = _deploy_decision(project.id, "encounters", {"accuracy": 0.88})

        assert deployed is False
        assert "did not beat the version serving now (0.9200)" in reason

    def test_a_serving_version_without_the_metric_is_not_replaced_blind(self, db_engine, db_session, project):
        """The deciding metric changed after the serving version deployed."""
        from models.schemas import ModelDeployment
        from tasks.celery_tasks import _deploy_decision

        project.deploy_policy = {"metric": "recall", "must_beat_serving": True, "threshold": 0.5}
        db_session.add(project)
        repo = seed_repo(db_session, project_id=project.id)
        serving_run = seed_pipeline(db_session, repo.id, project_id=project.id, metrics={"accuracy": 0.92})
        db_session.add(ModelDeployment(model_name="encounters", version="4", accuracy=0.92,
                                       pipeline_id=serving_run.id, is_active=True))
        db_session.commit()

        with patch("db.engine", db_engine):
            deployed, reason = _deploy_decision(project.id, "encounters", {"recall": 0.95})

        assert deployed is False
        assert "logged no 'recall' to compare it with" in reason

    def test_a_project_without_a_policy_uses_the_platforms(self, db_engine, project):
        from tasks.celery_tasks import _deploy_decision, settings

        with patch("db.engine", db_engine):
            deployed, _ = _deploy_decision(project.id, "encounters", {"accuracy": 0.99})

        assert deployed is settings.auto_deploy_on_success


class TestWhatAModelIsShownBy:
    """``GET /models`` reports the metric a model was judged on, not always accuracy."""

    def _deployed(self, db_session, project, metrics):
        from models.schemas import ModelDeployment

        repo = seed_repo(db_session, project_id=project.id)
        run = seed_pipeline(db_session, repo.id, project_id=project.id, metrics=metrics)
        # What the worker stores for a run that logged no accuracy.
        db_session.add(ModelDeployment(model_name="encounters", version="1", accuracy=metrics.get("accuracy", 0.0),
                                       endpoint_url="http://x/predict/encounters", pipeline_id=run.id, is_active=True))
        db_session.commit()

    def test_a_regressor_is_shown_by_its_error_not_a_zero_accuracy(self, test_app, db_session, project):
        project.deploy_policy = {"metric": "rmse", "direction": "lower", "threshold": 10}
        db_session.add(project)
        self._deployed(db_session, project, {"rmse": 8.5})

        (model,) = test_app.get("/models").json()

        assert (model["metric"], model["metric_value"]) == ("rmse", 8.5)

    def test_a_version_older_than_the_metric_keeps_its_accuracy(self, test_app, db_session, project):
        project.deploy_policy = {"metric": "recall"}
        db_session.add(project)
        self._deployed(db_session, project, {"accuracy": 0.92})

        (model,) = test_app.get("/models").json()

        assert (model["metric"], model["metric_value"]) == ("accuracy", 0.92)

    def test_a_run_that_logged_neither_has_no_number_rather_than_zero(self, test_app, db_session, project):
        self._deployed(db_session, project, {"f1": 0.8})

        (model,) = test_app.get("/models").json()

        assert (model["metric"], model["metric_value"]) == ("accuracy", None)


class TestTheRegisterMessage:
    """The run's log names the metric its project deploys on, not always accuracy."""

    def test_it_says_the_deciding_metric(self, db_engine, db_session, project):
        from tasks.celery_tasks import _judged_line

        with patch("db.engine", db_engine):
            assert _judged_line(project.id, {"accuracy": 0.91}) == "Accuracy: 0.9100"
            project.deploy_policy = {"metric": "rmse", "direction": "lower", "threshold": 10}
            db_session.add(project)
            db_session.commit()
            assert _judged_line(project.id, {"rmse": 8.5}) == "rmse: 8.5000"
            # A regressor used to read "Accuracy: 0.0000".
            assert _judged_line(None, {"f1": 0.8}) == "The notebook logged no 'accuracy'"
