"""Every call to a repository goes with its owner's token, never the server's.

Seen in production on WilmerJr01/PruebaPF: "Run pipeline" checked the branch
with the owner's expired token and failed, while the worker downloaded the
notebook with the server's token and the advisor pushed with it too. The
server's account could read the public repository but not write to it, so
"Apply & push" answered GitHub's 404 for an unauthorized write, and the run
button showed only "Network Error" (a 502 that Cloudflare does not pass on).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from tests.conftest import seed_pipeline, seed_repo, seed_repo_in_project
from tests.test_insights import seed_insight

SERVER_TOKEN = "ghp_test1234567890abcdef"  # GITHUB_TOKEN in conftest
OWNER_TOKEN = "ghp_owner_token_5678"


def _refusal(code: int, method: str = "GET") -> httpx.HTTPStatusError:
    request = httpx.Request(method, "https://api.github.com/repos/o/r/git/refs")
    return httpx.HTTPStatusError("refused", request=request, response=httpx.Response(code, request=request))


def _owner_repo(db_session, token: str | None = OWNER_TOKEN):
    """A repository that calls GitHub with its owner's token, as sign-in repositories do."""
    from core.config import get_settings
    from core.github_credentials import get_provider, set_user_token
    from models.schemas import User, UserIdentity

    owner = User(username="wilmer@t", hashed_password="x")
    db_session.add(owner)
    db_session.flush()
    if token:
        identity = UserIdentity(user_id=owner.id, provider_id=get_provider(db_session, "token").id)
        set_user_token(db_session, identity, token, get_settings())
    repo = seed_repo(db_session, owner_id=owner.id, uses_owner_token=True)
    return repo


class TestTokenProblem:
    def test_an_expired_token_says_the_owner_must_renew_it(self):
        from core.github_credentials import token_problem

        message = token_problem(_refusal(401), "push the corrected notebook")

        assert "expired or was revoked" in message
        assert "Settings" in message

    @pytest.mark.parametrize("code, method", [(403, "GET"), (404, "POST"), (404, "PUT")])
    def test_no_write_access_is_named(self, code, method):
        from core.github_credentials import token_problem

        assert "no write access" in token_problem(_refusal(code, method), "push")

    def test_a_missing_file_on_a_read_is_not_a_token_problem(self):
        from core.github_credentials import token_problem

        assert token_problem(_refusal(404, "GET"), "read") is None
        assert token_problem(_refusal(500), "read") is None
        assert token_problem(RuntimeError("boom"), "read") is None

    def test_an_owner_without_a_token_is_one(self):
        from core.github_credentials import MissingOwnerToken, token_problem

        assert "no GitHub token" in token_problem(MissingOwnerToken("The repository owner has no GitHub token."), "push")


class TestTheAdvisorPushesWithTheOwnersToken:
    def _apply(self, db_engine, db_session, repo, **github):
        from tasks.celery_tasks import apply_insight

        pipeline = seed_pipeline(db_session, repo.id, status="failed")
        insight = seed_insight(db_session, pipeline.id)
        upsert = MagicMock(**github)
        with (
            patch("sqlmodel.create_engine", return_value=db_engine),
            patch("tasks.celery_tasks._download_notebook_for_analysis", return_value={"cells": []}) as download,
            patch("tasks.celery_tasks._advisor_egress", return_value=(None, [])),
            patch("core.ai_advisor.generate_improved_notebook", return_value=({"cells": []}, "fix: x")),
            patch("core.github.get_branch_head", return_value="base123") as head,
            patch("core.github.upsert_branch", upsert),
            patch("core.github.commit_file", return_value="commit456"),
        ):
            outcome = apply_insight(pipeline.id, insight.id)
        return outcome, download, head, upsert, insight

    def test_the_branch_is_pushed_with_the_owners_token(self, db_engine, db_session):
        outcome, download, head, upsert, _ = self._apply(db_engine, db_session, _owner_repo(db_session))

        assert outcome["status"] == "pushed"
        assert download.call_args.args[3] == OWNER_TOKEN
        assert head.call_args.args[1] == OWNER_TOKEN
        assert upsert.call_args.args[1] == OWNER_TOKEN
        assert SERVER_TOKEN not in str(upsert.call_args)

    def test_an_expired_owner_token_says_so_instead_of_quoting_the_url(self, db_engine, db_session):
        outcome, *_, insight = self._apply(
            db_engine, db_session, _owner_repo(db_session), side_effect=_refusal(401, "POST")
        )

        assert outcome["status"] == "failed"
        from models.schemas import PipelineInsight

        db_session.expire_all()
        error = db_session.get(PipelineInsight, insight.id).apply_error
        assert "expired or was revoked" in error
        assert "api.github.com" not in error


class TestTheApiSaysWhatIsWrong:
    def test_apply_is_refused_when_the_owner_has_no_token(self, test_app, db_session, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            repo = _owner_repo(db_session, token=None)
            from models.schemas import Repository

            # The test client is the default user; give it this repository.
            from tests.conftest import DEFAULT_USER_ID

            row = db_session.get(Repository, repo.id)
            row.owner_id = DEFAULT_USER_ID
            db_session.add(row)
            db_session.commit()
            pipeline = seed_pipeline(db_session, repo.id, status="failed")
            insight = seed_insight(db_session, pipeline.id)

            resp = test_app.post(f"/pipelines/{pipeline.id}/insights/{insight.id}/apply")
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 424
        assert "no GitHub token" in resp.json()["detail"]

    def test_a_repository_is_not_registered_on_the_servers_token(
        self, test_app, db_session, mock_github_create_webhook
    ):
        """The default user has no token of their own; the server has GITHUB_TOKEN set."""
        resp = test_app.post("/repos", json={"github_url": "https://github.com/a/someone-elses"})

        assert resp.status_code == 400
        assert "Settings" in resp.json()["detail"]
        mock_github_create_webhook.assert_not_called()

    def test_run_with_an_expired_token_is_a_readable_424_not_a_502(self, test_app, db_session):
        repo = seed_repo_in_project(db_session)
        runner = MagicMock()
        runner.run = AsyncMock()
        with (
            patch("core.github.list_branches", new=AsyncMock(side_effect=_refusal(401))),
            patch("core.pipeline.get_pipeline_runner", return_value=runner),
        ):
            resp = test_app.post(f"/repos/{repo.id}/trigger", json={"branch": ""})

        assert resp.status_code == 424
        assert "expired or was revoked" in resp.json()["detail"]
        runner.run.assert_not_called()
