"""Centralized database engine and session dependency.

A single SQLAlchemy engine is created once from AppSettings and reused
across all routers. Use get_session() as a FastAPI Depends to get a
per-request SQLModel Session.
"""
from __future__ import annotations

from typing import Generator

from sqlmodel import Session, create_engine

from core.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    echo=False,
    pool_pre_ping=True,
)


def get_session() -> Generator[Session, None, None]:
    """Yield a SQLModel session, closing it after the request."""
    with Session(engine) as session:
        yield session
