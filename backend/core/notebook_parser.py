"""Notebook tag validation and extraction utilities.

MLOps notebooks must contain cells tagged with the following markers:
  - mlops:config
  - mlops:preprocessing
  - mlops:training
  - mlops:export
"""
from __future__ import annotations

import re
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

REQUIRED_TAGS: list[str] = [
    "mlops:config",
    "mlops:preprocessing",
    "mlops:training",
    "mlops:export",
]


def _cell_tags(cell: dict[str, Any]) -> list[str]:
    """Return the list of tags attached to a notebook cell."""
    metadata = cell.get("metadata", {})
    return metadata.get("tags", [])


def get_cells_by_tag(notebook: dict[str, Any], tag: str) -> list[dict[str, Any]]:
    """Return all cells that carry the given tag.

    Args:
        notebook: Parsed notebook dict (nbformat structure).
        tag: The tag string to filter by (e.g. ``"mlops:training"``).

    Returns:
        List of matching cell dicts.
    """
    return [
        cell
        for cell in notebook.get("cells", [])
        if tag in _cell_tags(cell)
    ]


def validate_required_tags(notebook: dict[str, Any]) -> None:
    """Validate that the notebook contains all required MLOps tags.

    Raises:
        ValueError: With a descriptive message listing any missing tags.
    """
    missing: list[str] = []
    for tag in REQUIRED_TAGS:
        if not get_cells_by_tag(notebook, tag):
            missing.append(tag)

    if missing:
        msg = (
            f"Notebook is missing required MLOps tags: {', '.join(missing)}. "
            f"Each cell must have metadata.tags containing the appropriate "
            f"mlops:* tag. Required tags: {', '.join(REQUIRED_TAGS)}"
        )
        logger.error("notebook.validation_failed", missing_tags=missing)
        raise ValueError(msg)

    logger.info("notebook.validation_passed")


def extract_config(notebook: dict[str, Any]) -> dict[str, str]:
    """Extract model_name and version from the ``mlops:config`` cell.

    The config cell source is scanned for assignments of the form::

        MODEL_NAME = "my-model"
        VERSION = "1"

    Returns:
        Dict with keys ``model_name`` and ``version``.

    Raises:
        ValueError: If the config cell is missing or values cannot be parsed.
    """
    cells = get_cells_by_tag(notebook, "mlops:config")
    if not cells:
        raise ValueError("No cell with tag 'mlops:config' found in notebook.")

    source = "".join(cells[0].get("source", []))
    if isinstance(cells[0].get("source"), str):
        source = cells[0]["source"]

    model_name_match = re.search(
        r"""MODEL_NAME\s*=\s*['"]([^'"]+)['"]""", source
    )
    version_match = re.search(
        r"""VERSION\s*=\s*['"]([^'"]+)['"]""", source
    )

    model_name = model_name_match.group(1) if model_name_match else "default-model"
    version = version_match.group(1) if version_match else "1"

    logger.info(
        "notebook.config_extracted",
        model_name=model_name,
        version=version,
    )
    return {"model_name": model_name, "version": version}


#: The phases a notebook is written in, in the order they run. This is also the
#: order the pipeline view lays its cards out in, so a notebook and its picture
#: cannot disagree about what comes after what.
PHASE_TAGS: list[str] = [
    "mlops:config",
    "mlops:data",
    "mlops:preprocessing",
    "mlops:training",
    "mlops:evaluation",
    "mlops:export",
]

#: Papermill's own cell, holding the values it injected. It is not the
#: author's code, and showing it as such would put DATASET_PATH in a card as if
#: someone had written it there.
INJECTED_TAG = "injected-parameters"

_MAX_SOURCE_CHARS = 20_000
_MAX_OUTPUT_CHARS = 2_000


def _text(value: Any) -> str:
    return "".join(value) if isinstance(value, list) else str(value or "")


def _output_text(cell: dict[str, Any]) -> tuple[str, str]:
    """What a cell printed, and the error it raised if it raised one."""
    printed = ""
    error = ""
    for out in cell.get("outputs", []) or []:
        if out.get("output_type") == "error":
            error = f"{out.get('ename', 'Error')}: {out.get('evalue', '')}".strip()
        elif "text" in out:
            printed += _text(out["text"])
        elif "text/plain" in (out.get("data") or {}):
            printed += _text(out["data"]["text/plain"])
    return printed[:_MAX_OUTPUT_CHARS], error


def notebook_cells(notebook: dict[str, Any]) -> list[dict[str, Any]]:
    """The notebook's code, cell by cell, each with the phase it belongs to.

    Kept as cells in notebook order rather than grouped by phase, because a
    notebook is allowed untagged cells — imports, a helper — and they still
    run. Grouping would have to either drop them or invent a phase for them;
    in order, the view can show them where they actually sit.

    Works on the notebook before execution and after it. After, each cell also
    carries what it printed, the error it raised, and papermill's status for
    it, which is how a card can say that training never ran because
    preprocessing failed rather than leave the reader to infer it.
    """
    cells: list[dict[str, Any]] = []
    for cell in notebook.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        tags = list(_cell_tags(cell))
        if INJECTED_TAG in tags:
            continue
        phase = next((tag for tag in tags if tag in PHASE_TAGS), "")
        output, error = _output_text(cell)
        papermill = (cell.get("metadata") or {}).get("papermill") or {}
        cells.append(
            {
                "index": len(cells),
                "phase": phase.removeprefix("mlops:"),
                "tags": tags,
                "source": _text(cell.get("source"))[:_MAX_SOURCE_CHARS],
                "output": output,
                "error": error,
                "status": papermill.get("status", "pending"),
            }
        )
    return cells
