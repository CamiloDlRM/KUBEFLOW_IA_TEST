"""Tests for the Grafana datasource query allow-list.

The dashboards scope every panel to ``${__user.login}``, but Grafana's Viewer
role can still *run* arbitrary SQL against the datasource. These tests pin the
proxy-side rule that closes that gap: a member may run the provisioned panel
queries with their own Grafana login (``user-<id>``) substituted, and nothing
else.

They also assert the allow-list is built from the *real* dashboard files, so a
panel whose SQL drifts out of the allow-list fails here rather than in front of
a user.
"""
from __future__ import annotations

import json
import re
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
from models.schemas import USERNAME_PATTERN
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

#: What Grafana calls them: ``user-<id>`` (``grafana_login``), not the username.
MEMBER_LOGIN = "user-1"
OTHER_LOGIN = "user-2"


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


class TestUsernamePattern:
    """The character set a username may use when it is set.

    It used to guard the ``${__user.login}`` interpolation too; that now holds
    ``user-<id>`` instead (``TestGrafanaLogin``). It must stay wide enough for
    the usernames this deployment issues, which are email addresses.
    """

    @pytest.mark.parametrize(
        "username",
        [
            "admin@kubeflowia.site",
            "jorge.de.la.rosa@example.com",
            "user+tag@example.com",
            "plain_user",
            "dash-user",
            "abc",
            "a" * 64,
        ],
    )
    def test_realistic_usernames_are_accepted(self, username):
        assert re.fullmatch(USERNAME_PATTERN, username)

    @pytest.mark.parametrize(
        "username",
        [
            "bob' OR '1'='1",  # terminates the SQL literal
            "bob'--",
            'bob"x',
            "bob\\x",  # backslash escape
            "bob user",  # whitespace
            "bob\nuser",  # header injection
            "bob\r\nX-WEBAUTH-USER: admin",
            "ab",  # too short
            "a" * 65,  # too long
            "",
        ],
    )
    def test_dangerous_or_malformed_usernames_are_rejected(self, username):
        assert not re.fullmatch(USERNAME_PATTERN, username)


class TestGrafanaLogin:
    """Grafana knows a user as ``user-<id>``, never by their username.

    Seen in production: Grafana lowercases logins, so for ``WilmerJr01@g`` it
    sent SQL filtered on ``wilmerjr01@g``. That matched no allow-list entry
    (403) and no row in ``users`` (no data), for every user with a capital.
    """

    WILMER = make_user(5, "member", "WilmerJr01@g")

    def test_the_login_is_the_id(self):
        from core.grafana_queries import grafana_login

        assert grafana_login(MEMBER) == "user-1"
        assert grafana_login(self.WILMER) == "user-5"

    def test_a_username_with_capitals_can_run_every_panel(self):
        for dashboard in ("mlops-ml.json", "mlops-model.json"):
            document = json.loads((DASHBOARDS_DIR / dashboard).read_text(encoding="utf-8"))
            for panel in document["panels"]:
                for target in panel.get("targets", []):
                    if target.get("rawSql"):
                        sql = target["rawSql"].replace("${__user.login}", "user-5").replace("${model}", "pulso")
                        authorize_query(_payload(sql), self.WILMER)

    def test_no_panel_filters_on_the_username_any_more(self):
        for dashboard in ("mlops-ml.json", "mlops-model.json"):
            text = (DASHBOARDS_DIR / dashboard).read_text(encoding="utf-8")
            assert "u.username = '${__user.login}'" not in text
            assert "'user-' || u.id = '${__user.login}'" in text

    def test_the_proxy_sends_grafana_the_id_whatever_the_username_holds(self):
        from routers.grafana import _identity_headers

        settings = get_settings()
        header = settings.grafana_auth_proxy_header
        assert _identity_headers(self.WILMER, settings) == {header: "user-5"}
        # A username that could break the SQL literal never reaches Grafana.
        odd = make_user(6, "member", "bob' OR '1'='1")
        assert _identity_headers(odd, settings) == {header: "user-6"}


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
        allowed = allowed_queries_for(MEMBER_LOGIN, get_settings())
        assert allowed, "no dashboard SQL was loaded"

    def test_username_is_substituted(self):
        allowed = allowed_queries_for(MEMBER_LOGIN, get_settings())
        assert any("'user-' || u.id = 'user-1'" in sql for sql in allowed)
        assert not any("${__user.login}" in sql for sql in allowed)

    def test_allow_lists_of_two_users_are_disjoint(self):
        """No query may be runnable by two different members.

        Anything shared would by definition not be scoped to either of them.
        """
        mine = allowed_queries_for(MEMBER_LOGIN, get_settings())
        theirs = allowed_queries_for(OTHER_LOGIN, get_settings())
        assert mine.isdisjoint(theirs)

    def test_platform_queries_are_excluded_from_a_members_allow_list(self):
        allowed = allowed_queries_for(MEMBER_LOGIN, get_settings())
        assert all("'user-' || u.id = 'user-1'" in sql for sql in allowed)


