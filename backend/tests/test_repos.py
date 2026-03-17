"""Tests for the repository management endpoints (/repos).

Covers CRUD operations and webhook lifecycle.
"""
from __future__ import annotations

import asyncio

from tests.conftest import seed_repo


def _run(coro):
    """Helper to run async coroutines in sync tests."""
    return asyncio.get_event_loop().run_until_complete(coro)


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
        from main import app
        from core.config import AppSettings, get_settings

        fake_settings = AppSettings(
            github_token="",
            github_webhook_secret="test-secret",
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
        mock_roble_client,
    ):
        _run(seed_repo(mock_roble_client, github_url="https://github.com/user/repo1"))
        _run(seed_repo(mock_roble_client, github_url="https://github.com/user/repo2"))

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
        mock_roble_client,
        mock_github_delete_webhook,
    ):
        repo = _run(seed_repo(mock_roble_client))

        resp = test_app.delete(f"/repos/{repo['_id']}")

        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()

    def test_delete_repo_when_not_found_should_return_404(
        self,
        test_app,
    ):
        resp = test_app.delete("/repos/nonexistent_id")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_delete_repo_when_webhook_delete_fails_should_still_delete_repo(
        self,
        test_app,
        mock_roble_client,
        mock_github_delete_webhook,
    ):
        mock_github_delete_webhook.side_effect = Exception("GitHub unreachable")
        repo = _run(seed_repo(mock_roble_client))

        resp = test_app.delete(f"/repos/{repo['_id']}")

        # Should still succeed - webhook deletion failure is non-fatal
        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"].lower()

    def test_delete_repo_when_exists_should_remove_from_roble(
        self,
        test_app,
        mock_roble_client,
        mock_github_delete_webhook,
    ):
        repo = _run(seed_repo(mock_roble_client))
        repo_id = repo["_id"]

        test_app.delete(f"/repos/{repo_id}")

        # Verify the repo no longer exists in ROBLE
        remaining = _run(mock_roble_client.read("repositories"))
        assert all(r["_id"] != repo_id for r in remaining)


class TestCreateRepoEdgeCases:
    """Edge cases for POST /repos"""

    def test_create_repo_when_empty_notebook_path_should_return_422(
        self,
        test_app,
        mock_github_create_webhook,
    ):
        resp = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/repo",
                "github_token": "ghp_testtoken1234",
                "branch": "main",
                "notebook_path": "   ",
            },
        )

        assert resp.status_code == 422
        assert "notebook_path" in resp.json()["detail"].lower()

    def test_create_repo_when_uses_env_token_should_succeed(
        self,
        test_app,
        mock_github_create_webhook,
    ):
        """When no github_token is provided in body, settings.github_token is used."""
        resp = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/envtokenrepo",
                "branch": "main",
                "notebook_path": "train.ipynb",
            },
        )

        assert resp.status_code == 201
        mock_github_create_webhook.assert_awaited_once()

    def test_create_repo_when_token_masked_correctly_should_show_last_four(
        self,
        test_app,
        mock_roble_client,
        mock_github_create_webhook,
    ):
        resp = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/maskedrepo",
                "github_token": "ghp_abcdefghijklmno",
                "branch": "main",
                "notebook_path": "train.ipynb",
            },
        )

        assert resp.status_code == 201

        # Verify the masked token in ROBLE
        repos = _run(mock_roble_client.read("repositories"))
        created = [r for r in repos if r["github_url"] == "https://github.com/testuser/maskedrepo"]
        assert len(created) == 1
        assert created[0]["github_token_masked"] == "****lmno"
