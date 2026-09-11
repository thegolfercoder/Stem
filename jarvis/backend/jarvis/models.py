"""The tables.

Phase 1 owns five: the single user, their login sessions, conversations,
messages, and the application settings that are not secrets. Tables for memory,
tasks, school and projects arrive with the phases that use them - an empty table
shipped early is a schema nobody has tested against real use.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from jarvis.db import Base


def utcnow() -> datetime:
    """Timezone-aware UTC. Stored naive by SQLite, so everything that reads a
    timestamp back attaches UTC again rather than guessing local time."""
    return datetime.now(UTC)


class User(Base):
    """The owner. Single-user by design; the table has a primary key because
    every row below needs an owner to be scoped to, not because JARVIS is
    multi-tenant."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AuthSession(Base):
    """A logged-in browser.

    The token itself is never stored - only its SHA-256 - so a stolen copy of the
    database cannot be used to resume a session. Logging out and locking both
    delete the row, which is what makes them real rather than cosmetic.
    """

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    user: Mapped[User] = relationship(lazy="joined")


class Conversation(Base):
    """One thread of chat."""

    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id",
    )

    __table_args__ = (Index("ix_conversations_user_updated", "user_id", "updated_at"),)


class Message(Base):
    """One turn. `content` is the plain text of the turn; token counts and the
    model that produced it are kept so the settings page can show what JARVIS
    actually costs to run."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Set when the turn failed. The message is still written, so a failed request
    # is visible in the history instead of vanishing.
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    __table_args__ = (
        CheckConstraint("role in ('user', 'assistant', 'system')", name="ck_messages_role"),
    )


class AppSetting(Base):
    """Configuration the settings page can change, stored as JSON text.

    Secrets are not welcome here. The API key comes from the environment, which
    is what keeps it out of `data/` and therefore out of any backup of it.
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (UniqueConstraint("key", name="uq_app_settings_key"),)
