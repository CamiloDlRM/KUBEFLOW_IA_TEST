"""Public prediction links: shared without sign-in, guarded by everything else.

Covers the owner's controls (switch on and off, rotate), and what a public
request meets on the way to a model: an unguessable token, rate limits, size
and shape limits, and errors that say nothing internal.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from core.rate_limit import RateLimiter, get_rate_limiter
from tests.conftest import seed_pipeline, seed_project, seed_repo
from tests.test_models import _mock_async_client, _resp


class _MemoryRedis:
    """Enough of redis.asyncio for the limiter: counters that never expire."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, seconds: int) -> bool:
        return True


@pytest.fixture()
def limiter():
    from main import app

    redis = _MemoryRedis()
    app.dependency_overrides[get_rate_limiter] = lambda: RateLimiter(redis)
    yield redis


@pytest.fixture()
def model(db_session):
    """An active deployment of 'iris', owned by the default member, taking 4 inputs."""
    from models.schemas import ModelDeployment

    repo = seed_repo(db_session, project_id=seed_project(db_session).id)
    run = seed_pipeline(
        db_session,
        repo.id,
        model_card={"inputs": [{"name": f"x{i}", "type": "number", "min": 0} for i in range(4)], "classes": [0, 1]},
    )
    db_session.add(ModelDeployment(model_name="iris", version="3", pipeline_id=run.id, is_active=True))
    db_session.commit()
    return run


def _share(client: TestClient) -> str:
    resp = client.put("/models/iris/share", json={"enabled": True})
    assert resp.status_code == 200, resp.text
    return resp.json()["url"].rsplit("/", 1)[1]


def _served(prediction=(1,)):
    return patch(
        "routers.models.httpx.AsyncClient",
        return_value=_mock_async_client(
            post=AsyncMock(
                return_value=_resp(200, json_data={"prediction": list(prediction), "model_name": "iris", "version": "3"})
            )
        ),
    )


class TestOwnerControls:
    def test_a_model_starts_unshared(self, test_app, model):
        body = test_app.get("/models/iris/share").json()
        assert body["enabled"] is False
        assert body["url"] is None

    def test_sharing_gives_an_unguessable_url_with_no_model_name(self, test_app, model):
        url = test_app.put("/models/iris/share", json={"enabled": True}).json()["url"]
        token = url.rsplit("/", 1)[1]
        assert "/public/predict/" in url
        assert "iris" not in token
        assert len(token) >= 40

    def test_the_list_carries_the_link_once_shared(self, test_app, model):
        _share(test_app)
        listed = test_app.get("/models").json()
        assert listed[0]["share_url"].startswith("http")

    def test_rotating_kills_the_old_url(self, test_app, model, limiter):
        old = _share(test_app)
        new = test_app.post("/models/iris/share/rotate").json()["url"].rsplit("/", 1)[1]
        assert new != old
        with _served():
            assert test_app.post(f"/public/predict/{old}", json={"data": [[1.0] * 4]}).status_code == 404
            assert test_app.post(f"/public/predict/{new}", json={"data": [[1.0] * 4]}).status_code == 200

    def test_only_the_owner_can_share(self, other_member_app, model):
        assert other_member_app.put("/models/iris/share", json={"enabled": True}).status_code == 404

    def test_an_unknown_model_cannot_be_shared(self, test_app):
        assert test_app.put("/models/ghost/share", json={"enabled": True}).status_code == 404