class TestMemberAuthorisation:
    def test_own_dashboard_panel_is_allowed(self):
        sql = _panel_sql("mlops-ml.json", "My projects").replace(
            "${__user.login}", MEMBER_LOGIN
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
                sql = raw.replace("${__user.login}", MEMBER_LOGIN)
                authorize_query(_payload(sql), MEMBER)

    def test_another_users_name_is_refused(self):
        sql = _panel_sql("mlops-ml.json", "My projects").replace(
            "${__user.login}", OTHER_LOGIN
        )
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(sql), MEMBER)

    def test_hand_written_sql_is_refused(self):
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload("SELECT * FROM repositories"), MEMBER)

    def test_appending_a_disjunction_to_a_valid_panel_is_refused(self):
        """The attack the allow-list exists for: a real panel, widened."""
        sql = _panel_sql("mlops-ml.json", "My projects").replace(
            "${__user.login}", MEMBER_LOGIN
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
        good = _panel_sql("mlops-ml.json", "My projects").replace(
            "${__user.login}", MEMBER_LOGIN
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
        sql = _panel_sql("mlops-ml.json", "My projects").replace(
            "${__user.login}", MEMBER_LOGIN
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


# ---------------------------------------------------------------------------
# Per-model dashboard (``mlops-model``): ${model} slot and PromQL ownership
# ---------------------------------------------------------------------------


def _model_targets(key: str) -> list[str]:
    document = json.loads((DASHBOARDS_DIR / "mlops-model.json").read_text(encoding="utf-8"))
    return [t[key] for p in document["panels"] for t in p["targets"] if key in t]


def _render(template: str, model: str, login: str = "user-1") -> str:
    """What Grafana sends once it has interpolated both variables."""
    return template.replace("${__user.login}", login).replace("${model}", model)


def _prom_payload(*exprs: str) -> bytes:
    return json.dumps({"queries": [{"refId": "A", "expr": e} for e in exprs]}).encode()


def _owner_of(*models: str):
    return lambda name: name in models


class TestModelDashboard:
    def test_every_sql_panel_is_user_and_model_scoped(self):
        for raw in _model_targets("rawSql"):
            assert "${__user.login}" in raw and "${model}" in raw, raw

    def test_every_promql_panel_is_model_scoped(self):
        for expr in _model_targets("expr"):
            assert 'model_name="${model}"' in expr, expr

    def test_every_sql_panel_is_allowed_for_any_safe_model_name(self):
        for raw in _model_targets("rawSql"):
            authorize_query(_payload(_render(raw, "iris-classifier_v2.1")), MEMBER)

    def test_every_promql_panel_is_allowed_for_an_owned_model(self):
        for expr in _model_targets("expr"):
            authorize_query(
                _prom_payload(_render(expr, "iris")), MEMBER, owns_model=_owner_of("iris")
            )

    def test_promql_for_a_model_of_someone_else_is_refused(self):
        expr = _model_targets("expr")[0]
        with pytest.raises(QueryNotAllowed):
            authorize_query(
                _prom_payload(_render(expr, "theirs")), MEMBER, owns_model=_owner_of("iris")
            )

    def test_promql_without_an_ownership_check_is_refused(self):
        expr = _model_targets("expr")[0]
        with pytest.raises(QueryNotAllowed):
            authorize_query(_prom_payload(_render(expr, "iris")), MEMBER)

    def test_ad_hoc_promql_is_refused_even_for_an_owned_model(self):
        with pytest.raises(QueryNotAllowed):
            authorize_query(
                _prom_payload('mlops_model_predictions_total{model_name="iris"} or up'),
                MEMBER,
                owns_model=_owner_of("iris"),
            )

    @pytest.mark.parametrize(
        "model",
        ["x' OR '1'='1", "x'--", 'x"} or up{a="', "x y", "", "a" * 201],
    )
    def test_unsafe_model_values_are_refused(self, model):
        raw = _model_targets("rawSql")[0]
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(_render(raw, model)), MEMBER)
        expr = _model_targets("expr")[0]
        with pytest.raises(QueryNotAllowed):
            authorize_query(
                _prom_payload(_render(expr, model)), MEMBER, owns_model=lambda _: True
            )

    def test_repeated_model_slot_must_hold_one_value(self):
        from core.grafana_queries import _model_pattern

        pattern = _model_pattern("a = '${model}' AND b = '${model}'")
        assert pattern.fullmatch("a = 'x' AND b = 'x'")
        assert not pattern.fullmatch("a = 'x' AND b = 'y'")

    def test_another_users_name_with_a_model_is_refused(self):
        raw = _model_targets("rawSql")[0]
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(_render(raw, "iris", OTHER_LOGIN)), MEMBER)


class TestIntervalVariables:
    """Grafana fills ``$__interval`` before the query reaches the proxy.

    Seen in production: "Average pipeline duration" arrived as
    ``$__timeGroupAlias(p.started_at, 30m)``, matched no template and was
    refused, so it showed no data to every member.
    """

    @staticmethod
    def _duration_panel(interval: str) -> str:
        return (
            _panel_sql("mlops-ml.json", "Average pipeline duration")
            .replace("${__user.login}", MEMBER_LOGIN)
            .replace("$__interval", interval)
        )

    @pytest.mark.parametrize("interval", ["30m", "1h", "500ms", "15s", "2d", "1w"])
    def test_the_panel_runs_at_any_interval_grafana_picks(self, interval):
        authorize_query(_payload(self._duration_panel(interval)), MEMBER)

    @pytest.mark.parametrize("interval", ["30m) OR (TRUE", "1h'", "abc", "", "30 m"])
    def test_anything_but_an_interval_in_that_slot_is_refused(self, interval):
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(self._duration_panel(interval)), MEMBER)

    def test_another_users_rows_at_an_interval_are_refused(self):
        sql = self._duration_panel("30m").replace(MEMBER_LOGIN, OTHER_LOGIN)
        with pytest.raises(QueryNotAllowed):
            authorize_query(_payload(sql), MEMBER)

    def test_interval_ms_is_a_number_and_not_read_as_interval(self):
        from core.grafana_queries import _slot_pattern

        pattern = _slot_pattern("x $__interval_ms y $__interval z")
        assert pattern.fullmatch("x 1500 y 30m z")
        assert not pattern.fullmatch("x 1h y 30m z")
        assert not pattern.fullmatch("x 1500_ms y 30m z")


