"""Model management endpoints.

Proxies requests to the model-server and manages deployment records.
"""
from __future__ import annotations

from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from core.config import AppSettings, get_settings
from core.security import get_current_user
from db import get_session
from models.schemas import (
    MessageResponse,
    ModelDeployment,
    ModelDeploymentResponse,
    PredictRequest,
    PredictResponse,
    RollbackRequest,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/models", tags=["models"])


@router.get(
    "",
    response_model=list[ModelDeploymentResponse],
    summary="List deployed models",
)
async def list_models(
    session: Annotated[Session, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[ModelDeploymentResponse]:
    """Return all deployed models from the database and verify against model-server."""
    deployments = session.exec(
        select(ModelDeployment).where(ModelDeployment.is_active == True)
    ).all()
    return [ModelDeploymentResponse.model_validate(d) for d in deployments]


@router.post(
    "/{model_name}/predict",
    response_model=PredictResponse,
    summary="Run inference on a model",
)
async def predict(
    model_name: str,
    body: PredictRequest,
    settings: Annotated[AppSettings, Depends(get_settings)],
    _: Annotated[User, Depends(get_current_user)],
) -> PredictResponse:
    """Proxy a prediction request to the model-server.

    Args:
        model_name: Name of the deployed model.
        body: Input features as a 2-D array.
    """
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
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Rollback a model to a specific MLflow version.

    Args:
        model_name: Name of the deployed model.
        body: Contains the target version string.
    """
    deployment = session.exec(
        select(ModelDeployment).where(
            ModelDeployment.model_name == model_name,
            ModelDeployment.version == body.version,
        )
    ).first()

    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No deployment found for {model_name} version {body.version}.",
        )

    url = f"{settings.model_server_url}/internal/load/{model_name}"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                json={
                    "mlflow_run_id": deployment.pipeline_id or "",
                    "version": body.version,
                },
            )
            resp.raise_for_status()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to reload model: {exc}",
        )

    current_active = session.exec(
        select(ModelDeployment).where(
            ModelDeployment.model_name == model_name,
            ModelDeployment.is_active == True,
        )
    ).all()
    for d in current_active:
        d.is_active = False
        session.add(d)

    deployment.is_active = True
    session.add(deployment)
    session.commit()

    logger.info("model.rollback", model_name=model_name, version=body.version)
    return MessageResponse(message=f"Rolled back {model_name} to version {body.version}.")


@router.delete(
    "/{model_name}",
    response_model=MessageResponse,
    summary="Unregister a model",
)
async def delete_model(
    model_name: str,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Unload a model from the model-server and deactivate its deployment records.

    Args:
        model_name: Name of the model to remove.
    """
    url = f"{settings.model_server_url}/models/{model_name}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(url)
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("model.unload_failed", model_name=model_name, error=str(exc))

    deployments = session.exec(
        select(ModelDeployment).where(
            ModelDeployment.model_name == model_name,
            ModelDeployment.is_active == True,
        )
    ).all()
    for d in deployments:
        d.is_active = False
        session.add(d)
    session.commit()

    logger.info("model.deleted", model_name=model_name)
    return MessageResponse(message=f"Model {model_name} unregistered.")
