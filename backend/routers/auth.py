"""Authentication endpoints: register, login, invite, /me, and credential changes."""
from __future__ import annotations

import secrets
from datetime import timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.email import send_change_confirmation_email
from core.security import (
    create_access_token,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from db import get_session
from models.schemas import (
    ChangePasswordRequest,
    ChangeRequestedResponse,
    ChangeToken,
    ChangeUsernameRequest,
    ConfirmChangeRequest,
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
        email=invite.email,
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


# ---------------------------------------------------------------------------
# Credential changes (email-confirmed)
# ---------------------------------------------------------------------------

def _create_change_token(
    *,
    user: User,
    change_type: str,
    new_value: str,
    session: Session,
    settings: AppSettings,
) -> str:
    """Invalidate any previous pending token of the same type and create a new one."""
    from datetime import datetime

    # Invalidate previous unused tokens for this user + type
    old_tokens = session.exec(
        select(ChangeToken).where(
            ChangeToken.user_id == user.id,
            ChangeToken.change_type == change_type,
            ChangeToken.used_at.is_(None),  # type: ignore[union-attr]
        )
    ).all()
    for t in old_tokens:
        t.used_at = datetime.now(timezone.utc)
        session.add(t)

    token_value = secrets.token_urlsafe(32)
    change_token = ChangeToken(
        token=token_value,
        user_id=user.id,  # type: ignore[arg-type]
        change_type=change_type,
        new_value=new_value,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    session.add(change_token)
    session.commit()
    return token_value


@router.post(
    "/me/change-password",
    response_model=ChangeRequestedResponse,
    summary="Request a password change (sends confirmation email)",
)
async def request_change_password(
    body: ChangePasswordRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> ChangeRequestedResponse:
    """Verify the current password and send a confirmation email to apply the new one."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")

    if not current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No email address on your account. Ask an admin to update it.",
        )

    token_value = _create_change_token(
        user=current_user,
        change_type="password",
        new_value=hash_password(body.new_password),
        session=session,
        settings=settings,
    )
    confirm_url = f"{settings.frontend_url}/confirm-change?token={token_value}"

    background_tasks.add_task(
        send_change_confirmation_email,
        to_address=current_user.email,
        confirm_url=confirm_url,
        change_type="password",
        settings=settings,
    )
    logger.info("auth.change_password_requested", username=current_user.username)
    return ChangeRequestedResponse(
        message="Confirmation email sent. Click the link to apply the new password.",
        email=current_user.email,
    )


@router.post(
    "/me/change-username",
    response_model=ChangeRequestedResponse,
    summary="Request a username change (sends confirmation email)",
)
async def request_change_username(
    body: ChangeUsernameRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> ChangeRequestedResponse:
    """Check the new username is available and send a confirmation email."""
    if not current_user.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No email address on your account. Ask an admin to update it.",
        )

    conflict = session.exec(
        select(User).where(User.username == body.new_username)
    ).first()
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken.")

    token_value = _create_change_token(
        user=current_user,
        change_type="username",
        new_value=body.new_username,
        session=session,
        settings=settings,
    )
    confirm_url = f"{settings.frontend_url}/confirm-change?token={token_value}"

    background_tasks.add_task(
        send_change_confirmation_email,
        to_address=current_user.email,
        confirm_url=confirm_url,
        change_type="username",
        new_username=body.new_username,
        settings=settings,
    )
    logger.info("auth.change_username_requested", username=current_user.username, new=body.new_username)
    return ChangeRequestedResponse(
        message="Confirmation email sent. Click the link to apply the new username.",
        email=current_user.email,
    )


@router.post(
    "/confirm-change",
    response_model=UserResponse,
    summary="Apply a pending credential change via confirmation token",
)
def confirm_change(
    body: ConfirmChangeRequest,
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    """Validate the token and apply the pending credential change."""
    from datetime import datetime

    token = session.exec(
        select(ChangeToken).where(ChangeToken.token == body.token)
    ).first()

    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token.")
    if token.used_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token already used.")

    expires = token.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token has expired.")

    user = session.get(User, token.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if token.change_type == "password":
        user.hashed_password = token.new_value
    elif token.change_type == "username":
        conflict = session.exec(select(User).where(User.username == token.new_value)).first()
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken.")
        user.username = token.new_value

    token.used_at = datetime.now(timezone.utc)
    session.add(user)
    session.add(token)
    session.commit()
    session.refresh(user)

    logger.info("auth.change_confirmed", username=user.username, change_type=token.change_type)
    return UserResponse.model_validate(user)
