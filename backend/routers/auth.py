"""Authentication endpoints: register, login, invite, /me, and credential changes."""
from __future__ import annotations

import secrets
from datetime import timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError, jwt
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.email import send_change_confirmation_email
from core.github import check_github_token
from core.github_credentials import (
    encrypt_token,
    decrypt_token,
    get_provider,
    identity_of,
    set_user_token,
    user_token,
)
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
    GithubConfirmNewRequest,
    GithubTokenUpdateRequest,
    InviteCreateRequest,
    InviteToken,
    InviteTokenResponse,
    SetPasswordRequest,
    TokenResponse,
    UpdateProfileRequest,
    User,
    UserIdentity,
    UserRegisterRequest,
    UserResponse,
)

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

_SUFFIXES = ("@g", "@t")


def _base_username(name: str) -> str:
    """Strip a sign-in suffix the user may have typed themselves."""
    for suffix in _SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def user_response(session: Session, user: User) -> UserResponse:
    found = identity_of(session, user)
    identity, provider = found if found else (None, None)
    return UserResponse.model_validate(user).model_copy(
        update={
            "auth_provider": provider.code if provider else "token",
            "has_github_token": bool(identity and identity.github_token_encrypted),
            "github_token_masked": identity.github_token_masked if identity else "",
        }
    )


