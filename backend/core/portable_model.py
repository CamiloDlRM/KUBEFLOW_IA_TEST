"""Keep the code a notebook writes inside the model it saves.

``joblib.dump`` saves an object's data and, for each class, only where to find
it: ``xgboost.sklearn.XGBClassifier``, ``sklearn.compose.ColumnTransformer``.
A class written in a notebook cell has no such place. Python files it under
``__main__``, "the program running now", which during training is the notebook
and while serving is the model server. The server then fails with "Can't get
attribute 'FixedThresholdClassifier' on <module '__main__'>": seen in
production on PULSO, whose notebook wraps its pipeline in a threshold class of
its own.

So the platform appends one cell of its own to the notebook it runs. After the
notebook's export cell has saved the model, that cell looks for ``__main__`` in
the file. When it is there, it loads the model back (in the notebook, where the
class exists) and saves it again with ``cloudpickle``, which writes the code of
classes and functions defined in ``__main__`` into the file instead of their
name. A model built only from library classes is left exactly as the notebook
saved it.

The cell never fails the run: a model that cannot be made portable is the same
model it was without the cell. It is tagged, and dropped from what the run's
page shows, because it is the platform's and not the author's.
"""
from __future__ import annotations

import copy
from typing import Any

#: Tag on the cell the platform adds, so it can be told apart from the author's.
PLATFORM_TAG = "maia:platform"

#: What the cell runs. Everything it defines is prefixed and deleted afterwards,
#: so nothing leaks into the notebook's namespace.
_SOURCE = '''\
# Added by Maia, not part of this notebook: keeps any class or function written
# in this notebook inside the saved model, so the model server can load it.
def _maia_keep_notebook_code():
    import os

    path = globals().get("MODEL_OUTPUT_PATH")
    if not path or not os.path.exists(path):
        return
    found, tail = False, b""
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            if b"__main__" in tail + chunk:
                found = True
                break
            tail = chunk[-8:]
    if not found:
        return
    import cloudpickle
    import joblib

    model = joblib.load(path)
    portable = path + ".portable"
    with open(portable, "wb") as handle:
        cloudpickle.dump(model, handle)
    os.replace(portable, path)
    print("Maia: the model uses code written in this notebook; that code is now saved inside the model file.")


try:
    _maia_keep_notebook_code()
except Exception as _maia_error:  # the model stays as the notebook saved it
    print(f"Maia: could not save this notebook's code inside the model: {_maia_error}")
finally:
    del _maia_keep_notebook_code
'''


def portable_model_cell() -> dict[str, Any]:
    """The cell the platform appends to every notebook it runs."""
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {"tags": [PLATFORM_TAG]},
        "outputs": [],
        "source": _SOURCE,
    }


def with_portable_model_cell(notebook: dict[str, Any]) -> dict[str, Any]:
    """A copy of ``notebook`` with the platform's cell last; the original is untouched.

    Last, so it runs after the export cell has written the model, and so it
    shifts no index the author's cells are known by.
    """
    prepared = copy.deepcopy(notebook)
    prepared.setdefault("cells", []).append(portable_model_cell())
    return prepared


def is_platform_cell(cell: Any) -> bool:
    metadata = cell.get("metadata", {}) if hasattr(cell, "get") else {}
    return PLATFORM_TAG in (metadata.get("tags") or [])


def without_platform_cells(notebook: Any) -> Any:
    """``notebook`` with the platform's cell removed, in place: what the author wrote."""
    notebook["cells"] = [cell for cell in notebook.get("cells", []) if not is_platform_cell(cell)]
    return notebook
