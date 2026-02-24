"""Pipeline listing, status, logs, and WebSocket streaming endpoints."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlmodel import Session, func, select
import structlog

from core.config import AppSettings, get_settings
from models.schemas import (
    Pipeline,
    PipelineListResponse,
    PipelineLogsResponse,
    PipelineResponse,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/pipelines", tags=["pipelines"])


def _get_session(settings: AppSettings = Depends(get_settings)) -> Session:
    from sqlmodel import create_engine

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as session:
        yield session


@router.get(
    "",
    response_model=PipelineListResponse,
    summary="List pipelines (paginated)",
)
async def list_pipelines(
    page: int = Query(default=1, ge=1, description="Page number."),
    size: int = Query(default=20, ge=1, le=100, description="Page size."),
    session: Session = Depends(_get_session),
) -> PipelineListResponse:
    """Return a paginated list of all pipeline runs, newest first."""
    total_stmt = select(func.count()).select_from(Pipeline)
    total: int = session.exec(total_stmt).one()

    offset = (page - 1) * size
    pipelines = session.exec(
        select(Pipeline).order_by(Pipeline.started_at.desc()).offset(offset).limit(size)  # type: ignore[union-attr]
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
    session: Session = Depends(_get_session),
) -> PipelineResponse:
    """Return full status, phases, and metrics for a single pipeline run.

    Args:
        pipeline_id: UUID of the pipeline.
    """
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline {pipeline_id} not found.",
        )
    return PipelineResponse.model_validate(pipeline)


@router.get(
    "/{pipeline_id}/logs",
    response_model=PipelineLogsResponse,
    summary="Get pipeline logs",
)
async def get_pipeline_logs(
    pipeline_id: str,
    settings: AppSettings = Depends(get_settings),
    session: Session = Depends(_get_session),
) -> PipelineLogsResponse:
    """Return all stored log entries for a pipeline.

    Reads accumulated phase logs from Redis (stored as a list).

    Args:
        pipeline_id: UUID of the pipeline.
    """
    # Verify pipeline exists
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline {pipeline_id} not found.",
        )

    import redis

    r = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    raw_logs = r.lrange(f"pipeline:{pipeline_id}:phases", 0, -1)
    logs: list[dict[str, Any]] = [json.loads(entry) for entry in raw_logs]

    return PipelineLogsResponse(pipeline_id=pipeline_id, logs=logs)


@router.websocket("/ws/pipelines/{pipeline_id}/logs")
async def ws_pipeline_logs(
    websocket: WebSocket,
    pipeline_id: str,
    settings: AppSettings = Depends(get_settings),
) -> None:
    """WebSocket endpoint for real-time pipeline log streaming.

    Subscribes to the Redis pub/sub channel for the given pipeline and
    forwards every message to the connected WebSocket client.
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
