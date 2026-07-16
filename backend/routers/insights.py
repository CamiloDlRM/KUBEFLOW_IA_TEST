"""AI insight endpoints: fetch and (re)generate feedback for a pipeline run."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from models.schemas import InsightResponse, Pipeline, PipelineInsight

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/pipelines", tags=["insights"])


def _get_session(settings: AppSettings = Depends(get_settings)) -> Session:
    from sqlmodel import create_engine

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as session:
        yield session


@router.get(
    "/{pipeline_id}/insights",
    response_model=list[InsightResponse],
    summary="List AI insights for a pipeline",
)
async def list_insights(
    pipeline_id: str,
    session: Session = Depends(_get_session),
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
    session: Session = Depends(_get_session),
    settings: AppSettings = Depends(get_settings),
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
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ANTHROPIC_API_KEY is not configured on the server.",
        )

    insight = PipelineInsight(pipeline_id=pipeline_id, status="pending")
    session.add(insight)
    session.commit()
    session.refresh(insight)

    from tasks.celery_tasks import analyze_pipeline

    analyze_pipeline.apply_async(args=[pipeline_id, insight.id])
    logger.info("insight.enqueued", pipeline_id=pipeline_id, insight_id=insight.id)
    return InsightResponse.model_validate(insight)
