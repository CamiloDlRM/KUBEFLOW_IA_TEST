"""Password hashing and session-token signing.

Uses only the standard library (PBKDF2-HMAC-SHA256 for passwords, HMAC-SHA256
for tokens) to avoid extra dependencies in the Docker image.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time

from core.config import get_settings

_PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    """Return a salted PBKDF2 hash in the form ``salt$hash`` (base64)."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return (
        base64.urlsafe_b64encode(salt).decode()
        + "$"
        + base64.urlsafe_b64encode(digest).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    """Check a plaintext password against a stored ``salt$hash`` value."""
    try:
        salt_b64, digest_b64 = stored.split("$", 1)
        salt = base64.urlsafe_b64decode(salt_b64)
        expected = base64.urlsafe_b64decode(digest_b64)
    except (ValueError, TypeError):
        return False
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS
    )
    return hmac.compare_digest(candidate, expected)


def create_token(email: str) -> str:
    """Issue a signed session token: ``base64(email)|expiry|signature``."""
    settings = get_settings()
    expiry = int(time.time()) + settings.auth_token_ttl_hours * 3600
    payload = f"{base64.urlsafe_b64encode(email.encode()).decode()}|{expiry}"
    sig = hmac.new(
        settings.auth_secret_key.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload}|{sig}"


def verify_token(token: str) -> str | None:
    """Return the email encoded in a valid, unexpired token, else None."""
    settings = get_settings()
    try:
        email_b64, expiry_str, sig = token.split("|")
    except (ValueError, AttributeError):
        return None
    payload = f"{email_b64}|{expiry_str}"
    expected = hmac.new(
        settings.auth_secret_key.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        if int(expiry_str) < time.time():
            return None
        return base64.urlsafe_b64decode(email_b64).decode()
    except (ValueError, TypeError):
        return None
