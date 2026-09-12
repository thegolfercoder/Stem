"""Settings, dashboard status, and deleting memory."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
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
    TaskOut,
    UserOut,
)
from jarvis.config import Settings
from jarvis.context_manager import clear_traces
from jarvis.db import deleted_rows
from jarvis.models import AppSetting, Conversation, User
from jarvis.services import conversations as convo_service
from jarvis.services import documents as document_service
from jarvis.services import memory as memory_service
from jarvis.services import tasks as task_service
from jarvis.services.app_settings import AISettings, get_ai_settings, save_ai_settings
from jarvis.tools import ToolRegistry
from jarvis.voice.gemini import VOICES

router = APIRouter(prefix="/api", tags=["system"])

ERASE_PHRASE = "DELETE MY MEMORY"
ERASE_SCOPES = ("conversations", "memories", "documents", "all")


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
    today = date.today()
    task_counts = task_service.counts(session, user_id=user.id, today=today)
    agenda = task_service.agenda(session, user_id=user.id, today=today)
    return StatusOut(
        version=__version__,
        user=UserOut.model_validate(user),
        conversations=conversations,
        messages=messages,
        memories=memory_service.count(session, user_id=user.id),
        documents=len(document_service.list_all(session, user_id=user.id, limit=500)),
        api_key_present=bool(settings.anthropic_api_key),
        model=ai.model,
        data_dir=str(settings.data_dir),
        tools=[t.name for t in registry],
        tasks_open=task_counts["open"],
        tasks_overdue=task_counts["overdue"],
        tasks_due_today=task_counts["due_today"],
        recent_conversations=[ConversationOut.model_validate(c) for c in recent],
        attention=[TaskOut.of(task, today) for task in agenda.needs_attention[:6]],
    )


def _first_message(exc: ValidationError) -> str:
    """Pydantic's first complaint, in words rather than as a JSON tree."""
    errors = exc.errors()
    if not errors:
        return "Those settings are not valid."
    first = errors[0]
    field = ".".join(str(p) for p in first.get("loc", ())) or "setting"
    return f"{field}: {first.get('msg', 'is not valid')}"


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
        gemini_key_present=bool(settings.gemini_api_key),
        voices=list(VOICES),
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
    # Re-validated rather than model_copy'd: copy skips validators, so a bad
    # voice backend or an unknown voice name would be written to the database
    # and only fail later, somewhere less helpful.
    merged = {**current.model_dump(), **body.model_dump(exclude_none=True)}
    try:
        updated = AISettings.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=_first_message(exc)) from exc
    save_ai_settings(session, updated)
    return AISettingsOut(
        **updated.model_dump(),
        api_key_present=bool(settings.anthropic_api_key),
        api_key_source=_key_source(settings),
        gemini_key_present=bool(settings.gemini_api_key),
        voices=list(VOICES),
        tools=[t.name for t in registry],
    )


@router.post("/memory/erase")
def erase(
    body: EraseRequest,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
) -> dict[str, object]:
    """Delete what JARVIS remembers.

    `scope` decides how much: "conversations" for the chat history, "memories"
    for the stored facts, "documents" for the indexed files and JARVIS's copies
    of them, or "all" for every one of those plus the settings.

    Each is a real SQL DELETE against the local file, and deleting a document
    unlinks the copy under `data/documents/` as well. There is nothing held
    anywhere else to also delete, which is the point of the whole architecture.
    """
    if body.confirm != ERASE_PHRASE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'Type "{ERASE_PHRASE}" exactly to confirm.',
        )
    if body.scope not in ERASE_SCOPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"scope must be one of: {', '.join(ERASE_SCOPES)}.",
        )

    everything = body.scope == "all"
    conversations_deleted = 0
    memories_deleted = 0
    documents_deleted = 0
    settings_removed = 0

    if everything or body.scope == "conversations":
        conversations_deleted = deleted_rows(
            session.execute(delete(Conversation).where(Conversation.user_id == user.id))
        )
    if everything or body.scope == "memories":
        memories_deleted = memory_service.delete_all(session, user_id=user.id)
    if everything or body.scope == "documents":
        documents_deleted = document_service.remove_all(
            session, user_id=user.id, documents_dir=settings.documents_dir
        )
    if everything:
        settings_removed = deleted_rows(session.execute(delete(AppSetting)))

    session.commit()
    # The in-memory record of what was recently sent to the cloud goes too. It
    # is derived from the data that was just deleted.
    clear_traces()
    return {
        "conversations_deleted": conversations_deleted,
        "memories_deleted": memories_deleted,
        "documents_deleted": documents_deleted,
        "settings_reset": settings_removed,
        "scope": body.scope,
    }
