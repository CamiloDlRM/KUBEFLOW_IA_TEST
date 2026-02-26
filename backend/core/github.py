"""GitHub API integration helpers.

Handles webhook CRUD, notebook download, and signature verification.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)

_GITHUB_API = "https://api.github.com"


def parse_repo_url(github_url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL.

    Supports https://github.com/owner/repo and
    https://github.com/owner/repo.git variants.

    Raises:
        ValueError: If the URL does not match the expected pattern.
    """
    pattern = r"github\.com[/:](?P<owner>[^/]+)/(?P<repo>[^/.]+)"
    match = re.search(pattern, github_url)
    if not match:
        raise ValueError(f"Cannot parse GitHub URL: {github_url}")
    return match.group("owner"), match.group("repo")


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def create_webhook(
    repo_url: str,
    token: str,
    webhook_url: str,
    secret: str,
) -> dict[str, Any]:
    """Create a push-event webhook on the repository.

    Returns the GitHub API response body (includes ``id``).
    """
    owner, repo = parse_repo_url(repo_url)
    url = f"{_GITHUB_API}/repos/{owner}/{repo}/hooks"
    payload = {
        "name": "web",
        "active": True,
        "events": ["push"],
        "config": {
            "url": webhook_url,
            "content_type": "json",
            "secret": secret,
            "insecure_ssl": "0",
        },
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json=payload, headers=_headers(token))
        if resp.status_code == 422:
            # Webhook already exists — find and return it
            list_resp = await client.get(url, headers=_headers(token))
            list_resp.raise_for_status()
            for hook in list_resp.json():
                if hook.get("config", {}).get("url") == webhook_url:
                    logger.info(
                        "github.webhook_already_exists",
                        owner=owner,
                        repo=repo,
                        hook_id=hook.get("id"),
                    )
                    return hook
            resp.raise_for_status()
        else:
            resp.raise_for_status()
        data: dict[str, Any] = resp.json()
        logger.info(
            "github.webhook_created",
            owner=owner,
            repo=repo,
            hook_id=data.get("id"),
        )
        return data


async def delete_webhook(
    repo_url: str,
    token: str,
    webhook_id: int,
) -> None:
    """Delete a webhook from the repository."""
    owner, repo = parse_repo_url(repo_url)
    url = f"{_GITHUB_API}/repos/{owner}/{repo}/hooks/{webhook_id}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(url, headers=_headers(token))
        resp.raise_for_status()
        logger.info(
            "github.webhook_deleted",
            owner=owner,
            repo=repo,
            hook_id=webhook_id,
        )


async def download_notebook(
    repo_url: str,
    token: str,
    branch: str,
    notebook_path: str,
) -> dict[str, Any]:
    """Download a notebook file from the repository via the Contents API.

    Returns the parsed notebook dict (nbformat structure).
    """
    import base64
    import json

    owner, repo = parse_repo_url(repo_url)
    url = f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{notebook_path}"
    params = {"ref": branch}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url, headers=_headers(token), params=params)
        resp.raise_for_status()
        content_b64: str = resp.json()["content"]
        raw = base64.b64decode(content_b64)
        notebook: dict[str, Any] = json.loads(raw)
        logger.info(
            "github.notebook_downloaded",
            owner=owner,
            repo=repo,
            path=notebook_path,
            branch=branch,
        )
        return notebook


def verify_webhook_signature(
    payload: bytes,
    signature: str,
    secret: str,
) -> bool:
    """Verify a GitHub webhook HMAC-SHA256 signature.

    Args:
        payload: Raw request body bytes.
        signature: Value of the ``X-Hub-Signature-256`` header (``sha256=...``).
        secret: The shared webhook secret.

    Returns:
        True if the signature is valid, False otherwise.
    """
    if not signature.startswith("sha256="):
        return False
    expected = hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
