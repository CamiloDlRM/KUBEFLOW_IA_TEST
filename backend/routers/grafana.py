"""Authenticated reverse proxy in front of the embedded Grafana instance.

Grafana runs on a private Docker network (``grafana_internal_url``) with its
own login form and anonymous access **disabled**. The only way in is through
this proxy, which:

1. Authenticates the caller with the platform's own JWT (cookie or
   ``Authorization: Bearer``).
2. Injects the ``auth.proxy`` identity header (``grafana_auth_proxy_header``)
   with the authenticated ``username``. Any value the *client* sent for that
   header — or for any other ``X-WEBAUTH-*`` header — is dropped first, so a
   user cannot impersonate anybody by crafting the request by hand.
3. Streams the upstream response back untouched (minus hop-by-hop headers).

Because an ``<iframe>`` cannot attach an ``Authorization`` header, the SPA first
calls ``POST /grafana/session`` (a normal ``fetch`` with the Bearer token). That
endpoint sets a short-lived, HttpOnly, ``Path=/grafana`` cookie **and** returns a
single-use ``embed_url`` containing an opaque ticket. The iframe then points at
``embed_url``; ``GET /grafana/embed`` burns the ticket, (re)sets the cookie in
the iframe's own browsing context and redirects to the dashboard. Every
subsequent asset/API request the iframe makes carries the cookie.

Known limitation: WebSockets are **not** proxied (Grafana Live, ``/api/live/ws``,
returns ``501``). Dashboards only need the regular HTTP query API, so panels,
alerts and explore all work; only Grafana's live-streaming channels are lost.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Final
from urllib.parse import urlencode, urlparse

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse, StreamingResponse
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlmodel import Session, select
from starlette.background import BackgroundTask

from core.config import AppSettings, get_settings
from core.grafana_queries import QueryNotAllowed, authorize_query, is_query_path
from core.security import get_current_user
from db import get_session
from models.schemas import USERNAME_PATTERN, User

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/grafana", tags=["grafana"])


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Name of the proxy's own session cookie (scoped to ``/grafana``).
PROXY_COOKIE_NAME: Final[str] = "mlops_grafana_session"

#: ``typ`` claim that distinguishes a proxy cookie token from a platform token.
_PROXY_TOKEN_TYPE: Final[str] = "grafana_proxy"

#: Lifetime of a single-use embed ticket, in seconds.
_TICKET_TTL_SECONDS: Final[int] = 60

#: RFC 7230 hop-by-hop headers: never forwarded in either direction.
_HOP_BY_HOP: Final[frozenset[str]] = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "trailers",
        "transfer-encoding",
        "upgrade",
    }
)

#: Request headers dropped before forwarding upstream.
#:
#: ``authorization`` is stripped so our JWT never reaches Grafana (Grafana would
#: try to interpret it as one of its own API keys). ``x-forwarded-*`` is stripped
#: so a client cannot spoof its source address and defeat
#: ``GF_AUTH_PROXY_WHITELIST`` — Grafana must see the backend container's IP.
_STRIPPED_REQUEST_HEADERS: Final[frozenset[str]] = _HOP_BY_HOP | frozenset(
    {
        "host",
        "content-length",
        "authorization",
        "cookie",  # rewritten below: the proxy cookie is never forwarded
        "forwarded",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-port",
        "x-real-ip",
    }
)

#: Methods the proxy accepts on the catch-all route.
_PROXY_METHODS: Final[list[str]] = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
]

#: Methods whose request body is forwarded.
_BODY_METHODS: Final[frozenset[str]] = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: In-process single-use ticket store: ``ticket -> (username, expires_at)``.
#:
#: Deliberately in-memory: tickets live for a minute and are burned on first
#: use. With more than one uvicorn worker/replica a ticket minted by worker A
#: is unknown to worker B, so the ticket flow degrades to "cookie only" — which
#: still works, since ``POST /grafana/session`` sets the cookie on the same
#: response. Move this to Redis if you scale out and need the ticket path.
_TICKETS: dict[str, tuple[str, float]] = {}

_client: httpx.AsyncClient | None = None
_client_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class GrafanaSessionResponse(BaseModel):
    """Everything the SPA needs to mount the Grafana iframe."""

    username: str
    expires_at: datetime
    embed_url: str
    dashboard_url: str
    dashboard_uid: str


class GrafanaStatusResponse(BaseModel):
    """Whether the embedded Grafana section should be shown at all."""

    enabled: bool
    public_path: str
    dashboard_uid: str


# ---------------------------------------------------------------------------
# HTTP client
# ---------------------------------------------------------------------------


async def _get_client() -> httpx.AsyncClient:
    """Return the shared upstream client, creating it on first use."""
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0, connect=5.0),
                    follow_redirects=False,
                    limits=httpx.Limits(max_connections=50, max_keepalive_connections=10),
                )
    return _client


async def aclose_grafana_client() -> None:
    """Close the shared upstream client (call from the app lifespan shutdown)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ---------------------------------------------------------------------------
