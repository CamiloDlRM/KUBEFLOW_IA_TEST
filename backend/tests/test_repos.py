"""Tests for the repository management endpoints (/repos).

Covers CRUD operations and webhook lifecycle.
"""
from __future__ import annotations

from tests.conftest import seed_repo


class TestCreateRepo:
    """POST /repos"""

    def test_create_repo_when_valid_data_should_create_webhook_and_return_201(
        self,
        test_app,
        mock_github_create_webhook,
    ):
        resp = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/newrepo",
                "github_token": "ghp_testtoken1234",
                "branch": "main",
                "notebook_path": "notebooks/train.ipynb",
            },
        )

        assert resp.status_code == 201
        data = resp.json()
        assert "repo_id" in data
        assert "webhook_url" in data
        assert data["status"] == "webhook_created"
        mock_github_create_webhook.assert_awaited_once()

    def test_create_repo_when_github_api_fails_should_return_502(
        self,
        test_app,
        mock_github_create_webhook,
    ):
        mock_github_create_webhook.side_effect = Exception("GitHub API error")

        resp = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/failrepo",
                "github_token": "ghp_testtoken1234",
                "branch": "main",
                "notebook_path": "notebooks/train.ipynb",
            },
        )

        assert resp.status_code == 502
        assert "Failed to create GitHub webhook" in resp.json()["detail"]

    def test_create_repo_when_no_token_should_return_400(
        self,
        test_app,
        mock_github_create_webhook,
    ):
        """When neither body token nor env GITHUB_TOKEN is provided,
        the endpoint should return 400.

        Override the settings dependency to return empty github_token.
        """
        from main import app
        from core.config import AppSettings, get_settings

        fake_settings = AppSettings(
            github_token="",
            github_webhook_secret="test-secret",
            database_url="sqlite://",
        )
        app.dependency_overrides[get_settings] = lambda: fake_settings

        try:
            resp = test_app.post(
                "/repos",
                json={
                    "github_url": "https://github.com/testuser/norepo",
                    "github_token": "",
                    "branch": "main",
                    "notebook_path": "notebooks/train.ipynb",
                },
            )

            assert resp.status_code == 400
            assert "token" in resp.json()["detail"].lower()
        finally:
            app.dependency_overrides.pop(get_settings, None)


class TestListRepos:
    """GET /repos"""

    def test_list_repos_when_repos_exist_should_return_list(
        self,
        test_app,
        db_session,
    ):
        seed_repo(db_session, github_url="https://github.com/user/repo1")
        seed_repo(db_session, github_url="https://github.com/user/repo2")

        resp = test_app.get("/repos")

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 2
        urls = [r["github_url"] for r in data]
        assert "https://github.com/user/repo1" in urls
        assert "https://github.com/user/repo2" in urls

    def test_list_repos_when_empty_should_return_empty_list(
        self,
        test_app,
    ):
        resp = test_app.get("/repos")

        assert resp.status_code == 200
        assert resp.json() == []


class TestDeleteRepo:
    """DELETE /repos/{repo_id}"""

    def test_delete_repo_when_exists_should_delete_webhook_and_return_200(
        self,
        test_app,
        db_session,
        mock_github_delete_webhook,
    ):
        repo = seed_repo(db_session)

        resp = test_app.delete(f"/repos/{repo.id}")

        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()

    def test_delete_repo_when_not_found_should_return_404(
        self,
        test_app,
    ):
        resp = test_app.delete("/repos/99999")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_delete_repo_when_webhook_delete_fails_should_still_delete_repo(
        self,
        test_app,
        db_session,
        mock_github_delete_webhook,
    ):
        mock_github_delete_webhook.side_effect = Exception("GitHub unreachable")
        repo = seed_repo(db_session)

        resp = test_app.delete(f"/repos/{repo.id}")

        # Should still succeed - webhook deletion failure is non-fatal
        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()
