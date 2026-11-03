"""What a trained model expects, and what it answers across that.

A deployed model is a function of a few numbers in a fixed order, and nothing
in the artifact says which numbers, in what range, or what happens when one of
them moves. The test page used to offer the Iris example to every model; it
"worked" on any model with four inputs and meant nothing on all of them.

This builds a card from the model and the features it was fitted on:

- **the inputs**, in the order the model takes them, each with the range it
  saw in training and a typical value;
- **a baseline**: every input at its typical value, and what the model says
  there — the row the test page starts from;
- **one effect per input**: the training rows split by that input into
  ranges, and what the model answers for the rows in each — "when the
  duration is under 40 minutes it answers ambulatory for 92% of them; from 40
  to 190, emergency for 71%". For a classifier, neighbouring ranges with the
  same majority answer are merged.

Why the training rows and not a sweep. The obvious design — move one input
across its range, hold the others at their typical value, read the answer —
was tried first, on a real forest over encounters, and every strip came out a
single colour. Duration and the costs rise together with the class; a forest
fitted on them wants several to agree before it changes its answer, so moving
one alone, with the costs pinned at an ambulatory visit's, never gets there.
The sweep described a combination of inputs that does not occur. Grouping the
real rows describes the combinations that do, which is what "what will it say
if I send a longer encounter" is asking.

What that costs: the effects are associations within the training data, not
the consequence of changing one input alone. The test page says so, and lets
the actual model answer any row typed into it.

The features come from the notebook (``TRAINING_FEATURES_PATH``), because only
the notebook knows what it fitted on: derived columns like a duration exist
nowhere upstream.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

#: Ranges per input. Quantile ranges, so each holds about the same number of
#: rows; twenty puts about 5% of the data in each, enough to place a boundary
#: and enough rows per range for its majority to mean something.
BINS = 20
#: Rows used for everything. A sample, because the card describes the shape of
#: the training data, not its every row.
SAMPLE = 5_000
#: Categories kept for a non-numeric input.
MAX_CATEGORIES = 20


def _plain(value: Any) -> Any:
    """A numpy scalar as the JSON value it stands for."""
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return None if not np.isfinite(number) else round(number, 6)
    if isinstance(value, np.generic):
        return value.item()
    return value


def _is_number(series: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series)


def _ranges(column: pd.Series) -> pd.Series:
    """Assign each row to a quantile range of ``column``.

    Quantiles rather than equal widths: a skewed cost split evenly would put
    nearly every encounter in the first range and say nothing about them.
    """
    clean = column.dropna()
    edges = np.unique(np.quantile(clean.to_numpy(dtype=float), np.linspace(0, 1, BINS + 1)))
    if len(edges) < 2:
        return pd.Series(pd.NA, index=column.index)
    return pd.cut(column, edges, include_lowest=True)


def _majority(answers: pd.Series) -> tuple[Any, float]:
    counts = answers.value_counts()
    return counts.index[0], float(counts.iloc[0] / counts.sum())


def _class_effect(column: pd.Series, answers: pd.Series) -> list[dict[str, Any]]:
    """Ranges of ``column`` and the model's majority answer in each, merged."""
    groups = answers.groupby(_ranges(column), observed=True)
    stretches: list[dict[str, Any]] = []
    for interval, group in groups:
        label, share = _majority(group)
        rows = len(group)
        if stretches and stretches[-1]["prediction"] == label:
            last = stretches[-1]
            last["share"] = (last["share"] * last["rows"] + share * rows) / (last["rows"] + rows)
            last["rows"] += rows
            last["to"] = interval.right
            continue
        stretches.append(
            {"from": interval.left, "to": interval.right, "prediction": label, "share": share, "rows": rows}
        )
    if stretches:
        # pd.cut widens the lowest edge a hair to include it; report the data's.
        stretches[0]["from"] = column.min()
    return [{key: _plain(value) for key, value in stretch.items()} for stretch in stretches]


def _value_effect(column: pd.Series, answers: pd.Series) -> list[dict[str, Any]]:
    """Ranges of ``column`` and the model's mean answer in each (a regressor)."""
    points = []
    for interval, group in answers.astype(float).groupby(_ranges(column), observed=True):
        points.append(
            {"from": interval.left, "to": interval.right, "mean": group.mean(), "rows": len(group)}
        )
    if points:
        points[0]["from"] = column.min()
    return [{key: _plain(value) for key, value in point.items()} for point in points]


def _category_effect(column: pd.Series, answers: pd.Series, classifier: bool) -> list[dict[str, Any]]:
    values = column.astype(str)
    effect = []
    for value in values.value_counts().index[:MAX_CATEGORIES]:
        group = answers[values == value]
        if classifier:
            label, share = _majority(group)
            effect.append({"value": value, "prediction": _plain(label), "share": _plain(share), "rows": len(group)})
        else:
            effect.append({"value": value, "mean": _plain(group.astype(float).mean()), "rows": len(group)})
    return effect