# Tokens, tickets and cookies
# ---------------------------------------------------------------------------


def _create_proxy_token(username: str, settings: AppSettings) -> tuple[str, datetime]:
    """Mint the proxy's own session JWT for ``username``."""
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    token = jwt.encode(
        {"sub": username, "exp": expires_at, "typ": _PROXY_TOKEN_TYPE},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return token, expires_at


def _decode_token(
    token: str,
    settings: AppSettings,
    *,
    require_type: str | None,
) -> str | None:
    """Decode a JWT and return its subject, or ``None`` when it is not valid."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        return None

    if require_type is not None and payload.get("typ") != require_type:
        return None
    subject = payload.get("sub")
    return subject if isinstance(subject, str) and subject else None


def _issue_ticket(username: str) -> str:
    """Create a single-use, short-lived ticket bound to ``username``."""
    _purge_tickets()
    ticket = secrets.token_urlsafe(32)
    _TICKETS[ticket] = (username, time.monotonic() + _TICKET_TTL_SECONDS)
    return ticket


def _redeem_ticket(ticket: str) -> str | None:
    """Consume ``ticket`` and return its username, or ``None`` if invalid."""
    _purge_tickets()
    entry = _TICKETS.pop(ticket, None)
    if entry is None:
        return None
    username, expires_at = entry
    if expires_at < time.monotonic():
        return None
    return username


def _purge_tickets() -> None:
    """Drop expired tickets so the store cannot grow without bound."""
    now = time.monotonic()
    for key in [k for k, (_, exp) in _TICKETS.items() if exp < now]:
        _TICKETS.pop(key, None)


def _site_of(url: str) -> str:
    """Return a coarse 'site' key (registrable-ish domain) for ``url``."""
    host = (urlparse(url).hostname or "").lower()
    labels = host.split(".")
    return ".".join(labels[-2:]) if len(labels) > 2 else host


def _cookie_policy(settings: AppSettings) -> tuple[str, bool]:
    """Return the ``(samesite, secure)`` policy for the proxy cookie.

    ``lax`` is used when the SPA and the backend are on the same site (the
    normal deployment). When they are cross-site the cookie must be
    ``SameSite=None; Secure`` to survive an iframe — and browsers that block
    third-party cookies will still drop it, so same-site hosting is strongly
    recommended. Override with ``GRAFANA_PROXY_COOKIE_SAMESITE``.
    """
    backend_https = settings.backend_public_url.lower().startswith("https://")
    override = os.getenv("GRAFANA_PROXY_COOKIE_SAMESITE", "").strip().lower()
    if override in {"lax", "strict", "none"}:
        samesite = override
    else:
        same_site_deployment = _site_of(settings.frontend_url) == _site_of(
            settings.backend_public_url
        )
        samesite = "lax" if same_site_deployment else "none"

    if samesite == "none" and not backend_https:
        # Browsers reject SameSite=None without Secure; degrade instead of
        # silently issuing a cookie that is never stored.
        logger.warning(
            "grafana.cookie_samesite_downgraded",
            reason="SameSite=None requires HTTPS",
            backend_public_url=settings.backend_public_url,
        )
        samesite = "lax"

    return samesite, backend_https


def _set_proxy_cookie(response: Response, token: str, settings: AppSettings) -> None:
    """Attach the HttpOnly proxy session cookie to ``response``."""
    samesite, secure = _cookie_policy(settings)
    response.set_cookie(
        key=PROXY_COOKIE_NAME,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        path=_public_prefix(settings) or "/",
        httponly=True,
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------


def _public_prefix(settings: AppSettings) -> str:
    """Return the normalised public sub-path, e.g. ``/grafana`` (never ``/``)."""
    prefix = "/" + settings.grafana_public_path.strip("/")
    return "" if prefix == "/" else prefix


def _upstream_url(settings: AppSettings, path: str) -> str:
    """Build the upstream URL for a proxied ``path``.

    Grafana runs with ``GF_SERVER_SERVE_FROM_SUB_PATH=true``, so it expects the
    public sub-path to be present in the request line.
    """
    base = settings.grafana_internal_url.rstrip("/")
    return f"{base}{_public_prefix(settings)}/{path.lstrip('/')}"


def _require_enabled(settings: AppSettings) -> None:
    """Raise 404 when the Grafana integration is switched off."""
    if not settings.grafana_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Grafana integration is disabled.",
        )


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def _resolve_proxy_user(
    request: Request,
    session: Session,
    settings: AppSettings,
) -> User:
    """Authenticate a proxied request from the cookie or the Bearer header.

    The cookie is what the iframe actually sends; the ``Authorization`` header
    is accepted so the SPA (or curl) can hit the proxy directly.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated for Grafana.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    username: str | None = None

    cookie_token = request.cookies.get(PROXY_COOKIE_NAME)
    if cookie_token:
        username = _decode_token(
            cookie_token, settings, require_type=_PROXY_TOKEN_TYPE
        )

    if username is None:
        header = request.headers.get("authorization", "")
        scheme, _, credentials = header.partition(" ")
        if scheme.lower() == "bearer" and credentials.strip():
            username = _decode_token(
                credentials.strip(), settings, require_type=None
            )

    if username is None:
        raise unauthorized

    user = session.exec(select(User).where(User.username == username)).first()
    if user is None or not user.is_active:
        raise unauthorized
    return user


# ---------------------------------------------------------------------------
# Header filtering
# ---------------------------------------------------------------------------


def _identity_headers(user: User, settings: AppSettings) -> dict[str, str]:
    """Build the auth-proxy identity headers Grafana is told to trust.

    Grafana hands this username to the dashboards as ``${__user.login}`` and
    interpolates it *verbatim* into the panel SQL, with no parameter binding.
    ``USERNAME_PATTERN`` is enforced on both paths that can set a username, so
    a stored value should never contain a quote — but this is the one place the
    value leaves our process, and a row predating that rule (or seeded straight
    from ``ADMIN_USERNAME``) would bypass it. Fail closed here rather than hand
    Grafana something that changes the meaning of its own queries.
    """
    if not re.fullmatch(USERNAME_PATTERN, user.username):
        logger.error(
            "grafana.username_rejected",
            user_id=user.id,
            reason="does not match USERNAME_PATTERN",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This account's username contains characters that cannot be "
                "passed to Grafana safely (a quote, a backslash or whitespace). "
                "Letters, digits and _ . + - @ are accepted, so an email "
                "address works. Change it in Settings, or ask an admin to."
            ),
        )
    return {settings.grafana_auth_proxy_header: user.username}


