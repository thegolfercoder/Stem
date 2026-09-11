"""Sign in, sign out, lock."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from jarvis.api.deps import app_settings, current_user, db_session
from jarvis.api.schemas import (
    AuthStatus,
    LoginRequest,
    PasswordChangeRequest,
    SetupRequest,
    UserOut,
)
from jarvis.config import Settings
from jarvis.models import User
from jarvis.services import auth as auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(response: Response, token: str, ttl_hours: int) -> None:
    response.set_cookie(
        auth_service.SESSION_COOKIE,
        token,
        max_age=ttl_hours * 3600,
        httponly=True,
        # Lax, not None: the cookie should not ride along on a request some other
        # page made. `secure` stays off because this is served over http on
        # loopback, where there is nothing between the browser and the server.
        samesite="lax",
        path="/",
    )


@router.get("/status", response_model=AuthStatus)
def status_(
    session: Session = Depends(db_session),
    jarvis_session: str | None = Cookie(default=None, alias=auth_service.SESSION_COOKIE),
) -> AuthStatus:
    """What the login screen needs to know before it draws itself."""
    user = auth_service.resolve_session(session, jarvis_session)
    return AuthStatus(
        needs_setup=not auth_service.user_exists(session),
        authenticated=user is not None,
        user=UserOut.model_validate(user) if user else None,
    )


@router.post("/setup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def setup(
    body: SetupRequest,
    response: Response,
    session: Session = Depends(db_session),
    settings: Settings = Depends(app_settings),
) -> UserOut:
    """First run: create the owner and sign them in."""
    try:
        user = auth_service.create_user(
            session,
            username=body.username,
            password=body.password,
            display_name=body.display_name,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    result = auth_service.login(
        session,
        username=body.username,
        password=body.password,
        ttl_hours=settings.session_ttl_hours,
    )
    _set_cookie(response, result.token, settings.session_ttl_hours)
    return UserOut.model_validate(user)


@router.post("/login", response_model=UserOut)
def login(
    body: LoginRequest,
    response: Response,
    session: Session = Depends(db_session),
    settings: Settings = Depends(app_settings),
) -> UserOut:
    try:
        result = auth_service.login(
            session,
            username=body.username,
            password=body.password,
            ttl_hours=settings.session_ttl_hours,
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    _set_cookie(response, result.token, settings.session_ttl_hours)
    return UserOut.model_validate(result.user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    session: Session = Depends(db_session),
    jarvis_session: str | None = Cookie(default=None, alias=auth_service.SESSION_COOKIE),
) -> Response:
    """Lock and log out are the same operation: the session row goes."""
    auth_service.logout(session, jarvis_session)
    response.delete_cookie(auth_service.SESSION_COOKIE, path="/")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChangeRequest,
    response: Response,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> Response:
    try:
        auth_service.change_password(
            session, user=user, current=body.current_password, new=body.new_password
        )
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    # Changing the password ends every session, this one included.
    response.delete_cookie(auth_service.SESSION_COOKIE, path="/")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
