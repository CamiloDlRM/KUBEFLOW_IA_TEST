"""Model management endpoints.

Proxies requests to the model-server and manages deployment records via ROBLE.
"""
from __future__ import annotations

from typing import Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status

from core.config import AppSettings, get_settings
from core.roble_client import RobleClient
from models.schemas import (
    MessageResponse,
    ModelDeploymentResponse,
    PredictRequest,
    PredictResponse,
    RollbackRequest,
    deployment_from_roble,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/models", tags=["models"])


def _get_roble(request: Request) -> RobleClient:
    return request.app.state.roble


@router.get(
    "",
    response_model=list[ModelDeploymentResponse],
    summary="List deployed models",
)
async def list_models(
    roble: RobleClient = Depends(_get_roble),
) -> list[ModelDeploymentResponse]:
    """Return all active deployed models."""
    records = await roble.read("model_deployments", {"is_active": "true"})
    return [deployment_from_roble(d) for d in records]


@router.post(
    "/{model_name}/predict",
    response_model=PredictResponse,
    summary="Run inference on a model",
)
async def predict(
    model_name: str,
    body: PredictRequest,
    settings: AppSettings = Depends(get_settings),
) -> PredictResponse:
    """Proxy a prediction request to the model-server."""
    url = f"{settings.model_server_url}/predict/{model_name}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body.model_dump())
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            return PredictResponse(**data)
    except httpx.HTTPStatusError as exc:
        logger.error(
            "model.predict_failed",
            model_name=model_name,
            status_code=exc.response.status_code,
        )
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"Model server error: {exc.response.text}",
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model server is not reachable.",
        )


@router.post(
    "/{model_name}/rollback",
    response_model=MessageResponse,
    summary="Rollback a model to a previous version",
)
async def rollback_model(
    model_name: str,
    body: RollbackRequest,
    settings: AppSettings = Depends(get_settings),
    roble: RobleClient = Depends(_get_roble),
) -> MessageResponse:
    """Rollback a model to a specific MLflow version."""
    # Find the deployment record for the target version
    records = await roble.read("model_deployments", {
        "model_name": model_name,
        "version": body.version,
    })

    if not records:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No deployment found for {model_name} version {body.version}.",
        )

    deployment = records[0]

    # Reload in model-server
    url = f"{settings.model_server_url}/internal/load/{model_name}"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                json={
                    "mlflow_run_id": deployment.get("pipeline_id", ""),
                    "version": body.version,
                },
            )
            resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to reload model: {exc}",
        )

    # Deactivate all current active deployments for this model
    current_active = await roble.read("model_deployments", {
        "model_name": model_name,
        "is_active": "true",
    })
    for d in current_active:
        await roble.update("model_deployments", "_id", d["_id"], {"is_active": False})

    # Activate the target deployment
    await roble.update("model_deployments", "_id", deployment["_id"], {"is_active": True})

    logger.info(
        "model.rollback",
        model_name=model_name,
        version=body.version,
    )
    return MessageResponse(
        message=f"Rolled back {model_name} to version {body.version}."
    )


@router.delete(
    "/{model_name}",
    response_model=MessageResponse,
    summary="Unregister a model",
)
async def delete_model(
    model_name: str,
    settings: AppSettings = Depends(get_settings),
    roble: RobleClient = Depends(_get_roble),
) -> MessageResponse:
    """Unload a model from the model-server and deactivate its deployment records."""
    # Unload from model-server
    url = f"{settings.model_server_url}/models/{model_name}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(url)
            resp.raise_for_status()
    except Exception as exc:
        logger.warning(
            "model.unload_failed",
            model_name=model_name,
            error=str(exc),
        )

    # Deactivate in ROBLE
    deployments = await roble.read("model_deployments", {
        "model_name": model_name,
        "is_active": "true",
    })
    for d in deployments:
        await roble.update("model_deployments", "_id", d["_id"], {"is_active": False})

    logger.info("model.deleted", model_name=model_name)
    return MessageResponse(message=f"Model {model_name} unregistered.")
