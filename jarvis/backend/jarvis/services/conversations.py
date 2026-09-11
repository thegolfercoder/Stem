"""Conversations and the messages in them."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from jarvis.ai.base import ProviderMessage, Role
from jarvis.db import deleted_rows
from jarvis.models import Conversation, Message, utcnow

TITLE_MAX_CHARS = 60
DEFAULT_TITLE = "New conversation"


def create_conversation(
    session: Session, *, user_id: int, title: str = DEFAULT_TITLE
) -> Conversation:
    conversation = Conversation(user_id=user_id, title=title.strip() or DEFAULT_TITLE)
    session.add(conversation)
    session.flush()
    return conversation


def list_conversations(session: Session, *, user_id: int, limit: int = 50) -> list[Conversation]:
    statement = (
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .order_by(Conversation.updated_at.desc())
        .limit(limit)
    )
    return list(session.execute(statement).scalars())


def get_conversation(
    session: Session, *, user_id: int, conversation_id: int
) -> Conversation | None:
    """Always by (id, user_id).

    Scoping every read to the owner is what keeps a guessed id from being a way in.
    """
    return session.execute(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user_id
        )
    ).scalar_one_or_none()


def delete_conversation(session: Session, *, user_id: int, conversation_id: int) -> bool:
    result = session.execute(
        delete(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user_id
        )
    )
    return bool(deleted_rows(result))


def rename_conversation(
    session: Session, *, user_id: int, conversation_id: int, title: str
) -> Conversation | None:
    conversation = get_conversation(session, user_id=user_id, conversation_id=conversation_id)
    if conversation is None:
        return None
    conversation.title = title.strip()[:TITLE_MAX_CHARS] or DEFAULT_TITLE
    session.flush()
    return conversation


def message_counts(session: Session, *, user_id: int) -> tuple[int, int]:
    """(conversations, messages) - for the dashboard."""
    conversations = session.execute(
        select(func.count(Conversation.id)).where(Conversation.user_id == user_id)
    ).scalar_one()
    messages = session.execute(
        select(func.count(Message.id))
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Conversation.user_id == user_id)
    ).scalar_one()
    return int(conversations), int(messages)


def add_message(
    session: Session,
    *,
    conversation: Conversation,
    role: str,
    content: str,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    error: str | None = None,
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        role=role,
        content=content,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        error=error,
    )
    session.add(message)
    conversation.updated_at = utcnow().replace(tzinfo=None)
    session.flush()
    return message


def load_messages(session: Session, *, conversation_id: int) -> list[Message]:
    statement = (
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.id.asc())
    )
    return list(session.execute(statement).scalars())


def as_provider_messages(messages: Sequence[Message]) -> list[ProviderMessage]:
    """History in the form the provider takes.

    Failed turns are dropped: an empty assistant message, or one that only ever
    held an error, is not something to send back to the model as if it had said it.
    """
    out: list[ProviderMessage] = []
    for message in messages:
        if message.role not in ("user", "assistant"):
            continue
        if not message.content.strip():
            continue
        role: Role = "user" if message.role == "user" else "assistant"
        out.append(ProviderMessage.text(role, message.content))
    return out


def derive_title(text: str) -> str:
    """A conversation's name, from its first message.

    Deliberately not a second model call: naming a chat should not cost a request,
    and the first line of what was asked is usually the best label anyway.
    """
    cleaned = " ".join(text.split())
    if not cleaned:
        return DEFAULT_TITLE
    if len(cleaned) <= TITLE_MAX_CHARS:
        return cleaned
    cut = cleaned[:TITLE_MAX_CHARS]
    if " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut + "..."
