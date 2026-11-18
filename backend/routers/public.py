"""Public prediction links: no sign-in, so every other guard lives here.

Sharing a model is the point of the platform, so a shared link answers anyone,
signed in or not. What keeps it from being abused:

- **An unguessable URL.** The link carries a random token, not the model's
  name, so it can only be had from someone who shared it. The owner can switch
  it off, or replace the token if it leaks.
- **Rate limits** per client IP and per link (core.rate_limit), answered with
  429 and Retry-After.
- **Bounded input.** The body has a size cap, the rows a count cap, every
  value must be a finite number and every row as long as the model expects
  (PredictRequest and core.predict_input). Nothing malformed reaches a model.
- **Quiet errors.** A wrong token and a switched-off link read the same, and
  failures say what happened without internal detail.
- **Open CORS here only** (main.PublicCorsMiddleware), without credentials,
  so a page anywhere can call the link but no cookie or token rides along.
"""
from __future__ import annotations

from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import ValidationError
from sqlmodel import Session, select

from core.config import AppSettings, get_settings
from core.rate_limit import RateLimiter, RateResult, client_ip, get_rate_limiter
from core.share_links import enabled_link
from db import get_session
from models.schemas import ModelDeployment, Pipeline, PredictRequest, PredictResponse, PublicModelInfo
from routers.models import run_prediction

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/public", tags=["public"])

#: The same answer for a token that never existed and one switched off, so the
#: response says nothing about which tokens are real.
_NOT_FOUND = "This link does not exist or is not shared anymore."


def _rate_headers(result: RateResult) -> dict[str, str]:
    return {
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(result.remaining),
        "X-RateLimit-Reset": str(result.retry_after),
    }


async def _enforce_limits(
    token: str, request: Request, settings: AppSettings, limiter: RateLimiter
) -> RateResult:
    """Count this request against the caller's and the link's allowance.

    Counted before the token is even looked up, and per IP across every link
    too: otherwise guessing tokens would be free, since a wrong one costs nothing.
    """
    ip = client_ip(request, settings)
    any_link = await limiter.hit(f"public:ip:{ip}", settings.public_predict_per_ip_per_minute * 2)
    per_ip = await limiter.hit(f"public:{token}:ip:{ip}", settings.public_predict_per_ip_per_minute)
    per_link = await limiter.hit(f"public:{token}:all", settings.public_predict_per_link_per_minute)
    refused = next((result for result in (any_link, per_ip, per_link) if not result.allowed), None)
    if refused:
        logger.warning("public.rate_limited", token_prefix=token[:6], ip=ip, limit=refused.limit)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Try again in {refused.retry_after} seconds.",
            headers={**_rate_headers(refused), "Retry-After": str(refused.retry_after)},
        )
    return per_ip


def _serving(session: Session, model_name: str) -> ModelDeployment:
    deployment = session.exec(
        select(ModelDeployment).where(
            ModelDeployment.model_name == model_name,
            ModelDeployment.is_active == True,  # noqa: E712
        )
    ).first()
    if deployment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This model is not serving right now.")
    return deployment


@router.post(
    "/predict/{token}",
    response_model=PredictResponse,
    summary="Ask a shared model for predictions, without signing in",
)
async def public_predict(
    token: str,
    request: Request,
    response: Response,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> PredictResponse:
    # Size first, from the header and then the bytes themselves: an oversized
    # body is refused before it is parsed, whatever the header claimed.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.predict_max_body_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Request body too large.")
    raw = await request.body()
    if len(raw) > settings.predict_max_body_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Request body too large.")

    allowance = await _enforce_limits(token, request, settings, limiter)
    response.headers.update(_rate_headers(allowance))

    link = enabled_link(session, token)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)

    try:
        body = PredictRequest.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors(include_url=False, include_input=False, include_context=False),
        )

    deployment = _serving(session, link.model_name)
    result = await run_prediction(link.model_name, body, deployment, settings, session)
    logger.info("public.predicted", model_name=link.model_name, rows=len(body.data))
    return result


@router.get(
    "/predict/{token}",
    response_model=PublicModelInfo,
    summary="What a shared model expects, so it can be called correctly",
)
async def public_model_info(
    token: str,
    request: Request,
    response: Response,
    settings: Annotated[AppSettings, Depends(get_settings)],
    session: Annotated[Session, Depends(get_session)],
    limiter: Annotated[RateLimiter, Depends(get_rate_limiter)],
) -> PublicModelInfo:
    """The inputs in order and the classes, from the model card. Names and types
    only: the training ranges describe the training data and stay private."""
    allowance = await _enforce_limits(token, request, settings, limiter)
    response.headers.update(_rate_headers(allowance))
    link = enabled_link(session, token)
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)

    deployment = _serving(session, link.model_name)
    run = session.get(Pipeline, deployment.pipeline_id) if deployment.pipeline_id else None
    card: dict[str, Any] = (run.model_card or {}) if run else {}
    inputs = [
        {key: value for key, value in item.items() if key in ("name", "type")}
        for item in card.get("inputs", [])
        if isinstance(item, dict)
    ]
    return PublicModelInfo(
        model_name=link.model_name,
        version=deployment.version,
        inputs=inputs,
        classes=list(card.get("classes", [])),
        max_rows=settings.predict_max_rows,
        per_ip_per_minute=settings.public_predict_per_ip_per_minute,
    )
