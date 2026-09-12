"""Sign in, sign out, lock."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
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
from jarvis.services.throttle import login_throttle

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(request: Request, response: Response, token: str, ttl_hours: int) -> None:
    response.set_cookie(
        auth_service.SESSION_COOKIE,
        token,
        max_age=ttl_hours * 3600,
        httponly=True,
        # Lax, not None: the cookie should not ride along on a request some other
        # page made.
        samesite="lax",
        # On loopback over http there is nothing between the browser and the
        # server, and `secure` would stop the cookie being set at all. Hosted
        # over https it is essential, so it follows the scheme rather than being
        # a setting somebody has to remember to turn on.
        secure=_is_https(request),
        path="/",
    )


def _is_https(request: Request) -> bool:
    """Whether this request reached us over TLS, proxy included.

    Behind nginx or Caddy the app itself speaks http, and only the forwarded
    header knows the truth. Trusting that header is safe here because a reverse
    proxy is the only supported way to host this - and if there is no proxy, the
    header cannot arrive from anywhere else on loopback.
    """
    if request.url.scheme == "https":
        return True
    return request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


def _caller(request: Request) -> str:
    """Who is asking, for rate limiting. The forwarded address when behind a
    proxy, since otherwise every attempt looks like it came from the proxy."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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
    request: Request,
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
    _set_cookie(request, response, result.token, settings.session_ttl_hours)
    return UserOut.model_validate(user)


@router.post("/login", response_model=UserOut)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: Session = Depends(db_session),
    settings: Settings = Depends(app_settings),
) -> UserOut:
    """Sign in, with guessing made slow.

    Both the account and the caller's address are counted. Counting only the
    account would let anyone lock the owner out of their own assistant; counting
    only the address would let a botnet spread its guesses across many.
    """
    account = f"user:{body.username.strip().lower()}"
    address = f"ip:{_caller(request)}"

    waiting = login_throttle.retry_after(account, address)
    if waiting:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in {waiting} seconds.",
            headers={"Retry-After": str(waiting)},
        )

    try:
        result = auth_service.login(
            session,
            username=body.username,
            password=body.password,
            ttl_hours=settings.session_ttl_hours,
        )
    except auth_service.AuthError as exc:
        delay = login_throttle.record_failure(account, address)
        detail = str(exc)
        if delay:
            detail += f" Too many attempts - wait {delay} seconds."
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail) from exc

    login_throttle.record_success(account, address)
    _set_cookie(request, response, result.token, settings.session_ttl_hours)
    return UserOut.model_validate(result.user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    session: Session = Depends(db_session),
    jarvis_session: str | None = Cookie(default=None, alias=auth_service.SESSION_COOKIE),
) -> Response:
    """Lock and log out are the same operation: the session row goes.

    The cookie is cleared on the response that is actually returned. Clearing it
    on the injected one and then returning a fresh `Response` throws the header
    away - the row is gone so the token is already useless, but a dead cookie
    left sitting in a browser is exactly the kind of thing that matters on a
    machine somebody else might use.
    """
    auth_service.logout(session, jarvis_session)
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    out.delete_cookie(auth_service.SESSION_COOKIE, path="/")
    return out


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