def _is_forbidden_client_header(name: str, settings: AppSettings) -> bool:
    """Return True for headers a client must never be able to set upstream.

    Blocks the configured auth-proxy header and, defensively, every
    ``X-WEBAUTH-*`` header — otherwise a user could add
    ``X-WEBAUTH-USER: someone-else`` by hand and log into Grafana as another
    account. ``X-WEBAUTH-*`` is the conventional prefix for the extra headers
    ``GF_AUTH_PROXY_HEADERS`` can map to name/email/**role**, so the whole
    family is refused even though only the identity header is enabled today.

    ``X-Grafana-*`` headers are deliberately *not* blocked: they carry UI state
    (org id, device id) that Grafana re-validates against the session, and
    dropping them breaks the frontend.
    """
    lowered = name.lower()
    return (
        lowered == settings.grafana_auth_proxy_header.lower()
        or lowered.startswith("x-webauth-")
    )


def _build_request_headers(
    request: Request,
    user: User,
    settings: AppSettings,
) -> dict[str, str]:
    """Copy the client's headers, dropping the unsafe ones and adding identity."""
    headers: dict[str, str] = {}
    for name, value in request.headers.items():
        lowered = name.lower()
        if lowered in _STRIPPED_REQUEST_HEADERS:
            continue
        if _is_forbidden_client_header(lowered, settings):
            logger.warning(
                "grafana.spoofed_identity_header_dropped",
                header=lowered,
                username=user.username,
                path=request.url.path,
            )
            continue
        headers[name] = value

    # Grafana's own session cookie must still reach it; ours must not.
    forwarded_cookies = "; ".join(
        f"{key}={value}"
        for key, value in request.cookies.items()
        if key != PROXY_COOKIE_NAME
    )
    if forwarded_cookies:
        headers["cookie"] = forwarded_cookies

    headers.update(_identity_headers(user, settings))
    return headers