def describe(model: Any, features: pd.DataFrame) -> dict[str, Any]:
    """Build the card for ``model`` from the features it was fitted on."""
    names = [str(name) for name in getattr(model, "feature_names_in_", features.columns)]
    missing = [name for name in names if name not in features.columns]
    if missing:
        # The notebook wrote something other than what the model was fitted
        # on. A card built from it would describe a different model.
        return {
            "inputs": [{"name": name} for name in names],
            "note": (
                f"The training features do not match the model: {', '.join(missing)} "
                "missing. Write exactly the frame passed to fit()."
            ),
        }

    frame = features[names]
    if len(frame) > SAMPLE:
        frame = frame.sample(SAMPLE, random_state=0)
    classifier = hasattr(model, "classes_")

    inputs: list[dict[str, Any]] = []
    baseline: dict[str, Any] = {}
    for name in names:
        column = frame[name]
        if _is_number(column):
            clean = column.dropna()
            typical = float(clean.median()) if len(clean) else 0.0
            inputs.append(
                {
                    "name": name,
                    "type": "number",
                    "min": _plain(clean.min()) if len(clean) else None,
                    "p05": _plain(clean.quantile(0.05)) if len(clean) else None,
                    "median": _plain(typical),
                    "p95": _plain(clean.quantile(0.95)) if len(clean) else None,
                    "max": _plain(clean.max()) if len(clean) else None,
                    "missing": _plain(float(column.isna().mean())),
                }
            )
        else:
            counts = column.astype(str).value_counts()
            typical = counts.index[0] if len(counts) else ""
            inputs.append(
                {
                    "name": name,
                    "type": "category",
                    "values": [str(value) for value in counts.index[:MAX_CATEGORIES]],
                    "median": typical,
                    "missing": _plain(float(column.isna().mean())),
                }
            )
        baseline[name] = typical

    base = pd.DataFrame([baseline], columns=names)
    card: dict[str, Any] = {
        "kind": "classifier" if classifier else "regressor",
        "rows": int(len(features)),
        "inputs": inputs,
        "baseline": {
            "values": [_plain(baseline[name]) for name in names],
            "prediction": _plain(model.predict(base)[0]),
        },
        "effects": [],
        "note": "",
    }
    if classifier:
        card["classes"] = [_plain(value) for value in model.classes_]
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba(base)[0]
            card["baseline"]["probabilities"] = {
                str(_plain(label)): _plain(p) for label, p in zip(model.classes_, probabilities)
            }

    # One prediction per training row, reused for every input's ranges. The
    # model sees each row whole — every input as it really was together.
    answers = pd.Series(model.predict(frame), index=frame.index)

    for spec in inputs:
        column = frame[spec["name"]]
        if column.nunique(dropna=True) < 2:
            continue
        if spec["type"] == "category":
            effect = {"input": spec["name"], "categories": _category_effect(column, answers, classifier)}
        elif classifier:
            effect = {"input": spec["name"], "segments": _class_effect(column, answers)}
        else:
            effect = {"input": spec["name"], "ranges": _value_effect(column, answers)}
        card["effects"].append(effect)

    return card


# ---------------------------------------------------------------------------
# What the numbers mean
# ---------------------------------------------------------------------------

#: Longest description kept. Notes are a sentence for a form, not a document.
_MAX_TEXT = 300


def _text(value: Any) -> str:
    return str(value).strip()[:_MAX_TEXT] if isinstance(value, (str, int, float)) else ""


def annotate(card: dict[str, Any], notes: dict[str, Any]) -> dict[str, Any]:
    """Add what the notebook says its inputs and answers mean.

    Ranges and types can be read off the data; meaning cannot. "base_cost
    12 – 14,650" says nothing until someone says it is dollars, before
    insurance. So the notebook may write notes (``MODEL_NOTES_PATH``)::

        {"target": {"name": "encounter_class", "description": "..."},
         "inputs": {"base_cost": {"description": "...", "unit": "USD"}},
         "classes": {"inpatient": "Admitted for at least one night"}}

    Every part is optional, and anything not shaped like that is ignored
    rather than trusted: the notes come from user code. Names that match no
    input are dropped, so a stale note cannot describe a column the model no
    longer takes.
    """
    if not isinstance(notes, dict):
        return card

    target = notes.get("target")
    if isinstance(target, dict) and (_text(target.get("name")) or _text(target.get("description"))):
        card["target"] = {"name": _text(target.get("name")), "description": _text(target.get("description"))}

    described = notes.get("inputs")
    if isinstance(described, dict):
        for spec in card.get("inputs", []):
            note = described.get(spec["name"])
            if isinstance(note, str):
                note = {"description": note}
            if not isinstance(note, dict):
                continue
            if _text(note.get("description")):
                spec["description"] = _text(note.get("description"))
            if _text(note.get("unit")):
                spec["unit"] = _text(note.get("unit"))[:20]

    classes = notes.get("classes")
    if isinstance(classes, dict):
        known = {str(label) for label in card.get("classes", [])}
        meanings = {str(label): _text(text) for label, text in classes.items() if str(label) in known and _text(text)}
        if meanings:
            card["class_notes"] = meanings

    return card
