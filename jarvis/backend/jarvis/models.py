"""The tables.

Phase 1 owns five: the single user, their login sessions, conversations,
messages, and the application settings that are not secrets. Phase 2 adds three
more - memories, documents and the chunks documents are split into - which is
the whole of what "JARVIS remembers things" means. Tables for tasks, school and
projects arrive with the phase that uses them; an empty table shipped early is a
schema nobody has tested against real use.

New tables appear through `create_all()` on the next start, so an existing
database picks up phase 2 without a migration step. Nothing in phase 1's five
tables changed, which is what makes that safe.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
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


# --- phase 2: memory ---------------------------------------------------------

# The categories a memory can be filed under. A fixed list rather than free text:
# the model picks one on every save, and a vocabulary it can drift away from is a
# vocabulary that stops being useful for filtering a year in.
MEMORY_CATEGORIES: tuple[str, ...] = (
    "personal",
    "school",
    "subjects",
    "preferences",
    "goals",
    "projects",
    "people",
    "routines",
    "important_facts",
    "instructions",
)

# Where a memory came from. Worth keeping: "you told me this" and "I inferred
# this" deserve different treatment when one of them turns out to be wrong.
MEMORY_SOURCES: tuple[str, ...] = ("user", "assistant", "manual", "import")


class Memory(Base):
    """One durable fact about the owner.

    Small on purpose. A memory is a sentence, not a document - "I prefer concise
    answers", "my maths goal is an A*". Anything longer belongs in a document,
    which is the other half of phase 2.
    """

    __tablename__ = "memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 1 (trivia) to 5 (never get this wrong). Used to break ties in retrieval and
    # to decide what survives when the context budget runs out.
    importance: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    # Comma-separated, lowercased, no spaces. A join table would be tidier and is
    # not worth a second table for something only ever read whole; `tag_list`
    # below is the accessor everything uses.
    tags: Mapped[str] = mapped_column(String(256), nullable=False, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    # Retrieval bookkeeping: a memory that is never used is a memory worth
    # reviewing, and the memory page can sort by it.
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (
        CheckConstraint("importance between 1 and 5", name="ck_memories_importance"),
        Index("ix_memories_user_category", "user_id", "category"),
    )

    @property
    def tag_list(self) -> list[str]:
        return [tag for tag in self.tags.split(",") if tag]


# --- phase 2: documents ------------------------------------------------------


class Document(Base):
    """A file the owner has given JARVIS permission to read.

    The file itself lives under `data/documents/`; this row is the index entry.
    `content_hash` is what makes re-adding the same file an update rather than a
    duplicate.
    """

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    # Relative to the data directory, so moving the data directory does not
    # invalidate every row.
    path: Mapped[str] = mapped_column(String(1024), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    tags: Mapped[str] = mapped_column(String(256), nullable=False, default="")

    content_type: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # The opening of the text, for listing a document without reading the file.
    excerpt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    chunks: Mapped[list[DocumentChunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="DocumentChunk.ordinal"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "content_hash", name="uq_documents_user_hash"),
        Index("ix_documents_user_subject", "user_id", "subject"),
    )

    @property
    def tag_list(self) -> list[str]:
        return [tag for tag in self.tags.split(",") if tag]


class DocumentChunk(Base):
    """A passage of a document, and the unit retrieval actually works in.

    Whole documents are the wrong size to send to a model: a question about one
    paragraph should not cost the other forty. `char_start` is kept so a chunk
    can be pointed back at its place in the file.
    """

    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Reserved for phase 2's embedding plug point: null until an embedder is
    # configured, so adding one later is a backfill and not a schema change.
    embedding_norm: Mapped[float | None] = mapped_column(Float, nullable=True)

    document: Mapped[Document] = relationship(back_populates="chunks")

    __table_args__ = (UniqueConstraint("document_id", "ordinal", name="uq_chunk_ordinal"),)