class TestAdminsSeeAnyModel:
    """In the per-model dashboard an admin sees any model, a member only theirs.

    Seen in production: an admin opening another user's model from the Models
    page got "No data" in every SQL panel ("Active version" among them),
    because the SQL kept only the viewer's own models.
    """

    def test_every_sql_panel_admits_an_admin(self):
        for raw in _model_targets("rawSql"):
            assert "a.role = 'admin'" in raw, raw

    def test_a_members_queries_name_nobody_but_them(self):
        allowed = allowed_queries_for(MEMBER_LOGIN, get_settings())
        model_panels = [sql for sql in allowed if "a.role = 'admin'" in sql]
        assert model_panels, "the model dashboard's panels are in the member's allow-list"
        for sql in model_panels:
            assert sql.count(f"'{MEMBER_LOGIN}'") == 2
            assert OTHER_LOGIN not in sql

    def test_a_member_still_runs_every_model_panel(self):
        for raw in _model_targets("rawSql"):
            authorize_query(_payload(_render(raw, "prueba-3")), MEMBER)


class TestActiveVersionPanel:
    """The panel's one column is text ('v3'), and a Stat panel shows only numbers by default.

    Seen in production: "Active version" showed "No data" to admins and owners
    alike although its query returned a row. Grafana dropped the text column.
    """

    def test_it_shows_its_version_column(self):
        document = json.loads((DASHBOARDS_DIR / "mlops-model.json").read_text(encoding="utf-8"))
        panel = next(p for p in document["panels"] if p["title"] == "Active version")
        assert panel["type"] == "stat"
        assert 'AS "version"' in panel["targets"][0]["rawSql"]
        assert re.fullmatch(panel["options"]["reduceOptions"]["fields"].strip("/"), "version")


class TestResourcesDashboard:
    """CPU and memory of every container is the platform's, not a tenant's."""

    @staticmethod
    def _exprs() -> list[str]:
        document = json.loads((DASHBOARDS_DIR / "mlops-resources.json").read_text(encoding="utf-8"))
        return [
            target["expr"]
            for panel in document["panels"]
            for target in panel.get("targets", [])
        ]

    def test_every_panel_reads_prometheus(self):
        document = json.loads((DASHBOARDS_DIR / "mlops-resources.json").read_text(encoding="utf-8"))
        assert document["uid"] == "mlops-resources"
        assert document["editable"] is False
        assert {panel["datasource"]["uid"] for panel in document["panels"]} == {"mlops-prometheus"}

    def test_a_member_cannot_run_any_of_its_queries(self):
        for expr in self._exprs():
            body = json.dumps({"queries": [{"refId": "A", "expr": expr}]}).encode()
            with pytest.raises(QueryNotAllowed):
                authorize_query(body, MEMBER, owns_model=lambda _name: True)

    def test_an_admin_can(self):
        for expr in self._exprs():
            authorize_query(json.dumps({"queries": [{"refId": "A", "expr": expr}]}).encode(), ADMIN)
