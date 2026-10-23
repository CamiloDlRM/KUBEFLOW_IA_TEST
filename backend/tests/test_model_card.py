"""Tests for the card that tells the test page what a model expects.

The model here is a fake with known thresholds — under 40 minutes is
ambulatory, under 200 is emergency, the rest inpatient — so the test can say
exactly where the card should place its boundaries. A real forest would only
let it say "somewhere".
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from core.model_card import describe
from tests.conftest import seed_pipeline, seed_project, seed_repo


class ThresholdClassifier:
    feature_names_in_ = np.array(["duration_minutes", "base_cost"])
    classes_ = np.array(["ambulatory", "emergency", "inpatient"])

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        duration = frame["duration_minutes"].to_numpy(dtype=float)
        return np.where(duration < 40, "ambulatory", np.where(duration < 200, "emergency", "inpatient"))

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        labels = self.predict(frame)
        return np.array([[float(label == c) for c in self.classes_] for label in labels])


class DoublingRegressor:
    feature_names_in_ = np.array(["x"])

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        return frame["x"].to_numpy(dtype=float) * 2


@pytest.fixture()
def features() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    return pd.DataFrame(
        {
            # Written in a different order from the model's on purpose: the
            # card must follow the model, not the file.
            "base_cost": rng.uniform(50, 5000, 2000),
            "duration_minutes": rng.uniform(5, 1000, 2000),
        }
    )


class TestInputs:
    def test_inputs_come_in_the_order_the_model_takes_them(self, features):
        card = describe(ThresholdClassifier(), features)

        assert [spec["name"] for spec in card["inputs"]] == ["duration_minutes", "base_cost"]

    def test_each_input_carries_its_training_range(self, features):
        duration = describe(ThresholdClassifier(), features)["inputs"][0]

        assert duration["min"] == pytest.approx(features["duration_minutes"].min(), rel=1e-6)
        assert duration["max"] == pytest.approx(features["duration_minutes"].max(), rel=1e-6)
        assert duration["min"] < duration["p05"] < duration["median"] < duration["p95"] < duration["max"]

    def test_the_baseline_is_the_typical_row_and_its_answer(self, features):
        card = describe(ThresholdClassifier(), features)

        median = features["duration_minutes"].median()
        assert card["baseline"]["values"][0] == pytest.approx(median, rel=1e-6)
        assert card["baseline"]["prediction"] == "inpatient"  # the median is ~500 minutes
        assert card["baseline"]["probabilities"]["inpatient"] == 1.0

    def test_a_classifier_lists_its_classes(self, features):
        assert describe(ThresholdClassifier(), features)["classes"] == [
            "ambulatory", "emergency", "inpatient",
        ]


class TestEffects:
    def test_ranges_of_an_input_find_where_the_answer_changes(self, features):
        effect = describe(ThresholdClassifier(), features)["effects"][0]

        assert effect["input"] == "duration_minutes"
        stretches = effect["segments"]
        assert [s["prediction"] for s in stretches] == ["ambulatory", "emergency", "inpatient"]
        # Boundaries land within one range (5% of the rows, ~50 minutes here)
        # of the real thresholds.
        assert stretches[0]["to"] == pytest.approx(40, abs=60)
        assert stretches[1]["to"] == pytest.approx(200, abs=60)

    def test_each_stretch_says_how_often_and_over_how_many_rows(self, features):
        stretches = describe(ThresholdClassifier(), features)["effects"][0]["segments"]

        # Past 200 minutes it is always inpatient; the one range straddling the
        # threshold brings in the few emergencies just under it.
        assert stretches[-1]["share"] > 0.99
        assert all(0.5 <= s["share"] <= 1.0 for s in stretches)
        assert sum(s["rows"] for s in stretches) == len(features)

    def test_the_stretches_cover_the_training_range_without_gaps(self, features):
        stretches = describe(ThresholdClassifier(), features)["effects"][0]["segments"]

        assert stretches[0]["from"] == pytest.approx(features["duration_minutes"].min(), rel=1e-6)
        assert stretches[-1]["to"] == pytest.approx(features["duration_minutes"].max(), rel=1e-6)
        for left, right in zip(stretches, stretches[1:]):
            assert left["to"] == right["from"]

    def test_an_input_the_model_ignores_shows_the_overall_mix(self, features):
        """Cost is unrelated to duration here, so every range of it holds the
        whole mix: one stretch, at the share of the commonest answer."""
        cost = describe(ThresholdClassifier(), features)["effects"][1]

        assert cost["input"] == "base_cost"
        assert [s["prediction"] for s in cost["segments"]] == ["inpatient"]
        assert cost["segments"][0]["share"] == pytest.approx(0.8, abs=0.05)

    def test_a_regressor_reports_the_mean_answer_per_range(self):
        frame = pd.DataFrame({"x": np.arange(100, dtype=float)})

        ranges = describe(DoublingRegressor(), frame)["effects"][0]["ranges"]

        assert "segments" not in describe(DoublingRegressor(), frame)["effects"][0]
        assert len(ranges) == 20
        assert ranges[0]["mean"] == pytest.approx(4.0)  # x in 0..4, doubled
        assert ranges[-1]["mean"] == pytest.approx(194.0, abs=1)


class TestWhatCanGoWrong:
    def test_features_that_are_not_what_the_model_was_fitted_on_are_named(self):
        card = describe(ThresholdClassifier(), pd.DataFrame({"duration_minutes": [1.0, 2.0]}))

        assert [spec["name"] for spec in card["inputs"]] == ["duration_minutes", "base_cost"]
        assert "base_cost" in card["note"]
        assert "effects" not in card

    def test_the_card_is_plain_json(self, features):
        """It is stored in a JSON column and logged to MLflow as JSON."""
        json.dumps(describe(ThresholdClassifier(), features))


class TestModelsCarryTheirCard:
    def test_a_deployed_model_lists_the_card_of_the_run_that_trained_it(
        self, test_app, db_session
    ):
        from models.schemas import ModelDeployment

        repo = seed_repo(db_session, project_id=seed_project(db_session).id)
        run = seed_pipeline(db_session, repo.id, model_card={"inputs": [{"name": "duration_minutes"}]})
        db_session.add(
            ModelDeployment(model_name="encounter-class", version="1", pipeline_id=run.id, is_active=True)
        )
        db_session.commit()

        listed = test_app.get("/models").json()

        assert listed[0]["model_card"]["inputs"][0]["name"] == "duration_minutes"

    def test_a_model_from_before_cards_has_an_empty_one(self, test_app, db_session):
        from models.schemas import ModelDeployment

        repo = seed_repo(db_session, project_id=seed_project(db_session).id)
        run = seed_pipeline(db_session, repo.id)
        db_session.add(ModelDeployment(model_name="old", version="1", pipeline_id=run.id, is_active=True))
        db_session.commit()

        assert test_app.get("/models").json()[0]["model_card"] == {}
