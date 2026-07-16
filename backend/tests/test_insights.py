"""Tests for the AI insight endpoints and prompt builder."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from models.schemas import PipelineInsight
from tests.conftest import seed_pipeline, seed_repo


def seed_insight(session, pipeline_id: str, **kwargs) -> PipelineInsight:
    defaults = {
        "pipeline_id": pipeline_id,
        "status": "ready",
        "content": "## Resumen\nTodo bien.",
        "model": "claude-opus-4-8",
    }
    defaults.update(kwargs)
    insight = PipelineInsight(**defaults)
    session.add(insight)
    session.commit()
    session.refresh(insight)
    return insight


class TestListInsights:
    def test_list_insights_for_pipeline(self, test_app, db_session):
        repo = seed_repo(db_session)
        pipeline = seed_pipeline(db_session, repo.id, status="success")
        seed_insight(db_session, pipeline.id)

        resp = test_app.get(f"/pipelines/{pipeline.id}/insights")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["status"] == "ready"
        assert "Resumen" in items[0]["content"]

    def test_list_insights_empty(self, test_app, db_session):
        repo = seed_repo(db_session)
        pipeline = seed_pipeline(db_session, repo.id, status="success")
        resp = test_app.get(f"/pipelines/{pipeline.id}/insights")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_insights_unknown_pipeline(self, test_app):
        resp = test_app.get("/pipelines/nonexistent/insights")
        assert resp.status_code == 404


class TestGenerateInsights:
    def test_generate_enqueues_task(self, test_app, db_session, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = seed_repo(db_session)
            pipeline = seed_pipeline(db_session, repo.id, status="success")

            with patch("tasks.celery_tasks.analyze_pipeline") as mock_task:
                mock_task.apply_async = MagicMock()
                resp = test_app.post(f"/pipelines/{pipeline.id}/insights")

            assert resp.status_code == 202
            assert resp.json()["status"] == "pending"
            mock_task.apply_async.assert_called_once()
        finally:
            get_settings.cache_clear()

    def test_generate_rejected_while_running(self, test_app, db_session, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = seed_repo(db_session)
            pipeline = seed_pipeline(db_session, repo.id, status="running")
            resp = test_app.post(f"/pipelines/{pipeline.id}/insights")
            assert resp.status_code == 409
        finally:
            get_settings.cache_clear()

    def test_generate_without_api_key(self, test_app, db_session, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = seed_repo(db_session)
            pipeline = seed_pipeline(db_session, repo.id, status="success")
            resp = test_app.post(f"/pipelines/{pipeline.id}/insights")
            assert resp.status_code == 503
        finally:
            get_settings.cache_clear()

    def test_generate_unknown_pipeline(self, test_app):
        resp = test_app.post("/pipelines/nonexistent/insights")
        assert resp.status_code == 404


class TestPromptBuilder:
    def test_prompt_includes_code_and_metrics(self, sample_notebook):
        from core.ai_advisor import build_analysis_prompt

        prompt = build_analysis_prompt(
            notebook=sample_notebook,
            status="success",
            metrics={"accuracy": 0.93},
            phases=[{"name": "execute", "status": "success", "logs": ""}],
            history=[{"id": "old-run", "status": "success", "metrics": {"accuracy": 0.90}}],
            commit_sha="abc123def",
        )

        assert "MODEL_NAME" in prompt  # notebook code included
        assert "mlops:training" in prompt  # cell tags preserved
        assert "0.93" in prompt  # current metrics
        assert "0.9" in prompt  # history metrics
        assert "SUCCESS" in prompt

    def test_prompt_marks_failed_runs(self, sample_notebook):
        from core.ai_advisor import build_analysis_prompt

        prompt = build_analysis_prompt(
            notebook=sample_notebook,
            status="failed",
            metrics={},
            phases=[{"name": "execute", "status": "failed", "logs": "ValueError: bad shape"}],
            history=[],
            commit_sha="abc123def",
        )
        assert "FAILED" in prompt
        assert "ValueError: bad shape" in prompt
