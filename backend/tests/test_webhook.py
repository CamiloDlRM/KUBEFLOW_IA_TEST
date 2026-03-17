"""Tests for the GitHub webhook endpoint (/webhook/github).

Covers signature verification, event filtering, branch matching,
notebook file detection, and pipeline record creation.
"""
from __future__ import annotations

import asyncio
import json

from tests.conftest import make_webhook_signature, seed_pipeline, seed_repo


def _run(coro):
    """Helper to run async coroutines in sync tests."""
    return asyncio.get_event_loop().run_until_complete(coro)


class TestGithubWebhook:
    """POST /webhook/github"""

    def test_receive_push_when_valid_signature_should_queue_pipeline(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        _run(seed_repo(mock_roble_client))
        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "queued"
        assert "pipeline_id" in data
        mock_pipeline_runner.run.assert_awaited_once()

    def test_receive_push_when_invalid_signature_should_return_401(
        self,
        test_app,
        sample_webhook_payload,
    ):
        body = json.dumps(sample_webhook_payload).encode()

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": "sha256=invalidsignature",
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 401
        assert "Invalid webhook signature" in resp.json()["detail"]

    def test_receive_push_when_no_ipynb_in_changed_files_should_return_200_skipped(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
    ):
        _run(seed_repo(mock_roble_client))

        # Modify payload to have no notebook changes
        sample_webhook_payload["commits"][0]["added"] = ["README.md"]
        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 200
        assert "No notebook files modified" in resp.json()["detail"]

    def test_receive_push_when_wrong_branch_should_return_200_skipped(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
    ):
        _run(seed_repo(mock_roble_client))

        # Push to a different branch than the monitored one
        sample_webhook_payload["ref"] = "refs/heads/develop"
        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 200
        assert "ignored" in resp.json()["detail"].lower()

    def test_receive_push_when_valid_event_should_create_pipeline_record(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        _run(seed_repo(mock_roble_client))
        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        pipeline_id = resp.json()["pipeline_id"]

        # Verify pipeline was persisted in mock ROBLE
        pipelines = _run(mock_roble_client.read("pipelines", {"pipeline_uuid": pipeline_id}))
        assert len(pipelines) == 1
        assert pipelines[0]["status"] == "queued"
        assert pipelines[0]["commit_sha"] == sample_webhook_payload["after"]

    def test_receive_push_when_ping_event_should_be_ignored(
        self,
        test_app,
    ):
        body = json.dumps({"zen": "test"}).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "ping",
            },
        )

        assert resp.status_code == 200
        assert "ignored" in resp.json()["detail"].lower()

    def test_receive_push_when_missing_signature_should_return_401(
        self,
        test_app,
        sample_webhook_payload,
    ):
        body = json.dumps(sample_webhook_payload).encode()

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 401

    def test_receive_push_when_no_matching_repo_should_return_404(
        self,
        test_app,
        sample_webhook_payload,
    ):
        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 404
        assert "No registered repository" in resp.json()["detail"]

    def test_receive_push_when_duplicate_commit_queued_should_return_already_queued(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        """Deduplication: if a pipeline for the same commit is already queued,
        the endpoint should return 'already_queued' instead of creating a new one."""
        repo = _run(seed_repo(mock_roble_client))
        commit_sha = sample_webhook_payload["after"]

        # Pre-seed a queued pipeline for the same commit
        _run(seed_pipeline(
            mock_roble_client,
            repo["_id"],
            commit_sha=commit_sha,
            status="queued",
        ))

        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "already_queued"
        # Pipeline runner should NOT have been called again
        mock_pipeline_runner.run.assert_not_awaited()

    def test_receive_push_when_duplicate_commit_running_should_return_already_queued(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        """If a pipeline for the same commit is already running,
        the endpoint should return 'already_queued'."""
        repo = _run(seed_repo(mock_roble_client))
        commit_sha = sample_webhook_payload["after"]

        _run(seed_pipeline(
            mock_roble_client,
            repo["_id"],
            commit_sha=commit_sha,
            status="running",
        ))

        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        assert resp.json()["status"] == "already_queued"

    def test_receive_push_when_previous_commit_completed_should_queue_new(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        """If a pipeline for the same commit already completed (success/failed),
        a new push should create a new pipeline."""
        repo = _run(seed_repo(mock_roble_client))
        commit_sha = sample_webhook_payload["after"]

        # Pre-seed a completed pipeline for same commit
        _run(seed_pipeline(
            mock_roble_client,
            repo["_id"],
            commit_sha=commit_sha,
            status="success",
        ))

        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        assert resp.json()["status"] == "queued"
        mock_pipeline_runner.run.assert_awaited_once()

    def test_receive_push_when_modified_ipynb_should_trigger_pipeline(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        """Modified (not just added) .ipynb files should also trigger."""
        _run(seed_repo(mock_roble_client))

        sample_webhook_payload["commits"][0]["added"] = []
        sample_webhook_payload["commits"][0]["modified"] = ["notebooks/train.ipynb"]

        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        assert resp.json()["status"] == "queued"

    def test_receive_push_when_inactive_repo_should_return_404(
        self,
        test_app,
        mock_roble_client,
        sample_webhook_payload,
    ):
        """Inactive repositories should not match webhook events."""
        _run(seed_repo(mock_roble_client, is_active=False))

        body = json.dumps(sample_webhook_payload).encode()
        sig = make_webhook_signature(body)

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": sig,
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 404
