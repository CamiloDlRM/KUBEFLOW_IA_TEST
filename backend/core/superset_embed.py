"""Showing the KPI maker's dashboard inside the platform.

Three steps, each kept small because each fails differently.

**Which dashboard.** The agent builds it, so the record of what it built is
the only place its id lives. It is read from the tool calls rather than from
the model's account of itself: a tool result says which dashboard Superset
made; the model's summary says what the model believes it made.

**Switching embedding on.** Superset only frames a dashboard that has an
embedded configuration, and that configuration carries a UUID distinct from
the dashboard's id. It is created through Superset's REST API, which is the one
place the backend holds a Superset login — inside the compose network, never
sent to the browser.

**The guest token.** Signed here, with the secret Superset verifies it with,
rather than requested from Superset. It names exactly one dashboard and lives
five minutes; the embedding SDK asks for a fresh one before it runs out. The
browser never sees a Superset credential: the token is the whole grant.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

import structlog

from core.config import AppSettings

logger = structlog.get_logger(__name__)

__all__ = ["EmbedError", "dashboard_id_from", "guest_token", "SupersetApi"]

#: Tools whose result or arguments name the dashboard the agent is working on.
_DASHBOARD_TOOLS = (
    "generate_dashboard",
    "add_chart_to_existing_dashboard",
    "get_dashboard_info",
)

_IN_URL = re.compile(r"/dashboard/(\d+)")

#: Long enough for a page to load and render, short enough that a token that
#: leaked into a log is worthless by the time anyone reads it. The SDK fetches
#: a fresh one before this runs out.
TOKEN_SECONDS = 300


class EmbedError(RuntimeError):
    """The dashboard could not be embedded."""


# ---------------------------------------------------------------------------
# Which dashboard
# ---------------------------------------------------------------------------


def _from_result(tool: str, result: str) -> int | None:
    try:
        data = json.loads(result)
    except (TypeError, ValueError):
        data = None

    if isinstance(data, dict):
        # A call that failed may still echo an id it was asked about. It did
        # not make that dashboard, so it is not evidence one exists.
        if data.get("success") is False or data.get("error"):
            return None
        nested = data.get("dashboard")
        if isinstance(nested, dict) and isinstance(nested.get("id"), int):
            return nested["id"]
        if isinstance(data.get("dashboard_id"), int):
            return data["dashboard_id"]
        if tool == "generate_dashboard" and isinstance(data.get("id"), int):
            return data["id"]
        for source in [data] + ([nested] if isinstance(nested, dict) else []):
            for key in ("url", "dashboard_url"):
                value = source.get(key)
                if isinstance(value, str) and (match := _IN_URL.search(value)):
                    return int(match.group(1))

    if isinstance(result, str) and (match := _IN_URL.search(result)):
        return int(match.group(1))
    return None


def _from_arguments(arguments: dict[str, Any]) -> int | None:
    # Superset nests every tool's arguments in `request`.
    for scope in (arguments.get("request"), arguments):
        if isinstance(scope, dict) and isinstance(scope.get("dashboard_id"), int):
            return scope["dashboard_id"]
    return None


def dashboard_id_from(turns: list[list[dict[str, Any]]]) -> int | None:
    """The dashboard the agent most recently built or changed, or None.

    `turns` is each exchange's calls, oldest first. Read newest first, because
    a later exchange may have built a new dashboard rather than editing the
    old one, and it is the latest that the user has just asked about.
    """
    for calls in reversed(turns):
        for call in reversed(calls or []):
            tool = call.get("name", "")
            if tool not in _DASHBOARD_TOOLS:
                continue
            found = _from_result(tool, call.get("result", "")) or _from_arguments(
                call.get("arguments") or {}
            )
            if found is not None:
                return found
    return None


# ---------------------------------------------------------------------------
# The guest token
# ---------------------------------------------------------------------------


def guest_token(secret: str, embedded_uuid: str, *, now: float | None = None) -> str:
    """A token that lets one browser show one embedded dashboard, briefly."""
    from jose import jwt

    issued = int(now if now is not None else time.time())
    return jwt.encode(
        {
            "user": {"username": "kpi-maker", "first_name": "KPI", "last_name": "maker"},
            "resources": [{"type": "dashboard", "id": embedded_uuid}],
            # Gold is per project and the dashboard is built over that
            # project's object, so there is no row to hide within it.
            "rls_rules": [],
            "iat": issued,
            "exp": issued + TOKEN_SECONDS,
            "aud": "superset",
            "type": "guest",
        },
        secret,
        algorithm="HS256",
    )


# ---------------------------------------------------------------------------
# Switching embedding on
# ---------------------------------------------------------------------------


class SupersetApi:
    """Just enough of Superset's REST API to give a dashboard an embedded UUID."""

    def __init__(self, settings: AppSettings, *, http: Any = None) -> None:
        import httpx

        self.base = settings.superset_internal_url.rstrip("/")
        self.settings = settings
        # A client rather than bare calls: the CSRF token Superset hands out
        # is bound to the session cookie it sets alongside, and a POST that
        # arrives without that cookie is refused even with the token.
        self.http = http or httpx.Client(timeout=30)
        self._headers: dict[str, str] = {}

    def close(self) -> None:
        self.http.close()

    def _login(self) -> None:
        if self._headers:
            return
        response = self.http.post(
            f"{self.base}/api/v1/security/login",
            json={
                "username": self.settings.superset_admin_username,
                "password": self.settings.superset_admin_password,
                "provider": "db",
                "refresh": False,
            },
        )
        if response.status_code >= 400:
            raise EmbedError(
                f"Superset refused the platform's login: HTTP {response.status_code}. "
                "SUPERSET_ADMIN_USERNAME and SUPERSET_ADMIN_PASSWORD must match the "
                "admin bootstrap.sh created."
            )
        token = response.json().get("access_token", "")
        headers = {"Authorization": f"Bearer {token}", "Referer": self.base}

        csrf = self.http.get(f"{self.base}/api/v1/security/csrf_token/", headers=headers)
        if csrf.status_code < 400:
            headers["X-CSRFToken"] = csrf.json().get("result", "")
        self._headers = headers

    def embedded_uuid(self, dashboard_id: int, allowed_domains: list[str]) -> str:
        """The dashboard's embedded UUID, creating its configuration if needed."""
        self._login()
        url = f"{self.base}/api/v1/dashboard/{dashboard_id}/embedded"

        existing = self.http.get(url, headers=self._headers)
        if existing.status_code == 200:
            found = (existing.json().get("result") or {}).get("uuid")
            if found:
                return str(found)
        elif existing.status_code not in (404,):
            raise EmbedError(
                f"Superset could not say whether dashboard {dashboard_id} is "
                f"embeddable: HTTP {existing.status_code} {existing.text[:200]}"
            )

        created = self.http.post(
            url, headers=self._headers, json={"allowed_domains": allowed_domains}
        )
        if created.status_code >= 400:
            raise EmbedError(
                f"Superset would not make dashboard {dashboard_id} embeddable: "
                f"HTTP {created.status_code} {created.text[:200]}"
            )
        uuid = (created.json().get("result") or {}).get("uuid")
        if not uuid:
            raise EmbedError("Superset made the dashboard embeddable but returned no UUID.")
        logger.info("superset_embed.enabled", dashboard=dashboard_id, uuid=uuid)
        return str(uuid)
