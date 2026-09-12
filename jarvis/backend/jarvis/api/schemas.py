"""Request and response bodies."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SetupRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    display_name: str = Field(default="", max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    last_login_at: datetime | None = None


class AuthStatus(BaseModel):
    needs_setup: bool
    authenticated: bool
    user: UserOut | None = None


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    created_at: datetime
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None
    # So reopening a conversation still offers the rating buttons, and shows
    # what was already said about each answer.
    interaction_id: int | None = None
    rating: str | None = None


class ConversationDetail(ConversationOut):
    messages: list[MessageOut] = Field(default_factory=list)


class ConversationCreate(BaseModel):
    title: str = Field(default="New conversation", max_length=200)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ChatRequestBody(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: int | None = None


class AISettingsOut(BaseModel):
    provider: str
    model: str
    max_tokens: int
    show_thinking: bool
    use_refusal_fallback: bool
    enable_tools: bool
    log_context: bool
    allow_assistant_memories: bool
    voice_enabled: bool
    # Whether a key was found in the environment. The key itself is never sent to
    # the browser - there is no endpoint that returns it.
    api_key_present: bool
    api_key_source: str | None = None
    tools: list[str] = Field(default_factory=list)


class AISettingsUpdate(BaseModel):
    model: str | None = Field(default=None, max_length=64)
    max_tokens: int | None = Field(default=None, ge=256, le=64_000)
    show_thinking: bool | None = None
    use_refusal_fallback: bool | None = None
    enable_tools: bool | None = None
    log_context: bool | None = None
    allow_assistant_memories: bool | None = None
    voice_enabled: bool | None = None


class EraseRequest(BaseModel):
    # Typed out in full by the user. Deleting everything should take a moment's
    # deliberate effort.
    confirm: str
    scope: str = "conversations"


class StatusOut(BaseModel):
    version: str
    user: UserOut
    conversations: int
    messages: int
    memories: int
    documents: int
    api_key_present: bool
    model: str
    data_dir: str
    tools: list[str]
    recent_conversations: list[ConversationOut] = Field(default_factory=list)


# --- phase 2: memory --------------------------------------------------------


class MemoryIn(BaseModel):
    content: str = Field(min_length=1, max_length=1_000)
    category: str = Field(default="important_facts", max_length=32)
    importance: int = Field(default=3, ge=1, le=5)
    tags: list[str] = Field(default_factory=list)


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, max_length=1_000)
    category: str | None = Field(default=None, max_length=32)
    importance: int | None = Field(default=None, ge=1, le=5)
    tags: list[str] | None = None


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    content: str
    importance: int
    source: str
    tags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None = None
    use_count: int = 0

    @classmethod
    def of(cls, memory: object) -> MemoryOut:
        """Built by hand because `tags` is stored as a string and read as a list."""
        return cls(
            id=memory.id,  # type: ignore[attr-defined]
            category=memory.category,  # type: ignore[attr-defined]
            content=memory.content,  # type: ignore[attr-defined]
            importance=memory.importance,  # type: ignore[attr-defined]
            source=memory.source,  # type: ignore[attr-defined]
            tags=memory.tag_list,  # type: ignore[attr-defined]
            created_at=memory.created_at,  # type: ignore[attr-defined]
            updated_at=memory.updated_at,  # type: ignore[attr-defined]
            last_used_at=memory.last_used_at,  # type: ignore[attr-defined]
            use_count=memory.use_count,  # type: ignore[attr-defined]
        )


class MemorySearchHit(BaseModel):
    memory: MemoryOut
    score: float
    matched: list[str] = Field(default_factory=list)


# --- phase 2: documents -----------------------------------------------------


class DocumentOut(BaseModel):
    id: int
    filename: str
    category: str
    subject: str
    tags: list[str] = Field(default_factory=list)
    content_type: str
    size_bytes: int
    chunk_count: int
    excerpt: str
    created_at: datetime
    updated_at: datetime
    indexed_at: datetime | None = None

    @classmethod
    def of(cls, document: object) -> DocumentOut:
        return cls(
            id=document.id,  # type: ignore[attr-defined]
            filename=document.filename,  # type: ignore[attr-defined]
            category=document.category,  # type: ignore[attr-defined]
            subject=document.subject,  # type: ignore[attr-defined]
            tags=document.tag_list,  # type: ignore[attr-defined]
            content_type=document.content_type,  # type: ignore[attr-defined]
            size_bytes=document.size_bytes,  # type: ignore[attr-defined]
            chunk_count=document.chunk_count,  # type: ignore[attr-defined]
            excerpt=document.excerpt,  # type: ignore[attr-defined]
            created_at=document.created_at,  # type: ignore[attr-defined]
            updated_at=document.updated_at,  # type: ignore[attr-defined]
            indexed_at=document.indexed_at,  # type: ignore[attr-defined]
        )


class DocumentSearchHit(BaseModel):
    document_id: int
    filename: str
    subject: str
    part: int
    parts: int
    text: str
    score: float


class ConversationSearchHit(BaseModel):
    conversation_id: int
    title: str
    role: str
    text: str
    created_at: datetime


class NoteIn(BaseModel):
    title: str = Field(default="", max_length=120)
    text: str = Field(min_length=1, max_length=200_000)
    subject: str = Field(default="", max_length=64)
    tags: list[str] = Field(default_factory=list)


# --- phase 3: the improvement loop ------------------------------------------


class FeedbackIn(BaseModel):
    interaction_id: int
    rating: str = Field(pattern="^(up|down)$")
    note: str = Field(default="", max_length=2000)


class InteractionOut(BaseModel):
    id: int
    query: str
    answer: str
    intent: str
    snippets: int
    context_chars: int
    input_tokens: int
    output_tokens: int
    latency_ms: int
    tools_used: list[str] = Field(default_factory=list)
    tool_errors: int
    error: str | None = None
    created_at: datetime
    rating: str | None = None
    note: str = ""
    prompt_version_id: int | None = None

    @classmethod
    def of(cls, row: object, feedback: object | None = None) -> InteractionOut:
        return cls(
            id=row.id,  # type: ignore[attr-defined]
            query=row.query,  # type: ignore[attr-defined]
            answer=row.answer,  # type: ignore[attr-defined]
            intent=row.intent,  # type: ignore[attr-defined]
            snippets=row.snippets,  # type: ignore[attr-defined]
            context_chars=row.context_chars,  # type: ignore[attr-defined]
            input_tokens=row.input_tokens,  # type: ignore[attr-defined]
            output_tokens=row.output_tokens,  # type: ignore[attr-defined]
            latency_ms=row.latency_ms,  # type: ignore[attr-defined]
            tools_used=[t for t in row.tools_used.split(",") if t],  # type: ignore[attr-defined]
            tool_errors=row.tool_errors,  # type: ignore[attr-defined]
            error=row.error,  # type: ignore[attr-defined]
            created_at=row.created_at,  # type: ignore[attr-defined]
            prompt_version_id=row.prompt_version_id,  # type: ignore[attr-defined]
            rating=getattr(feedback, "rating", None),
            note=getattr(feedback, "note", "") or "",
        )


class PromptVersionIn(BaseModel):
    body: str = Field(min_length=40, max_length=20_000)
    name: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2000)


class PromptVersionOut(BaseModel):
    id: int
    number: int
    name: str
    status: str
    author: str
    notes: str
    body: str
    parent_id: int | None = None
    created_at: datetime
    activated_at: datetime | None = None

    @classmethod
    def of(cls, row: object) -> PromptVersionOut:
        return cls(
            id=row.id,  # type: ignore[attr-defined]
            number=row.number,  # type: ignore[attr-defined]
            name=row.name,  # type: ignore[attr-defined]
            status=row.status,  # type: ignore[attr-defined]
            author=row.author,  # type: ignore[attr-defined]
            notes=row.notes,  # type: ignore[attr-defined]
            body=row.body,  # type: ignore[attr-defined]
            parent_id=row.parent_id,  # type: ignore[attr-defined]
            created_at=row.created_at,  # type: ignore[attr-defined]
            activated_at=row.activated_at,  # type: ignore[attr-defined]
        )


class ActivateRequest(BaseModel):
    # Shipping past a known regression has to be typed out, and it is recorded.
    force: bool = False


class FixtureRow(BaseModel):
    category: str = Field(default="important_facts", max_length=32)
    content: str = Field(min_length=1, max_length=1000)


class CheckIn(BaseModel):
    kind: str = Field(max_length=32)
    value: str = Field(default="", max_length=500)


class EvalCaseIn(BaseModel):
    name: str = Field(default="", max_length=160)
    prompt: str = Field(min_length=1, max_length=4000)
    fixture: list[FixtureRow] = Field(default_factory=list)
    checks: list[CheckIn] = Field(default_factory=list)


class EvalCaseOut(BaseModel):
    id: int
    name: str
    prompt: str
    fixture: list[FixtureRow] = Field(default_factory=list)
    checks: list[CheckIn] = Field(default_factory=list)
    source: str
    enabled: bool
    created_at: datetime

    @classmethod
    def of(cls, row: object) -> EvalCaseOut:
        import json

        return cls(
            id=row.id,  # type: ignore[attr-defined]
            name=row.name,  # type: ignore[attr-defined]
            prompt=row.prompt,  # type: ignore[attr-defined]
            fixture=[FixtureRow(**f) for f in json.loads(row.fixture or "[]")],  # type: ignore[attr-defined]
            checks=[CheckIn(**c) for c in json.loads(row.checks or "[]")],  # type: ignore[attr-defined]
            source=row.source,  # type: ignore[attr-defined]
            enabled=bool(row.enabled),  # type: ignore[attr-defined]
            created_at=row.created_at,  # type: ignore[attr-defined]
        )


class PromoteRequest(BaseModel):
    interaction_id: int
    name: str = Field(default="", max_length=160)
    checks: list[CheckIn] | None = None
    fixture: list[FixtureRow] | None = None
