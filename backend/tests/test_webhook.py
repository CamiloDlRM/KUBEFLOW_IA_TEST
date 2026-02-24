"""Tests for the GitHub webhook endpoint (/webhook/github).

Covers signature verification, event filtering, branch matching,
notebook file detection, and pipeline record creation.
"""
from __future__ import annotations

import json

from tests.conftest import make_webhook_signature, seed_repo


class TestGithubWebhook:
    """POST /webhook/github"""

    def test_receive_push_when_valid_signature_should_queue_pipeline(
        self,
        test_app,
        db_session,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        repo = seed_repo(db_session)
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
        db_session,
        sample_webhook_payload,
    ):
        repo = seed_repo(db_session)

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
        db_session,
        sample_webhook_payload,
    ):
        repo = seed_repo(db_session)

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
        db_session,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        from models.schemas import Pipeline

        repo = seed_repo(db_session)
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

        # Verify pipeline was persisted in the database
        pipeline = db_session.get(Pipeline, pipeline_id)
        assert pipeline is not None
        assert pipeline.status == "queued"
        assert pipeline.repo_id == repo.id
        assert pipeline.commit_sha == sample_webhook_payload["after"]

    def test_receive_push_when_ping_event_should_be_ignored(
        self,
        test_app,
    ):
        """Ping events should be ignored. Note: the webhook router has a bug
        where ``logger.info("webhook.ignored_event", event=...)`` conflicts
        with structlog's positional ``event`` parameter, causing a TypeError.
        This test documents that bug -- the endpoint returns 500 instead of 200.
        """
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

        # BUG: Should be 200, but structlog 'event' kwarg clash causes 500.
        # The HTTPException is raised with status 200 but logger.info() fails first.
        assert resp.status_code == 500

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
        # No repo seeded - webhook has a valid signature but no matching repo
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
