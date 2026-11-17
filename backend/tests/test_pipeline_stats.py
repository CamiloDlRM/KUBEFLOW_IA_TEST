"""Tests for ``GET /pipelines/stats``: the dashboard's success-rate tile."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tests.conftest import OTHER_USER_ID, seed_pipeline, seed_repo


def _ago(days: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _runs(db_session, owner_id: int, *runs: tuple[str, float]) -> None:
    repo = seed_repo(db_session, owner_id=owner_id, github_url=f"https://github.com/x/r{owner_id}")
    for status, days in runs:
        seed_pipeline(db_session, repo.id, status=status, started_at=_ago(days))


class TestPipelineStats:
    def test_rate_counts_only_finished_runs_in_the_window(self, test_app, db_session):
        _runs(
            db_session,
            1,
            ("success", 1),
            ("success", 2),
            ("success", 3),
            ("failed", 4),
            ("running", 0.1),  # no outcome yet
            ("success", 45),  # the window before
            ("failed", 50),
        )

        body = test_app.get("/pipelines/stats").json()

        assert body["window_days"] == 30
        assert (body["finished"], body["succeeded"]) == (4, 3)
        assert body["success_rate"] == 0.75
        assert body["previous_success_rate"] == 0.5

    def test_a_member_counts_only_their_runs(self, test_app, admin_app, db_session):
        _runs(db_session, 1, ("success", 1))
        _runs(db_session, OTHER_USER_ID, ("failed", 1), ("failed", 2))

        assert test_app.get("/pipelines/stats").json()["success_rate"] == 1.0
        assert admin_app.get("/pipelines/stats").json()["finished"] == 3

    def test_no_finished_runs_is_no_rate_not_zero(self, test_app):
        body = test_app.get("/pipelines/stats").json()

        assert body["success_rate"] is None
        assert body["previous_success_rate"] is None
