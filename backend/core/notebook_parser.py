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

#: Allowed ``MODEL_NAME`` values. The name becomes a URL segment on the
#: model-server, a Prometheus label and the ``${model}`` slot the Grafana proxy
#: matches (core/grafana_queries.py), so it must never carry quotes or spaces.
MODEL_NAME_PATTERN = r"[A-Za-z0-9_.\-]{1,200}"

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


_DATASET_PATH_DECLARATION = re.compile(r"^\s*DATASET_PATH\s*=", re.MULTILINE)


def uses_project_dataset(notebook: dict[str, Any]) -> bool:
    """Whether the notebook reads the project's gold data.

    The contract is the papermill ``parameters`` cell: a notebook that declares
    ``DATASET_PATH`` there expects the platform to hand it the project's active
    dataset; one that does not brings its own data, so nothing is downloaded.
    """
    for cell in get_cells_by_tag(notebook, "parameters"):
        source = cell.get("source", "")
        if isinstance(source, list):
            source = "".join(source)
        if _DATASET_PATH_DECLARATION.search(source):
            return True
    return False


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
        ValueError: If the config cell is missing, values cannot be parsed or
            ``MODEL_NAME`` does not match :data:`MODEL_NAME_PATTERN`.
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
    if not re.fullmatch(MODEL_NAME_PATTERN, model_name):
        raise ValueError(
            f"Invalid MODEL_NAME {model_name!r} in the mlops:config cell: use only "
            "letters, digits, '_', '.' or '-' (max 200 characters)."
        )
    version = version_match.group(1) if version_match else "1"

    logger.info(
        "notebook.config_extracted",
        model_name=model_name,
        version=version,
    )
    return {"model_name": model_name, "version": version}
