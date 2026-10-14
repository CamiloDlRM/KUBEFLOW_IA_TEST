"""Encrypt per-repository GitHub credentials at rest."""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from core.config import AppSettings
from models.schemas import Repository


def _fernet(settings: AppSettings) -> Fernet:
    key = base64.urlsafe_b64encode(
        hashlib.sha256(settings.jwt_secret_key.encode()).digest()
    )
    return Fernet(key)


def encrypt_token(token: str, settings: AppSettings) -> str:
    return _fernet(settings).encrypt(token.encode()).decode()


def repo_token(repo: Repository, settings: AppSettings) -> str:
    """Return the repository token, falling back to the global token."""
    if repo.github_token_encrypted:
        return _fernet(settings).decrypt(repo.github_token_encrypted.encode()).decode()
    return settings.github_token
