"""Pipeline listing, status, logs, and WebSocket streaming endpoints."""
from __future__ import annotations

import asyncio
import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlmodel import Session, func, select
import structlog

from core.config import AppSettings, get_settings
from core.ownership import get_visible_pipeline_or_404, restrict_by_repo
from core.security import get_current_user
from db import get_session
from models.schemas import (
    Pipeline,
    PipelineListResponse,
    PipelineLogsResponse,
    PipelineResponse,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get(
    "",
    response_model=PipelineListResponse,
    summary="List pipelines (paginated)",
)
async def list_pipelines(
    page: int = Query(default=1, ge=1, description="Page number."),
    size: int = Query(default=20, ge=1, le=100, description="Page size."),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PipelineListResponse:
    """Return a paginated list of pipeline runs, newest first.

    Members only see runs belonging to their own repositories; admins see all
    of them. The total is filtered too, so pagination stays consistent.
    """
    total_stmt = restrict_by_repo(
        select(func.count()).select_from(Pipeline),
        Pipeline.repo_id,
        session,
        current_user,
    )
    total: int = session.exec(total_stmt).one()

    offset = (page - 1) * size
    list_stmt = restrict_by_repo(
        select(Pipeline), Pipeline.repo_id, session, current_user
    )
    pipelines = session.exec(
        list_stmt.order_by(Pipeline.started_at.desc()).offset(offset).limit(size)  # type: ignore[union-attr]
    ).all()

    items = [PipelineResponse.model_validate(p) for p in pipelines]
    return PipelineListResponse(items=items, total=total, page=page, size=size)


@router.get(
    "/{pipeline_id}",
    response_model=PipelineResponse,
    summary="Get pipeline details",
)
async def get_pipeline(
    pipeline_id: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PipelineResponse:
    """Return full status, phases, and metrics for a single pipeline run.

    A run whose repository belongs to somebody else is reported as 404.

    Args:
        pipeline_id: UUID of the pipeline.
    """
    pipeline = get_visible_pipeline_or_404(session, pipeline_id, current_user)
    return PipelineResponse.model_validate(pipeline)


@router.get(
    "/{pipeline_id}/logs",
    response_model=PipelineLogsResponse,
    summary="Get pipeline logs",
)
async def get_pipeline_logs(
    pipeline_id: str,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PipelineLogsResponse:
    """Return all stored log entries for a pipeline.

    Reads accumulated phase logs from Redis (stored as a list). Restricted to
    pipelines of repositories the caller can see.

    Args:
        pipeline_id: UUID of the pipeline.
    """
    get_visible_pipeline_or_404(session, pipeline_id, current_user)

    import redis

    r = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    raw_logs = r.lrange(f"pipeline:{pipeline_id}:phases", 0, -1)
    logs: list[dict[str, Any]] = [json.loads(entry) for entry in raw_logs]

    return PipelineLogsResponse(pipeline_id=pipeline_id, logs=logs)


@router.websocket("/{pipeline_id}/ws")
async def ws_pipeline_logs(
    websocket: WebSocket,
    pipeline_id: str,
    settings: AppSettings = Depends(get_settings),
) -> None:
    """WebSocket endpoint for real-time pipeline log streaming.

    Subscribes to the Redis pub/sub channel for the given pipeline and
    forwards every message to the connected WebSocket client.

    .. warning::

       **Known multi-tenancy gap — this endpoint is NOT ownership-filtered.**

       Every other pipeline endpoint now answers 404 for runs that belong to
       another user's repository, but this one cannot: it is unauthenticated.
       ``get_current_user`` depends on ``OAuth2PasswordBearer``, which reads the
       ``Authorization`` header, and the browser WebSocket API offers no way to
       set headers on the handshake — the frontend (``getWsUrl`` in
       ``frontend/src/api/client.ts``) therefore opens ``/pipelines/{id}/ws``
       with no credentials at all. Adding a dependency here would silently
       break live log streaming for everyone.

       Practical impact: anybody who can reach the backend and *guess a
       pipeline UUID* can tail that run's logs. The ids are random UUID4s and
       are only handed out through the ownership-filtered REST endpoints, so
       this is a "secret URL", not an enumerable one — but it is still weaker
       than the rest of the API.

       Closing it requires a coordinated frontend change (out of scope here);
       the usual options are a short-lived one-time ticket minted by an
       authenticated ``POST /pipelines/{id}/ws-ticket`` and passed as a query
       parameter, or sending the JWT as a WebSocket subprotocol. Either way the
       handler would then resolve the user and call
       ``core.ownership.get_visible_pipeline_or_404`` before accepting.
    """
    await websocket.accept()
    logger.info("ws.connected", pipeline_id=pipeline_id)

    import redis.asyncio as aioredis

    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()
    channel = f"pipeline:{pipeline_id}:logs"

    try:
        await pubsub.subscribe(channel)
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message and message["type"] == "message":
                await websocket.send_text(message["data"])
                data = json.loads(message["data"])
                if data.get("phase") == "complete":
                    break
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        logger.info("ws.disconnected", pipeline_id=pipeline_id)
    except Exception as exc:
        logger.error("ws.error", pipeline_id=pipeline_id, error=str(exc))
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await r.close()
