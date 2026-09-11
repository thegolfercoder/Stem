"""Conversations, and the chat stream itself."""

from __future__ import annotations

import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from jarvis import retrieval
from jarvis.ai.base import ChatProvider
from jarvis.api.deps import (
    chat_provider,
    context_manager,
    current_user,
    db_session,
    tool_registry,
)
from jarvis.api.schemas import (
    ChatRequestBody,
    ConversationCreate,
    ConversationDetail,
    ConversationOut,
    ConversationRename,
    ConversationSearchHit,
    MessageOut,
)
from jarvis.context_manager import ContextManager
from jarvis.models import User
from jarvis.services import chat as chat_service
from jarvis.services import conversations as convo_service
from jarvis.services.app_settings import get_ai_settings
from jarvis.tools import ToolRegistry

router = APIRouter(prefix="/api", tags=["chat"])


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    session: Session = Depends(db_session), user: User = Depends(current_user)
) -> list[ConversationOut]:
    return [
        ConversationOut.model_validate(c)
        for c in convo_service.list_conversations(session, user_id=user.id)
    ]


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def create_conversation(
    body: ConversationCreate,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> ConversationOut:
    conversation = convo_service.create_conversation(session, user_id=user.id, title=body.title)
    return ConversationOut.model_validate(conversation)


@router.get("/conversations/search", response_model=list[ConversationSearchHit])
def search_conversations(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[ConversationSearchHit]:
    """Search past messages. Declared before `/conversations/{id}` so that
    "search" is not read as a conversation id."""
    return [
        ConversationSearchHit(
            conversation_id=hit.conversation.id,
            title=hit.conversation.title,
            role=hit.message.role,
            text=retrieval.excerpt(hit.message.content, q),
            created_at=hit.message.created_at,
        )
        for hit in convo_service.search_messages(session, user_id=user.id, query=q, limit=limit)
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> ConversationDetail:
    conversation = convo_service.get_conversation(
        session, user_id=user.id, conversation_id=conversation_id
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such conversation.")
    messages = convo_service.load_messages(session, conversation_id=conversation.id)
    detail = ConversationDetail.model_validate(conversation)
    detail.messages = [MessageOut.model_validate(m) for m in messages]
    return detail


@router.patch("/conversations/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: int,
    body: ConversationRename,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> ConversationOut:
    conversation = convo_service.rename_conversation(
        session, user_id=user.id, conversation_id=conversation_id, title=body.title
    )
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such conversation.")
    return ConversationOut.model_validate(conversation)


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> None:
    if not convo_service.delete_conversation(
        session, user_id=user.id, conversation_id=conversation_id
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such conversation.")


@router.post("/chat")
def chat(
    body: ChatRequestBody,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
    provider: ChatProvider = Depends(chat_provider),
    manager: ContextManager = Depends(context_manager),
    registry: ToolRegistry = Depends(tool_registry),
) -> StreamingResponse:
    """Send a message; the answer streams back as server-sent events.

    Server-sent events rather than a WebSocket: the traffic is one-directional
    and this keeps the browser side to a `fetch` and a loop.
    """
    if body.conversation_id is None:
        conversation = convo_service.create_conversation(session, user_id=user.id)
        session.commit()
    else:
        found = convo_service.get_conversation(
            session, user_id=user.id, conversation_id=body.conversation_id
        )
        if found is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No such conversation."
            )
        conversation = found

    ai_settings = get_ai_settings(session)

    def events() -> Iterator[str]:
        for event in chat_service.run_turn(
            session,
            user=user,
            conversation=conversation,
            user_text=body.message,
            provider=provider,
            manager=manager,
            registry=registry,
            ai_settings=ai_settings,
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Nginx and friends buffer event streams into uselessness. Harmless
            # on loopback, and correct the day somebody puts this behind a proxy.
            "X-Accel-Buffering": "no",
        },
    )
