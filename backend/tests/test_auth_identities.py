"""Sign-in identities: open registration, per-user GitHub token, legacy repos."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from tests.conftest import DEFAULT_USER_ID


@pytest.fixture()
def anon_app(db_engine):
    from db import get_session
    from main import app

    def _session():
        with Session(db_engine) as session:
            yield session

    app.dependency_overrides[get_session] = _session
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _register(client, username="wil", token_status="ok"):
    with patch("routers.auth.check_github_token", new=AsyncMock(return_value=token_status)):
        return client.post("/auth/register", json={
            "username": username, "password": "password123",
            "email": "wil@example.com", "github_token": "ghp_user_token_9999",
        })


def test_register_is_open_and_adds_the_token_suffix(anon_app):
    resp = _register(anon_app)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["username"] == "wil@t"
    assert body["auth_provider"] == "token"
    assert body["has_github_token"] is True
    assert body["github_token_masked"] == "****9999"


def test_register_twice_with_same_username_is_409(anon_app):
    assert _register(anon_app).status_code == 201
    assert _register(anon_app, username="wil@t").status_code == 409


def test_register_with_invalid_github_token_is_400(anon_app):
    assert _register(anon_app, token_status="invalid").status_code == 400


def test_login_without_the_token_suffix_finds_the_t_account(anon_app):
    _register(anon_app)
    with patch("routers.auth.check_github_token", new=AsyncMock(return_value="ok")):
        assert anon_app.post("/auth/login", data={"username": "wil", "password": "password123"}).status_code == 200
        assert anon_app.post("/auth/login", data={"username": "wil", "password": "wrong"}).status_code == 401
        assert anon_app.post("/auth/login", data={"username": "nobody", "password": "password123"}).status_code == 401


def test_login_reports_github_token_status(anon_app):
    _register(anon_app)
    with patch("routers.auth.check_github_token", new=AsyncMock(return_value="invalid")):
        resp = anon_app.post("/auth/login", data={"username": "wil@t", "password": "password123"})
    assert resp.status_code == 200
    assert resp.json()["github_token_status"] == "invalid"


def test_legacy_repo_keeps_its_own_token(db_session):
    from core.config import get_settings
    from core.github_credentials import (
        encrypt_token, get_provider, repo_token, set_user_token,
    )
    from models.schemas import Repository, User, UserIdentity

    settings = get_settings()
    user = User(username="old@t", hashed_password="x")
    db_session.add(user)
    db_session.flush()
    identity = UserIdentity(user_id=user.id, provider_id=get_provider(db_session, "token").id)
    set_user_token(db_session, identity, "ghp_owner_token", settings)
    legacy = Repository(owner_id=user.id, github_url="https://github.com/a/old",
                        github_token_encrypted=encrypt_token("ghp_repo_token", settings))
    new = Repository(owner_id=user.id, github_url="https://github.com/a/new", uses_owner_token=True)
    db_session.add_all([legacy, new])
    db_session.commit()

    assert repo_token(legacy, settings) == "ghp_repo_token"
    assert repo_token(new, settings) == "ghp_owner_token"


def test_new_repo_without_body_token_uses_the_owner_token(
    test_app, db_session, mock_github_create_webhook
):
    from core.config import get_settings
    from core.github_credentials import get_provider, set_user_token
    from models.schemas import Repository, UserIdentity

    identity = UserIdentity(user_id=DEFAULT_USER_ID, provider_id=get_provider(db_session, "token").id)
    set_user_token(db_session, identity, "ghp_owner_token_abcd", get_settings())
    db_session.commit()

    resp = test_app.post("/repos", json={"github_url": "https://github.com/a/fresh"})
    assert resp.status_code == 201, resp.text
    assert mock_github_create_webhook.call_args.kwargs["token"] == "ghp_owner_token_abcd"
    repo = db_session.get(Repository, resp.json()["repo_id"])
    assert repo.uses_owner_token is True
    assert repo.github_token_encrypted == ""


@pytest.mark.asyncio
async def test_check_github_token_classifies_responses():
    from core.github import check_github_token

    def _resp(code, headers=None):
        return httpx.Response(code, headers=headers or {}, request=httpx.Request("GET", "https://x"))

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=_resp(401))):
        assert await check_github_token("t") == "invalid"
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=_resp(200, {
        "github-authentication-token-expiration": "2000-01-01 00:00:00 UTC"}))):
        assert await check_github_token("t") == "expiring"
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=_resp(200))):
        assert await check_github_token("t") == "ok"
    assert await check_github_token("") == "missing"


@pytest.fixture()
def oauth_settings():
    from core.config import get_settings
    from main import app

    settings = get_settings().model_copy(update={
        "github_oauth_client_id": "cid", "github_oauth_client_secret": "secret",
    })
    app.dependency_overrides[get_settings] = lambda: settings
    yield settings
    app.dependency_overrides.pop(get_settings, None)


def _start_github_login(client):
    from urllib.parse import parse_qs, urlparse

    resp = client.get("/auth/github/login", follow_redirects=False)
    assert resp.status_code == 302
    state = parse_qs(urlparse(resp.headers["location"]).query)["state"][0]
    return state, resp.cookies.get("gh_oauth_nonce")


def test_github_callback_rejects_a_state_from_another_browser(anon_app, oauth_settings):
    state, nonce = _start_github_login(anon_app)
    assert nonce
    anon_app.cookies.clear()  # the victim's browser never got the cookie
    with patch("httpx.AsyncClient.post", new=AsyncMock()) as github:
        resp = anon_app.get(f"/auth/github/callback?code=c&state={state}", follow_redirects=False)
    assert resp.status_code == 400
    github.assert_not_called()

    anon_app.cookies.set("gh_oauth_nonce", "someone-elses", path="/auth/github")
    resp = anon_app.get(f"/auth/github/callback?code=c&state={state}", follow_redirects=False)
    assert resp.status_code == 400


def test_github_nonce_cookie_follows_the_public_url_prefix(anon_app, oauth_settings):
    # Behind the frontend's nginx the browser reaches the callback at /api/auth/github/...
    oauth_settings.backend_public_url = "https://app.example.com/api/"
    resp = anon_app.get("/auth/github/login", follow_redirects=False)
    assert "Path=/api/auth/github" in resp.headers["set-cookie"]


def test_github_callback_in_the_same_browser_creates_the_g_user(anon_app, oauth_settings, db_session):
    from models.schemas import User

    state, _ = _start_github_login(anon_app)

    def _resp(payload):
        return httpx.Response(200, json=payload, request=httpx.Request("GET", "https://x"))

    get = AsyncMock(side_effect=[
        _resp({"id": 42, "login": "wil", "email": None}),
        _resp([{"email": "gh@example.com", "primary": True, "verified": True}]),
    ])
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_resp({"access_token": "gho_x"}))), \
         patch("httpx.AsyncClient.get", new=get):
        resp = anon_app.get(f"/auth/github/callback?code=c&state={state}", follow_redirects=False)

    assert resp.status_code == 302, resp.text
    assert "/auth/github?token=" in resp.headers["location"]
    user = db_session.exec(select(User).where(User.username == "wil@g")).first()
    assert user is not None and user.needs_password is True
