"""The local database: one SQLite file under `data/`.

SQLite because the source of truth for personal data should be a single file the
owner can copy, encrypt, or delete - not a service. WAL mode so a long streaming
response holding a read does not block the write that follows it, and foreign
keys on because SQLite leaves them off by default and silently keeps orphans if
you never ask.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast

from sqlalchemy import CursorResult, Engine, Result, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    """Declarative base for every JARVIS table."""


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def _configure_connection(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def init_engine(db_path: Path) -> Engine:
    """Open (or reopen) the database. Returns the process-wide engine."""
    global _engine, _session_factory
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{db_path}",
        # FastAPI runs sync endpoints on a threadpool, so a connection made on
        # one thread is used on another. That is safe here because sessions are
        # never shared between threads - only the pool is.
        connect_args={"check_same_thread": False},
        future=True,
    )
    event.listen(engine, "connect", _configure_connection)
    _engine = engine
    _session_factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    return engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("database engine not initialised; call init_engine() first")
    return _engine


def create_all() -> None:
    # Importing the models registers them on Base.metadata. The import lives
    # here rather than at module top to keep db.py free of a circular import.
    from jarvis import models  # noqa: F401

    Base.metadata.create_all(get_engine())


def session_factory() -> sessionmaker[Session]:
    if _session_factory is None:
        raise RuntimeError("database engine not initialised; call init_engine() first")
    return _session_factory


@contextmanager
def session_scope() -> Iterator[Session]:
    """A transaction. Commits on success, rolls back on any exception."""
    session = session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def deleted_rows(result: Result[Any]) -> int:
    """How many rows a DELETE removed.

    SQLAlchemy types `Session.execute` as returning `Result`, which carries no
    `rowcount`; a DELETE always returns a `CursorResult`, which does.
    """
    return int(cast("CursorResult[Any]", result).rowcount or 0)


def get_session() -> Iterator[Session]:
    """FastAPI dependency. One session per request, rolled back if the endpoint
    raises so a half-finished write never reaches disk."""
    with session_scope() as session:
        yield session
