"""A model's public link: the token in its URL, and whether it answers."""
from __future__ import annotations

import secrets

from sqlmodel import Session, select

from core.config import AppSettings
from models.schemas import ModelShareLink, User


def new_token() -> str:
    """32 random bytes, URL-safe: too many possibilities to guess or walk through."""
    return secrets.token_urlsafe(32)


def link_for(session: Session, model_name: str) -> ModelShareLink | None:
    return session.exec(select(ModelShareLink).where(ModelShareLink.model_name == model_name)).first()


def enabled_link(session: Session, token: str) -> ModelShareLink | None:
    """The link a public request names, if it exists and is switched on."""
    link = session.exec(select(ModelShareLink).where(ModelShareLink.token == token)).first()
    return link if link and link.enabled else None


def set_enabled(session: Session, model_name: str, enabled: bool, user: User) -> ModelShareLink:
    """Switch the link on or off, creating it (with a fresh token) the first time."""
    link = link_for(session, model_name)
    if link is None:
        link = ModelShareLink(model_name=model_name, token=new_token(), created_by=user.id)
    link.enabled = enabled
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


def rotate(session: Session, model_name: str, user: User) -> ModelShareLink:
    """Replace the token: the old URL stops working at once. For a leaked link."""
    link = link_for(session, model_name)
    if link is None:
        link = ModelShareLink(model_name=model_name, token=new_token(), created_by=user.id)
    else:
        link.token = new_token()
    session.add(link)
    session.commit()
    session.refresh(link)
    return link


def public_url(settings: AppSettings, link: ModelShareLink) -> str:
    return f"{settings.backend_public_url.rstrip('/')}/public/predict/{link.token}"
