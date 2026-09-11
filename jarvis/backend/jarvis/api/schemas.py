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
    api_key_present: bool
    model: str
    data_dir: str
    tools: list[str]
    recent_conversations: list[ConversationOut] = Field(default_factory=list)
