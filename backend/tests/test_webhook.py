"""Tests for the GitHub webhook endpoint (/webhook/github).

Covers signature verification, event filtering, branch matching,
notebook file detection, and pipeline record creation.
"""
from __future__ import annotations

import json

from sqlmodel import select

from models.schemas import Pipeline, Project
from tests.conftest import make_webhook_signature, seed_project, seed_repo, seed_repo_in_project


class TestGithubWebhook:
    """POST /webhook/github"""

    def test_receive_push_when_valid_signature_should_queue_pipeline(
        self,
        test_app,
        db_session,
        sample_webhook_payload,
        mock_pipeline_runner,
    ):
        repo = seed_repo_in_project(db_session)
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
        repo = seed_repo_in_project(db_session)

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
        repo = seed_repo_in_project(db_session)

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

        repo = seed_repo_in_project(db_session)
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
        """Ping events should be acknowledged with 200 and an 'ignored' detail message."""
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


class TestProjectRequirement:
    """A push only runs a pipeline for a repository inside an active project."""

    def _push(self, test_app, payload):
        body = json.dumps(payload).encode()
        return test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": make_webhook_signature(body),
                "X-GitHub-Event": "push",
            },
        )

    def test_push_to_a_repository_without_project_is_ignored(
        self, test_app, db_session, sample_webhook_payload, mock_pipeline_runner
    ):
        seed_repo(db_session)

        resp = self._push(test_app, sample_webhook_payload)

        assert resp.status_code == 200
        assert "not in a project" in resp.json()["detail"]
        mock_pipeline_runner.run.assert_not_awaited()

    def test_push_to_a_repository_in_an_archived_project_is_ignored(
        self, test_app, db_session, sample_webhook_payload, mock_pipeline_runner
    ):
        repo = seed_repo_in_project(db_session)
        project = db_session.exec(select(Project).where(Project.repo_id == repo.id)).one()
        project.is_active = False
        db_session.add(project)
        db_session.commit()

        resp = self._push(test_app, sample_webhook_payload)

        assert resp.status_code == 200
        mock_pipeline_runner.run.assert_not_awaited()


class TestNotebookLinks:
    """A push runs the linked notebooks it changed, each in its own project."""

    _push = TestProjectRequirement._push

    def _project(self, db_session, name: str, repo_id: int, notebook_path: str) -> Project:
        project = seed_project(db_session, name=name)
        project.repo_id = repo_id
        project.notebook_path = notebook_path
        db_session.add(project)
        db_session.commit()
        return project

    def test_only_the_changed_notebook_runs(
        self, test_app, db_session, sample_webhook_payload, mock_pipeline_runner
    ):
        repo = seed_repo(db_session)
        self._project(db_session, "Untouched", repo.id, "notebooks/other.ipynb")

        resp = self._push(test_app, sample_webhook_payload)

        assert resp.status_code == 200
        assert "No notebook files modified" in resp.json()["detail"]
        mock_pipeline_runner.run.assert_not_awaited()

    def test_each_changed_notebook_runs_in_its_own_project(
        self, test_app, db_session, sample_webhook_payload, mock_pipeline_runner
    ):
        repo = seed_repo(db_session)
        first = self._project(db_session, "First", repo.id, "notebooks/train.ipynb")
        second = self._project(db_session, "Second", repo.id, "notebooks/eval.ipynb")
        sample_webhook_payload["commits"][0]["modified"] = ["notebooks/eval.ipynb"]

        resp = self._push(test_app, sample_webhook_payload)

        assert resp.status_code == 202
        runs = [db_session.get(Pipeline, pid) for pid in resp.json()["pipeline_ids"]]
        assert {(r.project_id, r.notebook_path) for r in runs} == {
            (first.id, "notebooks/train.ipynb"),
            (second.id, "notebooks/eval.ipynb"),
        }
        assert mock_pipeline_runner.run.await_count == 2
