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

    def test_generate_unknown_pipeline(self, test_app, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            resp = test_app.post("/pipelines/nonexistent/insights")
            assert resp.status_code == 404
        finally:
            get_settings.cache_clear()


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


class TestProviderConfig:
    """Tests for the multi-provider configuration helpers."""

    def _settings(self, monkeypatch, **env):
        from core.config import get_settings

        for key in (
            "AI_ADVISOR_ENABLED",
            "AI_ADVISOR_PROVIDER",
            "AI_ADVISOR_MODEL",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "OLLAMA_BASE_URL",
        ):
            monkeypatch.delenv(key, raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        return get_settings()

    def teardown_method(self):
        from core.config import get_settings

        get_settings.cache_clear()

    def test_disabled_advisor_is_not_configured(self, monkeypatch):
        from core.ai_advisor import advisor_configured

        settings = self._settings(
            monkeypatch, AI_ADVISOR_ENABLED="false", ANTHROPIC_API_KEY="sk-x"
        )
        assert not advisor_configured(settings)

    def test_anthropic_requires_api_key(self, monkeypatch):
        from core.ai_advisor import advisor_configured

        settings = self._settings(monkeypatch, AI_ADVISOR_PROVIDER="anthropic")
        assert not advisor_configured(settings)

        settings = self._settings(
            monkeypatch, AI_ADVISOR_PROVIDER="anthropic", ANTHROPIC_API_KEY="sk-x"
        )
        assert advisor_configured(settings)

    def test_gemini_requires_api_key(self, monkeypatch):
        from core.ai_advisor import advisor_configured

        settings = self._settings(monkeypatch, AI_ADVISOR_PROVIDER="gemini")
        assert not advisor_configured(settings)

        settings = self._settings(
            monkeypatch, AI_ADVISOR_PROVIDER="gemini", GEMINI_API_KEY="AIza-x"
        )
        assert advisor_configured(settings)

    def test_ollama_needs_only_base_url(self, monkeypatch):
        from core.ai_advisor import advisor_configured

        settings = self._settings(monkeypatch, AI_ADVISOR_PROVIDER="ollama")
        assert advisor_configured(settings)  # default base URL, no key needed

        settings = self._settings(
            monkeypatch, AI_ADVISOR_PROVIDER="ollama", OLLAMA_BASE_URL=""
        )
        assert not advisor_configured(settings)

    def test_resolve_model_defaults_per_provider(self, monkeypatch):
        from core.ai_advisor import resolve_model

        settings = self._settings(monkeypatch, AI_ADVISOR_PROVIDER="anthropic")
        assert resolve_model(settings) == "claude-opus-4-8"

        settings = self._settings(monkeypatch, AI_ADVISOR_PROVIDER="gemini")
        assert resolve_model(settings) == "gemini-2.5-pro"

        settings = self._settings(monkeypatch, AI_ADVISOR_PROVIDER="ollama")
        assert resolve_model(settings) == "llama3.1"

    def test_resolve_model_explicit_override(self, monkeypatch):
        from core.ai_advisor import advisor_label, resolve_model

        settings = self._settings(
            monkeypatch, AI_ADVISOR_PROVIDER="ollama", AI_ADVISOR_MODEL="mistral:7b"
        )
        assert resolve_model(settings) == "mistral:7b"
        assert advisor_label(settings) == "ollama:mistral:7b"

    def test_generate_insight_fails_fast_when_unconfigured(
        self, monkeypatch, sample_notebook
    ):
        import pytest

        from core.ai_advisor import generate_insight

        self._settings(monkeypatch, AI_ADVISOR_PROVIDER="anthropic")
        with pytest.raises(RuntimeError, match="not configured"):
            generate_insight(
                notebook=sample_notebook,
                status="success",
                metrics={},
                phases=[],
                history=[],
                commit_sha="abc123def",
            )


class TestProviderBackends:
    """Response-parsing tests for the Gemini and Ollama backends (mocked HTTP)."""

    def _settings(self, monkeypatch, **env):
        from core.config import get_settings

        for key, value in env.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()
        return get_settings()

    def teardown_method(self):
        from core.config import get_settings

        get_settings.cache_clear()

    def test_gemini_parses_candidates(self, monkeypatch):
        from core.ai_advisor import _generate_gemini

        settings = self._settings(
            monkeypatch, AI_ADVISOR_PROVIDER="gemini", GEMINI_API_KEY="AIza-x"
        )
        response = MagicMock()
        response.json.return_value = {
            "candidates": [
                {"content": {"parts": [{"text": "## Resumen\n"}, {"text": "ok"}]}}
            ]
        }
        with patch("httpx.post", return_value=response) as mock_post:
            report = _generate_gemini(settings, "gemini-2.5-pro", "hola")

        assert report == "## Resumen\nok"
        url = mock_post.call_args.args[0]
        assert "gemini-2.5-pro:generateContent" in url

    def test_gemini_raises_on_empty_candidates(self, monkeypatch):
        import pytest

        from core.ai_advisor import _generate_gemini

        settings = self._settings(
            monkeypatch, AI_ADVISOR_PROVIDER="gemini", GEMINI_API_KEY="AIza-x"
        )
        response = MagicMock()
        response.json.return_value = {"promptFeedback": {"blockReason": "SAFETY"}}
        with patch("httpx.post", return_value=response):
            with pytest.raises(RuntimeError, match="no candidates"):
                _generate_gemini(settings, "gemini-2.5-pro", "hola")

    def test_ollama_parses_chat_response(self, monkeypatch):
        from core.ai_advisor import _generate_ollama

        settings = self._settings(
            monkeypatch,
            AI_ADVISOR_PROVIDER="ollama",
            OLLAMA_BASE_URL="http://ollama:11434/",
        )
        response = MagicMock()
        response.json.return_value = {
            "message": {"role": "assistant", "content": "## Resumen\ntodo bien"}
        }
        with patch("httpx.post", return_value=response) as mock_post:
            report = _generate_ollama(settings, "llama3.1", "hola")

        assert report == "## Resumen\ntodo bien"
        # Trailing slash on the base URL must not produce a double slash
        assert mock_post.call_args.args[0] == "http://ollama:11434/api/chat"
        body = mock_post.call_args.kwargs["json"]
        assert body["model"] == "llama3.1"
        assert body["stream"] is False
