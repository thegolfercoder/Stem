"""Settings, dashboard status, and deleting memory."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from jarvis import __version__
from jarvis.api.deps import app_settings, current_user, db_session, tool_registry
from jarvis.api.schemas import (
    AISettingsOut,
    AISettingsUpdate,
    ConversationOut,
    EraseRequest,
    StatusOut,
    UserOut,
)
from jarvis.config import Settings
from jarvis.db import deleted_rows
from jarvis.models import AppSetting, Conversation, User
from jarvis.services import conversations as convo_service
from jarvis.services.app_settings import get_ai_settings, save_ai_settings
from jarvis.tools import ToolRegistry

router = APIRouter(prefix="/api", tags=["system"])

ERASE_PHRASE = "DELETE MY MEMORY"


def _key_source(settings: Settings) -> str | None:
    return "environment" if settings.anthropic_api_key else None


@router.get("/status", response_model=StatusOut)
def status_(
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
    registry: ToolRegistry = Depends(tool_registry),
) -> StatusOut:
    """Everything the dashboard shows, in one request."""
    conversations, messages = convo_service.message_counts(session, user_id=user.id)
    recent = convo_service.list_conversations(session, user_id=user.id, limit=5)
    ai = get_ai_settings(session)
    return StatusOut(
        version=__version__,
        user=UserOut.model_validate(user),
        conversations=conversations,
        messages=messages,
        api_key_present=bool(settings.anthropic_api_key),
        model=ai.model,
        data_dir=str(settings.data_dir),
        tools=[t.name for t in registry],
        recent_conversations=[ConversationOut.model_validate(c) for c in recent],
    )


@router.get("/settings", response_model=AISettingsOut)
def get_settings_(
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
    registry: ToolRegistry = Depends(tool_registry),
) -> AISettingsOut:
    ai = get_ai_settings(session)
    return AISettingsOut(
        **ai.model_dump(),
        api_key_present=bool(settings.anthropic_api_key),
        api_key_source=_key_source(settings),
        tools=[t.name for t in registry],
    )


@router.put("/settings", response_model=AISettingsOut)
def update_settings(
    body: AISettingsUpdate,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
    registry: ToolRegistry = Depends(tool_registry),
) -> AISettingsOut:
    """Change the AI configuration.

    There is deliberately no field here for the API key. It is read from the
    environment, so the settings page cannot be the thing that writes a secret
    into the database.
    """
    current = get_ai_settings(session)
    updated = current.model_copy(
        update={k: v for k, v in body.model_dump(exclude_none=True).items()}
    )
    save_ai_settings(session, updated)
    return AISettingsOut(
        **updated.model_dump(),
        api_key_present=bool(settings.anthropic_api_key),
        api_key_source=_key_source(settings),
        tools=[t.name for t in registry],
    )


@router.post("/memory/erase")
def erase(
    body: EraseRequest,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> dict[str, object]:
    """Delete what JARVIS remembers.

    `scope` is "conversations" or "all". Phase 1 has conversations and settings,
    so "all" means both; as later phases add memory, notes and tasks, they are
    deleted here too. The deletion is a real SQL DELETE against the local file -
    there is nothing held anywhere else to also delete, which is the point of the
    whole architecture.
    """
    if body.confirm != ERASE_PHRASE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Type "{ERASE_PHRASE}" exactly to confirm.',
        )
    if body.scope not in ("conversations", "all"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="scope must be conversations or all."
        )

    removed = deleted_rows(
        session.execute(delete(Conversation).where(Conversation.user_id == user.id))
    )
    settings_removed = 0
    if body.scope == "all":
        settings_removed = deleted_rows(session.execute(delete(AppSetting)))
    session.commit()
    return {
        "conversations_deleted": removed,
        "settings_reset": settings_removed,
        "scope": body.scope,
    }