class TestPublicPredict:
    def test_answers_without_signing_in(self, test_app, model, limiter):
        token = _share(test_app)
        from main import app
        from core.security import get_current_user

        app.dependency_overrides.pop(get_current_user, None)  # nobody signed in
        with _served(prediction=(0,)):
            resp = test_app.post(f"/public/predict/{token}", json={"data": [[5.1, 3.5, 1.4, 0.2]]})

        assert resp.status_code == 200, resp.text
        assert resp.json()["prediction"] == [0]
        assert resp.headers["access-control-allow-origin"] == "*"
        assert "x-ratelimit-remaining" in resp.headers

    def test_a_switched_off_link_and_a_made_up_one_read_the_same(self, test_app, model, limiter):
        token = _share(test_app)
        test_app.put("/models/iris/share", json={"enabled": False})

        off = test_app.post(f"/public/predict/{token}", json={"data": [[1.0] * 4]})
        made_up = test_app.post("/public/predict/not-a-real-token", json={"data": [[1.0] * 4]})

        assert off.status_code == made_up.status_code == 404
        assert off.json() == made_up.json()

    def test_refuses_with_429_past_the_per_ip_limit(self, test_app, model, limiter, monkeypatch):
        from core.config import get_settings

        monkeypatch.setattr(get_settings(), "public_predict_per_ip_per_minute", 2)
        token = _share(test_app)
        with _served():
            codes = [test_app.post(f"/public/predict/{token}", json={"data": [[1.0] * 4]}).status_code for _ in range(3)]

        assert codes == [200, 200, 429]

    def test_guessing_tokens_is_rate_limited_too(self, test_app, limiter, monkeypatch):
        from core.config import get_settings

        monkeypatch.setattr(get_settings(), "public_predict_per_ip_per_minute", 2)
        codes = [test_app.post(f"/public/predict/guess-{i}", json={"data": [[1.0]]}).status_code for i in range(6)]

        assert codes[-1] == 429

    @pytest.mark.parametrize(
        ("body", "why"),
        [
            ('{"data": [[NaN, 1, 2, 3]]}', "NaN"),
            ('{"data": [[1, 2, 3, 4], [1, 2]]}', "ragged rows"),
            ('{"data": []}', "no rows"),
            ('{"data": [["a", 1, 2, 3]]}', "text"),
        ],
    )
    def test_malformed_input_never_reaches_the_model(self, test_app, model, limiter, body, why):
        token = _share(test_app)
        with _served() as client_cls:
            resp = test_app.post(f"/public/predict/{token}", content=body, headers={"Content-Type": "application/json"})

        assert resp.status_code == 422, why
        client_cls.assert_not_called()

    def test_a_row_must_be_as_long_as_the_model_expects(self, test_app, model, limiter):
        token = _share(test_app)
        with _served() as client_cls:
            resp = test_app.post(f"/public/predict/{token}", json={"data": [[1.0, 2.0]]})

        assert resp.status_code == 422
        assert "4 values" in resp.json()["detail"]
        client_cls.assert_not_called()

    def test_too_many_rows_are_refused(self, test_app, model, limiter, monkeypatch):
        from core.config import get_settings

        monkeypatch.setattr(get_settings(), "predict_max_rows", 2)
        token = _share(test_app)
        resp = test_app.post(f"/public/predict/{token}", json={"data": [[1.0] * 4] * 3})

        assert resp.status_code == 422

    def test_an_oversized_body_is_refused_before_parsing(self, test_app, model, limiter, monkeypatch):
        from core.config import get_settings

        monkeypatch.setattr(get_settings(), "predict_max_body_bytes", 100)
        token = _share(test_app)
        resp = test_app.post(f"/public/predict/{token}", json={"data": [[1.0] * 4] * 50})

        assert resp.status_code == 413

    def test_a_model_failure_says_nothing_internal(self, test_app, model, limiter):
        token = _share(test_app)
        failing = _mock_async_client(post=AsyncMock(return_value=_resp(500, text="Traceback /app/secret.py")))
        with patch("routers.models.httpx.AsyncClient", return_value=failing):
            resp = test_app.post(f"/public/predict/{token}", json={"data": [[1.0] * 4]})

        assert resp.status_code == 502
        assert "secret" not in resp.text

    def test_preflight_from_any_origin_is_answered(self, test_app):
        resp = test_app.options(
            "/public/predict/anything",
            headers={"Origin": "https://example.org", "Access-Control-Request-Method": "POST"},
        )
        assert resp.status_code == 204
        assert resp.headers["access-control-allow-origin"] == "*"
        assert "access-control-allow-credentials" not in resp.headers


class TestPublicInfo:
    def test_says_what_to_send_without_the_training_ranges(self, test_app, model, limiter):
        token = _share(test_app)
        info = test_app.get(f"/public/predict/{token}").json()

        assert info["model_name"] == "iris"
        assert [i["name"] for i in info["inputs"]] == ["x0", "x1", "x2", "x3"]
        assert all("min" not in i for i in info["inputs"])
        assert info["classes"] == [0, 1]
