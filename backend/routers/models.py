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
from core.ownership import assert_model_access, restrict_by_pipeline
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


def _assert_model_visible(session: Session, model_name: str, user: User) -> None:
    """Raise 404 unless ``user`` may act on the model called ``model_name``.

    Models are addressed by *name*, not by deployment id, so a name maps to
    every ``ModelDeployment`` row carrying it (one per version, active or
    not). The caller is allowed through when at least one of those rows is
    visible — i.e. it was produced by a pipeline of a repository they own, or
    they are an admin.

    When the database holds no row at all for that name there is nothing to
    attribute ownership to, so the request is let through unchanged and the
    model-server has the last word. That preserves the pre-existing behaviour
    for models loaded out of band; it is a documented residual gap, not an
    oversight.
    """
    known = session.exec(
        select(ModelDeployment).where(ModelDeployment.model_name == model_name)
    ).all()
    assert_model_access(session, known, model_name, user)


def _resolve_mlflow_run_id(
    deployment: ModelDeployment,
    settings: AppSettings,
    session: Session,
) -> str:
    """Return the deployment's MLflow run id, backfilling old records.

    Deployments created before the ``mlflow_run_id`` column existed can be
    recovered by searching MLflow for the run tagged with the pipeline id.
    """
    if deployment.mlflow_run_id:
        return deployment.mlflow_run_id
    if not deployment.pipeline_id:
        return ""

    try:
        import mlflow

        mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
        client = mlflow.tracking.MlflowClient()
        experiment = client.get_experiment_by_name(f"mlops-{deployment.model_name}")
        if not experiment:
            return ""
        runs = client.search_runs(
            [experiment.experiment_id],
            filter_string=f"tags.pipeline_id = '{deployment.pipeline_id}'",
            max_results=1,
        )
        if not runs:
            return ""
        run_id: str = runs[0].info.run_id
        deployment.mlflow_run_id = run_id
        session.add(deployment)
        session.commit()
        logger.info(
            "model.mlflow_run_id_backfilled",
            model_name=deployment.model_name,
            mlflow_run_id=run_id,
        )
        return run_id
    except Exception as exc:
        logger.warning(
            "model.mlflow_run_id_backfill_failed",
            model_name=deployment.model_name,
            error=str(exc),
        )
        return ""


async def _load_into_model_server(
    model_name: str,
    mlflow_run_id: str,
    version: str,
    settings: AppSettings,
) -> None:
    """Ask the model-server to (re)load a model artifact from MLflow."""
    url = f"{settings.model_server_url}/internal/load/{model_name}"
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            url,
            json={"mlflow_run_id": mlflow_run_id, "version": version},
        )
        resp.raise_for_status()


