"""Tests for the Prometheus instrumentation in ``core.metrics``.

The suite covers three things:

* the ``/metrics`` endpoint answers in the Prometheus text exposition format;
* HTTP series are labelled with the **route template**, never the concrete URL
  (cardinality guard), and unknown label values collapse into ``other``;
* every recorder and the worker exporter are best-effort: they never raise and
  never need a real port or network access (the exporter is monkeypatched).
"""
from __future__ import annotations

from typing import Any, Iterator
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

from core import metrics as metrics_module
from core.metrics import (
    METRICS_PATH,
    OTHER,
    UNMATCHED_PATH,
    PrometheusMiddleware,
    record_advisor_analysis,
    record_pipeline_phase,
    record_pipeline_run,
    setup_metrics,
    start_worker_metrics_server,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_instrumented_app() -> FastAPI:
    """Return a throwaway FastAPI app with metrics wired in.

    A fresh app is used instead of ``main.app`` because Starlette refuses new
    middleware once an application has started, and because the real app must
    not be mutated by the test suite.
    """
    app = FastAPI()

    @app.get("/items/{item_id}")
    async def _read_item(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    @app.get("/boom")
    async def _boom() -> dict[str, str]:
        raise ValueError("kaboom")

    assert setup_metrics(app) is True
    return app


def _scrape(client: TestClient) -> str:
    """Return the decoded body of the ``/metrics`` endpoint."""
    response = client.get(METRICS_PATH)
    assert response.status_code == 200
    return response.text


def _sample(name: str, **labels: str) -> float:
    """Return a registry sample value, or 0.0 when the series does not exist."""
    value = REGISTRY.get_sample_value(name, labels or None)
    return 0.0 if value is None else value


@pytest.fixture()
def instrumented_client() -> Iterator[TestClient]:
    """Yield a ``TestClient`` over a freshly instrumented app."""
    with TestClient(_build_instrumented_app(), raise_server_exceptions=False) as client:
        yield client


@pytest.fixture()
def reset_worker_exporter() -> Iterator[None]:
    """Reset the module-level 'exporter started' flag around a test."""
    original = metrics_module._worker_server_started
    metrics_module._worker_server_started = False
    yield
    metrics_module._worker_server_started = original


# ---------------------------------------------------------------------------
# /metrics endpoint
# ---------------------------------------------------------------------------

def test_metrics_endpoint_returns_prometheus_text_format(instrumented_client: TestClient) -> None:
    """The scrape endpoint answers 200 with the Prometheus content type."""
    response = instrumented_client.get(METRICS_PATH)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    body = response.text
    assert "# HELP mlops_http_requests_total" in body
    assert "# TYPE mlops_http_requests_total counter" in body


def test_all_platform_metrics_are_registered(instrumented_client: TestClient) -> None:
    """Every metric family this module owns shows up in a scrape."""
    body = _scrape(instrumented_client)

    for family in (
        "mlops_http_requests_total",
        "mlops_http_request_duration_seconds",
        "mlops_http_requests_in_progress",
        "mlops_pipeline_runs_total",
        "mlops_pipeline_duration_seconds",
        "mlops_pipeline_phase_total",
        "mlops_pipeline_phase_duration_seconds",
        "mlops_pipelines_in_progress",
        "mlops_ai_advisor_analyses_total",
        "mlops_ai_advisor_duration_seconds",
    ):
        assert f"# HELP {family}" in body, f"{family} is not registered"


def test_main_app_metrics_endpoint_contract(test_app: TestClient) -> None:
    """Pin the contract for the real app served to Prometheus.

    ``setup_metrics(app)`` is wired by the orchestrator in ``main.py``, so the
    endpoint may legitimately be absent here. What must never happen is a
    ``/metrics`` route answering 200 with something other than the Prometheus
    text format (Prometheus would drop the target as malformed).
    """
    response = test_app.get(METRICS_PATH)

    assert response.status_code in (200, 404)
    if response.status_code == 200:
        assert response.headers["content-type"].startswith("text/plain")
        assert "mlops_http_requests_total" in response.text


# ---------------------------------------------------------------------------
# HTTP instrumentation / cardinality
# ---------------------------------------------------------------------------

def test_http_counter_uses_route_template_not_concrete_url(
    instrumented_client: TestClient,
) -> None:
    """Path ids must not create one series per value."""
    before = _sample(
        "mlops_http_requests_total",
        method="GET",
        path="/items/{item_id}",
        status_code="200",
    )

    for item_id in (1, 2, 3):
        assert instrumented_client.get(f"/items/{item_id}").status_code == 200

    after = _sample(
        "mlops_http_requests_total",
        method="GET",
        path="/items/{item_id}",
        status_code="200",
    )
    assert after - before == 3

    body = _scrape(instrumented_client)
    assert 'path="/items/{item_id}"' in body
    assert 'path="/items/1"' not in body
    assert 'path="/items/2"' not in body


def test_http_latency_histogram_is_observed(instrumented_client: TestClient) -> None:
    """The latency histogram gets one observation per request."""
    labels = {"method": "GET", "path": "/items/{item_id}"}
    before = _sample("mlops_http_request_duration_seconds_count", **labels)

    instrumented_client.get("/items/7")

    assert _sample("mlops_http_request_duration_seconds_count", **labels) - before == 1


def test_unmatched_requests_collapse_into_a_single_series(
    instrumented_client: TestClient,
) -> None:
    """Unknown URLs (404s, scanners) share one label value."""
    before = _sample(
        "mlops_http_requests_total",
        method="GET",
        path=UNMATCHED_PATH,
        status_code="404",
    )

    assert instrumented_client.get("/definitely-not-a-route-9f3a").status_code == 404

    after = _sample(
        "mlops_http_requests_total",
        method="GET",
        path=UNMATCHED_PATH,
        status_code="404",
    )
    assert after - before == 1
    assert "definitely-not-a-route-9f3a" not in _scrape(instrumented_client)


def test_failed_requests_are_counted_as_500(instrumented_client: TestClient) -> None:
    """A handler raising is still recorded, with a 500 status label."""
    before = _sample(
        "mlops_http_requests_total", method="GET", path="/boom", status_code="500"
    )

    assert instrumented_client.get("/boom").status_code == 500

    after = _sample(
        "mlops_http_requests_total", method="GET", path="/boom", status_code="500"
    )
    assert after - before == 1


def test_scrape_endpoint_does_not_instrument_itself(
    instrumented_client: TestClient,
) -> None:
    """``/metrics`` is excluded so scraping does not inflate the counters."""
    instrumented_client.get(METRICS_PATH)
    body = _scrape(instrumented_client)

    assert f'path="{METRICS_PATH}"' not in body


def test_in_progress_gauge_returns_to_zero(instrumented_client: TestClient) -> None:
    """The in-flight gauge is decremented once the response is sent."""
    instrumented_client.get("/items/1")

    assert _sample("mlops_http_requests_in_progress", method="GET") == 0.0


# ---------------------------------------------------------------------------
# setup_metrics behaviour
# ---------------------------------------------------------------------------

def test_setup_metrics_is_skipped_when_flag_is_disabled() -> None:
    """``prometheus_enabled=false`` leaves the app untouched."""
    disabled = MagicMock()
    disabled.prometheus_enabled = False
    app = FastAPI()

    with patch.object(metrics_module, "get_settings", return_value=disabled):
        assert setup_metrics(app) is False

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get(METRICS_PATH).status_code == 404


def test_setup_metrics_is_idempotent() -> None:
    """A second call is a no-op instead of registering a duplicate middleware."""
    app = FastAPI()

    assert setup_metrics(app) is True
    assert setup_metrics(app) is False

    installed = [m for m in app.user_middleware if m.cls is PrometheusMiddleware]
    assert len(installed) == 1


def test_metrics_route_is_hidden_from_openapi() -> None:
    """The scrape endpoint must not pollute the public API schema."""
    app = _build_instrumented_app()

    with TestClient(app, raise_server_exceptions=False) as client:
        schema = client.get("/openapi.json").json()

    assert METRICS_PATH not in schema["paths"]


# ---------------------------------------------------------------------------
# Worker recorders
# ---------------------------------------------------------------------------

def test_record_pipeline_run_increments_counter_and_histogram() -> None:
    """A finished run bumps both the counter and the duration histogram."""
    before_total = _sample("mlops_pipeline_runs_total", status="success")
    before_count = _sample("mlops_pipeline_duration_seconds_count", status="success")

    record_pipeline_run("success", 42.0)

    assert _sample("mlops_pipeline_runs_total", status="success") - before_total == 1
    assert (
        _sample("mlops_pipeline_duration_seconds_count", status="success") - before_count
        == 1
    )
    assert _sample("mlops_pipeline_duration_seconds_sum", status="success") >= 42.0


def test_record_pipeline_run_without_duration_only_counts() -> None:
    """Duration is optional; omitting it must not raise."""
    before = _sample("mlops_pipeline_runs_total", status="failed")

    record_pipeline_run("failed")

    assert _sample("mlops_pipeline_runs_total", status="failed") - before == 1


@pytest.mark.parametrize(
    "phase",
    ["download", "validate", "dataset", "execute", "register", "deploy"],
)
def test_record_pipeline_phase_covers_every_known_phase(phase: str) -> None:
    """Each pipeline phase gets its own series."""
    before = _sample("mlops_pipeline_phase_total", phase=phase, status="success")

    record_pipeline_phase(phase, "success", 1.5)

    assert (
        _sample("mlops_pipeline_phase_total", phase=phase, status="success") - before == 1
    )


def test_running_phase_transitions_are_not_counted() -> None:
    """Only terminal phase statuses feed the counter."""
    before = _sample("mlops_pipeline_phase_total", phase="execute", status="running")

    record_pipeline_phase("execute", "running", 1.0)

    assert _sample("mlops_pipeline_phase_total", phase="execute", status="running") == before


def test_unknown_phase_collapses_into_other() -> None:
    """An unexpected phase name must not create an unbounded series."""
    before = _sample("mlops_pipeline_phase_total", phase=OTHER, status="failed")

    record_pipeline_phase("some-unexpected-phase", "failed", 1.0)

    assert _sample("mlops_pipeline_phase_total", phase=OTHER, status="failed") - before == 1


def test_record_advisor_analysis_labels_provider_and_result() -> None:
    """Advisor analyses are split by provider and outcome."""
    before = _sample(
        "mlops_ai_advisor_analyses_total", provider="anthropic", result="success"
    )

    record_advisor_analysis("anthropic", "success", 3.0)

    after = _sample(
        "mlops_ai_advisor_analyses_total", provider="anthropic", result="success"
    )
    assert after - before == 1
    assert _sample("mlops_ai_advisor_duration_seconds_count", provider="anthropic") >= 1


def test_unknown_provider_and_result_collapse_into_other() -> None:
    """Provider/result labels are clamped to the known sets."""
    before = _sample("mlops_ai_advisor_analyses_total", provider=OTHER, result=OTHER)

    record_advisor_analysis("some-new-llm", "weird-outcome")

    assert (
        _sample("mlops_ai_advisor_analyses_total", provider=OTHER, result=OTHER) - before
        == 1
    )


@pytest.mark.parametrize(
    ("recorder", "args"),
    [
        (record_pipeline_run, ("success", 1.0)),
        (record_pipeline_phase, ("download", "success", 1.0)),
        (record_advisor_analysis, ("anthropic", "success", 1.0)),
    ],
)
def test_recorders_never_raise(recorder: Any, args: tuple[Any, ...]) -> None:
    """A broken registry must never propagate into pipeline code."""
    with patch.object(
        metrics_module, "_normalise", side_effect=RuntimeError("registry exploded")
    ):
        recorder(*args)  # must not raise


# ---------------------------------------------------------------------------
# Worker exporter (no real sockets)
# ---------------------------------------------------------------------------

def test_worker_exporter_binds_the_expected_port(reset_worker_exporter: None) -> None:
    """The worker exporter listens on 9100, matching prometheus.yml."""
    server = MagicMock()

    with patch.object(metrics_module, "_prometheus_start_http_server", server):
        assert start_worker_metrics_server() is True

    server.assert_called_once_with(9100)


def test_worker_exporter_is_idempotent(reset_worker_exporter: None) -> None:
    """A second call in the same process does not start a second server."""
    server = MagicMock()

    with patch.object(metrics_module, "_prometheus_start_http_server", server):
        assert start_worker_metrics_server() is True
        assert start_worker_metrics_server() is False

    assert server.call_count == 1


def test_worker_exporter_survives_a_busy_port(reset_worker_exporter: None) -> None:
    """Competing Celery children must log a warning, not crash the worker."""
    server = MagicMock(side_effect=OSError(98, "Address already in use"))

    with patch.object(metrics_module, "_prometheus_start_http_server", server):
        assert start_worker_metrics_server(9100) is False

    assert metrics_module._worker_server_started is False


def test_worker_exporter_survives_any_error(reset_worker_exporter: None) -> None:
    """Any unexpected exporter failure is swallowed."""
    server = MagicMock(side_effect=RuntimeError("boom"))

    with patch.object(metrics_module, "_prometheus_start_http_server", server):
        assert start_worker_metrics_server() is False


def test_worker_exporter_respects_the_flag(reset_worker_exporter: None) -> None:
    """``prometheus_enabled=false`` keeps the worker exporter down."""
    disabled = MagicMock()
    disabled.prometheus_enabled = False
    server = MagicMock()

    with patch.object(metrics_module, "get_settings", return_value=disabled), patch.object(
        metrics_module, "_prometheus_start_http_server", server
    ):
        assert start_worker_metrics_server() is False

    server.assert_not_called()
