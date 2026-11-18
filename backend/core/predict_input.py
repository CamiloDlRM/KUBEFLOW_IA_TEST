"""What a prediction request must look like for the model it is sent to.

The request's own shape (finite numbers, rectangular rows) is checked by
``PredictRequest``. This adds what depends on configuration and on the model:
how many rows one call may carry, and how many values make a row for *this*
model. A row of the wrong length used to reach the model and come back as a
500 with the model's own traceback text; it is now a 422 that says what was
expected, and the model never sees it.
"""
from __future__ import annotations

from typing import Any

from sqlmodel import Session

from core.config import AppSettings
from models.schemas import ModelDeployment, Pipeline


class InvalidPredictInput(ValueError):
    """The request is well-formed JSON but cannot be sent to this model."""


def expected_features(session: Session, deployment: ModelDeployment | None) -> int | None:
    """How many values a row needs, from the model card of the run that trained it.

    None when that is unknown (a model from before cards, or loaded out of
    band): rows are then only checked against each other.
    """
    if deployment is None or not deployment.pipeline_id:
        return None
    run = session.get(Pipeline, deployment.pipeline_id)
    card: dict[str, Any] = (run.model_card or {}) if run else {}
    inputs = card.get("inputs")
    return len(inputs) if isinstance(inputs, list) and inputs else None


def check_predict_input(data: list[list[float]], settings: AppSettings, features: int | None) -> None:
    """Raise InvalidPredictInput when ``data`` cannot go to the model."""
    if len(data) > settings.predict_max_rows:
        raise InvalidPredictInput(
            f"{len(data)} rows sent; at most {settings.predict_max_rows} are answered per request"
        )
    if features is not None and len(data[0]) != features:
        raise InvalidPredictInput(
            f"each row must have {features} values, in the order the model was trained on; "
            f"got {len(data[0])}"
        )
