"""Encrypt per-repository GitHub credentials at rest."""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet
from sqlmodel import Session, select

from core.config import AppSettings
from models.schemas import AuthProvider, Repository, User, UserIdentity

#: Seeded by migration 0023; recreated here when missing (tests use create_all).
_PROVIDERS = {"github": ("GitHub", "@g"), "token": ("GitHub token", "@t")}


class MissingOwnerToken(ValueError):
    """The repository calls GitHub with its owner's token, and the owner has none."""


def _fernet(settings: AppSettings) -> Fernet:
    key = base64.urlsafe_b64encode(
        hashlib.sha256(settings.jwt_secret_key.encode()).digest()
    )
    return Fernet(key)


def encrypt_token(token: str, settings: AppSettings) -> str:
    return _fernet(settings).encrypt(token.encode()).decode()


def decrypt_token(token: str, settings: AppSettings) -> str:
    return _fernet(settings).decrypt(token.encode()).decode()


def mask_token(token: str) -> str:
    return f"****{token[-4:]}" if len(token) >= 4 else "****"


def get_provider(session: Session, code: str) -> AuthProvider:
    provider = session.exec(select(AuthProvider).where(AuthProvider.code == code)).first()
    if provider is None:
        name, suffix = _PROVIDERS[code]
        provider = AuthProvider(code=code, name=name, username_suffix=suffix)
        session.add(provider)
        session.flush()
    return provider


def identity_of(session: Session, user: User) -> tuple[UserIdentity, AuthProvider] | None:
    row = session.exec(
        select(UserIdentity, AuthProvider)
        .where(UserIdentity.user_id == user.id, UserIdentity.provider_id == AuthProvider.id)
    ).first()
    return (row[0], row[1]) if row else None


def user_token(session: Session, user: User, settings: AppSettings) -> str:
    """The GitHub token of the user's sign-in identity, or "" if none."""
    found = identity_of(session, user)
    if not found or not found[0].github_token_encrypted:
        return ""
    return decrypt_token(found[0].github_token_encrypted, settings)


def set_user_token(session: Session, identity: UserIdentity, token: str, settings: AppSettings) -> None:
    from datetime import datetime, timezone

    identity.github_token_encrypted = encrypt_token(token, settings)
    identity.github_token_masked = mask_token(token)
    identity.updated_at = datetime.now(timezone.utc)
    session.add(identity)


def repo_token(repo: Repository, settings: AppSettings) -> str:
    """Return the token a repository calls GitHub with.

    Repositories registered before sign-in identities (``uses_owner_token``
    false) keep the exact old behaviour: their own token, then the global one.
    """
    if not repo.uses_owner_token:
        if repo.github_token_encrypted:
            return _fernet(settings).decrypt(repo.github_token_encrypted.encode()).decode()
        return settings.github_token
    session = Session.object_session(repo)
    owner = session.get(User, repo.owner_id) if session and repo.owner_id else None
    token = user_token(session, owner, settings) if owner else ""
    if not token:
        raise MissingOwnerToken("The repository owner has no GitHub token. Update it in Settings.")
    return token


def token_problem(exc: BaseException, action: str) -> str | None:
    """What a GitHub refusal says about the token, or None when it was not a refusal.

    Every call to a repository goes with its owner's token (``repo_token``),
    so a refusal is something only the owner can fix, in Settings. A 401 is a
    token GitHub no longer accepts: expired or revoked. A 403, or a 404 on a
    write (GitHub answers 404 rather than reveal a repository the token
    cannot write to), is a token without permission on this repository.
    Quoting the URL GitHub refused, as the raw error does, says none of that.
    """
    import httpx

    if isinstance(exc, MissingOwnerToken):
        return str(exc)
    if not isinstance(exc, httpx.HTTPStatusError):
        return None
    code = exc.response.status_code
    if code == 401:
        return (
            f"GitHub rejected the repository owner's token while trying to {action}: it expired "
            "or was revoked. The owner must update their GitHub token in Settings."
        )
    if code == 403 or (code == 404 and exc.request.method != "GET"):
        return (
            f"The repository owner's token cannot {action}: it has no write access to this "
            "repository, or the branch is protected. The owner must update their GitHub token "
            "in Settings."
        )
    return None
