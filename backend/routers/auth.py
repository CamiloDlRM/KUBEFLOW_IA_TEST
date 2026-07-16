"""Authentication endpoints: login and current-user lookup."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlmodel import Session, select
import structlog

from core.config import AppSettings, get_settings
from core.security import create_token, verify_password, verify_token
from models.schemas import LoginRequest, TokenResponse, User, UserResponse

logger = structlog.get_logger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def _get_session(settings: AppSettings = Depends(get_settings)) -> Session:
    from sqlmodel import create_engine

    engine = create_engine(settings.database_url, echo=False)
    with Session(engine) as session:
        yield session


def get_current_user(
    authorization: str = Header(default=""),
    session: Session = Depends(_get_session),
) -> User:
    """Resolve the user from a ``Bearer <token>`` Authorization header."""
    token = authorization.removeprefix("Bearer ").strip()
    email = verify_token(token) if token else None
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
    user = session.exec(select(User).where(User.email == email)).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive.",
        )
    return user


@router.post("/login", response_model=TokenResponse, summary="Log in")
async def login(
    payload: LoginRequest,
    session: Session = Depends(_get_session),
) -> TokenResponse:
    """Validate credentials and return a signed session token."""
    user = session.exec(select(User).where(User.email == payload.email)).first()
    if not user or not user.is_active or not verify_password(
        payload.password, user.password_hash
    ):
        logger.warning("auth.login.failed", email=payload.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    logger.info("auth.login.success", email=user.email)
    return TokenResponse(
        access_token=create_token(user.email),
        email=user.email,
        full_name=user.full_name,
    )


@router.get("/me", response_model=UserResponse, summary="Current user")
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    """Return the authenticated user's profile."""
    return UserResponse.model_validate(user)
