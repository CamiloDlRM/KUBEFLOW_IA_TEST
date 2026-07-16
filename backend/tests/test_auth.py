"""Tests for the authentication endpoints and security helpers."""
from __future__ import annotations

from core.security import (
    create_token,
    hash_password,
    verify_password,
    verify_token,
)
from models.schemas import User


def seed_user(session, email="admin@mlops.local", password="admin123", **kwargs):
    user = User(
        email=email,
        password_hash=hash_password(password),
        full_name=kwargs.pop("full_name", "Administrator"),
        **kwargs,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


class TestSecurityHelpers:
    def test_password_roundtrip(self):
        stored = hash_password("s3cret!")
        assert verify_password("s3cret!", stored)
        assert not verify_password("wrong", stored)

    def test_password_hashes_are_salted(self):
        assert hash_password("same") != hash_password("same")

    def test_verify_password_malformed_stored_value(self):
        assert not verify_password("x", "not-a-valid-hash")

    def test_token_roundtrip(self):
        token = create_token("user@example.com")
        assert verify_token(token) == "user@example.com"

    def test_tampered_token_rejected(self):
        token = create_token("user@example.com")
        assert verify_token(token + "x") is None
        assert verify_token("garbage") is None


class TestLoginEndpoint:
    def test_login_success(self, test_app, db_session):
        seed_user(db_session)
        resp = test_app.post(
            "/auth/login",
            json={"email": "admin@mlops.local", "password": "admin123"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["email"] == "admin@mlops.local"
        assert body["token_type"] == "bearer"
        assert verify_token(body["access_token"]) == "admin@mlops.local"

    def test_login_wrong_password(self, test_app, db_session):
        seed_user(db_session)
        resp = test_app.post(
            "/auth/login",
            json={"email": "admin@mlops.local", "password": "nope"},
        )
        assert resp.status_code == 401

    def test_login_unknown_user(self, test_app):
        resp = test_app.post(
            "/auth/login",
            json={"email": "ghost@mlops.local", "password": "x"},
        )
        assert resp.status_code == 401

    def test_login_inactive_user(self, test_app, db_session):
        seed_user(db_session, is_active=False)
        resp = test_app.post(
            "/auth/login",
            json={"email": "admin@mlops.local", "password": "admin123"},
        )
        assert resp.status_code == 401


class TestMeEndpoint:
    def test_me_with_valid_token(self, test_app, db_session):
        seed_user(db_session)
        token = create_token("admin@mlops.local")
        resp = test_app.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["email"] == "admin@mlops.local"

    def test_me_without_token(self, test_app):
        resp = test_app.get("/auth/me")
        assert resp.status_code == 401

    def test_me_with_invalid_token(self, test_app):
        resp = test_app.get("/auth/me", headers={"Authorization": "Bearer bogus"})
        assert resp.status_code == 401