@router.get(
    "",
    response_model=list[ModelDeploymentResponse],
    summary="List deployed models",
)
async def list_models(
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ModelDeploymentResponse]:
    """Return the active deployments the caller may see.

    A deployment is owned transitively: ``ModelDeployment -> Pipeline ->
    Repository -> owner``. Members therefore only see models trained from
    their own repositories; admins see every deployment.

    Legacy rows with ``pipeline_id IS NULL`` cannot be traced back to an owner
    and are hidden from members (fail closed) — see ``core.ownership``.
    """
    statement = restrict_by_pipeline(
        select(ModelDeployment).where(ModelDeployment.is_active == True),  # noqa: E712
        ModelDeployment.pipeline_id,
        session,
        current_user,
    )
    deployments = session.exec(statement).all()
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
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> PredictResponse:
    """Proxy a prediction request to the model-server.

    The model-server keeps models in memory, so a container restart loses
    them. If it answers 404 but the database has an active deployment, the
    model is reloaded from MLflow automatically and the prediction retried.

    Ownership: the caller must be able to see at least one deployment row for
    ``model_name`` (see :func:`_assert_model_visible`).

    Args:
        model_name: Name of the deployed model.
        body: Input features as a 2-D array.
    """
    _assert_model_visible(session, model_name, current_user)

    url = f"{settings.model_server_url}/predict/{model_name}"

    async def _predict_once() -> PredictResponse:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body.model_dump())
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            return PredictResponse(**data)

    try:
        return await _predict_once()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != status.HTTP_404_NOT_FOUND:
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

    # 404: the model-server lost the model (e.g. restart). Try to reload it,
    # using only a deployment the caller is allowed to see.
    deployment = session.exec(
        restrict_by_pipeline(
            select(ModelDeployment).where(
                ModelDeployment.model_name == model_name,
                ModelDeployment.is_active == True,  # noqa: E712
            ),
            ModelDeployment.pipeline_id,
            session,
            current_user,
        )
    ).first()
    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active deployment found for model '{model_name}'.",
        )

    mlflow_run_id = _resolve_mlflow_run_id(deployment, settings, session)
    if not mlflow_run_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Model '{model_name}' is not loaded and its MLflow run could "
                "not be determined. Re-run the pipeline to redeploy it."
            ),
        )

    logger.info(
        "model.reloading_after_restart",
        model_name=model_name,
        mlflow_run_id=mlflow_run_id,
    )
    try:
        await _load_into_model_server(
            model_name, mlflow_run_id, deployment.version, settings
        )
        return await _predict_once()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "model.reload_and_predict_failed",
            model_name=model_name,
            status_code=exc.response.status_code,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to reload model '{model_name}': {exc.response.text}",
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
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Rollback a model to a specific MLflow version.

    Restricted to models the caller can see: a rollback changes which
    artifact the shared model-server serves, so it must never be reachable
    across the tenant boundary.

    Args:
        model_name: Name of the deployed model.
        body: Contains the target version string.
    """
    _assert_model_visible(session, model_name, current_user)

    # Model names are a global namespace, so restrict the row we act on to the
    # caller's own deployments; otherwise two tenants using the same model name
    # would roll each other's versions back and forth.
    deployment = session.exec(
        restrict_by_pipeline(
            select(ModelDeployment).where(
                ModelDeployment.model_name == model_name,
                ModelDeployment.version == body.version,
            ),
            ModelDeployment.pipeline_id,
            session,
            current_user,
        )
    ).first()

    if not deployment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No deployment found for {model_name} version {body.version}.",
        )

    mlflow_run_id = _resolve_mlflow_run_id(deployment, settings, session)
    if not mlflow_run_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot rollback: the MLflow run for {model_name} "
                f"v{body.version} could not be determined."
            ),
        )

    try:
        await _load_into_model_server(
            model_name, mlflow_run_id, body.version, settings
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to reload model: {exc}",
        )

    current_active = session.exec(
        restrict_by_pipeline(
            select(ModelDeployment).where(
                ModelDeployment.model_name == model_name,
                ModelDeployment.is_active == True,  # noqa: E712
            ),
            ModelDeployment.pipeline_id,
            session,
            current_user,
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
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Unload a model from the model-server and deactivate its deployment records.

    Restricted to models the caller can see, so one tenant cannot take another
    tenant's model out of service.

    Args:
        model_name: Name of the model to remove.
    """
    _assert_model_visible(session, model_name, current_user)

    url = f"{settings.model_server_url}/models/{model_name}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.delete(url)
            resp.raise_for_status()
    except Exception as exc:
        logger.warning("model.unload_failed", model_name=model_name, error=str(exc))

    # Only deactivate rows the caller owns: model names are shared across
    # tenants, so a blanket update by name would unregister other people's
    # deployments as a side effect.
    deployments = session.exec(
        restrict_by_pipeline(
            select(ModelDeployment).where(
                ModelDeployment.model_name == model_name,
                ModelDeployment.is_active == True,  # noqa: E712
            ),
            ModelDeployment.pipeline_id,
            session,
            current_user,
        )
    ).all()
    for d in deployments:
        d.is_active = False
        session.add(d)
    session.commit()

    logger.info("model.deleted", model_name=model_name)
    return MessageResponse(message=f"Model {model_name} unregistered.")
