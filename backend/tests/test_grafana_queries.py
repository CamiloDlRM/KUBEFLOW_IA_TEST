"""Tests for the Grafana datasource query allow-list.

The dashboards scope every panel to ``${__user.login}``, but Grafana's Viewer
role can still *run* arbitrary SQL against the datasource. These tests pin the
proxy-side rule that closes that gap: a member may run the provisioned panel
queries with their own username substituted, and nothing else.

They also assert the allow-list is built from the *real* dashboard files, so a
panel whose SQL drifts out of the allow-list fails here rather than in front of
a user.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.config import get_settings
from core.grafana_queries import (
    QueryNotAllowed,
    allowed_queries_for,
    authorize_query,
    is_query_path,
    normalise_sql,
    reset_cache,
)
from tests.conftest import make_user

def _find_dashboards_dir() -> Path:
    """Locate the provisioned dashboards from either place they can live.

    Running from a checkout they sit at the repository root next to
    ``backend/``; inside the container docker-compose mounts them read-only at
    ``/app/grafana_dashboards``. The tests read the real files either way, so a
    panel whose SQL drifts is caught wherever the suite runs.
    """
    candidates = [
        Path(__file__).resolve().parents[2] / "grafana" / "dashboards",
        Path("/app/grafana_dashboards"),
    ]
    for candidate in candidates:
        if candidate.is_dir() and any(candidate.glob("*.json")):
            return candidate
    raise AssertionError(
        "provisioned Grafana dashboards not found in: "
        + ", ".join(str(c) for c in candidates)
    )


DASHBOARDS_DIR = _find_dashboards_dir()

MEMBER = make_user(1, "member", "testuser")
OTHER_MEMBER = make_user(2, "member", "otheruser")
ADMIN = make_user(3, "admin", "adminuser")


@pytest.fixture(autouse=True)
def _point_at_real_dashboards(monkeypatch):
    """Build the allow-list from the dashboards actually shipped in the repo."""
    settings = get_settings()
    monkeypatch.setattr(
        settings, "grafana_dashboards_dir", str(DASHBOARDS_DIR), raising=False
    )
    reset_cache()
    yield
    reset_cache()


def _panel_sql(dashboard: str, title: str) -> str:
    """Return the rawSql of a named panel, as Grafana would send it."""
    document = json.loads((DASHBOARDS_DIR / dashboard).read_text(encoding="utf-8"))
    for panel in document["panels"]:
        if panel["title"] == title:
            return panel["targets"][0]["rawSql"]
    raise AssertionError(f"panel {title!r} not found in {dashboard}")


def _payload(*sql: str) -> bytes:
    return json.dumps({"queries": [{"refId": "A", "rawSql": s} for s in sql]}).encode()


class TestNormalisation:
    def test_collapses_whitespace_and_trailing_semicolon(self):
        assert normalise_sql("SELECT   1\n  FROM t ;") == "SELECT 1 FROM t"

    def test_is_case_sensitive(self):
        assert normalise_sql("select 1") != normalise_sql("SELECT 1")


class TestQueryPathDetection:
    @pytest.mark.parametrize(
        "path", ["api/ds/query", "/api/ds/query/", "API/DS/QUERY", "api/tsdb/query"]
    )
    def test_query_endpoints_are_recognised(self, path):
        assert is_query_path(path)

    @pytest.mark.parametrize("path", ["api/dashboards/uid/mlops-ml", "d/mlops-ml/", ""])
    def test_other_paths_are_not(self, path):
        assert not is_query_path(path)


class TestAllowList:
    def test_dashboard_sql_is_loaded(self):
        allowed = allowed_queries_for("testuser", get_settings())
        assert allowed, "no dashboard SQL was loaded"

    def test_username_is_substituted(self):
        allowed = allowed_queries_for("testuser", get_settings())
        assert any("u.username = 'testuser'" in sql for sql in allowed)
        assert not any("${__user.login}" in sql for sql in allowed)

    def test_allow_lists_of_two_users_are_disjoint(self):
        """No query may be runnable by two different members.

        Anything shared would by definition not be scoped to either of them.
        """
        mine = allowed_queries_for("testuser", get_settings())
        theirs = allowed_queries_for("otheruser", get_settings())
        assert mine.isdisjoint(theirs)

    def test_platform_queries_are_excluded_from_a_members_allow_list(self):
        allowed = allowed_queries_for("testuser", get_settings())
        assert all("u.username = 'testuser'" in sql for sql in allowed)


class TestMemberAuthorisation:
    def test_own_dashboard_panel_is_allowed(self):
        sql = _panel_sql("mlops-ml.json", "My repositories").replace(
            "${__user.login}", "testuser"
        )
        authorize_query(_payload(sql), MEMBER)

    def test_every_ml_panel_is_allowed(self):
        """Guards against a panel whose SQL is unreachable through the proxy."""
        document = json.loads(
            (DASHBOARDS_DIR / "mlops-ml.json").read_text(encoding="utf-8")
        )
        for panel in document["panels"]:
            for target in panel.get("targets", []):
                raw = target.get("rawSql")
                if not raw:
                    continue
                sql = raw.replace("${__user.login}", "testuser")
                authorize_query(_payload(sql), MEMBER)

    def test_another_users_name_is_refused(self):
        sql = _panel_sql("mlops-ml.json", "My repositories").replace(
            "${__user.login}", "otheruser"
        )
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(sql), MEMBER)

    def test_hand_written_sql_is_refused(self):
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload("SELECT * FROM repositories"), MEMBER)

    def test_appending_a_disjunction_to_a_valid_panel_is_refused(self):
        """The attack the allow-list exists for: a real panel, widened."""
        sql = _panel_sql("mlops-ml.json", "My repositories").replace(
            "${__user.login}", "testuser"
        )
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(sql.rstrip().rstrip(";") + " OR TRUE"), MEMBER)

    def test_platform_dashboard_sql_is_refused(self):
        sql = _panel_sql("mlops-ops.json", "Pipeline runs by outcome")
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(sql), MEMBER)

    def test_prometheus_target_is_refused(self):
        body = json.dumps({"queries": [{"refId": "A", "expr": "up"}]}).encode()
        with pytest.raises(QueryNotAllowed):
            authorize_query(body, MEMBER)

    def test_a_batch_mixing_allowed_and_forbidden_is_refused(self):
        good = _panel_sql("mlops-ml.json", "My repositories").replace(
            "${__user.login}", "testuser"
        )
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(good, "SELECT * FROM users"), MEMBER)

    @pytest.mark.parametrize(
        "body",
        [b"", b"not json", b"[]", b"{}", b'{"queries": []}', b'{"queries": {}}'],
    )
    def test_malformed_payloads_are_refused(self, body):
        with pytest.raises(QueryNotAllowed):
            authorize_query(body, MEMBER)

    def test_whitespace_differences_are_tolerated(self):
        sql = _panel_sql("mlops-ml.json", "My repositories").replace(
            "${__user.login}", "testuser"
        )
        authorize_query(_payload("  " + sql.replace("\n", "\n\t") + "  "), MEMBER)


class TestAdminAuthorisation:
    def test_admin_may_run_arbitrary_sql(self):
        authorize_query(_payload("SELECT * FROM users"), ADMIN)

    def test_admin_may_run_prometheus_targets(self):
        body = json.dumps({"queries": [{"refId": "A", "expr": "up"}]}).encode()
        authorize_query(body, ADMIN)

    def test_admin_is_not_blocked_by_a_malformed_payload(self):
        authorize_query(b"not json", ADMIN)


class TestFailClosed:
    def test_missing_dashboard_dir_denies_members(self, monkeypatch, tmp_path):
        settings = get_settings()
        monkeypatch.setattr(
            settings,
            "grafana_dashboards_dir",
            str(tmp_path / "does-not-exist"),
            raising=False,
        )
        reset_cache()
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload("SELECT 1"), MEMBER)

    def test_missing_dashboard_dir_still_allows_admins(self, monkeypatch, tmp_path):
        settings = get_settings()
        monkeypatch.setattr(
            settings,
            "grafana_dashboards_dir",
            str(tmp_path / "does-not-exist"),
            raising=False,
        )
        reset_cache()
        authorize_query(_payload("SELECT 1"), ADMIN)
