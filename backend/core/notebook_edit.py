"""Editing a notebook's cells from the app, without touching anything else.

The in-app editor only rewrites the text of cells that already exist: it
cannot add, remove, reorder or retag them, so the ``mlops:*`` contract the
pipeline validates survives an edit. What is written back to GitHub is the
original file with the edited sources swapped in.
"""
from __future__ import annotations

import json
from typing import Any

EDITABLE_TYPES = ("code", "markdown")


def cell_source(cell: dict[str, Any]) -> str:
    """A cell's source as one string (nbformat stores a string or a list of lines)."""
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else str(source)


def editor_cells(notebook: dict[str, Any]) -> list[dict[str, Any]]:
    """The notebook's cells as the editor shows them: no outputs, only text and tags."""
    return [
        {
            "index": index,
            "cell_type": cell.get("cell_type", "code"),
            "source": cell_source(cell),
            "tags": list(cell.get("metadata", {}).get("tags", [])),
        }
        for index, cell in enumerate(notebook.get("cells", []))
    ]


def apply_edits(notebook: dict[str, Any], edits: dict[int, str]) -> int:
    """Swap the edited sources into ``notebook`` in place; return how many cells changed.

    A code cell whose source changed loses its outputs and execution count:
    they were produced by code that is no longer there. Untouched cells stay
    byte-for-byte as they were, so the commit's diff is only what was edited.

    Raises:
        ValueError: an edit points at a cell that does not exist or cannot be edited.
    """
    cells = notebook.get("cells", [])
    changed = 0
    for index, source in edits.items():
        if not 0 <= index < len(cells):
            raise ValueError(f"Cell {index} does not exist in the notebook.")
        cell = cells[index]
        if cell.get("cell_type") not in EDITABLE_TYPES:
            raise ValueError(f"Cell {index} is not a code or markdown cell.")
        if source == cell_source(cell):
            continue
        # Keep the file's own convention: a list of lines, or one string.
        cell["source"] = source.splitlines(keepends=True) if isinstance(cell.get("source"), list) else source
        if cell.get("cell_type") == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
        changed += 1
    return changed


def serialize(notebook: dict[str, Any]) -> bytes:
    """The notebook as Jupyter itself writes it, so an edit does not reformat the file."""
    return (json.dumps(notebook, indent=1, ensure_ascii=False) + "\n").encode("utf-8")
