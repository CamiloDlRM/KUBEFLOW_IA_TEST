"""Who looked at the rows of a project that holds health data.

Ley 1581 de 2012 asks that personal data be kept under conditions that
prevent unauthorised consultation (art. 17) and that access to it be
restricted (principle of restricted access and circulation). The platform
already restricts it: a project is visible to its owner and to
administrators, nobody else. What it did not do was keep a record — and an
administrator can open any project, so without a record that access is
invisible.

Every endpoint that returns rows is wrapped with :func:`audited`. In a
general project it does nothing. In a health project it records who saw
what, how many rows, and whether they did so as an administrator of a
project that is not theirs. Only views that succeeded are recorded: a
refused request showed nothing. The record is append-only; nothing in the
API edits or deletes it.
"""
from __future__ import annotations

import functools
import inspect
from datetime import datetime, timezone
from typing import Any, Callable

import structlog

logger = structlog.get_logger(__name__)


def describe(*parts: Any, **named: Any) -> str:
    """A short label for what was viewed, leaving out what was not given."""
    words = [str(part) for part in parts if part not in (None, "")]
    words += [f"{name} {value}" for name, value in named.items() if value not in (None, "")]
    return " · ".join(words)


def _shown(result: Any) -> int:
    """How many rows a response put on someone's screen."""
    rows = getattr(result, "rows", None)
    if isinstance(rows, list):
        return len(rows)
    steps = getattr(result, "steps", None)
    if isinstance(steps, list):
        return max((len(getattr(step, "preview_rows", []) or []) for step in steps), default=0)
    return 0


def record_access(
    session: Any,
    project_id: int | None,
    user: Any,
    action: str,
    *,
    resource: str = "",
    rows: int = 0,
) -> None:
    """Record a view of a health project's rows. Nothing for a general project."""
    from core.ownership import is_admin, owns_project
    from core.privacy import ProjectPrivacy
    from models.schemas import DataAccess, Project

    if session is None or project_id is None or user is None:
        return
    project = session.get(Project, project_id)
    if project is None or not ProjectPrivacy.from_stored(project.privacy).health:
        return
    session.add(
        DataAccess(
            project_id=project_id,
            user_id=getattr(user, "id", None),
            username=getattr(user, "username", "") or "",
            as_admin=bool(is_admin(user) and not owns_project(project, user)),
            action=action,
            resource=resource[:300],
            rows=rows,
            created_at=datetime.now(timezone.utc),
        )
    )
    session.commit()


def audited(
    action: str,
    *,
    project: Callable[[dict[str, Any], Any], int | None] = lambda kwargs, session: kwargs.get("project_id"),
    resource: Callable[[dict[str, Any]], str] = lambda kwargs: "",
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Record each successful call of an endpoint that returns rows.

    Applied under the route decorator. FastAPI reads the endpoint's
    signature through ``functools.wraps``, so dependencies resolve as before.
    A failure to record never fails the request: the user already has the
    rows, and losing the response would not take them back.
    """

    def decorate(endpoint: Callable[..., Any]) -> Callable[..., Any]:
        def after(kwargs: dict[str, Any], result: Any) -> None:
            session = kwargs.get("session")
            try:
                record_access(
                    session,
                    project(kwargs, session),
                    kwargs.get("current_user"),
                    action,
                    resource=resource(kwargs),
                    rows=_shown(result),
                )
            except Exception as exc:  # noqa: BLE001 — see the docstring
                logger.error("access_log.record_failed", action=action, error=str(exc))

        if inspect.iscoroutinefunction(endpoint):

            @functools.wraps(endpoint)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                result = await endpoint(*args, **kwargs)
                after(kwargs, result)
                return result

        else:

            @functools.wraps(endpoint)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                result = endpoint(*args, **kwargs)
                after(kwargs, result)
                return result

        # The routers use postponed annotations, which FastAPI resolves in the
        # function's own module. The wrapper lives here, so it carries the
        # endpoint's signature already evaluated.
        wrapper.__signature__ = inspect.signature(endpoint, eval_str=True)  # type: ignore[attr-defined]
        return wrapper

    return decorate
