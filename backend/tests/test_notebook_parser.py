"""Tests for the notebook tag validation and config extraction logic.

Covers required tag validation, config extraction, and cell filtering.
"""
from __future__ import annotations

import pytest

from core.notebook_parser import (
    REQUIRED_TAGS,
    extract_config,
    get_cells_by_tag,
    validate_required_tags,
)


class TestValidateRequiredTags:
    """validate_required_tags()"""

    def test_validate_tags_when_all_required_tags_present_should_pass(
        self, sample_notebook
    ):
        # Should not raise any exception
        validate_required_tags(sample_notebook)

    def test_validate_tags_when_missing_config_tag_should_raise_value_error(
        self, sample_notebook
    ):
        # Remove the mlops:config cell
        sample_notebook["cells"] = [
            c
            for c in sample_notebook["cells"]
            if "mlops:config" not in c.get("metadata", {}).get("tags", [])
        ]

        with pytest.raises(ValueError, match="mlops:config"):
            validate_required_tags(sample_notebook)

    def test_validate_tags_when_missing_training_tag_should_raise_value_error(
        self, sample_notebook
    ):
        # Remove the mlops:training cell
        sample_notebook["cells"] = [
            c
            for c in sample_notebook["cells"]
            if "mlops:training" not in c.get("metadata", {}).get("tags", [])
        ]

        with pytest.raises(ValueError, match="mlops:training"):
            validate_required_tags(sample_notebook)

    def test_validate_tags_when_empty_notebook_should_raise_value_error(self):
        empty_notebook = {"cells": []}

        with pytest.raises(ValueError) as exc_info:
            validate_required_tags(empty_notebook)

        # All required tags should be listed as missing
        for tag in REQUIRED_TAGS:
            assert tag in str(exc_info.value)

    def test_validate_tags_when_no_cells_key_should_raise_value_error(self):
        notebook = {"metadata": {}}

        with pytest.raises(ValueError):
            validate_required_tags(notebook)


class TestExtractConfig:
    """extract_config()"""

    def test_extract_config_when_valid_config_cell_should_return_model_name_and_version(
        self, sample_notebook
    ):
        config = extract_config(sample_notebook)

        assert config["model_name"] == "iris-classifier"
        assert config["version"] == "1"

    def test_extract_config_when_source_is_string_should_parse_correctly(self):
        notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:config"]},
                    "source": 'MODEL_NAME = "my-model"\nVERSION = "2"',
                    "outputs": [],
                }
            ]
        }

        config = extract_config(notebook)
        assert config["model_name"] == "my-model"
        assert config["version"] == "2"

    def test_extract_config_when_missing_model_name_should_return_default(self):
        notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:config"]},
                    "source": ['VERSION = "3"\n'],
                    "outputs": [],
                }
            ]
        }

        config = extract_config(notebook)
        assert config["model_name"] == "default-model"
        assert config["version"] == "3"

    def test_extract_config_when_no_config_cell_should_raise_value_error(self):
        notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:training"]},
                    "source": ["x = 1"],
                    "outputs": [],
                }
            ]
        }

        with pytest.raises(ValueError, match="mlops:config"):
            extract_config(notebook)


class TestGetCellsByTag:
    """get_cells_by_tag()"""

    def test_get_cells_by_tag_when_multiple_cells_should_return_all_matching(self):
        notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:training"]},
                    "source": ["line1"],
                },
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:training"]},
                    "source": ["line2"],
                },
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:config"]},
                    "source": ["config"],
                },
            ]
        }

        training_cells = get_cells_by_tag(notebook, "mlops:training")
        assert len(training_cells) == 2
        assert training_cells[0]["source"] == ["line1"]
        assert training_cells[1]["source"] == ["line2"]

    def test_get_cells_by_tag_when_no_match_should_return_empty_list(self):
        notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:config"]},
                    "source": ["x"],
                }
            ]
        }

        result = get_cells_by_tag(notebook, "mlops:nonexistent")
        assert result == []

    def test_get_cells_by_tag_when_cell_has_no_tags_should_skip(self):
        notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {},
                    "source": ["x"],
                },
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:config"]},
                    "source": ["y"],
                },
            ]
        }

        result = get_cells_by_tag(notebook, "mlops:config")
        assert len(result) == 1
        assert result[0]["source"] == ["y"]
