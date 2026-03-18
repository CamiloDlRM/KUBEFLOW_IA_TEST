"""FastAPI application entrypoint for the MLOps backend.

Configures structlog, CORS, SQLModel tables, and mounts all routers.
"""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import structlog
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import get_settings
from models.schemas import (
    HealthResponse,
    ReadyResponse,
)

# ---------------------------------------------------------------------------
# structlog configuration  (JSON in production, console in dev)
# ---------------------------------------------------------------------------

settings = get_settings()


def _configure_structlog() -> None:
    """Set up structlog to emit JSON-formatted structured logs."""
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Also route stdlib logging through structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )


_configure_structlog()
logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Lifespan: create tables on startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan handler.

    Creates SQLModel tables on startup and logs shutdown.
    """
    from sqlmodel import SQLModel, create_engine

    engine = create_engine(settings.database_url, echo=False)
    SQLModel.metadata.create_all(engine)
    logger.info("app.startup", database_url=settings.database_url)
    yield
    logger.info("app.shutdown")


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="MLOps Automation Platform",
    description="Backend API for the MLOps pipeline automation platform.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    """Catch-all handler that returns 500 with structured error info."""
    logger.exception("unhandled_exception", path=str(request.url), error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
    )


# ---------------------------------------------------------------------------
# Health & readiness
# ---------------------------------------------------------------------------

@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Health check endpoint. Returns 200 if the service is alive."""
    return HealthResponse(status="ok")


@app.get("/ready", response_model=ReadyResponse, tags=["system"])
async def ready() -> ReadyResponse:
    """Readiness check. Verifies connectivity to Redis, MLflow, and model-server."""
    import httpx
    import redis

    redis_status = "ok"
    mlflow_status = "ok"
    model_server_status = "ok"

    # Redis
    try:
        r = redis.Redis.from_url(settings.redis_url, socket_timeout=2)
        r.ping()
    except Exception:
        redis_status = "unreachable"

    # MLflow
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{settings.mlflow_tracking_uri}/health")
            if resp.status_code != 200:
                mlflow_status = "unhealthy"
    except Exception:
        mlflow_status = "unreachable"

    # Model server
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{settings.model_server_url}/health")
            if resp.status_code != 200:
                model_server_status = "unhealthy"
    except Exception:
        model_server_status = "unreachable"

    overall = "ok" if all(
        s == "ok" for s in [redis_status, mlflow_status, model_server_status]
    ) else "degraded"

    return ReadyResponse(
        status=overall,
        redis=redis_status,
        mlflow=mlflow_status,
        model_server=model_server_status,
    )


# ---------------------------------------------------------------------------
# Mount routers
# ---------------------------------------------------------------------------

from routers.repos import router as repos_router
from routers.pipelines import router as pipelines_router
from routers.models import router as models_router
from routers.webhook import router as webhook_router

# WebSocket router is mounted from pipelines module
from routers.pipelines import router as pipelines_ws_router

app.include_router(repos_router)
app.include_router(pipelines_router)
app.include_router(models_router)
app.include_router(webhook_router)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level=settings.log_level.lower(),
    )
