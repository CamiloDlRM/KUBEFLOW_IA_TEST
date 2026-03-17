"""Pipeline listing, status, logs, and WebSocket streaming endpoints."""
from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
import structlog

from core.config import AppSettings, get_settings
from core.roble_client import RobleClient
from models.schemas import (
    PipelineListResponse,
    PipelineLogsResponse,
    PipelineResponse,
    pipeline_from_roble,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/pipelines", tags=["pipelines"])


def _get_roble(request: Request) -> RobleClient:
    return request.app.state.roble


@router.get(
    "",
    response_model=PipelineListResponse,
    summary="List pipelines (paginated)",
)
async def list_pipelines(
    page: int = Query(default=1, ge=1, description="Page number."),
    size: int = Query(default=20, ge=1, le=100, description="Page size."),
    roble: RobleClient = Depends(_get_roble),
) -> PipelineListResponse:
    """Return a paginated list of all pipeline runs, newest first."""
    items, total = await roble.read_paginated(
        "pipelines", page, size, sort_key="started_at", sort_reverse=True,
    )
    pipeline_responses = [pipeline_from_roble(p) for p in items]
    return PipelineListResponse(items=pipeline_responses, total=total, page=page, size=size)


@router.get(
    "/{pipeline_id}",
    response_model=PipelineResponse,
    summary="Get pipeline details",
)
async def get_pipeline(
    pipeline_id: str,
    roble: RobleClient = Depends(_get_roble),
) -> PipelineResponse:
    """Return full status, phases, and metrics for a single pipeline run."""
    # Search by pipeline_uuid (the UUID used for Celery/WebSocket)
    records = await roble.read("pipelines", {"pipeline_uuid": pipeline_id})
    if not records:
        # Fallback: search by ROBLE _id
        records = await roble.read("pipelines", {"_id": pipeline_id})
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline {pipeline_id} not found.",
        )
    return pipeline_from_roble(records[0])


@router.get(
    "/{pipeline_id}/logs",
    response_model=PipelineLogsResponse,
    summary="Get pipeline logs",
)
async def get_pipeline_logs(
    pipeline_id: str,
    settings: AppSettings = Depends(get_settings),
    roble: RobleClient = Depends(_get_roble),
) -> PipelineLogsResponse:
    """Return all stored log entries for a pipeline."""
    # Verify pipeline exists
    records = await roble.read("pipelines", {"pipeline_uuid": pipeline_id})
    if not records:
        records = await roble.read("pipelines", {"_id": pipeline_id})
    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline {pipeline_id} not found.",
        )

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
    """WebSocket endpoint for real-time pipeline log streaming."""
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
