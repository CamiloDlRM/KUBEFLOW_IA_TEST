"""Embedding the KPI maker's dashboard: finding it, enabling it, granting it.

Superset's REST API is faked on `httpx.MockTransport`, so what is asserted is
what would go over the wire — the login, the CSRF token travelling with the
session, the embedded configuration created once and read after that.
"""
from __future__ import annotations

import json

import httpx
import pytest
from jose import jwt

from core.config import AppSettings
from core.superset_embed import (
    TOKEN_SECONDS,
    EmbedError,
    SupersetApi,
    dashboard_id_from,
    guest_token,
)


def call(name: str, result: object = "", **arguments) -> dict:
    return {
        "name": name,
        "arguments": {"request": arguments} if arguments else {},
        "result": result if isinstance(result, str) else json.dumps(result),
    }


# ---------------------------------------------------------------------------
# Which dashboard
# ---------------------------------------------------------------------------


class TestFindingTheDashboard:
    """Read from what Superset said it made, not from what the model says."""

    def test_from_a_generated_dashboard(self):
        turns = [[call("generate_dashboard", {"dashboard": {"id": 7, "title": "x"}})]]
        assert dashboard_id_from(turns) == 7

    def test_from_a_url_when_that_is_all_there_is(self):
        turns = [[call("generate_dashboard", {"url": "http://localhost:8088/superset/dashboard/12/"})]]
        assert dashboard_id_from(turns) == 12

    def test_from_the_arguments_of_a_chart_added_to_one(self):
        turns = [[call("add_chart_to_existing_dashboard", {"success": True}, dashboard_id=4)]]
        assert dashboard_id_from(turns) == 4

    def test_a_failed_call_is_not_evidence_a_dashboard_exists(self):
        """A failure may echo the id it was asked about. It did not make it."""
        turns = [
            [call("generate_dashboard", {"success": False, "dashboard": {"id": 99}, "error": {}})]
        ]
        assert dashboard_id_from(turns) is None

    def test_the_latest_one_wins(self):
        """A later exchange may have built a new dashboard rather than edited
        the old one, and it is the latest the user has just asked about."""
        turns = [
            [call("generate_dashboard", {"dashboard": {"id": 1}})],
            [call("generate_dashboard", {"dashboard": {"id": 2}})],
        ]
        assert dashboard_id_from(turns) == 2

    def test_charts_and_datasets_are_not_dashboards(self):
        turns = [
            [
                call("create_virtual_dataset", {"id": 1}),
                call("generate_chart", {"chart": {"id": 5}}),
            ]
        ]
        assert dashboard_id_from(turns) is None

    def test_nothing_built_yet(self):
        assert dashboard_id_from([]) is None


# ---------------------------------------------------------------------------
# The guest token
# ---------------------------------------------------------------------------


class TestTheGuestToken:
    def test_superset_can_verify_it_with_the_shared_secret(self):
        token = guest_token("s3cret", "abc-uuid", now=1_000_000)
        claims = jwt.decode(
            token,
            "s3cret",
            algorithms=["HS256"],
            audience="superset",
            options={"verify_exp": False},
        )

        assert claims["type"] == "guest"
        assert claims["resources"] == [{"type": "dashboard", "id": "abc-uuid"}]

    def test_it_names_one_dashboard_and_nothing_else(self):
        claims = jwt.get_unverified_claims(guest_token("s", "only-this"))
        assert claims["resources"] == [{"type": "dashboard", "id": "only-this"}]

    def test_it_is_short_lived(self):
        """The SDK fetches a fresh one before it runs out, so there is no
        reason for one that leaked into a log to still work an hour later."""
        claims = jwt.get_unverified_claims(guest_token("s", "u", now=1_000))
        assert claims["exp"] - claims["iat"] == TOKEN_SECONDS

    def test_a_different_secret_does_not_verify(self):
        with pytest.raises(Exception):
            jwt.decode(
                guest_token("ours", "u"),
                "theirs",
                algorithms=["HS256"],
                audience="superset",
            )


# ---------------------------------------------------------------------------
# Switching embedding on
# ---------------------------------------------------------------------------


def api(handler) -> SupersetApi:
    settings = AppSettings(
        superset_internal_url="http://superset:8088",
        superset_admin_username="admin",
        superset_admin_password="pw",
    )
    return SupersetApi(settings, http=httpx.Client(transport=httpx.MockTransport(handler)))


def superset(*, existing: str | None = None, login_status: int = 200):
    seen: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        seen.append((request.method, path, dict(request.headers)))
        if path == "/api/v1/security/login":
            if login_status != 200:
                return httpx.Response(login_status, json={"message": "nope"})
            return httpx.Response(200, json={"access_token": "tok"})
        if path == "/api/v1/security/csrf_token/":
            return httpx.Response(200, json={"result": "csrf-1"})
        if path.endswith("/embedded") and request.method == "GET":
            if existing:
                return httpx.Response(200, json={"result": {"uuid": existing}})
            return httpx.Response(404, json={"message": "Not found"})
        if path.endswith("/embedded") and request.method == "POST":
            return httpx.Response(200, json={"result": {"uuid": "new-uuid"}})
        return httpx.Response(500)

    return handler, seen


class TestEnablingEmbedding:
    def test_a_dashboard_is_made_embeddable_the_first_time(self):
        handler, seen = superset()

        assert api(handler).embedded_uuid(7, []) == "new-uuid"
        assert ("POST", "/api/v1/dashboard/7/embedded") in [(m, p) for m, p, _ in seen]

    def test_after_that_the_existing_configuration_is_read_back(self):
        """The SDK asks for a token every few minutes. Creating a new embedded
        configuration each time would change the UUID under a page that is
        already showing the old one."""
        handler, seen = superset(existing="kept-uuid")

        assert api(handler).embedded_uuid(7, []) == "kept-uuid"
        assert "POST" not in [m for m, p, _ in seen if p.endswith("/embedded")]

    def test_the_csrf_token_travels_with_the_write(self):
        handler, seen = superset()
        api(handler).embedded_uuid(7, [])

        post = next(h for m, p, h in seen if m == "POST" and p.endswith("/embedded"))
        assert post["x-csrftoken"] == "csrf-1"
        assert post["authorization"] == "Bearer tok"

    def test_a_refused_login_says_which_settings_to_check(self):
        handler, _ = superset(login_status=401)

        with pytest.raises(EmbedError, match="SUPERSET_ADMIN_USERNAME"):
            api(handler).embedded_uuid(7, [])
