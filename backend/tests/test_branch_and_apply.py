"""Tests for branch-aware pipeline triggering and insight apply/push."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import seed_pipeline, seed_repo
from tests.test_insights import seed_insight


class TestListBranches:
    def test_list_branches(self, test_app, db_session):
        repo = seed_repo(db_session)
        with patch(
            "core.github.list_branches",
            new=AsyncMock(
                return_value=[
                    {"name": "main", "commit_sha": "aaa111"},
                    {"name": "testing-ia-agent", "commit_sha": "bbb222"},
                ]
            ),
        ):
            resp = test_app.get(f"/repos/{repo.id}/branches")

        assert resp.status_code == 200
        names = [b["name"] for b in resp.json()]
        assert names == ["main", "testing-ia-agent"]

    def test_list_branches_unknown_repo(self, test_app):
        resp = test_app.get("/repos/9999/branches")
        assert resp.status_code == 404


class TestTriggerPipeline:
    def _mock_runner(self):
        runner = MagicMock()
        runner.run = AsyncMock()
        return runner

    def test_trigger_from_default_branch(self, test_app, db_session):
        repo = seed_repo(db_session)
        runner = self._mock_runner()
        with (
            patch(
                "core.github.list_branches",
                new=AsyncMock(return_value=[{"name": "main", "commit_sha": "abc123"}]),
            ),
            patch("core.pipeline.get_pipeline_runner", return_value=runner),
        ):
            resp = test_app.post(f"/repos/{repo.id}/trigger", json={"branch": ""})

        assert resp.status_code == 202
        pipeline_id = resp.json()["pipeline_id"]
        runner.run.assert_awaited_once()

        from models.schemas import Pipeline

        pipeline = db_session.get(Pipeline, pipeline_id)
        assert pipeline.branch == "main"
        assert pipeline.commit_sha == "abc123"

    def test_trigger_from_other_branch(self, test_app, db_session):
        repo = seed_repo(db_session)
        runner = self._mock_runner()
        with (
            patch(
                "core.github.list_branches",
                new=AsyncMock(
                    return_value=[
                        {"name": "main", "commit_sha": "abc123"},
                        {"name": "testing-ia-agent", "commit_sha": "def456"},
                    ]
                ),
            ),
            patch("core.pipeline.get_pipeline_runner", return_value=runner),
        ):
            resp = test_app.post(
                f"/repos/{repo.id}/trigger", json={"branch": "testing-ia-agent"}
            )

        assert resp.status_code == 202

        from models.schemas import Pipeline

        pipeline = db_session.get(Pipeline, resp.json()["pipeline_id"])
        assert pipeline.branch == "testing-ia-agent"
        assert pipeline.commit_sha == "def456"

    def test_trigger_unknown_branch(self, test_app, db_session):
        repo = seed_repo(db_session)
        with patch(
            "core.github.list_branches",
            new=AsyncMock(return_value=[{"name": "main", "commit_sha": "abc123"}]),
        ):
            resp = test_app.post(f"/repos/{repo.id}/trigger", json={"branch": "nope"})
        assert resp.status_code == 404

    def test_trigger_dedupes_running_commit(self, test_app, db_session):
        repo = seed_repo(db_session)
        existing = seed_pipeline(
            db_session, repo.id, status="running", commit_sha="abc123"
        )
        with patch(
            "core.github.list_branches",
            new=AsyncMock(return_value=[{"name": "main", "commit_sha": "abc123"}]),
        ):
            resp = test_app.post(f"/repos/{repo.id}/trigger", json={"branch": "main"})

        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "already_queued"
        assert body["pipeline_id"] == existing.id


class TestApplyInsight:
    def test_apply_enqueues_task(self, test_app, db_session, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = seed_repo(db_session)
            pipeline = seed_pipeline(db_session, repo.id, status="success")
            insight = seed_insight(db_session, pipeline.id)

            with patch("tasks.celery_tasks.apply_insight") as mock_task:
                mock_task.apply_async = MagicMock()
                resp = test_app.post(
                    f"/pipelines/{pipeline.id}/insights/{insight.id}/apply"
                )

            assert resp.status_code == 202
            assert resp.json()["apply_status"] == "queued"
            mock_task.apply_async.assert_called_once()
        finally:
            get_settings.cache_clear()

    def test_apply_rejected_when_insight_not_ready(
        self, test_app, db_session, monkeypatch
    ):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = seed_repo(db_session)
            pipeline = seed_pipeline(db_session, repo.id, status="success")
            insight = seed_insight(db_session, pipeline.id, status="generating")
            resp = test_app.post(
                f"/pipelines/{pipeline.id}/insights/{insight.id}/apply"
            )
            assert resp.status_code == 409
        finally:
            get_settings.cache_clear()

    def test_apply_rejected_while_already_applying(
        self, test_app, db_session, monkeypatch
    ):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = seed_repo(db_session)
            pipeline = seed_pipeline(db_session, repo.id, status="success")
            insight = seed_insight(db_session, pipeline.id, apply_status="applying")
            resp = test_app.post(
                f"/pipelines/{pipeline.id}/insights/{insight.id}/apply"
            )
            assert resp.status_code == 409
        finally:
            get_settings.cache_clear()

    def test_apply_unknown_insight(self, test_app, db_session):
        repo = seed_repo(db_session)
        pipeline = seed_pipeline(db_session, repo.id, status="success")
        resp = test_app.post(f"/pipelines/{pipeline.id}/insights/9999/apply")
        assert resp.status_code == 404


class TestNotebookPatching:
    def test_apply_cells_patch_replaces_source(self, sample_notebook):
        from core.ai_advisor import apply_cells_patch

        patched = apply_cells_patch(
            sample_notebook,
            [{"index": 2, "source": "model = RandomForestClassifier()\nmodel.fit(X_train, y_train)\n"}],
        )

        # Original untouched, patch applied on the copy
        assert "RandomForest" not in "".join(sample_notebook["cells"][2]["source"])
        assert "".join(patched["cells"][2]["source"]).startswith("model = RandomForest")
        assert patched["cells"][2]["outputs"] == []
        # Tags preserved
        assert patched["cells"][2]["metadata"]["tags"] == ["mlops:training"]

    def test_apply_cells_patch_rejects_bad_index(self, sample_notebook):
        import pytest

        from core.ai_advisor import apply_cells_patch

        with pytest.raises(ValueError, match="invalid cell index"):
            apply_cells_patch(sample_notebook, [{"index": 99, "source": "x = 1"}])

    def test_extract_json_plain(self):
        from core.ai_advisor import _extract_json

        data = _extract_json('{"commit_message": "fix", "cells": []}')
        assert data["commit_message"] == "fix"

    def test_extract_json_with_fences_and_prose(self):
        from core.ai_advisor import _extract_json

        raw = 'Aqui tienes:\n```json\n{"commit_message": "feat: mejora", "cells": [{"index": 1, "source": "x=1"}]}\n```'
        data = _extract_json(raw)
        assert data["cells"][0]["index"] == 1

    def test_extract_json_garbage_raises(self):
        import pytest

        from core.ai_advisor import _extract_json

        with pytest.raises(ValueError):
            _extract_json("no json here")
