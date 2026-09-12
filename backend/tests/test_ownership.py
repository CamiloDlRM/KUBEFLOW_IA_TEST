"""Multi-tenancy tests: a member only ever sees their own resources.

Every user-facing resource hangs off a repository, so the rule under test is
always the same one::

    member -> only repositories where owner_id == user.id (and everything
              derived from them)
    admin  -> everything

The negative cases assert **404**, never 403: a repository owned by somebody
else must be indistinguishable from one that never existed, otherwise the
status code alone leaks how many repositories other tenants own and which ids
to probe next. See ``core.ownership`` for the rationale.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from tests.conftest import (
    DEFAULT_USER_ID,
    OTHER_USER_ID,
    seed_dataset,
    seed_model_deployment,
    seed_pipeline,
    seed_project,
    seed_repo,
)


def _seed_mine(session):
    """Seed a repository owned by the ``test_app`` member."""
    return seed_repo(
        session,
        owner_id=DEFAULT_USER_ID,
        github_url="https://github.com/mine/repo",
    )


def _seed_theirs(session):
    """Seed a repository owned by the *other* member."""
    return seed_repo(
        session,
        owner_id=OTHER_USER_ID,
        github_url="https://github.com/theirs/repo",
    )


def _project_mine(session):
    """Seed a project owned by the ``test_app`` member."""
    return seed_project(session, owner_id=DEFAULT_USER_ID, name="Mine")


def _project_theirs(session):
    """Seed a project owned by the *other* member."""
    return seed_project(session, owner_id=OTHER_USER_ID, name="Theirs")


# ---------------------------------------------------------------------------
# Repositories
# ---------------------------------------------------------------------------

class TestRepoOwnershipOnCreate:
    """POST /repos assigns the caller as owner."""

    def test_create_repo_should_set_owner_to_current_user(
        self, test_app, db_session, mock_github_create_webhook
    ):
        resp = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/brand-new",
                "github_token": "ghp_testtoken1234",
                "branch": "main",
                "notebook_path": "notebooks/train.ipynb",
            },
        )

        assert resp.status_code == 201

        from models.schemas import Repository

        repo = db_session.get(Repository, resp.json()["repo_id"])
        assert repo is not None
        assert repo.owner_id == DEFAULT_USER_ID

    def test_created_repo_should_be_invisible_to_another_member(
        self, test_app, other_member_app, mock_github_create_webhook
    ):
        created = test_app.post(
            "/repos",
            json={
                "github_url": "https://github.com/testuser/private-one",
                "github_token": "ghp_testtoken1234",
                "branch": "main",
                "notebook_path": "notebooks/train.ipynb",
            },
        )
        assert created.status_code == 201

        assert other_member_app.get("/repos").json() == []


class TestRepoListIsolation:
    """GET /repos"""

    def test_list_repos_should_only_return_own_repositories(
        self, test_app, db_session
    ):
        mine = _seed_mine(db_session)
        _seed_theirs(db_session)

        resp = test_app.get("/repos")

        assert resp.status_code == 200
        data = resp.json()
        assert [r["id"] for r in data] == [mine.id]
        assert data[0]["owner_id"] == DEFAULT_USER_ID

    def test_list_repos_should_hide_repos_from_the_other_members_side_too(
        self, other_member_app, db_session
    ):
        _seed_mine(db_session)
        theirs = _seed_theirs(db_session)

        data = other_member_app.get("/repos").json()

        assert [r["id"] for r in data] == [theirs.id]

    def test_admin_should_see_every_repository(self, admin_app, db_session):
        mine = _seed_mine(db_session)
        theirs = _seed_theirs(db_session)

        data = admin_app.get("/repos").json()

        assert {r["id"] for r in data} == {mine.id, theirs.id}

    def test_orphan_repo_should_be_hidden_from_members_and_visible_to_admins(
        self, test_app, admin_app, db_session
    ):
        """A row the 0007 backfill could not adopt (no admin at the time).

        It belongs to nobody, so it fails closed: admins only.
        """
        orphan = seed_repo(
            db_session, owner_id=None, github_url="https://github.com/legacy/repo"
        )

        assert test_app.get("/repos").json() == []
        assert [r["id"] for r in admin_app.get("/repos").json()] == [orphan.id]


class TestRepoAccessIsolation:
    """Per-repository endpoints answer 404 across the tenant boundary."""

    def test_delete_other_members_repo_should_return_404(
        self, test_app, db_session, mock_github_delete_webhook
    ):
        theirs = _seed_theirs(db_session)

        resp = test_app.delete(f"/repos/{theirs.id}")

        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_delete_other_members_repo_should_not_delete_the_row(
        self, test_app, db_session, mock_github_delete_webhook
    ):
        theirs = _seed_theirs(db_session)

        test_app.delete(f"/repos/{theirs.id}")

        from models.schemas import Repository

        assert db_session.get(Repository, theirs.id) is not None

    def test_delete_own_repo_should_succeed(
        self, test_app, db_session, mock_github_delete_webhook
    ):
        mine = _seed_mine(db_session)

        resp = test_app.delete(f"/repos/{mine.id}")

        assert resp.status_code == 200

    def test_admin_can_delete_any_repo(
        self, admin_app, db_session, mock_github_delete_webhook
    ):
        theirs = _seed_theirs(db_session)

        resp = admin_app.delete(f"/repos/{theirs.id}")

        assert resp.status_code == 200

    def test_branches_of_other_members_repo_should_return_404(
        self, test_app, db_session
    ):
        theirs = _seed_theirs(db_session)

        with patch(
            "core.github.list_branches",
            new=AsyncMock(return_value=[{"name": "main", "commit_sha": "aaa"}]),
        ) as branches:
            resp = test_app.get(f"/repos/{theirs.id}/branches")

        assert resp.status_code == 404
        # The ownership check must short-circuit *before* GitHub is contacted.
        branches.assert_not_awaited()

    def test_branches_of_own_repo_should_succeed(self, test_app, db_session):
        mine = _seed_mine(db_session)

        with patch(
            "core.github.list_branches",
            new=AsyncMock(return_value=[{"name": "main", "commit_sha": "aaa"}]),
        ):
            resp = test_app.get(f"/repos/{mine.id}/branches")

        assert resp.status_code == 200
        assert [b["name"] for b in resp.json()] == ["main"]

    def test_trigger_on_other_members_repo_should_return_404(
        self, test_app, db_session
    ):
        theirs = _seed_theirs(db_session)
        runner = MagicMock()
        runner.run = AsyncMock()

        with (
            patch(
                "core.github.list_branches",
                new=AsyncMock(return_value=[{"name": "main", "commit_sha": "abc123"}]),
            ),
            patch("core.pipeline.get_pipeline_runner", return_value=runner),
        ):
            resp = test_app.post(f"/repos/{theirs.id}/trigger", json={"branch": "main"})

        assert resp.status_code == 404
        runner.run.assert_not_awaited()


# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------

class TestPipelineIsolation:
    """GET /pipelines and GET /pipelines/{id}"""

    def test_list_pipelines_should_only_include_own_repos(self, test_app, db_session):
        mine = _seed_mine(db_session)
        theirs = _seed_theirs(db_session)
        own_run = seed_pipeline(db_session, mine.id, status="success")
        seed_pipeline(db_session, theirs.id, status="success")

        data = test_app.get("/pipelines").json()

        assert data["total"] == 1
        assert [p["id"] for p in data["items"]] == [own_run.id]

    def test_admin_should_list_every_pipeline(self, admin_app, db_session):
        mine = _seed_mine(db_session)
        theirs = _seed_theirs(db_session)
        seed_pipeline(db_session, mine.id)
        seed_pipeline(db_session, theirs.id)

        data = admin_app.get("/pipelines").json()

        assert data["total"] == 2

    def test_get_other_members_pipeline_should_return_404(self, test_app, db_session):
        theirs = _seed_theirs(db_session)
        run = seed_pipeline(db_session, theirs.id)

        resp = test_app.get(f"/pipelines/{run.id}")

        assert resp.status_code == 404

    def test_get_own_pipeline_should_succeed(self, test_app, db_session):
        mine = _seed_mine(db_session)
        run = seed_pipeline(db_session, mine.id, status="running")

        resp = test_app.get(f"/pipelines/{run.id}")

        assert resp.status_code == 200
        assert resp.json()["id"] == run.id

    def test_logs_of_other_members_pipeline_should_return_404(
        self, test_app, db_session
    ):
        theirs = _seed_theirs(db_session)
        run = seed_pipeline(db_session, theirs.id)

        redis_mock = MagicMock()
        redis_mock.lrange.return_value = []
        with patch("redis.Redis.from_url", return_value=redis_mock) as from_url:
            resp = test_app.get(f"/pipelines/{run.id}/logs")

        assert resp.status_code == 404
        from_url.assert_not_called()


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------

class TestDatasetIsolation:
    """Datasets inherit the visibility of their project."""

    def test_list_datasets_of_other_members_project_should_return_404(
        self, test_app, db_session
    ):
        theirs = _project_theirs(db_session)
        seed_dataset(db_session, theirs.id)

        resp = test_app.get(f"/projects/{theirs.id}/datasets")

        assert resp.status_code == 404

    def test_list_datasets_of_own_project_should_succeed(self, test_app, db_session):
        mine = _project_mine(db_session)
        dataset = seed_dataset(db_session, mine.id)

        resp = test_app.get(f"/projects/{mine.id}/datasets")

        assert resp.status_code == 200
        assert [d["id"] for d in resp.json()] == [dataset.id]

    def test_upload_to_other_members_project_should_return_404(
        self, test_app, db_session
    ):
        theirs = _project_theirs(db_session)

        resp = test_app.post(
            f"/projects/{theirs.id}/datasets",
            files={"file": ("train.csv", b"a,b\n1,2\n", "text/csv")},
        )

        assert resp.status_code == 404

    def test_activate_other_members_dataset_should_return_404(
        self, test_app, db_session
    ):
        theirs = _project_theirs(db_session)
        dataset = seed_dataset(db_session, theirs.id, is_active=False)

        resp = test_app.post(f"/datasets/{dataset.id}/activate")

        assert resp.status_code == 404

        from models.schemas import Dataset

        db_session.refresh(dataset)
        assert db_session.get(Dataset, dataset.id).is_active is False

    def test_delete_other_members_dataset_should_return_404(
        self, test_app, db_session
    ):
        theirs = _project_theirs(db_session)
        dataset = seed_dataset(db_session, theirs.id)

        with patch("routers.datasets.delete_object") as delete_object:
            resp = test_app.delete(f"/datasets/{dataset.id}")

        assert resp.status_code == 404
        delete_object.assert_not_called()

    def test_preview_other_members_dataset_should_return_404(
        self, test_app, db_session
    ):
        theirs = _project_theirs(db_session)
        dataset = seed_dataset(db_session, theirs.id)

        with patch("routers.datasets.download_to_path") as download:
            resp = test_app.get(f"/datasets/{dataset.id}/preview")

        assert resp.status_code == 404
        download.assert_not_called()

    def test_admin_can_see_any_dataset(self, admin_app, db_session):
        theirs = _project_theirs(db_session)
        dataset = seed_dataset(db_session, theirs.id)

        resp = admin_app.get(f"/projects/{theirs.id}/datasets")

        assert resp.status_code == 200
        assert [d["id"] for d in resp.json()] == [dataset.id]


# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

class TestInsightIsolation:
    """Insights inherit the visibility of their pipeline's repository."""

    def test_list_insights_of_other_members_pipeline_should_return_404(
        self, test_app, db_session
    ):
        from tests.test_insights import seed_insight

        theirs = _seed_theirs(db_session)
        run = seed_pipeline(db_session, theirs.id, status="success")
        seed_insight(db_session, run.id)

        resp = test_app.get(f"/pipelines/{run.id}/insights")

        assert resp.status_code == 404

    def test_list_insights_of_own_pipeline_should_succeed(self, test_app, db_session):
        from tests.test_insights import seed_insight

        mine = _seed_mine(db_session)
        run = seed_pipeline(db_session, mine.id, status="success")
        seed_insight(db_session, run.id)

        resp = test_app.get(f"/pipelines/{run.id}/insights")

        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_generate_insights_on_other_members_pipeline_should_return_404(
        self, test_app, db_session, monkeypatch
    ):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings

        get_settings.cache_clear()
        try:
            theirs = _seed_theirs(db_session)
            run = seed_pipeline(db_session, theirs.id, status="success")

            with patch("tasks.celery_tasks.analyze_pipeline") as mock_task:
                mock_task.apply_async = MagicMock()
                resp = test_app.post(f"/pipelines/{run.id}/insights")

            assert resp.status_code == 404
            mock_task.apply_async.assert_not_called()
        finally:
            get_settings.cache_clear()

    def test_apply_insight_on_other_members_pipeline_should_return_404(
        self, test_app, db_session, monkeypatch
    ):
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
        from core.config import get_settings
        from tests.test_insights import seed_insight

        get_settings.cache_clear()
        try:
            theirs = _seed_theirs(db_session)
            run = seed_pipeline(db_session, theirs.id, status="success")
            insight = seed_insight(db_session, run.id)

            with patch("tasks.celery_tasks.apply_insight") as mock_task:
                mock_task.apply_async = MagicMock()
                resp = test_app.post(
                    f"/pipelines/{run.id}/insights/{insight.id}/apply"
                )

            assert resp.status_code == 404
            mock_task.apply_async.assert_not_called()
        finally:
            get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Model deployments