def _build_response_headers(upstream: httpx.Response) -> list[tuple[bytes, bytes]]:
    """Copy upstream headers, dropping hop-by-hop ones (keeps multi Set-Cookie)."""
    return [
        (name.encode("latin-1"), value.encode("latin-1"))
        for name, value in upstream.headers.multi_items()
        if name.lower() not in _HOP_BY_HOP
    ]


# ---------------------------------------------------------------------------
# Session bootstrap endpoints (declared before the catch-all route)
# ---------------------------------------------------------------------------


@router.get("/status", response_model=GrafanaStatusResponse)
async def grafana_status(
    settings: Annotated[AppSettings, Depends(get_settings)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> GrafanaStatusResponse:
    """Report whether the embedded Grafana section is available."""
    return GrafanaStatusResponse(
        enabled=settings.grafana_enabled,
        public_path=_public_prefix(settings) or "/",
        dashboard_uid=settings.grafana_ml_dashboard_uid,
    )


@router.post("/session", response_model=GrafanaSessionResponse)
async def create_grafana_session(
    response: Response,
    settings: Annotated[AppSettings, Depends(get_settings)],
    current_user: Annotated[User, Depends(get_current_user)],
    kiosk: bool = True,
    theme: str = "",
) -> GrafanaSessionResponse:
    """Open a Grafana proxy session for the authenticated user.

    Called by the SPA with the normal ``Authorization: Bearer`` header before
    the iframe is mounted. Sets the proxy cookie *and* returns a single-use
    ``embed_url`` so the iframe works even when the cookie needs to be
    (re)issued inside the frame.
    """
    _require_enabled(settings)

    token, expires_at = _create_proxy_token(current_user.username, settings)
    _set_proxy_cookie(response, token, settings)

    ticket = _issue_ticket(current_user.username)
    prefix = _public_prefix(settings)
    uid = settings.grafana_ml_dashboard_uid

    query: dict[str, str] = {"ticket": ticket, "uid": uid}
    if kiosk:
        query["kiosk"] = "1"
    if theme in {"light", "dark"}:
        query["theme"] = theme

    logger.info(
        "grafana.session_created",
        username=current_user.username,
        dashboard_uid=uid,
    )
    return GrafanaSessionResponse(
        username=current_user.username,
        expires_at=expires_at,
        embed_url=f"{prefix}/embed?{urlencode(query)}",
        dashboard_url=f"{prefix}/d/{uid}",
        dashboard_uid=uid,
    )


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def delete_grafana_session(
    settings: Annotated[AppSettings, Depends(get_settings)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Response:
    """Drop the proxy cookie (call this on logout)."""
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        key=PROXY_COOKIE_NAME,
        path=_public_prefix(settings) or "/",
    )
    logger.info("grafana.session_deleted", username=current_user.username)
    return response


@router.get("/embed", include_in_schema=False)
async def grafana_embed(
    request: Request,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    ticket: str = "",
    uid: str = "",
    kiosk: str = "",
    theme: str = "",
) -> Response:
    """Iframe entry point: burn the ticket, set the cookie, redirect.

    The ticket is opaque, single-use and expires in a minute, so the URL that
    briefly appears in the iframe's history / access logs is not a credential
    that can be replayed.
    """
    _require_enabled(settings)

    username: str | None = _redeem_ticket(ticket) if ticket else None
    if username is None:
        # No (valid) ticket: fall back to an already-established session.
        username = _resolve_proxy_user(request, session, settings).username

    user = session.exec(select(User).where(User.username == username)).first()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated for Grafana.",
        )

    dashboard_uid = uid or settings.grafana_ml_dashboard_uid
    target_query: dict[str, str] = {}
    if kiosk:
        target_query["kiosk"] = ""
    if theme in {"light", "dark"}:
        target_query["theme"] = theme
    suffix = f"?{urlencode(target_query)}" if target_query else ""

    token, _ = _create_proxy_token(user.username, settings)
    redirect = RedirectResponse(
        url=f"{_public_prefix(settings)}/d/{dashboard_uid}{suffix}",
        status_code=status.HTTP_302_FOUND,
    )
    _set_proxy_cookie(redirect, token, settings)
    logger.info("grafana.embed_bootstrapped", username=user.username, dashboard_uid=dashboard_uid)
    return redirect


# ---------------------------------------------------------------------------
# Catch-all reverse proxy (must stay last)
# ---------------------------------------------------------------------------


@router.api_route("/{path:path}", methods=_PROXY_METHODS, include_in_schema=False)
async def grafana_proxy(
    path: str,
    request: Request,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    """Forward an authenticated request to Grafana and stream the answer back."""
    _require_enabled(settings)

    user = _resolve_proxy_user(request, session, settings)

    if path.rstrip("/").endswith("api/live/ws"):
        # Starlette cannot upgrade an HTTP route to a WebSocket; Grafana Live
        # is therefore unavailable behind this proxy (dashboards do not need it).
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="WebSocket streaming (Grafana Live) is not proxied.",
        )

    method = request.method.upper()
    body: bytes | None = None
    if method in _BODY_METHODS:
        body = await request.body()

    # Grafana's Viewer role can *run* arbitrary datasource queries even though
    # it cannot save an edited panel, which would let a member read every
    # tenant's rows and bypass the ${__user.login} filter the dashboards apply.
    # Every request reaches Grafana through here, so this is where it is caught.
    if is_query_path(path):
        try:
            authorize_query(body or b"", user, settings)
        except QueryNotAllowed as exc:
            logger.warning(
                "grafana.query_rejected",
                username=user.username,
                path=path,
                reason=exc.reason,
                sql=exc.sql,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Only the provisioned dashboard queries may be run. "
                    "Ad-hoc queries and Explore are disabled for your account."
                ),
            ) from exc

    # Forward the raw query string so repeated keys and exact encoding survive.
    url = _upstream_url(settings, path)
    if request.url.query:
        url = f"{url}?{request.url.query}"

    client = await _get_client()
    upstream_request = client.build_request(
        method=method,
        url=url,
        headers=_build_request_headers(request, user, settings),
        content=body,
    )

    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as exc:
        logger.error(
            "grafana.upstream_unreachable",
            error=str(exc),
            path=path,
            username=user.username,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Grafana is unreachable.",
        ) from exc

    return _streaming_response(upstream)


def _streaming_response(upstream: httpx.Response) -> StreamingResponse:
    """Wrap an upstream streaming response, preserving its raw headers."""
    response = StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        background=BackgroundTask(upstream.aclose),
    )
    # Replace Starlette's computed headers with the upstream ones so repeated
    # Set-Cookie headers and Content-Encoding survive untouched.
    response.raw_headers = _build_response_headers(upstream)
    return response
