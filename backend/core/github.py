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


async def _find_existing_webhook(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    webhook_url: str,
    token: str,
) -> dict[str, Any] | None:
    """Return the existing webhook for ``webhook_url``, or None."""
    resp = await client.get(
        f"{_GITHUB_API}/repos/{owner}/{repo}/hooks",
        headers=_headers(token),
    )
    resp.raise_for_status()
    for hook in resp.json():
        if hook.get("config", {}).get("url") == webhook_url:
            return hook
    return None


async def create_webhook(
    repo_url: str,
    token: str,
    webhook_url: str,
    secret: str,
) -> dict[str, Any]:
    """Create a push-event webhook on the repository.

    If a webhook for ``webhook_url`` already exists, returns it without error.
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
            logger.info(
                "github.webhook_already_exists",
                owner=owner,
                repo=repo,
                webhook_url=webhook_url,
            )
            existing = await _find_existing_webhook(client, owner, repo, webhook_url, token)
            if existing:
                return existing
            logger.error(
                "github.webhook_creation_http_error",
                status=resp.status_code,
                body=resp.text,
                owner=owner,
                repo=repo,
            )
            resp.raise_for_status()

        if not resp.is_success:
            logger.error(
                "github.webhook_creation_http_error",
                status=resp.status_code,
                body=resp.text,
                owner=owner,
                repo=repo,
            )
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


async def list_branches(
    repo_url: str,
    token: str,
) -> list[dict[str, str]]:
    """List branches of the repository as ``{name, commit_sha}`` dicts."""
    owner, repo = parse_repo_url(repo_url)
    url = f"{_GITHUB_API}/repos/{owner}/{repo}/branches"
    branches: list[dict[str, str]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        page = 1
        while True:
            resp = await client.get(
                url,
                headers=_headers(token),
                params={"per_page": 100, "page": page},
            )
            resp.raise_for_status()
            batch = resp.json()
            branches.extend(
                {"name": b["name"], "commit_sha": b["commit"]["sha"]} for b in batch
            )
            if len(batch) < 100:
                break
            page += 1
    return branches


# ---------------------------------------------------------------------------
# Sync helpers (used from Celery workers)
# ---------------------------------------------------------------------------

def get_branch_head(repo_url: str, token: str, branch: str) -> str:
    """Return the HEAD commit SHA of a branch (sync)."""
    owner, repo = parse_repo_url(repo_url)
    resp = httpx.get(
        f"{_GITHUB_API}/repos/{owner}/{repo}/git/ref/heads/{branch}",
        headers=_headers(token),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["object"]["sha"]


def upsert_branch(repo_url: str, token: str, branch: str, sha: str) -> None:
    """Create ``branch`` pointing at ``sha``, or force-move it if it exists (sync)."""
    owner, repo = parse_repo_url(repo_url)
    create = httpx.post(
        f"{_GITHUB_API}/repos/{owner}/{repo}/git/refs",
        headers=_headers(token),
        json={"ref": f"refs/heads/{branch}", "sha": sha},
        timeout=30,
    )
    if create.status_code == 422:
        # Branch already exists — move it to the new base commit
        update = httpx.patch(
            f"{_GITHUB_API}/repos/{owner}/{repo}/git/refs/heads/{branch}",
            headers=_headers(token),
            json={"sha": sha, "force": True},
            timeout=30,
        )
        update.raise_for_status()
        logger.info("github.branch_reset", branch=branch, sha=sha)
        return
    create.raise_for_status()
    logger.info("github.branch_created", branch=branch, sha=sha)


def commit_file(
    repo_url: str,
    token: str,
    branch: str,
    path: str,
    content: bytes,
    message: str,
) -> str:
    """Create or update ``path`` on ``branch`` via the Contents API (sync).

    Returns the SHA of the new commit.
    """
    import base64

    owner, repo = parse_repo_url(repo_url)
    contents_url = f"{_GITHUB_API}/repos/{owner}/{repo}/contents/{path.strip('/')}"

    # Fetch the current blob SHA on the target branch (required for updates)
    existing = httpx.get(
        contents_url,
        headers=_headers(token),
        params={"ref": branch},
        timeout=30,
    )
    payload: dict[str, Any] = {
        "message": message,
        "content": base64.b64encode(content).decode(),
        "branch": branch,
    }
    if existing.status_code == 200:
        payload["sha"] = existing.json()["sha"]

    resp = httpx.put(contents_url, headers=_headers(token), json=payload, timeout=60)
    resp.raise_for_status()
    commit_sha: str = resp.json()["commit"]["sha"]
    logger.info(
        "github.file_committed",
        owner=owner,
        repo=repo,
        branch=branch,
        path=path,
        commit_sha=commit_sha,
    )
    return commit_sha


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
