"""Authentication endpoints: register (invite-only), login, invite generation, and /me."""
from __future__ import annotations

import secrets
from datetime import timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from db import get_session
from models.schemas import (
    InviteCreateRequest,
    InviteToken,
    InviteTokenResponse,
    TokenResponse,
    User,
    UserRegisterRequest,
    UserResponse,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Register (invite-only)
# ---------------------------------------------------------------------------

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register using a valid invite token",
)
def register(
    body: UserRegisterRequest,
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    """Create a new user account.

    Requires a valid, unexpired, unused invite token issued by an admin.
    Returns 409 if the username is already taken.
    Returns 400 if the invite token is invalid or expired.
    """
    from datetime import datetime

    # Validate invite token
    invite = session.exec(
        select(InviteToken).where(InviteToken.token == body.invite_token)
    ).first()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invite token.",
        )
    if invite.used_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite token has already been used.",
        )
    now = datetime.now(timezone.utc)
    expires = invite.expires_at
    if expires.tzinfo is None:
        from datetime import timezone as tz
        expires = expires.replace(tzinfo=tz.utc)
    if now > expires:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite token has expired.",
        )

    # Check username uniqueness
    existing = session.exec(select(User).where(User.username == body.username)).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already registered.",
        )

    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        role="member",
    )
    session.add(user)
    session.flush()  # get user.id before commit

    # Mark invite as used
    invite.used_by = user.id
    invite.used_at = now
    session.add(invite)
    session.commit()
    session.refresh(user)

    logger.info("auth.user_registered", username=body.username)
    return UserResponse.model_validate(user)


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Obtain a JWT access token",
)
def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> TokenResponse:
    """Authenticate with username/password and receive a JWT bearer token."""
    user = session.exec(select(User).where(User.username == form.username)).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled.",
        )

    token = create_access_token(subject=user.username, settings=settings)
    logger.info("auth.login_success", username=user.username)
    return TokenResponse(access_token=token)


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get the current authenticated user",
)
def me(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    """Return the profile of the currently authenticated user."""
    return UserResponse.model_validate(current_user)


# ---------------------------------------------------------------------------
# Invite (admin only)
# ---------------------------------------------------------------------------

@router.post(
    "/invite",
    response_model=InviteTokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate an invite token and optionally email it (admin only)",
)
async def create_invite(
    body: InviteCreateRequest,
    background_tasks: BackgroundTasks,
    session: Annotated[Session, Depends(get_session)],
    admin: Annotated[User, Depends(require_admin)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> InviteTokenResponse:
    """Generate a single-use invite token valid for the requested number of hours.

    If SMTP is configured the invite link is emailed to the provided address in the
    background. The response always includes the raw token so the admin can copy it
    as a fallback regardless of email delivery.
    """
    from datetime import datetime
    from core.email import send_invite_email

    hours = body.expires_in_hours or settings.invite_token_expire_hours
    expires_at = datetime.now(timezone.utc) + timedelta(hours=hours)
    token_value = secrets.token_urlsafe(32)

    invite = InviteToken(
        token=token_value,
        email=body.email,
        created_by=admin.id,  # type: ignore[arg-type]
        expires_at=expires_at,
    )
    session.add(invite)
    session.commit()
    session.refresh(invite)

    # Build the registration URL that will be emailed
    invite_url = f"{settings.frontend_url}/register?token={token_value}"

    email_sent = False
    if settings.smtp_enabled:
        background_tasks.add_task(
            send_invite_email,
            to_address=body.email,
            invite_url=invite_url,
            expires_in_hours=hours,
            settings=settings,
        )
        email_sent = True

    logger.info(
        "auth.invite_created",
        created_by=admin.username,
        to_email=body.email,
        expires_at=expires_at.isoformat(),
        email_sent=email_sent,
    )
    return InviteTokenResponse(
        token=token_value,
        expires_at=expires_at,
        email=body.email,
        email_sent=email_sent,
    )
