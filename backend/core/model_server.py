"""Talking to the model-server.

Every call but its health checks must carry the shared internal token, so the
model-server answers the platform and nobody else, even if its port is reached.
"""
from __future__ import annotations

from core.config import AppSettings


def model_server_headers(settings: AppSettings) -> dict[str, str]:
    """Headers for a call to the model-server: the internal token, when one is set."""
    token = settings.model_server_internal_token
    return {"X-Internal-Token": token} if token else {}
