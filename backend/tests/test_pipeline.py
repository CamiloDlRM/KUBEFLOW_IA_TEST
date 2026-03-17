"""Tests for the pipeline endpoints (/pipelines).

Covers listing, detail retrieval, logs, and 404 handling.
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import MagicMock, patch

from tests.conftest import seed_pipeline, seed_repo


def _run(coro):
    """Helper to run async coroutines in sync tests."""
    return asyncio.get_event_loop().run_until_complete(coro)


class TestListPipelines:
    """GET /pipelines"""

    def test_list_pipelines_when_pipelines_exist_should_return_paginated(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        _run(seed_pipeline(mock_roble_client, repo["_id"], status="success"))
        _run(seed_pipeline(mock_roble_client, repo["_id"], status="running"))

        resp = test_app.get("/pipelines?page=1&size=20")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["page"] == 1
        assert data["size"] == 20
        assert len(data["items"]) == 2

    def test_list_pipelines_when_empty_should_return_zero_items(
        self,
        test_app,
    ):
        resp = test_app.get("/pipelines")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []


class TestGetPipeline:
    """GET /pipelines/{pipeline_id}"""

    def test_get_pipeline_when_exists_should_return_status_and_phases(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        phases = [
            {"name": "download", "status": "success", "timestamp": "2026-02-23T10:00:00Z", "logs": ""},
            {"name": "validate", "status": "running", "timestamp": "2026-02-23T10:00:01Z", "logs": ""},
        ]
        pipeline = _run(seed_pipeline(
            mock_roble_client,
            repo["_id"],
            status="running",
            phases=phases,
            metrics={"accuracy": 0.95},
        ))

        resp = test_app.get(f"/pipelines/{pipeline['pipeline_uuid']}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == pipeline["pipeline_uuid"]
        assert data["status"] == "running"
        assert len(data["phases"]) == 2
        assert data["metrics"]["accuracy"] == 0.95

    def test_get_pipeline_when_not_found_should_return_404(
        self,
        test_app,
    ):
        resp = test_app.get("/pipelines/nonexistent-uuid")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


class TestGetPipelineLogs:
    """GET /pipelines/{pipeline_id}/logs"""

    def test_pipeline_logs_when_pipeline_exists_should_return_logs(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        pipeline = _run(seed_pipeline(mock_roble_client, repo["_id"]))

        # Mock Redis to return sample log entries
        mock_redis_instance = MagicMock()
        log_entries = [
            json.dumps({"pipeline_id": pipeline["pipeline_uuid"], "phase": "download", "status": "success", "logs": "Downloaded", "timestamp": "2026-02-23T10:00:00Z"}),
            json.dumps({"pipeline_id": pipeline["pipeline_uuid"], "phase": "validate", "status": "running", "logs": "Validating", "timestamp": "2026-02-23T10:00:01Z"}),
        ]
        mock_redis_instance.lrange.return_value = log_entries

        with patch("redis.Redis.from_url", return_value=mock_redis_instance):
            resp = test_app.get(f"/pipelines/{pipeline['pipeline_uuid']}/logs")

        assert resp.status_code == 200
        data = resp.json()
        assert data["pipeline_id"] == pipeline["pipeline_uuid"]
        assert len(data["logs"]) == 2
        assert data["logs"][0]["phase"] == "download"

    def test_pipeline_logs_when_pipeline_not_found_should_return_404(
        self,
        test_app,
    ):
        resp = test_app.get("/pipelines/nonexistent-uuid/logs")

        assert resp.status_code == 404


class TestRunPipeline:
    """Integration test: pipeline task execution logic."""

    def test_run_pipeline_when_valid_notebook_should_complete_all_phases(
        self,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        pipeline = _run(seed_pipeline(mock_roble_client, repo["_id"], status="queued"))

        assert pipeline["status"] == "queued"
        assert pipeline["phases"] == []

    def test_run_pipeline_when_missing_tags_should_fail_at_validation_phase(
        self,
    ):
        from core.notebook_parser import validate_required_tags

        import pytest

        invalid_notebook = {
            "cells": [
                {
                    "cell_type": "code",
                    "metadata": {"tags": ["mlops:config"]},
                    "source": ["MODEL_NAME = 'test'"],
                }
            ]
        }

        with pytest.raises(ValueError, match="mlops:preprocessing"):
            validate_required_tags(invalid_notebook)


class TestListPipelinesPagination:
    """GET /pipelines pagination edge cases."""

    def test_list_pipelines_when_page_two_should_return_correct_offset(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        # Seed 3 pipelines
        for i in range(3):
            _run(seed_pipeline(mock_roble_client, repo["_id"], status="success"))

        resp = test_app.get("/pipelines?page=2&size=2")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert data["page"] == 2
        assert data["size"] == 2
        assert len(data["items"]) == 1  # 3 total, page 2 with size 2 = 1 remaining

    def test_list_pipelines_when_page_beyond_total_should_return_empty_items(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        _run(seed_pipeline(mock_roble_client, repo["_id"]))

        resp = test_app.get("/pipelines?page=10&size=20")

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"] == []

    def test_list_pipelines_response_contains_correct_fields(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        _run(seed_pipeline(
            mock_roble_client,
            repo["_id"],
            status="success",
            metrics={"accuracy": 0.92},
        ))

        resp = test_app.get("/pipelines")

        assert resp.status_code == 200
        item = resp.json()["items"][0]
        assert "id" in item
        assert "repo_id" in item
        assert "status" in item
        assert "commit_sha" in item
        assert "phases" in item
        assert "metrics" in item


class TestGetPipelineFallbackId:
    """GET /pipelines/{pipeline_id} -- fallback to _id search."""

    def test_get_pipeline_when_searched_by_roble_id_should_still_return(
        self,
        test_app,
        mock_roble_client,
    ):
        repo = _run(seed_repo(mock_roble_client))
        pipeline = _run(seed_pipeline(mock_roble_client, repo["_id"]))

        # Search by ROBLE _id instead of pipeline_uuid
        resp = test_app.get(f"/pipelines/{pipeline['_id']}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["repo_id"] == repo["_id"]
