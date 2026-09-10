"""Authorisation for the Grafana datasource query API.

Why this module exists
----------------------

Every panel in ``mlops-ml.json`` scopes its SQL to the signed-in user::

    JOIN users u ON u.id = r.owner_id
    WHERE u.username = '${__user.login}'

That filter is what makes the dashboard multi-tenant — but it only governs the
queries *the dashboard itself* issues. Grafana's ``Viewer`` role, which every
auto-provisioned user gets, still holds the ``datasources:query`` permission,
so a member can POST their own SQL straight to ``/api/ds/query`` and read every
tenant's rows. The role stops them *saving* an edited panel; it does not stop
them *running* one. Everything reaches Grafana through our reverse proxy, so
that request is ours to refuse, and this is where we refuse it.

How it works
------------

The dashboards are provisioned from JSON and marked ``editable: false``, so the
set of legitimate queries is fixed and known ahead of time. At startup we read
those files and keep the SQL of every panel as a *template*, with
``${__user.login}`` left in place. On each request we substitute the
authenticated username into each template and require the incoming SQL to match
one of them exactly (after whitespace normalisation).

Consequences worth knowing:

- Members can run the dashboards and nothing else. Explore and ad-hoc panels
  are refused for them by construction — there is no template to match.
- Admins are exempt: they can already read every row through the application
  itself, so restricting their queries would buy nothing.
- A panel whose SQL does not mention ``${__user.login}`` returns the same rows
  for everybody, so it is kept out of every member's allow-list. That is what
  makes the platform dashboard (``mlops-ops``) admin-only, without needing a
  second mechanism to say so.
- Editing a dashboard's SQL means editing the JSON, which regenerates the
  allow-list on the next start. A panel edited only in Grafana's UI will be
  refused — which is the intent.

Failure is closed: if the dashboard directory is missing or unreadable, members
are denied and the error is logged, rather than the allow-list silently
becoming permissive.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Final

import structlog

from core.config import AppSettings, get_settings
from models.schemas import User

logger = structlog.get_logger(__name__)

#: Proxy paths that carry datasource queries. ``/api/tsdb/query`` is the legacy
#: spelling; it is listed so an older client cannot take an unguarded route.
QUERY_PATHS: Final[frozenset[str]] = frozenset(
    {
        "api/ds/query",
        "api/tsdb/query",
    }
)

#: The Grafana global variable carrying the signed-in username.
_USER_VARIABLE: Final[str] = "${__user.login}"

#: Alternative spellings Grafana accepts for the same variable.
_USER_VARIABLE_ALIASES: Final[tuple[str, ...]] = (
    "${__user.login}",
    "$__user.login",
    "[[__user.login]]",
)

_WHITESPACE = re.compile(r"\s+")


def is_query_path(path: str) -> bool:
    """Whether ``path`` (proxy-relative, no leading slash) is a query endpoint."""
    return path.strip("/").lower() in QUERY_PATHS


def normalise_sql(sql: str) -> str:
    """Reduce SQL to a form stable across Grafana's own reformatting.

    Collapses whitespace runs and drops a trailing semicolon. Case is kept:
    Grafana forwards the panel's SQL verbatim, so a difference in case means
    the query did not come from the panel.
    """
    return _WHITESPACE.sub(" ", sql).strip().rstrip(";").strip()


# ---------------------------------------------------------------------------
# Template loading
# ---------------------------------------------------------------------------


def _iter_raw_sql(node: Any) -> list[str]:
    """Collect every ``rawSql`` value anywhere in a dashboard document.

    Walks the whole tree rather than assuming ``panels[].targets[]`` so that
    SQL inside row panels, repeated panels or template variables is picked up
    too. A query we fail to collect would be refused at runtime, so breadth
    here is what keeps working dashboards working.
    """
    found: list[str] = []
    if isinstance(node, dict):
        raw = node.get("rawSql")
        if isinstance(raw, str) and raw.strip():
            found.append(raw)
        for value in node.values():
            found.extend(_iter_raw_sql(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_iter_raw_sql(value))
    return found


def _dashboards_dir(settings: AppSettings) -> Path:
    return Path(settings.grafana_dashboards_dir)


@lru_cache(maxsize=1)
def _load_templates(directory: str) -> frozenset[str]:
    """Read every provisioned dashboard and return the normalised SQL set.

    Cached on the directory path: the dashboards are baked into the image and
    mounted read-only, so re-reading them per request would be pure overhead.
    """
    path = Path(directory)
    if not path.is_dir():
        logger.error(
            "grafana.query_allowlist_missing",
            directory=directory,
            impact="members cannot run dashboard queries",
        )
        return frozenset()

    templates: set[str] = set()
    for file in sorted(path.glob("*.json")):
        try:
            document = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.error(
                "grafana.query_allowlist_unreadable", file=str(file), error=str(exc)
            )
            continue
        for raw in _iter_raw_sql(document):
            templates.add(normalise_sql(raw))

    logger.info(
        "grafana.query_allowlist_loaded",
        directory=directory,
        queries=len(templates),
    )
    return frozenset(templates)


def _is_user_scoped(template: str) -> bool:
    """Whether a panel's SQL narrows itself to the signed-in user.

    A template that never mentions the Grafana user variable returns the same
    rows whoever runs it — the platform dashboard's panels are like this. Such
    a query is identical for every account, so admitting it to a member's
    allow-list would hand them a cross-tenant read through the front door.
    """
    return any(alias in template for alias in _USER_VARIABLE_ALIASES)


def allowed_queries_for(username: str, settings: AppSettings) -> frozenset[str]:
    """Return the normalised SQL ``username`` is allowed to run.

    Only user-scoped templates are considered, each with the Grafana user
    variable replaced by ``username``. A member's allow-list therefore contains
    nothing but queries restricted to their own rows; platform-wide panels are
    left out entirely and stay admin-only.
    """
    templates = _load_templates(str(_dashboards_dir(settings)))
    allowed: set[str] = set()
    for template in templates:
        if not _is_user_scoped(template):
            continue
        rendered = template
        for alias in _USER_VARIABLE_ALIASES:
            rendered = rendered.replace(alias, username)
        allowed.add(rendered)
    return frozenset(allowed)


def reset_cache() -> None:
    """Drop the cached allow-list (used by tests)."""
    _load_templates.cache_clear()


# ---------------------------------------------------------------------------
# Authorisation
# ---------------------------------------------------------------------------


#: How much of a rejected query to keep in the log line.
_LOG_SQL_LIMIT: Final[int] = 500


class QueryNotAllowed(Exception):
    """Raised when a datasource query is not on the caller's allow-list.

    Carries the offending SQL so the proxy can log it. Matching is exact, so
    the difference between a genuine attack and a template that drifted out of
    sync is visible only by comparing the two strings — without them in the log
    a legitimate panel failing would be undiagnosable.
    """

    def __init__(self, reason: str, sql: str | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.sql = (sql or "")[:_LOG_SQL_LIMIT]


def _extract_queries(body: bytes) -> list[dict[str, Any]]:
    """Parse the query payload, or raise :class:`QueryNotAllowed`.

    An unparseable body is refused rather than forwarded: we cannot vouch for
    what we cannot read.
    """
    if not body:
        raise QueryNotAllowed("empty query payload")
    try:
        document = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise QueryNotAllowed(f"unparseable query payload: {exc}") from exc

    if not isinstance(document, dict):
        raise QueryNotAllowed("query payload is not an object")

    queries = document.get("queries")
    if not isinstance(queries, list):
        raise QueryNotAllowed("query payload has no 'queries' array")

    return [q for q in queries if isinstance(q, dict)]


def authorize_query(body: bytes, user: User, settings: AppSettings | None = None) -> None:
    """Allow or refuse a datasource query on behalf of ``user``.

    Admins pass unconditionally. For everyone else each query in the payload
    must be SQL that matches a provisioned panel with their own username
    substituted; anything else — hand-written SQL, another user's name, or a
    non-SQL (Prometheus) target belonging to the platform dashboard — is
    refused.

    Raises:
        QueryNotAllowed: when any query in the payload is not permitted.
    """
    from core.ownership import is_admin

    if is_admin(user):
        return

    settings = settings or get_settings()
    queries = _extract_queries(body)
    if not queries:
        raise QueryNotAllowed("query payload contains no queries")

    allowed = allowed_queries_for(user.username, settings)
    if not allowed:
        raise QueryNotAllowed("no dashboard queries are provisioned")

    for query in queries:
        raw_sql = query.get("rawSql")
        if not isinstance(raw_sql, str) or not raw_sql.strip():
            # No SQL means a Prometheus/other target. Those live only on the
            # platform dashboard, which is not a member's to read.
            raise QueryNotAllowed("only SQL dashboard queries are permitted")

        normalised = normalise_sql(raw_sql)
        if normalised not in allowed:
            raise QueryNotAllowed(
                "query does not match a provisioned dashboard panel", normalised
            )
