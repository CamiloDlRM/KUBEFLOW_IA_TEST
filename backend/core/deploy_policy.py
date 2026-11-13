"""When a trained model goes to production, and with what knobs it was trained.

Until now both were the platform's call: a model deployed when its
``accuracy`` reached ``MIN_ACCURACY_THRESHOLD``, the same number for every
project, and a run took no input from the person launching it. That is wrong
for most models. A regressor has no accuracy; a fraud model is judged on
recall; a project may want every model reviewed by hand before it serves.

**The policy** belongs to the project, because a project is one model line:

- ``auto_deploy``: deploy on its own at all, or wait to be deployed from the
  model's Versions;
- ``metric``: which logged metric decides — any the notebook logs to MLflow;
- ``threshold`` and ``direction``: the bar, and whether higher or lower is
  better (an error like RMSE wants lower);
- ``must_beat_serving``: also require beating the version serving now, so a
  run that clears the bar but is worse than production does not replace it.

An empty policy is the platform's defaults, so a project nobody configured
deploys exactly as before.

**Training parameters** are per run: names and values typed into "Run
pipeline", injected into the notebook by papermill next to the platform's own.
They are checked here because they become Python assignments in someone's
notebook — a name must be an identifier, and the platform's own names cannot
be overwritten.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from typing import Any

DIRECTIONS = ("higher", "lower")

#: Names the platform injects. A training parameter with one of them would
#: quietly redirect where the model is saved or which data it reads.
RESERVED = frozenset(
    {
        "DATASET_PATH",
        "MODEL_OUTPUT_PATH",
        "PIPELINE_ID",
        "MLFLOW_TRACKING_URI",
        "MLFLOW_RUN_ID",
        "TRAINING_FEATURES_PATH",
        "MODEL_NOTES_PATH",
    }
)
MAX_PARAMETERS = 30
MAX_TEXT = 500
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


class PolicyError(ValueError):
    """A policy or a parameter set that cannot be used."""


@dataclass(frozen=True)
class DeployPolicy:
    auto_deploy: bool
    metric: str
    threshold: float
    direction: str = "higher"
    must_beat_serving: bool = False

    @classmethod
    def defaults(cls, *, auto_deploy: bool, threshold: float) -> DeployPolicy:
        return cls(auto_deploy=auto_deploy, metric="accuracy", threshold=threshold)

    @classmethod
    def parse(cls, raw: dict[str, Any] | None, *, fallback: DeployPolicy) -> DeployPolicy:
        """Read a stored or submitted policy; missing fields take ``fallback``'s."""
        raw = raw or {}
        metric = str(raw.get("metric", fallback.metric)).strip()
        if not metric or len(metric) > 100:
            raise PolicyError("Say which metric decides (at most 100 characters).")
        direction = str(raw.get("direction", fallback.direction))
        if direction not in DIRECTIONS:
            raise PolicyError("direction is 'higher' or 'lower'.")
        try:
            threshold = float(raw.get("threshold", fallback.threshold))
        except (TypeError, ValueError) as exc:
            raise PolicyError("threshold must be a number.") from exc
        if not math.isfinite(threshold):
            raise PolicyError("threshold must be a finite number.")
        return cls(
            auto_deploy=bool(raw.get("auto_deploy", fallback.auto_deploy)),
            metric=metric,
            threshold=threshold,
            direction=direction,
            must_beat_serving=bool(raw.get("must_beat_serving", fallback.must_beat_serving)),
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def better(self, value: float, than: float) -> bool:
        return value > than if self.direction == "higher" else value < than

    def clears(self, value: float) -> bool:
        return value >= self.threshold if self.direction == "higher" else value <= self.threshold


def deciding_metric(raw: dict[str, Any] | None) -> str:
    """The metric a stored policy decides on; the platform's when it names none or is unusable."""
    fallback = DeployPolicy.defaults(auto_deploy=True, threshold=0.0)
    try:
        return DeployPolicy.parse(raw, fallback=fallback).metric
    except PolicyError:
        return fallback.metric


def judged_on(raw: dict[str, Any] | None, metrics: dict[str, Any] | None) -> tuple[str, float | None]:
    """The number a model is shown by: the policy's metric as the run logged it, else its accuracy.

    A version that deployed before the metric was chosen logged only the old
    one, so it keeps its accuracy; a run that logged neither has no number.
    """
    wanted = deciding_metric(raw)
    for name in (wanted, "accuracy"):
        value = (metrics or {}).get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return name, float(value)
    return wanted, None


def decide(
    policy: DeployPolicy,
    metrics: dict[str, Any],
    serving: float | None,
    *,
    serving_unknown: bool = False,
) -> tuple[bool, str]:
    """Whether a run deploys under ``policy``, and the sentence that says why.

    ``serving`` is the policy's metric for the version serving now, if any.
    ``serving_unknown`` says a version *is* serving but logged no such metric
    (the deciding metric was changed after it deployed): a policy that must
    beat it then refuses, rather than deploying on a comparison never made.
    The reason is stored on the run: "not deployed" with no reason is how a
    person ends up retraining a model that was fine.
    """
    if not policy.auto_deploy:
        return False, "Auto-deploy is off for this project; deploy it from the model's Versions."
    value = metrics.get(policy.metric)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return False, f"The notebook logged no '{policy.metric}', which this project deploys on."
    sign = ">=" if policy.direction == "higher" else "<="
    if not policy.clears(value):
        return False, f"{policy.metric} {value:.4f} missed the bar ({sign} {policy.threshold:g})."
    if policy.must_beat_serving and serving is None and serving_unknown:
        return False, (
            f"{policy.metric} {value:.4f} cleared the bar, but the version serving now logged no "
            f"'{policy.metric}' to compare it with; deploy it from the model's Versions."
        )
    if policy.must_beat_serving and serving is not None and not policy.better(value, serving):
        return False, (
            f"{policy.metric} {value:.4f} cleared the bar but did not beat the version "
            f"serving now ({serving:.4f})."
        )
    reason = f"{policy.metric} {value:.4f} {sign} {policy.threshold:g}"
    if policy.must_beat_serving and serving is not None:
        reason += f", better than the version serving now ({serving:.4f})"
    return True, reason + "."


def clean_parameters(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Check training parameters before they become assignments in a notebook."""
    raw = raw or {}
    if not isinstance(raw, dict):
        raise PolicyError("Training parameters are a set of names and values.")
    if len(raw) > MAX_PARAMETERS:
        raise PolicyError(f"At most {MAX_PARAMETERS} training parameters.")
    cleaned: dict[str, Any] = {}
    for name, value in raw.items():
        if not isinstance(name, str) or not _IDENTIFIER.match(name):
            raise PolicyError(
                f"{name!r} is not a usable name: letters, digits and '_', not starting with a digit."
            )
        if name in RESERVED:
            raise PolicyError(f"{name} is set by the platform and cannot be a training parameter.")
        if isinstance(value, bool) or isinstance(value, int):
            cleaned[name] = value
        elif isinstance(value, float):
            if not math.isfinite(value):
                raise PolicyError(f"{name} must be a finite number.")
            cleaned[name] = value
        elif isinstance(value, str):
            if len(value) > MAX_TEXT:
                raise PolicyError(f"{name} is longer than {MAX_TEXT} characters.")
            cleaned[name] = value
        else:
            raise PolicyError(f"{name} must be a number, true/false or text.")
    return cleaned
