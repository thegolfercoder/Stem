"""Login, logout, and the session behind them.

Single user, local machine, cookie session. The lock button and the logout button
do the same thing on purpose - they delete the session row - because a lock that
only hides the interface is not a lock.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from jarvis.db import deleted_rows
from jarvis.models import AuthSession, User, utcnow
from jarvis.security import hash_password, new_session_token, token_fingerprint, verify_password

SESSION_COOKIE = "jarvis_session"
MIN_PASSWORD_LENGTH = 8


class AuthError(Exception):
    """Login refused."""


@dataclass(frozen=True)
class LoginResult:
    user: User
    token: str
    expires_at: datetime


def user_exists(session: Session) -> bool:
    return session.execute(select(User.id).limit(1)).first() is not None


def create_user(session: Session, *, username: str, password: str, display_name: str = "") -> User:
    """Create the owner. Refuses a second one: this is a personal application,
    and a second account on it would be a second person's data on one database."""
    username = username.strip().lower()
    if not username:
        raise AuthError("A username is required.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AuthError(f"The password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if user_exists(session):
        raise AuthError("This JARVIS already has an owner.")
    user = User(
        username=username,
        display_name=display_name.strip() or username.title(),
        password_hash=hash_password(password),
    )
    session.add(user)
    session.flush()
    return user


def login(session: Session, *, username: str, password: str, ttl_hours: int) -> LoginResult:
    user = session.execute(
        select(User).where(User.username == username.strip().lower())
    ).scalar_one_or_none()
    # The same message either way: which half was wrong is not the user's
    # business to learn from a login form.
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("Incorrect username or password.")

    token = new_session_token()
    expires_at = datetime.now(UTC) + timedelta(hours=ttl_hours)
    session.add(
        AuthSession(
            user_id=user.id,
            token_hash=token_fingerprint(token),
            expires_at=expires_at.replace(tzinfo=None),
        )
    )
    user.last_login_at = utcnow().replace(tzinfo=None)
    session.flush()
    return LoginResult(user=user, token=token, expires_at=expires_at)


def resolve_session(session: Session, token: str | None) -> User | None:
    """The user behind a cookie, or None. Expired rows are deleted on sight."""
    if not token:
        return None
    row = session.execute(
        select(AuthSession).where(AuthSession.token_hash == token_fingerprint(token))
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.expires_at < datetime.now(UTC).replace(tzinfo=None):
        session.delete(row)
        session.flush()
        return None
    row.last_seen_at = utcnow().replace(tzinfo=None)
    return row.user


def logout(session: Session, token: str | None) -> None:
    if not token:
        return
    session.execute(delete(AuthSession).where(AuthSession.token_hash == token_fingerprint(token)))


def logout_everywhere(session: Session, user_id: int) -> None:
    """Every session for this user. What "lock everything" means when a browser
    has been left logged in somewhere else."""
    session.execute(delete(AuthSession).where(AuthSession.user_id == user_id))


def purge_expired(session: Session) -> int:
    result = session.execute(
        delete(AuthSession).where(AuthSession.expires_at < datetime.now(UTC).replace(tzinfo=None))
    )
    return deleted_rows(result)


def change_password(session: Session, *, user: User, current: str, new: str) -> None:
    if not verify_password(current, user.password_hash):
        raise AuthError("The current password is incorrect.")
    if len(new) < MIN_PASSWORD_LENGTH:
        raise AuthError(f"The new password must be at least {MIN_PASSWORD_LENGTH} characters.")
    user.password_hash = hash_password(new)
    # Every other session dies with the old password. A password change that
    # leaves old sessions alive has not really changed anything.
    logout_everywhere(session, user.id)
    session.flush()
