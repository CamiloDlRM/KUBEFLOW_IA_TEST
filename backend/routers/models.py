"""Model management endpoints.

Proxies requests to the model-server and manages deployment records.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Annotated, Any

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from core.config import AppSettings, get_settings
from core.metrics import record_model_prediction, record_model_reload, record_model_rollback
from core.model_server import model_server_headers
from core.predict_input import InvalidPredictInput, check_predict_input, expected_features
from core.share_links import link_for, public_url, rotate, set_enabled
from core.ownership import (
    assert_model_access,
    pipeline_owners,
    restrict_by_pipeline,
    restrict_by_repo,
)
from core.security import get_current_user
from db import get_session
from models.schemas import (
    MessageResponse,
    ModelDeployment,
    Pipeline,
    ModelDeploymentResponse,
    ModelShareLink,
    ModelVersionResponse,
    PredictRequest,
    PredictResponse,
    RollbackRequest,
    ShareLinkResponse,
    ShareLinkUpdate,
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
            headers=model_server_headers(settings),
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
    settings: Annotated[AppSettings, Depends(get_settings)],
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
    owners = pipeline_owners(session, [d.pipeline_id for d in deployments])

    # Each model's card and project live on the run that trained it. One query
    # for all of them, rather than one per row of the table.
    run_ids = [d.pipeline_id for d in deployments if d.pipeline_id]
    runs = {
        run.id: run
        for run in session.exec(select(Pipeline).where(Pipeline.id.in_(run_ids))).all()  # type: ignore[attr-defined]
    } if run_ids else {}

    names = {d.model_name for d in deployments}
    shared = {
        link.model_name: public_url(settings, link)
        for link in session.exec(
            select(ModelShareLink).where(
                ModelShareLink.model_name.in_(names),  # type: ignore[attr-defined]
                ModelShareLink.enabled == True,  # noqa: E712
            )
        ).all()
    } if names else {}

    def _from_run(d: ModelDeployment) -> dict:
        run = runs.get(d.pipeline_id or "")
        return {
            "owner_username": owners.get(d.pipeline_id or ""),
            "model_card": (run.model_card or {}) if run else {},
            "project_id": run.project_id if run else None,
            "share_url": shared.get(d.model_name),
        }

    return [ModelDeploymentResponse.model_validate(d).model_copy(update=_from_run(d)) for d in deployments]


def _owned_model_or_404(session: Session, model_name: str, user: User) -> None:
    """Only whoever can see a model's deployments may share it. Unlike prediction,
    a name with no deployment at all is refused: nothing vouches for its owner."""
    owned = session.exec(
        restrict_by_pipeline(
            select(ModelDeployment).where(ModelDeployment.model_name == model_name),
            ModelDeployment.pipeline_id,
            session,
            user,
        )
    ).first()
    if owned is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Model '{model_name}' not found.")


def _share_response(settings: AppSettings, model_name: str, link: ModelShareLink | None) -> ShareLinkResponse:
    return ShareLinkResponse(
        model_name=model_name,
        enabled=bool(link and link.enabled),
        url=public_url(settings, link) if link and link.enabled else None,
        per_ip_per_minute=settings.public_predict_per_ip_per_minute,
        per_link_per_minute=settings.public_predict_per_link_per_minute,
        max_rows=settings.predict_max_rows,
    )


@router.get("/{model_name}/share", response_model=ShareLinkResponse, summary="A model's public link")
def get_share_link(
    model_name: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> ShareLinkResponse:
    _owned_model_or_404(session, model_name, current_user)
    return _share_response(settings, model_name, link_for(session, model_name))


@router.put("/{model_name}/share", response_model=ShareLinkResponse, summary="Switch a model's public link on or off")
def update_share_link(
    model_name: str,
    body: ShareLinkUpdate,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> ShareLinkResponse:
    """On makes the model answer anyone holding the link; off stops it at once.
    Switching back on restores the same URL."""
    _owned_model_or_404(session, model_name, current_user)
    link = set_enabled(session, model_name, body.enabled, current_user)
    logger.info("model.share_link_set", model_name=model_name, enabled=body.enabled, user=current_user.username)
    return _share_response(settings, model_name, link)


@router.post(
    "/{model_name}/share/rotate",
    response_model=ShareLinkResponse,
    summary="Replace a model's public link with a new one",
)
def rotate_share_link(
    model_name: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> ShareLinkResponse:
    """For a link that went further than meant: the old URL stops working."""
    _owned_model_or_404(session, model_name, current_user)
    link = rotate(session, model_name, current_user)
    logger.info("model.share_link_rotated", model_name=model_name, user=current_user.username)
    return _share_response(settings, model_name, link)


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
    """Proxy a prediction request to the model-server and record its metrics.

    Metrics are labelled from the caller's active ``ModelDeployment`` row, so a
    name with no row (unknown, or loaded out of band) is proxied unrecorded and
    an arbitrary URL can never create a new series.
    """
    _assert_model_visible(session, model_name, current_user)
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
    return await run_prediction(model_name, body, deployment, settings, session)


async def run_prediction(
    model_name: str,
    body: PredictRequest,
    deployment: ModelDeployment | None,
    settings: AppSettings,
    session: Session,
) -> PredictResponse:
    """Check the input against the model, forward it, and record the outcome.

    Shared by the signed-in endpoint and public links; each decides beforehand
    which ``deployment`` the caller may reach.
    """
    try:
        check_predict_input(body.data, settings, expected_features(session, deployment))
    except InvalidPredictInput as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    started = time.perf_counter()
    try:
        result = await _proxy_predict(model_name, body, deployment, settings, session)
    except Exception:  # HTTPException and uncaught httpx errors (timeouts) alike
        if deployment:
            record_model_prediction(
                model_name, deployment.version, "error", time.perf_counter() - started
            )
        raise
    if deployment:
        record_model_prediction(
            model_name,
            deployment.version,
            "success",
            time.perf_counter() - started,
            rows=len(body.data),
        )
    return result


async def _proxy_predict(
    model_name: str,
    body: PredictRequest,
    deployment: ModelDeployment | None,
    settings: AppSettings,
    session: Session,
) -> PredictResponse:
    """Proxy a prediction request to the model-server.

    The model-server keeps models in memory, so a container restart loses
    them. If it answers 404 but ``deployment`` (the active one the caller may
    reach) exists, the model is reloaded from MLflow and the prediction retried.

    Errors say what went wrong without passing on the model-server's own text:
    that is internal detail, and on a public link it would be anyone's to read.

    Args:
        model_name: Name of the deployed model.
        body: Input features as a 2-D array.
    """
    url = f"{settings.model_server_url}/predict/{model_name}"

    async def _predict_once() -> PredictResponse:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=body.model_dump(), headers=model_server_headers(settings))
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
            return PredictResponse(**data)

    try:
        return await _predict_once()
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code != status.HTTP_404_NOT_FOUND:
            logger.error(
                "model.predict_failed",
                model_name=model_name,
                status_code=code,
                detail=exc.response.text[:500],
            )
            # A 4xx says the input was wrong, in words the model-server chose
            # for the caller ("each row must have 4 values"): passed on. A 401
            # means the internal token is misconfigured and a 5xx is internal:
            # neither is the caller's to read.
            if 400 <= code < 500 and code != status.HTTP_401_UNAUTHORIZED:
                try:
                    detail = exc.response.json().get("detail")
                except ValueError:
                    detail = None
                raise HTTPException(
                    status_code=code,
                    detail=detail if isinstance(detail, (str, list)) else "The model refused this input.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="The model could not answer this request.",
            )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="The model took too long to answer.",
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model server is not reachable.",
        )

    # 404: the model-server lost the model (e.g. restart). Try to reload it,
    # using only the deployment the caller may reach.
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
        record_model_reload(model_name)
        return await _predict_once()
    except httpx.HTTPStatusError as exc:
        logger.error(
            "model.reload_and_predict_failed",
            model_name=model_name,
            status_code=exc.response.status_code,
            detail=exc.response.text[:500],
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model '{model_name}' could not be reloaded to answer this request.",
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model server is not reachable.",
        )


def _version_key(version: str) -> tuple[int, int, str]:
    """Newest first: numeric versions by number, anything else after them."""
    return (0, -int(version), "") if version.isdigit() else (1, 0, version)


def _numeric_metrics(metrics: dict[str, Any] | None) -> dict[str, float]:
    return {
        name: float(value)
        for name, value in (metrics or {}).items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }


@router.get(
    "/{model_name}/versions",
    response_model=list[ModelVersionResponse],
    summary="Every version of a model that can be served",
)
def list_versions(
    model_name: str,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> list[ModelVersionResponse]:
    """Return each registered version of ``model_name``, newest first.

    A version is a run that registered an artifact, whether or not it was
    ever deployed: a run that trained a good model just under the auto-deploy
    bar is exactly the one someone may want to put in service. Each says
    what it scored, what it trained on, when it was last deployed, and
    whether it is serving now.

    Runs from before versions were recorded appear through their deployment
    row, so a model's existing history is not lost.
    """
    _assert_model_visible(session, model_name, current_user)

    runs = session.exec(
        restrict_by_repo(
            select(Pipeline).where(Pipeline.model_name == model_name, Pipeline.mlflow_run_id != ""),
            Pipeline.repo_id,
            session,
            current_user,
        )
    ).all()
    deployments = session.exec(
        restrict_by_pipeline(
            select(ModelDeployment).where(ModelDeployment.model_name == model_name),
            ModelDeployment.pipeline_id,
            session,
            current_user,
        )
    ).all()

    versions: dict[str, ModelVersionResponse] = {}

    def from_run(run: Pipeline, version: str, mlflow_run_id: str) -> ModelVersionResponse:
        metrics = _numeric_metrics(run.metrics)
        return ModelVersionResponse(
            version=version,
            pipeline_id=run.id,
            mlflow_run_id=mlflow_run_id,
            trained_at=run.finished_at or run.started_at,
            metrics=metrics,
            accuracy=metrics.get("accuracy"),
            branch=run.branch,
            commit_sha=run.commit_sha,
            input_label=str((run.mounted_input or {}).get("label", "")),
            deployable=bool(mlflow_run_id),
            parameters=dict(run.parameters or {}),
        )

    for run in runs:
        versions[run.id] = from_run(run, run.model_version or "?", run.mlflow_run_id)

    for deployment in deployments:
        key = deployment.pipeline_id or f"deployment-{deployment.id}"
        entry = versions.get(key)
        if entry is None:
            run = session.get(Pipeline, deployment.pipeline_id) if deployment.pipeline_id else None
            if run is not None:
                entry = from_run(run, deployment.version, deployment.mlflow_run_id or run.mlflow_run_id)
            else:
                entry = ModelVersionResponse(
                    version=deployment.version,
                    mlflow_run_id=deployment.mlflow_run_id,
                    trained_at=deployment.deployed_at,
                    accuracy=deployment.accuracy,
                    metrics={"accuracy": deployment.accuracy},
                    deployable=bool(deployment.mlflow_run_id),
                )
            versions[key] = entry
        if entry.accuracy is None:
            entry.accuracy = deployment.accuracy
        if entry.deployed_at is None or deployment.deployed_at > entry.deployed_at:
            entry.deployed_at = deployment.deployed_at
        entry.is_active = entry.is_active or deployment.is_active
        # A run deployed before it recorded its artifact still has one, on
        # its deployment row; and a deployment may be the only thing that
        # knows the run's MLflow id.
        if not entry.mlflow_run_id and deployment.mlflow_run_id:
            entry.mlflow_run_id = deployment.mlflow_run_id
            entry.deployable = True
        if not entry.deployable and deployment.pipeline_id:
            entry.deployable = True  # resolvable from MLflow by its pipeline tag

    return sorted(versions.values(), key=lambda v: (_version_key(v.version), v.trained_at is None))


@router.post(
    "/{model_name}/rollback",
    response_model=MessageResponse,
    summary="Serve a chosen version of a model",
)
async def rollback_model(
    model_name: str,
    body: RollbackRequest,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> MessageResponse:
    """Put one version of ``model_name`` in service, older or newer.

    The version is named by its run (``pipeline_id``), which is unique, or by
    its version number. A version that was never deployed — it registered but
    missed the auto-deploy bar — is deployed now, so choosing it is a
    deliberate override of that bar rather than something the page hides.

    Restricted to models the caller can see: switching which artifact the
    shared model-server serves must never be reachable across tenants.
    """
    _assert_model_visible(session, model_name, current_user)

    # Model names are a global namespace, so every row acted on is restricted
    # to the caller's own; otherwise two tenants sharing a name would switch
    # each other's versions.
    def visible_deployments():
        return restrict_by_pipeline(
            select(ModelDeployment).where(ModelDeployment.model_name == model_name),
            ModelDeployment.pipeline_id,
            session,
            current_user,
        )

    run: Pipeline | None = None
    deployment: ModelDeployment | None = None
    if body.pipeline_id:
        run = session.exec(
            restrict_by_repo(
                select(Pipeline).where(Pipeline.id == body.pipeline_id),
                Pipeline.repo_id,
                session,
                current_user,
            )
        ).first()
        deployment = session.exec(
            visible_deployments().where(ModelDeployment.pipeline_id == body.pipeline_id)
        ).first()
        if run is not None and run.model_name not in ("", model_name) and deployment is None:
            run = None  # a run of a different model is not a version of this one
    else:
        deployment = session.exec(
            visible_deployments().where(ModelDeployment.version == body.version)
        ).first()
        if deployment is None:
            run = session.exec(
                restrict_by_repo(
                    select(Pipeline).where(
                        Pipeline.model_name == model_name, Pipeline.model_version == body.version
                    ),
                    Pipeline.repo_id,
                    session,
                    current_user,
                )
            ).first()
        elif deployment.pipeline_id:
            run = session.get(Pipeline, deployment.pipeline_id)

    if run is None and deployment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No version {body.pipeline_id or body.version} of {model_name}.",
        )

    version = (deployment.version if deployment else "") or (run.model_version if run else "") or "?"
    mlflow_run_id = (run.mlflow_run_id if run else "") or (
        _resolve_mlflow_run_id(deployment, settings, session) if deployment else ""
    )
    if not mlflow_run_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot serve {model_name} v{version}: its MLflow run could not be "
                "determined, so there is no artifact to load."
            ),
        )

    try:
        await _load_into_model_server(model_name, mlflow_run_id, version, settings)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to reload model: {exc}",
        )

    for active in session.exec(visible_deployments().where(ModelDeployment.is_active == True)).all():  # noqa: E712
        active.is_active = False
        session.add(active)

    if deployment is None:
        # Never deployed: this is its first time in service.
        metrics = _numeric_metrics(run.metrics if run else {})
        deployment = ModelDeployment(
            model_name=model_name,
            version=version,
            accuracy=metrics.get("accuracy", 0.0),
            endpoint_url=f"{settings.model_server_url}/predict/{model_name}",
            mlflow_run_id=mlflow_run_id,
            pipeline_id=run.id if run else None,
        )
    deployment.is_active = True
    deployment.deployed_at = datetime.now(timezone.utc)
    session.add(deployment)
    session.commit()
    record_model_rollback(model_name, version)

    logger.info("model.version_served", model_name=model_name, version=version, pipeline_id=deployment.pipeline_id)
    return MessageResponse(message=f"{model_name} is now serving version {version}.")


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
            resp = await client.delete(url, headers=model_server_headers(settings))
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
