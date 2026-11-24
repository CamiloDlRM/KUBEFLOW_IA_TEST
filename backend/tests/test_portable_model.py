"""The platform's last cell keeps a notebook's own classes inside the saved model.

Seen in production on PULSO: its notebook defines FixedThresholdClassifier in a
cell, joblib saved it as "__main__.FixedThresholdClassifier", and the model
server, whose __main__ is itself, failed to load the model.

The end-to-end tests train in one process and serve from another, as the
worker and the model server do, so "__main__" means a different program in
each, exactly as in production.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import textwrap

import pytest

from core.portable_model import (
    PLATFORM_TAG,
    is_platform_cell,
    portable_model_cell,
    with_portable_model_cell,
    without_platform_cells,
)

NOTEBOOK = {
    "cells": [
        {"cell_type": "markdown", "metadata": {}, "source": "# Title"},
        {"cell_type": "code", "metadata": {"tags": ["mlops:export"]}, "source": "joblib.dump(model, MODEL_OUTPUT_PATH)"},
    ],
    "metadata": {},
    "nbformat": 4,
    "nbformat_minor": 5,
}


class TestTheCell:
    def test_it_runs_last_and_leaves_the_authors_notebook_alone(self):
        prepared = with_portable_model_cell(NOTEBOOK)

        assert len(prepared["cells"]) == 3
        assert is_platform_cell(prepared["cells"][-1])
        assert prepared["cells"][:2] == NOTEBOOK["cells"]
        assert len(NOTEBOOK["cells"]) == 2, "the original is not modified"

    def test_it_is_dropped_from_what_the_run_shows(self):
        shown = without_platform_cells(with_portable_model_cell(NOTEBOOK))

        assert shown["cells"] == NOTEBOOK["cells"]
        assert not any(PLATFORM_TAG in (c["metadata"].get("tags") or []) for c in shown["cells"])

    def test_it_is_valid_python(self):
        compile(portable_model_cell()["source"], "maia-cell", "exec")


CELL = portable_model_cell()["source"]

_LIBRARIES = all(importlib.util.find_spec(name) for name in ("joblib", "cloudpickle"))

#: A model whose class is written in the "notebook", the way PULSO's is.
TRAIN = textwrap.dedent(
    """
    import joblib

    class Threshold:
        def __init__(self, threshold):
            self.threshold = threshold

        def predict(self, rows):
            return [int(row[0] >= self.threshold) for row in rows]

    joblib.dump(Threshold(0.38), MODEL_OUTPUT_PATH)
    """
)

SERVE = "import joblib, sys; print(joblib.load(sys.argv[1]).predict([[0.2], [0.5]]))"


def _python(code: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-c", code, *args], capture_output=True, text=True, timeout=120)


def _notebook(path, *, with_cell: bool) -> subprocess.CompletedProcess[str]:
    code = f"MODEL_OUTPUT_PATH = {str(path)!r}\n{TRAIN}\n"
    if with_cell:
        code += f"exec(compile({CELL!r}, 'maia-cell', 'exec'))\n"
        code += "assert '_maia_keep_notebook_code' not in globals(), 'the cell cleans up after itself'\n"
    return _python(code)


@pytest.mark.skipif(not _LIBRARIES, reason="needs joblib and cloudpickle (backend/requirements.txt)")
class TestEndToEnd:
    def test_without_the_cell_the_server_cannot_load_it(self, tmp_path):
        """The production failure, reproduced: the control for the next test."""
        path = tmp_path / "model.joblib"
        assert _notebook(path, with_cell=False).returncode == 0

        served = _python(SERVE, str(path))

        assert served.returncode != 0
        assert "Can't get attribute 'Threshold'" in served.stderr

    def test_with_the_cell_the_server_loads_it_and_it_answers(self, tmp_path):
        path = tmp_path / "model.joblib"
        trained = _notebook(path, with_cell=True)
        assert trained.returncode == 0, trained.stderr
        assert "code is now saved inside the model file" in trained.stdout

        served = _python(SERVE, str(path))

        assert served.returncode == 0, served.stderr
        assert served.stdout.strip() == "[0, 1]"

    def test_a_model_of_library_classes_is_left_exactly_as_saved(self, tmp_path):
        path = tmp_path / "model.joblib"
        code = f"import joblib, collections\nMODEL_OUTPUT_PATH = {str(path)!r}\njoblib.dump(collections.Counter('abc'), MODEL_OUTPUT_PATH)\n"
        assert _python(code).returncode == 0
        before = path.read_bytes()

        ran = _python(f"MODEL_OUTPUT_PATH = {str(path)!r}\nexec(compile({CELL!r}, 'maia-cell', 'exec'))")

        assert ran.returncode == 0, ran.stderr
        assert ran.stdout == ""
        assert path.read_bytes() == before

    @pytest.mark.parametrize(
        "setup",
        [
            "MODEL_OUTPUT_PATH = None",  # the notebook saved nothing
            "MODEL_OUTPUT_PATH = '/no/such/model.joblib'",
        ],
    )
    def test_nothing_to_save_is_not_an_error(self, setup):
        ran = _python(f"{setup}\nexec(compile({CELL!r}, 'maia-cell', 'exec'))")

        assert ran.returncode == 0, ran.stderr
        assert ran.stdout == ""

    def test_a_model_that_cannot_be_read_back_does_not_fail_the_run(self, tmp_path):
        path = tmp_path / "model.joblib"
        path.write_bytes(b"not a pickle, but it mentions __main__")

        ran = _python(f"MODEL_OUTPUT_PATH = {str(path)!r}\nexec(compile({CELL!r}, 'maia-cell', 'exec'))")

        assert ran.returncode == 0, ran.stderr
        assert "could not save this notebook's code" in ran.stdout
        assert path.read_bytes() == b"not a pickle, but it mentions __main__"
