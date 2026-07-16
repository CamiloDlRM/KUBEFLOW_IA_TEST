"""AI insight endpoints: fetch and (re)generate feedback for a pipeline run."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
import structlog

from core.ai_advisor import advisor_configured
from core.config import AppSettings, get_settings
from core.security import get_current_user
from db import get_session
from models.schemas import InsightResponse, Pipeline, PipelineInsight, User

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/pipelines", tags=["insights"])


@router.get(
    "/{pipeline_id}/insights",
    response_model=list[InsightResponse],
    summary="List AI insights for a pipeline",
)
async def list_insights(
    pipeline_id: str,
    session: Annotated[Session, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[InsightResponse]:
    """Return AI-generated feedback reports for a pipeline, newest first."""
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline {pipeline_id} not found.",
        )
    insights = session.exec(
        select(PipelineInsight)
        .where(PipelineInsight.pipeline_id == pipeline_id)
        .order_by(PipelineInsight.created_at.desc())  # type: ignore[union-attr]
    ).all()
    return [InsightResponse.model_validate(i) for i in insights]


@router.post(
    "/{pipeline_id}/insights",
    response_model=InsightResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Generate (or regenerate) AI insights for a pipeline",
)
async def generate_insights(
    pipeline_id: str,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
    _: Annotated[User, Depends(get_current_user)],
) -> InsightResponse:
    """Queue an AI analysis of this pipeline run.

    The analysis runs asynchronously in a Celery worker; poll the GET
    endpoint until the insight status becomes ``ready`` or ``failed``.
    """
    pipeline = session.get(Pipeline, pipeline_id)
    if not pipeline:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Pipeline {pipeline_id} not found.",
        )
    if pipeline.status in ("queued", "running"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pipeline is still running; wait for it to finish.",
        )
    if not advisor_configured(settings):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"AI advisor provider '{settings.ai_advisor_provider}' is not "
                "configured on the server (missing API key or base URL)."
            ),
        )

    insight = PipelineInsight(pipeline_id=pipeline_id, status="pending")
    session.add(insight)
    session.commit()
    session.refresh(insight)

    from tasks.celery_tasks import analyze_pipeline

    analyze_pipeline.apply_async(args=[pipeline_id, insight.id])
    logger.info("insight.enqueued", pipeline_id=pipeline_id, insight_id=insight.id)
    return InsightResponse.model_validate(insight)


@router.post(
    "/{pipeline_id}/insights/{insight_id}/apply",
    response_model=InsightResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Apply the insight's suggestions and push them to the AI branch",
)
async def apply_insight_endpoint(
    pipeline_id: str,
    insight_id: int,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
    _: Annotated[User, Depends(get_current_user)],
) -> InsightResponse:
    """Have the AI rewrite the notebook per its own recommendations and push
    the result to the ``testing-ia-agent`` branch of the repository.

    Runs asynchronously in a Celery worker; poll the insights GET endpoint
    until ``apply_status`` becomes ``pushed`` or ``failed``.
    """
    insight = session.get(PipelineInsight, insight_id)
    if not insight or insight.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Insight {insight_id} not found for pipeline {pipeline_id}.",
        )
    if insight.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The insight is not ready yet; wait for the analysis to finish.",
        )
    if insight.apply_status in ("queued", "applying"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Suggestions are already being applied for this insight.",
        )
    if not advisor_configured(settings):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"AI advisor provider '{settings.ai_advisor_provider}' is not "
                "configured on the server (missing API key or base URL)."
            ),
        )
    if not settings.github_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GITHUB_TOKEN is not configured on the server; cannot push.",
        )

    insight.apply_status = "queued"
    insight.apply_error = ""
    session.add(insight)
    session.commit()
    session.refresh(insight)

    from tasks.celery_tasks import apply_insight

    apply_insight.apply_async(args=[pipeline_id, insight_id])
    logger.info("insight.apply_enqueued", pipeline_id=pipeline_id, insight_id=insight_id)
    return InsightResponse.model_validate(insight)
