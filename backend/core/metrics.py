"""Prometheus instrumentation for the backend API and the Celery worker.

Scope
-----
This module only exposes **operational** metrics: HTTP traffic of the FastAPI
app and pipeline/worker counters. Per-user ML metrics (accuracy, F1, ...) are
deliberately **not** exported here: they live in PostgreSQL and Grafana reads
them straight from there. One Prometheus time series per user/model/run would
blow up cardinality for no benefit.

Cardinality rules followed by every metric below:

* HTTP metrics are labelled with the **route template** (``/repos/{repo_id}``),
  never the concrete URL, so ids never create new series.
* Unmatched requests (404s, scanners) collapse into a single ``__unmatched__``
  label value.
* ``phase``, ``provider``, ``status`` and ``result`` label values are normalised
  against a closed allow-list; anything unexpected becomes ``other``.

Multiprocess caveat
-------------------
``prometheus_client`` keeps its registry in process memory. The Celery worker
runs with ``--concurrency=2`` (prefork), so each child process owns its own
counters and only the first child that manages to bind port 9100 is actually
scraped. Numbers are therefore a *sample* of the worker's activity, not the
total. Two ways out, neither implemented here on purpose:

1. Run the worker with ``--concurrency=1`` (simplest; exact numbers).
2. Enable ``prometheus_client``'s multiprocess mode: set
   ``PROMETHEUS_MULTIPROC_DIR``, use ``multiprocess.MultiProcessCollector`` in
   the parent process and clean the directory on boot. It adds shared-state
   plumbing (histograms lose ``_created``, files must be reaped on restart)
   that is not worth it for the current single-node deployment.

Usage
-----
FastAPI (in ``main.py``)::

    from core.metrics import setup_metrics
    setup_metrics(app)

Celery worker (in ``tasks/celery_tasks.py``)::

    from core.metrics import start_worker_metrics_server
    start_worker_metrics_server()

Every ``record_*`` helper is best-effort: it swallows its own exceptions so a
broken metric can never take down a request or a pipeline run.
"""
from __future__ import annotations

import functools
import time
from typing import Any, Callable, Final, Iterable, MutableMapping, TypeVar

import structlog
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest
from prometheus_client import start_http_server as _prometheus_start_http_server

from core.config import get_settings

logger = structlog.get_logger(__name__)

F = TypeVar("F", bound=Callable[..., Any])

# ---------------------------------------------------------------------------
# Label allow-lists (cardinality guards)
# ---------------------------------------------------------------------------

#: Route template used when no FastAPI route matched the request.
UNMATCHED_PATH: Final[str] = "__unmatched__"

#: Pipeline phases emitted by ``tasks.celery_tasks.run_pipeline``.
KNOWN_PHASES: Final[frozenset[str]] = frozenset(
    {"download", "validate", "dataset", "execute", "register", "deploy", "error"}
)

#: Terminal pipeline / phase statuses.
KNOWN_STATUSES: Final[frozenset[str]] = frozenset({"success", "failed", "running"})

#: AI advisor providers supported by ``core.ai_advisor``.
KNOWN_PROVIDERS: Final[frozenset[str]] = frozenset({"anthropic", "gemini", "ollama"})

#: Outcomes of an AI advisor analysis.
KNOWN_RESULTS: Final[frozenset[str]] = frozenset({"success", "failed", "skipped"})

