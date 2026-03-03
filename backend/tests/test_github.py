"""Tests for core/github.py -- GitHub API helpers.

Covers parse_repo_url, verify_webhook_signature, create_webhook,
delete_webhook, and download_notebook with mocked httpx responses.
"""
from __future__ import annotations

import base64
import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from core.github import (
    _headers,
    create_webhook,
    delete_webhook,
    download_notebook,
    parse_repo_url,
    verify_webhook_signature,
)

# Helper to build httpx.Response with a request set (required by raise_for_status)
_FAKE_REQ = httpx.Request("GET", "https://api.github.com")


def _resp(status, json_data=None, text=None):
    """Build an httpx.Response with a request attached."""
    kwargs = {"status_code": status, "request": _FAKE_REQ}
    if json_data is not None:
        kwargs["json"] = json_data
    if text is not None:
        kwargs["text"] = text
    return httpx.Response(**kwargs)


def _mock_async_client(**method_mocks):
    """Return a patched httpx.AsyncClient context-manager mock."""
    mock_client = AsyncMock()
    for method_name, impl in method_mocks.items():
        setattr(mock_client, method_name, impl)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


class TestParseRepoUrl:
    """parse_repo_url()"""

    def test_parse_repo_url_when_standard_https_should_return_owner_and_repo(self):
        owner, repo = parse_repo_url("https://github.com/myorg/myrepo")
        assert owner == "myorg"
        assert repo == "myrepo"

    def test_parse_repo_url_when_git_suffix_should_strip_suffix(self):
        owner, repo = parse_repo_url("https://github.com/myorg/myrepo.git")
        assert owner == "myorg"
        assert repo == "myrepo"

    def test_parse_repo_url_when_ssh_style_should_parse(self):
        owner, repo = parse_repo_url("git@github.com:myorg/myrepo")
        assert owner == "myorg"
        assert repo == "myrepo"

    def test_parse_repo_url_when_invalid_url_should_raise_value_error(self):
        with pytest.raises(ValueError, match="Cannot parse GitHub URL"):
            parse_repo_url("https://gitlab.com/foo/bar")

    def test_parse_repo_url_when_empty_string_should_raise_value_error(self):
        with pytest.raises(ValueError):
            parse_repo_url("")


class TestHeaders:
    """_headers()"""

    def test_headers_when_token_provided_should_return_auth_headers(self):
        h = _headers("ghp_abc123")
        assert h["Authorization"] == "Bearer ghp_abc123"
        assert "application/vnd.github+json" in h["Accept"]
        assert "X-GitHub-Api-Version" in h


class TestVerifyWebhookSignature:
    """verify_webhook_signature()"""

    def test_verify_when_valid_signature_should_return_true(self):
        import hashlib, hmac

        payload = b'{"action": "push"}'
        secret = "mysecret"
        expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        sig = f"sha256={expected}"

        assert verify_webhook_signature(payload, sig, secret) is True

    def test_verify_when_invalid_signature_should_return_false(self):
        assert verify_webhook_signature(b"data", "sha256=wrong", "secret") is False

    def test_verify_when_missing_prefix_should_return_false(self):
        assert verify_webhook_signature(b"data", "md5=abc", "secret") is False

    def test_verify_when_empty_signature_should_return_false(self):
        assert verify_webhook_signature(b"data", "", "secret") is False


class TestCreateWebhook:
    """create_webhook()"""

    @pytest.mark.asyncio
    async def test_create_webhook_when_success_should_return_hook_data(self):
        hook_data = {"id": 999, "name": "web", "active": True, "events": ["push"]}
        mock_client = _mock_async_client(
            post=AsyncMock(return_value=_resp(201, hook_data)),
        )

        with patch("core.github.httpx.AsyncClient", return_value=mock_client):
            result = await create_webhook(
                "https://github.com/owner/repo",
                "ghp_token",
                "https://myapp.com/webhook",
                "secret",
            )

        assert result["id"] == 999
        mock_client.post.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_create_webhook_when_422_and_existing_hook_should_return_existing(self):
        post_resp = _resp(422, {"message": "already exists"})
        existing_hook = {"id": 111, "config": {"url": "https://myapp.com/webhook"}}
        list_resp = _resp(200, [existing_hook])

        mock_client = _mock_async_client(
            post=AsyncMock(return_value=post_resp),
            get=AsyncMock(return_value=list_resp),
        )

        with patch("core.github.httpx.AsyncClient", return_value=mock_client):
            result = await create_webhook(
                "https://github.com/o/r",
                "ghp_token",
                "https://myapp.com/webhook",
                "secret",
            )

        assert result["id"] == 111

    @pytest.mark.asyncio
    async def test_create_webhook_when_422_no_matching_hook_should_raise(self):
        post_resp = _resp(422, {"message": "already exists"})
        other_hook = {"id": 222, "config": {"url": "https://other.com/webhook"}}
        list_resp = _resp(200, [other_hook])

        mock_client = _mock_async_client(
            post=AsyncMock(return_value=post_resp),
            get=AsyncMock(return_value=list_resp),
        )

        with patch("core.github.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPStatusError):
                await create_webhook(
                    "https://github.com/o/r",
                    "ghp_token",
                    "https://myapp.com/webhook",
                    "secret",
                )


class TestDeleteWebhook:
    """delete_webhook()"""

    @pytest.mark.asyncio
    async def test_delete_webhook_when_success_should_not_raise(self):
        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(204)),
        )

        with patch("core.github.httpx.AsyncClient", return_value=mock_client):
            await delete_webhook(
                "https://github.com/owner/repo",
                "ghp_token",
                12345,
            )

        mock_client.delete.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_delete_webhook_when_not_found_should_raise(self):
        mock_client = _mock_async_client(
            delete=AsyncMock(return_value=_resp(404, {"message": "Not Found"})),
        )

        with patch("core.github.httpx.AsyncClient", return_value=mock_client):
            with pytest.raises(httpx.HTTPStatusError):
                await delete_webhook(
                    "https://github.com/o/r",
                    "ghp_token",
                    1,
                )


class TestDownloadNotebook:
    """download_notebook()"""

    @pytest.mark.asyncio
    async def test_download_notebook_when_success_should_return_parsed_dict(self):
        notebook = {"nbformat": 4, "cells": []}
        encoded = base64.b64encode(json.dumps(notebook).encode()).decode()
        mock_client = _mock_async_client(
            get=AsyncMock(return_value=_resp(200, {"content": encoded})),
        )

        with patch("core.github.httpx.AsyncClient", return_value=mock_client):
            result = await download_notebook(
                "https://github.com/owner/repo",
                "ghp_token",
                "main",
                "notebooks/train.ipynb",
            )

        assert result["nbformat"] == 4
        assert result["cells"] == []