# ---------------------------------------------------------------------------

class TestModelIsolation:
    """Deployments are owned through pipeline -> repository."""

    def test_list_models_should_only_include_own_deployments(
        self, test_app, db_session
    ):
        mine = _seed_mine(db_session)
        theirs = _seed_theirs(db_session)
        my_run = seed_pipeline(db_session, mine.id, status="success")
        their_run = seed_pipeline(db_session, theirs.id, status="success")
        seed_model_deployment(
            db_session, model_name="mine-model", pipeline_id=my_run.id
        )
        seed_model_deployment(
            db_session, model_name="theirs-model", pipeline_id=their_run.id
        )

        data = test_app.get("/models").json()

        assert [d["model_name"] for d in data] == ["mine-model"]

    def test_list_models_should_hide_legacy_deployments_without_pipeline(
        self, test_app, admin_app, db_session
    ):
        """No pipeline_id means no traceable owner, so it fails closed."""
        seed_model_deployment(db_session, model_name="orphan-model", pipeline_id=None)

        assert test_app.get("/models").json() == []
        assert [d["model_name"] for d in admin_app.get("/models").json()] == [
            "orphan-model"
        ]

    def test_admin_should_list_every_deployment(self, admin_app, db_session):
        theirs = _seed_theirs(db_session)
        their_run = seed_pipeline(db_session, theirs.id, status="success")
        seed_model_deployment(
            db_session, model_name="theirs-model", pipeline_id=their_run.id
        )

        data = admin_app.get("/models").json()

        assert [d["model_name"] for d in data] == ["theirs-model"]

    def test_predict_on_other_members_model_should_return_404(
        self, test_app, db_session
    ):
        theirs = _seed_theirs(db_session)
        their_run = seed_pipeline(db_session, theirs.id, status="success")
        seed_model_deployment(
            db_session, model_name="theirs-model", pipeline_id=their_run.id
        )

        with patch("routers.models.httpx.AsyncClient") as client_cls:
            resp = test_app.post(
                "/models/theirs-model/predict", json={"data": [[1.0]]}
            )

        assert resp.status_code == 404
        # The model-server must never be contacted for a foreign model.
        client_cls.assert_not_called()

    def test_rollback_on_other_members_model_should_return_404(
        self, test_app, db_session
    ):
        theirs = _seed_theirs(db_session)
        their_run = seed_pipeline(db_session, theirs.id, status="success")
        seed_model_deployment(
            db_session,
            model_name="theirs-model",
            version="1",
            pipeline_id=their_run.id,
            mlflow_run_id="run-x",
        )

        with patch("routers.models.httpx.AsyncClient") as client_cls:
            resp = test_app.post(
                "/models/theirs-model/rollback", json={"version": "1"}
            )

        assert resp.status_code == 404
        client_cls.assert_not_called()

    def test_delete_other_members_model_should_return_404(self, test_app, db_session):
        theirs = _seed_theirs(db_session)
        their_run = seed_pipeline(db_session, theirs.id, status="success")
        deployment = seed_model_deployment(
            db_session,
            model_name="theirs-model",
            pipeline_id=their_run.id,
            is_active=True,
        )

        with patch("routers.models.httpx.AsyncClient") as client_cls:
            resp = test_app.delete("/models/theirs-model")

        assert resp.status_code == 404
        client_cls.assert_not_called()

        from models.schemas import ModelDeployment

        db_session.refresh(deployment)
        assert db_session.get(ModelDeployment, deployment.id).is_active is True


# ---------------------------------------------------------------------------
# Regression guard
# ---------------------------------------------------------------------------

class TestWebhookStillUnauthenticated:
    """The GitHub webhook is called by GitHub, not by a user.

    Ownership filtering must never reach it: there is no current user to
    filter by, and requiring one would silently stop every push-triggered run.
    """

    def test_webhook_still_queues_a_run_for_a_repo_owned_by_someone_else(
        self, test_app, db_session, sample_webhook_payload, mock_pipeline_runner
    ):
        import json

        from tests.conftest import make_webhook_signature

        # Owned by the *other* member: the webhook must not care.
        seed_repo(
            db_session,
            owner_id=OTHER_USER_ID,
            github_url="https://github.com/testuser/testrepo",
        )
        body = json.dumps(sample_webhook_payload).encode()

        resp = test_app.post(
            "/webhook/github",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Hub-Signature-256": make_webhook_signature(body),
                "X-GitHub-Event": "push",
            },
        )

        assert resp.status_code == 202
        assert resp.json()["status"] == "queued"
        mock_pipeline_runner.run.assert_awaited_once()
