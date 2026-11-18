"""Tests for ``GET /models/traffic``: prediction requests per deployed model.

Prometheus is faked on ``httpx.MockTransport`` and answers for every model on
the platform, as the real one does: it has no notion of owners. What is
asserted is that the endpoint narrows that answer to the caller's models.
"""
from __future__ import annotations

import httpx
import pytest

from tests.conftest import OTHER_USER_ID, seed_pipeline, seed_repo


def _deploy(db_session, name: str, owner_id: int) -> None:
    from models.schemas import ModelDeployment

    repo = seed_repo(db_session, owner_id=owner_id, github_url=f"https://github.com/x/{name}")
    run = seed_pipeline(db_session, repo.id)
    db_session.add(ModelDeployment(model_name=name, version="1", pipeline_id=run.id, is_active=True))
    db_session.commit()


def _prometheus(monkeypatch, handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    real = httpx.AsyncClient

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(recording), **kw)
    )
    return seen


def _vector(**counts: float) -> httpx.Response:
    result = [{"metric": {"model_name": n}, "value": [0, str(v)]} for n, v in counts.items()]
    return httpx.Response(200, json={"status": "success", "data": {"result": result}})


@pytest.fixture()
def two_tenants(db_session):
    _deploy(db_session, "mine", owner_id=1)
    _deploy(db_session, "quiet", owner_id=1)
    _deploy(db_session, "theirs", owner_id=OTHER_USER_ID)


class TestModelTraffic:
    def test_a_member_sees_only_their_models_counts(self, test_app, two_tenants, monkeypatch):
        _prometheus(monkeypatch, lambda _: _vector(mine=41.7, theirs=900))

        body = test_app.get("/models/traffic").json()

        assert body["available"] is True
        # Rounded, since increase() extrapolates; zero for a model nobody called;
        # and nothing at all about another tenant's model.
        assert body["requests"] == {"mine": 42, "quiet": 0}

    def test_an_admin_sees_every_model(self, admin_app, two_tenants, monkeypatch):
        _prometheus(monkeypatch, lambda _: _vector(mine=3, theirs=900))

        body = admin_app.get("/models/traffic").json()

        assert body["requests"] == {"mine": 3, "quiet": 0, "theirs": 900}

    def test_prometheus_down_is_unknown_not_zero(self, test_app, two_tenants, monkeypatch):
        _prometheus(monkeypatch, lambda _: httpx.Response(503))

        body = test_app.get("/models/traffic").json()

        assert body["available"] is False

    def test_nobody_asks_prometheus_when_there_is_nothing_to_count(self, test_app, monkeypatch):
        seen = _prometheus(monkeypatch, lambda _: _vector())

        body = test_app.get("/models/traffic").json()

        assert body == {"window": "30d", "available": True, "requests": {}}
        assert seen == []