# ---------------------------------------------------------------------------
# Register (invite-only)
# ---------------------------------------------------------------------------

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register with username, email, password and a GitHub token",
)
async def register(
    body: UserRegisterRequest,
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    """Create a new user account.

    Open to anyone. The username gets the ``@t`` suffix; 409 if it is taken.
    Returns 400 if the GitHub token or an (optional) invite token is invalid.
    """
    from datetime import datetime

    now = datetime.now(timezone.utc)
    invite = None
    if body.invite_token:
        invite = session.exec(
            select(InviteToken).where(InviteToken.token == body.invite_token)
        ).first()
        if not invite:
            raise HTTPException(status_code=400, detail="Invalid invite token.")
        if invite.used_at is not None:
            raise HTTPException(status_code=400, detail="Invite token has already been used.")
        expires = invite.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if now > expires:
            raise HTTPException(status_code=400, detail="Invite token has expired.")

    base = _base_username(body.username)
    if "@" in base:
        raise HTTPException(status_code=422, detail="Username may not contain '@'.")
    provider = get_provider(session, "token")
    username = base + provider.username_suffix
    if session.exec(select(User).where(User.username == username)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{username}' is already taken. Choose another one.",
        )

    if await check_github_token(body.github_token) == "invalid":
        raise HTTPException(status_code=400, detail="The GitHub token is invalid or expired.")

    user = User(
        username=username,
        hashed_password=hash_password(body.password),
        role="member",
        email=body.email,
    )
    session.add(user)
    session.flush()  # get user.id before commit

    identity = UserIdentity(user_id=user.id, provider_id=provider.id)  # type: ignore[arg-type]
    set_user_token(session, identity, body.github_token, get_settings())

    if invite:
        invite.used_by = user.id
        invite.used_at = now
        session.add(invite)
    session.commit()
    session.refresh(user)

    logger.info("auth.user_registered", username=user.username)
    return user_response(session, user)


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Obtain a JWT access token",
)
async def login(
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
    return TokenResponse(
        access_token=token,
        github_token_status=await check_github_token(user_token(session, user, settings)),
    )


# ---------------------------------------------------------------------------
# GitHub OAuth
# ---------------------------------------------------------------------------

_GH_STATE = "gh_state"
_GH_PENDING = "gh_pending"
#: Binds the OAuth ``state`` to the browser that started the sign-in, so a
#: callback URL forwarded to someone else cannot log them into another account.
_GH_NONCE_COOKIE = "gh_oauth_nonce"


def _gh_cookie_path(settings: AppSettings) -> str:
    """Path the browser sees, e.g. ``/api/auth/github`` behind the frontend's nginx."""
    from urllib.parse import urlparse

    return urlparse(settings.backend_public_url).path.rstrip("/") + "/auth/github"


def _short_jwt(claims: dict, typ: str, settings: AppSettings) -> str:
    from datetime import datetime

    exp = datetime.now(timezone.utc) + timedelta(minutes=10)
    return jwt.encode({**claims, "typ": typ, "exp": exp}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _read_short_jwt(value: str, typ: str, settings: AppSettings) -> dict:
    try:
        claims = jwt.decode(value, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=400, detail="Expired or invalid GitHub sign-in.") from exc
    if claims.get("typ") != typ:
        raise HTTPException(status_code=400, detail="Expired or invalid GitHub sign-in.")
    return claims


def _github_account(session: Session, settings: AppSettings, gh: dict) -> User:
    """Create the ``<login>@g`` user and its GitHub identity."""
    provider = get_provider(session, "github")
    username = gh["login"] + provider.username_suffix
    if session.exec(select(User).where(User.username == username)).first():
        # Someone renamed on GitHub and another took the old login.
        username = f"{gh['login']}-{gh['id']}{provider.username_suffix}"
    user = User(
        username=username,
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        role="member",
        email=gh["email"],
        needs_password=True,
    )
    session.add(user)
    session.flush()
    identity = UserIdentity(
        user_id=user.id,  # type: ignore[arg-type]
        provider_id=provider.id,  # type: ignore[arg-type]
        provider_user_id=str(gh["id"]),
    )
    set_user_token(session, identity, decrypt_token(gh["token"], settings), settings)
    session.commit()
    session.refresh(user)
    logger.info("auth.github_user_created", username=user.username)
    return user


def _login_redirect(user: User, status_: str, settings: AppSettings) -> RedirectResponse:
    from urllib.parse import urlencode

    query = urlencode({
        "token": create_access_token(subject=user.username, settings=settings),
        "github_token_status": status_,
    })
    return RedirectResponse(f"{settings.frontend_url}/auth/github?{query}", status_code=302)


@router.get("/github/login", summary="Start the GitHub OAuth sign-in")
def github_login(settings: Annotated[AppSettings, Depends(get_settings)]) -> RedirectResponse:
    from urllib.parse import urlencode

    if not settings.github_oauth_client_id:
        raise HTTPException(status_code=503, detail="GitHub sign-in is not configured.")
    nonce = secrets.token_urlsafe(32)
    query = urlencode({
        "client_id": settings.github_oauth_client_id,
        # repo + admin:repo_hook: registering a repository creates its webhook.
        "scope": "repo admin:repo_hook user:email",
        "state": _short_jwt({"nonce": nonce}, _GH_STATE, settings),
        "redirect_uri": f"{settings.backend_public_url.rstrip('/')}/auth/github/callback",
    })
    response = RedirectResponse(f"https://github.com/login/oauth/authorize?{query}", status_code=302)
    response.set_cookie(
        _GH_NONCE_COOKIE,
        nonce,
        max_age=600,
        path=_gh_cookie_path(settings),
        httponly=True,
        # Lax still sends it on GitHub's top-level GET redirect back to us.
        samesite="lax",
        secure=settings.backend_public_url.startswith("https://"),
    )
    return response


@router.get("/github/callback", summary="GitHub OAuth callback")
async def github_callback(
    code: str,
    state: str,
    request: Request,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> RedirectResponse:
    claims = _read_short_jwt(state, _GH_STATE, settings)
    cookie = request.cookies.get(_GH_NONCE_COOKIE, "")
    if not cookie or not secrets.compare_digest(str(claims.get("nonce", "")), cookie):
        raise HTTPException(status_code=400, detail="GitHub sign-in was started in another browser.")
    response = await _github_sign_in(code, session, settings)
    response.delete_cookie(_GH_NONCE_COOKIE, path=_gh_cookie_path(settings))
    return response


async def _github_sign_in(code: str, session: Session, settings: AppSettings) -> RedirectResponse:
    import httpx
    from urllib.parse import urlencode

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "client_id": settings.github_oauth_client_id,
                    "client_secret": settings.github_oauth_client_secret,
                    "code": code,
                },
                headers={"Accept": "application/json"},
            )
            access = resp.json().get("access_token")
            if not access:
                raise HTTPException(status_code=400, detail="GitHub refused the sign-in.")
            headers = {"Authorization": f"Bearer {access}", "Accept": "application/vnd.github+json"}
            profile = (await client.get("https://api.github.com/user", headers=headers)).json()
            emails = (await client.get("https://api.github.com/user/emails", headers=headers)).json()
    except httpx.HTTPError as exc:
        logger.error("auth.github_callback_failed", error=str(exc))
        raise HTTPException(status_code=502, detail="Could not reach GitHub.") from exc

    email = next(
        (e["email"] for e in emails if isinstance(e, dict) and e.get("primary") and e.get("verified")),
        profile.get("email"),
    )
    provider = get_provider(session, "github")
    identity = session.exec(
        select(UserIdentity).where(
            UserIdentity.provider_id == provider.id,
            UserIdentity.provider_user_id == str(profile["id"]),
        )
    ).first()
    if identity:
        set_user_token(session, identity, access, settings)  # GitHub may have issued a new one
        session.commit()
        user = session.get(User, identity.user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=403, detail="User account is disabled.")
        return _login_redirect(user, "ok", settings)

    gh = {"id": profile["id"], "login": profile["login"], "email": email,
          "token": encrypt_token(access, settings)}
    if email and session.exec(select(User).where(User.email == email)).first():
        # Accounts are never linked: let the person choose.
        query = urlencode({"conflict": email, "pending": _short_jwt({"gh": gh}, _GH_PENDING, settings)})
        return RedirectResponse(f"{settings.frontend_url}/auth/github?{query}", status_code=302)
    return _login_redirect(_github_account(session, settings, gh), "ok", settings)


@router.post("/github/confirm-new", response_model=TokenResponse,
             summary="Create the @g account despite an existing account with that email")
def github_confirm_new(
    body: GithubConfirmNewRequest,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> TokenResponse:
    gh = _read_short_jwt(body.pending, _GH_PENDING, settings)["gh"]
    provider = get_provider(session, "github")
    if session.exec(select(UserIdentity).where(
        UserIdentity.provider_id == provider.id, UserIdentity.provider_user_id == str(gh["id"])
    )).first():
        raise HTTPException(status_code=409, detail="This GitHub account is already registered.")
    user = _github_account(session, settings, gh)
    return TokenResponse(
        access_token=create_access_token(subject=user.username, settings=settings),
        github_token_status="ok",
    )


@router.post("/set-password", response_model=UserResponse,
             summary="Set the first password of a GitHub sign-up")
def set_password(
    body: SetPasswordRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    if not current_user.needs_password:
        raise HTTPException(status_code=400, detail="Use change-password instead.")
    current_user.hashed_password = hash_password(body.password)
    current_user.needs_password = False
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return user_response(session, current_user)


@router.put("/github-token", response_model=UserResponse, summary="Replace your GitHub token")
async def update_github_token(
    body: GithubTokenUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> UserResponse:
    if await check_github_token(body.github_token) == "invalid":
        raise HTTPException(status_code=400, detail="The GitHub token is invalid or expired.")
    found = identity_of(session, current_user)
    identity = found[0] if found else UserIdentity(
        user_id=current_user.id,  # type: ignore[arg-type]
        provider_id=get_provider(session, "token").id,  # type: ignore[arg-type]
    )
    set_user_token(session, identity, body.github_token, settings)
    session.commit()
    logger.info("auth.github_token_updated", username=current_user.username)
    return user_response(session, current_user)


@router.get("/github-token/status", summary="Ping GitHub with your stored token")
async def github_token_status(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> dict[str, str]:
    return {"status": await check_github_token(user_token(session, current_user, settings))}


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
    session: Annotated[Session, Depends(get_session)],
) -> UserResponse:
    """Return the profile of the currently authenticated user."""
    return user_response(session, current_user)


@router.patch(
    "/me",
    response_model=UserResponse,
    summary="Update profile (email)",
)
async def update_me(
    body: UpdateProfileRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[AppSettings, Depends(get_settings)],
) -> UserResponse:
    """Set or update the account email address.

    - No email on account → saves directly (bootstrapping case).
    - Email already set → sends a confirmation link to the current email;
      the new address is applied only after the user clicks it.
    """
    first_time = not current_user.email
    # Send to new address when setting for first time (verify it exists),
    # send to current address when changing (verify identity).
    recipient = body.email if first_time else current_user.email

    token_value = _create_change_token(
        user=current_user,
        change_type="email",
        new_value=body.email,
        session=session,
        settings=settings,
    )
    confirm_url = f"{settings.frontend_url}/confirm-change?token={token_value}"

    background_tasks.add_task(
        send_change_confirmation_email,
        to_address=recipient,
        confirm_url=confirm_url,
        change_type="email",
        new_username=body.email,
        settings=settings,
    )
    logger.info(
        "auth.change_email_requested",
        username=current_user.username,
        recipient=recipient,
        first_time=first_time,
    )
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

    # The sign-in suffix is not the user's to change.
    found = identity_of(session, current_user)
    suffix = found[1].username_suffix if found else "@t"
    new_username = _base_username(body.new_username) + suffix
    conflict = session.exec(
        select(User).where(User.username == new_username)
    ).first()
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken.")

    token_value = _create_change_token(
        user=current_user,
        change_type="username",
        new_value=new_username,
        session=session,
        settings=settings,
    )
    confirm_url = f"{settings.frontend_url}/confirm-change?token={token_value}"

    background_tasks.add_task(
        send_change_confirmation_email,
        to_address=current_user.email,
        confirm_url=confirm_url,
        change_type="username",
        new_username=new_username,
        settings=settings,
    )
    logger.info("auth.change_username_requested", username=current_user.username, new=new_username)
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
    elif token.change_type == "email":
        user.email = token.new_value

    token.used_at = datetime.now(timezone.utc)
    session.add(user)
    session.add(token)
    session.commit()
    session.refresh(user)

    logger.info("auth.change_confirmed", username=user.username, change_type=token.change_type)
    return UserResponse.model_validate(user)
