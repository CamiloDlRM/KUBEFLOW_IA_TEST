"""Health data endpoints: say a project holds it, on what basis, and protect it.

A project is general until somebody says otherwise. Marking it as holding
health data requires the legal basis for holding it (Ley 1581 de 2012, arts.
6 and 9; Resolución 8430 de 1993) and from then on identity is suppressed in
everything it lands, before bronze. What landed earlier is protected by a
queued task, the same way, and what cannot be protected is deleted.

A project with health data cannot go back to general: the controls exist
because of what the data is, and that does not change by editing a setting.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from core.ownership import get_visible_project_or_404
from core.security import get_current_user
from db import get_session
from models.schemas import (
    Dataset,
    DataSource,
    IngestionRun,
    LegalBasisKindResponse,
    PrivacyColumnResponse,
    PrivacySourceResponse,
    Project,
    ProjectPrivacyRequest,
    ProjectPrivacyResponse,
    User,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/projects", tags=["privacy"])

#: A queued or running protection older than this is assumed lost with its
#: worker, so it does not block another attempt forever.
_STALE_AFTER = timedelta(hours=2)


def _sources(session: Session, project_id: int) -> list[DataSource]:
    return list(session.exec(select(DataSource).where(DataSource.project_id == project_id)).all())


def _runs(session: Session, sources: list[DataSource]) -> list[IngestionRun]:
    ids = [source.id for source in sources]
    if not ids:
        return []
    return list(
        session.exec(
            select(IngestionRun).where(
                IngestionRun.source_id.in_(ids),  # type: ignore[attr-defined]
                IngestionRun.status == "success",
            )
        ).all()
    )


def _unprotected(session: Session, project: Project) -> int:
    """How many landed files hold data that was never protected."""
    runs = _runs(session, _sources(session, project.id))  # type: ignore[arg-type]
    count = sum(1 for run in runs if run.bronze_key and not (run.privacy or {}).get("protected"))
    uploads = session.exec(
        select(Dataset).where(Dataset.project_id == project.id, Dataset.origin == "upload")
    ).all()
    count += sum(
        1
        for upload in uploads
        if not (upload.privacy or {}).get("protected") and not (upload.privacy or {}).get("purged")
    )
    return count


def _columns_seen(run: IngestionRun) -> list[str]:
    """The columns a run landed: profiled, typed by the cleaning, or suppressed.

    An extraction is profiled as it arrives; an upload's run is not, but its
    quality report types every column silver kept. Detection matches names
    in their standardised form, so either spelling serves.
    """
    candidates = [
        *(run.profile or {}).keys(),
        *(run.quality_report or {}).get("types", {}).keys(),
        *(run.privacy or {}).get("suppressed", []),
    ]
    seen: list[str] = []
    standard: set[str] = set()
    for column in candidates:
        name = column.strip().lower()
        if name not in standard:
            standard.add(name)
            seen.append(column)
    return seen


def _response(session: Session, project: Project) -> ProjectPrivacyResponse:
    from core.privacy import LEGAL_BASES, ProjectPrivacy, plan

    stored = project.privacy or {}
    privacy = ProjectPrivacy.from_stored(stored)
    sources = _sources(session, project.id)  # type: ignore[arg-type]
    runs = _runs(session, sources)
    latest: dict[int, IngestionRun] = {}
    for run in sorted(runs, key=lambda r: r.started_at or datetime.min.replace(tzinfo=timezone.utc)):
        latest[run.source_id] = run

    previews = []
    for source in sources:
        run = latest.get(source.id)  # type: ignore[arg-type]
        columns = _columns_seen(run) if run else []
        previews.append(
            PrivacySourceResponse(
                source_id=source.id,  # type: ignore[arg-type]
                source_name=source.name,
                columns=[
                    PrivacyColumnResponse(column=column, action=action)
                    for column, action in plan(columns, privacy.policy).items()
                ],
            )
        )

    from sqlalchemy import func

    from models.schemas import LlmEgress

    calls = session.exec(
        select(LlmEgress)
        .where(LlmEgress.project_id == project.id)
        .order_by(LlmEgress.id.desc())  # type: ignore[union-attr]
        .limit(20)
    ).all()
    total = session.exec(
        select(func.count()).select_from(LlmEgress).where(LlmEgress.project_id == project.id)
    ).one()

    from models.schemas import DataAccess

    views = session.exec(
        select(DataAccess)
        .where(DataAccess.project_id == project.id)
        .order_by(DataAccess.id.desc())  # type: ignore[union-attr]
        .limit(20)
    ).all()
    views_total = session.exec(
        select(func.count()).select_from(DataAccess).where(DataAccess.project_id == project.id)
    ).one()

    return ProjectPrivacyResponse(
        project_id=project.id,  # type: ignore[arg-type]
        classification=privacy.classification,
        legal_basis=privacy.legal_basis.as_dict() if privacy.legal_basis else None,
        policy=privacy.policy.as_dict(),
        protection=stored.get("protection", {}),
        unprotected_runs=_unprotected(session, project) if privacy.health else 0,
        sources=previews,
        legal_bases=[LegalBasisKindResponse(kind=kind, **info) for kind, info in LEGAL_BASES.items()],
        egress=[
            {
                "agent": call.agent,
                "provider": call.provider,
                "model": call.model,
                "sent_chars": call.sent_chars,
                "withheld": call.withheld or {},
                "ok": call.ok,
                "at": call.created_at.isoformat() if call.created_at else None,
            }
            for call in calls
        ],
        egress_total=int(total or 0),
        access=[
            {
                "username": view.username,
                "as_admin": view.as_admin,
                "action": view.action,
                "resource": view.resource,
                "rows": view.rows,
                "at": view.created_at.isoformat() if view.created_at else None,
            }
            for view in views
        ],
        access_total=int(views_total or 0),
    )


@router.get(
    "/{project_id}/privacy",
    response_model=ProjectPrivacyResponse,
    summary="Whether this project holds health data, on what basis, and what is protected",
)
def get_privacy(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectPrivacyResponse:
    return _response(session, get_visible_project_or_404(session, project_id, current_user))


@router.put(
    "/{project_id}/privacy",
    response_model=ProjectPrivacyResponse,
    summary="Mark a project as holding health data, with its legal basis",
)
def set_privacy(
    project_id: int,
    body: ProjectPrivacyRequest,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectPrivacyResponse:
    """Classify the project and record why it may hold health data.

    Marking it ``health`` needs a complete legal basis. From then on identity
    is suppressed in what it lands; anything already stored is protected by a
    queued task, which also runs when the policy gets stricter. Going back to
    ``general`` is refused once anything has landed.
    """
    from core.privacy import CLASSIFICATIONS, LegalBasis, PrivacyError, PrivacyPolicy, ProjectPrivacy

    project = get_visible_project_or_404(session, project_id, current_user)
    before = ProjectPrivacy.from_stored(project.privacy)

    if body.classification not in CLASSIFICATIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"classification is one of {', '.join(CLASSIFICATIONS)}",
        )
    if before.health and body.classification != "health":
        landed = any(run.bronze_key for run in _runs(session, _sources(session, project_id)))
        if landed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This project already holds health data, so it stays classified as health data. "
                    "Remove its sources first if the data should no longer be here."
                ),
            )

    try:
        policy = PrivacyPolicy.from_dict(body.policy.model_dump())
        basis = None
        if body.classification == "health":
            if body.legal_basis is None:
                raise PrivacyError("health data needs the legal basis for holding it")
            basis = LegalBasis.from_dict(
                {
                    **body.legal_basis.model_dump(),
                    "recorded_by": current_user.username,
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                }
            )
    except PrivacyError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    stored: dict[str, Any] = dict(project.privacy or {})
    stored["classification"] = body.classification
    stored["legal_basis"] = basis.as_dict() if basis else None
    stored["policy"] = policy.as_dict()
    project.privacy = stored
    session.add(project)
    session.commit()
    session.refresh(project)

    stricter = before.health and policy != before.policy
    if body.classification == "health" and (not before.health or stricter):
        _queue_protection(session, project, force=stricter)

    logger.info(
        "project.privacy.set",
        project_id=project_id,
        classification=body.classification,
        basis=basis.kind if basis else None,
    )
    return _response(session, project)


@router.post(
    "/{project_id}/privacy/protect",
    response_model=ProjectPrivacyResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Protect everything the project landed before it was marked",
)
def protect(
    project_id: int,
    session: Annotated[Session, Depends(get_session)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> ProjectPrivacyResponse:
    from core.privacy import ProjectPrivacy

    project = get_visible_project_or_404(session, project_id, current_user)
    if not ProjectPrivacy.from_stored(project.privacy).health:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mark the project as holding health data first.",
        )
    current = (project.privacy or {}).get("protection", {})
    if current.get("status") in ("queued", "running"):
        since = _parse(current.get("started_at") or current.get("queued_at"))
        if since is None or datetime.now(timezone.utc) - since < _STALE_AFTER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The project's data is already being protected.",
            )
    _queue_protection(session, project, force=True)
    return _response(session, project)


def _queue_protection(session: Session, project: Project, *, force: bool) -> None:
    """Queue the protection of stored data, if there is any to protect."""
    landed = any(run.bronze_key for run in _runs(session, _sources(session, project.id)))  # type: ignore[arg-type]
    if not landed and not _unprotected(session, project):
        return
    if not force and not _unprotected(session, project):
        return
    from tasks.celery_tasks import protect_project

    stored = dict(project.privacy or {})
    stored["protection"] = {"status": "queued", "queued_at": datetime.now(timezone.utc).isoformat()}
    project.privacy = stored
    session.add(project)
    session.commit()
    session.refresh(project)
    protect_project.apply_async(args=[project.id])
    logger.info("project.privacy.protection_queued", project_id=project.id)


def _parse(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