#: HTTP methods kept as-is; anything else (arbitrary verbs are legal on the
#: wire) collapses into ``OTHER`` so a client cannot invent new series.
KNOWN_METHODS: Final[frozenset[str]] = frozenset(
    {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
)

#: Fallback label value for anything outside the allow-lists above.
OTHER: Final[str] = "other"


def _normalise(value: Any, allowed: Iterable[str]) -> str:
    """Clamp a label value to a closed set, mapping anything else to ``other``.

    Args:
        value: Raw label value (may be ``None`` or a non-string).
        allowed: Accepted label values.

    Returns:
        The lower-cased value when it is allowed, ``"other"`` otherwise.
    """
    text = str(value).strip().lower() if value is not None else ""
    return text if text in allowed else OTHER


def _safe(func: F) -> F:
    """Decorate a recorder so instrumentation failures never propagate.

    Metrics are observability, not business logic: a registry error, a bad
    label or a missing dependency must never break a request or a pipeline.
    """

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> None:
        try:
            func(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 — best-effort by design
            logger.warning("metrics.record_failed", metric=func.__name__, error=str(exc))

    return wrapper  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# HTTP metrics (backend)
# ---------------------------------------------------------------------------

HTTP_REQUESTS_TOTAL = Counter(
    "mlops_http_requests_total",
    "Total HTTP requests handled by the backend.",
    labelnames=("method", "path", "status_code"),
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "mlops_http_request_duration_seconds",
    "HTTP request latency in seconds, by route template.",
    labelnames=("method", "path"),
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

HTTP_REQUESTS_IN_PROGRESS = Gauge(
    "mlops_http_requests_in_progress",
    "HTTP requests currently being served by the backend.",
    labelnames=("method",),
)
# Note: no ``path`` label here on purpose — the route template is only known
# *after* routing, and this gauge has to be incremented before the request is
# handed to the router.

# ---------------------------------------------------------------------------
# Pipeline metrics (worker)
# ---------------------------------------------------------------------------

PIPELINE_RUNS_TOTAL = Counter(
    "mlops_pipeline_runs_total",
    "Pipeline executions that reached a terminal state.",
    labelnames=("status",),
)

PIPELINE_DURATION_SECONDS = Histogram(
    "mlops_pipeline_duration_seconds",
    "End-to-end pipeline duration in seconds.",
    labelnames=("status",),
    buckets=(5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600),
)

PIPELINE_PHASE_TOTAL = Counter(
    "mlops_pipeline_phase_total",
    "Pipeline phases that reached a terminal state.",
    labelnames=("phase", "status"),
)

PIPELINE_PHASE_DURATION_SECONDS = Histogram(
    "mlops_pipeline_phase_duration_seconds",
    "Duration of each pipeline phase in seconds.",
    labelnames=("phase", "status"),
    buckets=(0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1800),
)

PIPELINES_IN_PROGRESS = Gauge(
    "mlops_pipelines_in_progress",
    "Pipelines currently executing in this worker process.",
)

# ---------------------------------------------------------------------------
# AI advisor metrics (worker)
# ---------------------------------------------------------------------------

AI_ADVISOR_ANALYSES_TOTAL = Counter(
    "mlops_ai_advisor_analyses_total",
    "AI advisor analyses by provider and outcome.",
    labelnames=("provider", "result"),
)

AI_ADVISOR_DURATION_SECONDS = Histogram(
    "mlops_ai_advisor_duration_seconds",
    "AI advisor analysis duration in seconds, by provider.",
    labelnames=("provider",),
    buckets=(1, 2.5, 5, 10, 20, 30, 60, 120, 300),
)


# ---------------------------------------------------------------------------
# Best-effort recorders (safe to call from anywhere)
# ---------------------------------------------------------------------------

@_safe
def record_pipeline_run(status: str, duration_seconds: float | None = None) -> None:
    """Record a finished pipeline run.

    Args:
        status: Terminal status (``success`` / ``failed``).
        duration_seconds: Wall-clock duration of the run, when known.
    """
    label = _normalise(status, KNOWN_STATUSES)
    PIPELINE_RUNS_TOTAL.labels(status=label).inc()
    if duration_seconds is not None:
        PIPELINE_DURATION_SECONDS.labels(status=label).observe(max(0.0, float(duration_seconds)))


@_safe
def record_pipeline_phase(
    phase: str,
    status: str,
    duration_seconds: float | None = None,
) -> None:
    """Record a pipeline phase transition.

    Only terminal statuses (``success`` / ``failed``) are counted; ``running``
    transitions are ignored so the counter tracks completed work.

    Args:
        phase: Phase name (``download``, ``validate``, ``execute``, ...).
        status: Phase status as reported by the worker.
        duration_seconds: Time spent in the phase, when known.
    """
    status_label = _normalise(status, KNOWN_STATUSES)
    if status_label == "running":
        return
    phase_label = _normalise(phase, KNOWN_PHASES)
    PIPELINE_PHASE_TOTAL.labels(phase=phase_label, status=status_label).inc()
    if duration_seconds is not None:
        PIPELINE_PHASE_DURATION_SECONDS.labels(
            phase=phase_label, status=status_label
        ).observe(max(0.0, float(duration_seconds)))


@_safe
def record_advisor_analysis(
    provider: str,
    result: str,
    duration_seconds: float | None = None,
) -> None:
    """Record an AI advisor analysis.

    Args:
        provider: LLM provider (``anthropic`` / ``gemini`` / ``ollama``).
        result: ``success``, ``failed`` or ``skipped``.
        duration_seconds: Time the provider call took, when known.
    """
    provider_label = _normalise(provider, KNOWN_PROVIDERS)
    AI_ADVISOR_ANALYSES_TOTAL.labels(
        provider=provider_label, result=_normalise(result, KNOWN_RESULTS)
    ).inc()
    if duration_seconds is not None:
        AI_ADVISOR_DURATION_SECONDS.labels(provider=provider_label).observe(
            max(0.0, float(duration_seconds))
        )


@_safe
def pipeline_started() -> None:
    """Increment the in-flight pipeline gauge for this process."""
    PIPELINES_IN_PROGRESS.inc()


@_safe
def pipeline_finished() -> None:
    """Decrement the in-flight pipeline gauge for this process."""
    PIPELINES_IN_PROGRESS.dec()


# ---------------------------------------------------------------------------
# FastAPI wiring
# ---------------------------------------------------------------------------

METRICS_PATH: Final[str] = "/metrics"


def _route_template(scope: MutableMapping[str, Any]) -> str:
    """Return the matched route template for an ASGI scope.

    Starlette stores the matched ``Route`` in ``scope["route"]`` while routing,
    and the scope dict is shared with the middleware, so reading it *after* the
    downstream app ran yields the template (``/repos/{repo_id}/datasets``)
    instead of the concrete URL. Unmatched requests collapse into a single
    label value so scanners cannot create unbounded series.
    """
    route = scope.get("route")
    template = getattr(route, "path_format", None) or getattr(route, "path", None)
    if isinstance(template, str) and template:
        return template
    return UNMATCHED_PATH


class PrometheusMiddleware:
    """Pure-ASGI middleware recording request counts and latency.

    Implemented at the ASGI level (rather than with ``BaseHTTPMiddleware``) so
    it can read ``scope["route"]`` after routing and capture the real response
    status without buffering the body.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(
        self, scope: MutableMapping[str, Any], receive: Any, send: Any
    ) -> None:
        """Instrument a single HTTP interaction, passing everything else through."""
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        if scope.get("path") == METRICS_PATH:
            # Never instrument the scrape endpoint itself.
            await self.app(scope, receive, send)
            return

        raw_method = str(scope.get("method", "GET")).upper()
        method = raw_method if raw_method in KNOWN_METHODS else OTHER
        status_code = 500
        started = time.perf_counter()
        in_progress_labels: Any = None

        try:
            in_progress_labels = HTTP_REQUESTS_IN_PROGRESS.labels(method=method)
            in_progress_labels.inc()
        except Exception as exc:  # noqa: BLE001 — best-effort by design
            logger.warning("metrics.in_progress_failed", error=str(exc))
            in_progress_labels = None

        async def _send(message: MutableMapping[str, Any]) -> None:
            nonlocal status_code
            if message.get("type") == "http.response.start":
                status_code = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception:
            status_code = 500
            raise
        finally:
            elapsed = time.perf_counter() - started
            try:
                if in_progress_labels is not None:
                    in_progress_labels.dec()
                path = _route_template(scope)
                HTTP_REQUESTS_TOTAL.labels(
                    method=method, path=path, status_code=str(status_code)
                ).inc()
                HTTP_REQUEST_DURATION_SECONDS.labels(method=method, path=path).observe(
                    elapsed
                )
            except Exception as exc:  # noqa: BLE001 — best-effort by design
                logger.warning("metrics.http_record_failed", error=str(exc))


def render_latest() -> tuple[bytes, str]:
    """Render the default registry in the Prometheus text exposition format.

    Returns:
        Tuple of ``(payload, content_type)``.
    """
    return generate_latest(), CONTENT_TYPE_LATEST


def setup_metrics(app: Any) -> bool:
    """Wire Prometheus instrumentation into a FastAPI application.

    Registers :class:`PrometheusMiddleware` and the ``GET /metrics`` scrape
    endpoint. Does nothing when ``settings.prometheus_enabled`` is false, and
    is idempotent so repeated calls (tests, reloads) are harmless.

    Args:
        app: The FastAPI application instance.

    Returns:
        ``True`` when instrumentation was installed, ``False`` when it was
        skipped (disabled by config, or already installed).
    """
    settings = get_settings()
    if not settings.prometheus_enabled:
        logger.info("metrics.disabled")
        return False

    state = getattr(app, "state", None)
    if getattr(state, "prometheus_installed", False):
        return False

    from starlette.requests import Request
    from starlette.responses import Response

    async def metrics_endpoint(_request: Request) -> Response:
        """Expose the process registry in Prometheus text format."""
        payload, content_type = render_latest()
        return Response(content=payload, media_type=content_type)

    app.add_middleware(PrometheusMiddleware)
    app.add_route(
        METRICS_PATH,
        metrics_endpoint,
        methods=["GET"],
        include_in_schema=False,
    )

    if state is not None:
        state.prometheus_installed = True
    logger.info("metrics.enabled", path=METRICS_PATH)
    return True


# ---------------------------------------------------------------------------
# Celery worker exporter
# ---------------------------------------------------------------------------

DEFAULT_WORKER_METRICS_PORT: Final[int] = 9100

_worker_server_started = False


def start_worker_metrics_server(port: int = DEFAULT_WORKER_METRICS_PORT) -> bool:
    """Start the worker's standalone Prometheus HTTP exporter.

    The Celery worker is not an HTTP server, so it serves its own ``/metrics``
    endpoint on ``port`` (scraped as ``worker:9100``).

    The call is idempotent per process and tolerant of a busy port: with a
    prefork pool every child process runs this, so only the first one binds and
    the rest log a warning instead of crashing the worker. That also means the
    scraped numbers come from a single child — see the module docstring.

    Args:
        port: TCP port to listen on.

    Returns:
        ``True`` if this process now owns the exporter, ``False`` otherwise
        (disabled, already started, or the port was taken).
    """
    global _worker_server_started

    settings = get_settings()
    if not settings.prometheus_enabled:
        logger.info("metrics.worker_exporter_disabled")
        return False

    if _worker_server_started:
        logger.debug("metrics.worker_exporter_already_started", port=port)
        return False

    try:
        _prometheus_start_http_server(port)
    except OSError as exc:
        # Address already in use: another Celery child won the race. Expected
        # with --concurrency > 1; must not take the worker down.
        logger.warning("metrics.worker_exporter_port_busy", port=port, error=str(exc))
        return False
    except Exception as exc:  # noqa: BLE001 — never break worker startup
        logger.warning("metrics.worker_exporter_failed", port=port, error=str(exc))
        return False

    _worker_server_started = True
    logger.info("metrics.worker_exporter_started", port=port)
    return True
