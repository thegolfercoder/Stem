"""The provider interface, and the neutral types it speaks.

A provider takes an assembled request and returns a stream of events. It does not
know what JARVIS is, where the data came from, or that a database exists - which
is the property that keeps "only the minimum context leaves the machine" a rule
enforced in one place (`context.py`) rather than a habit spread across the code.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, runtime_checkable

Role = Literal["user", "assistant"]


# --- what goes up -----------------------------------------------------------


@dataclass(frozen=True)
class TextContent:
    text: str


@dataclass(frozen=True)
class ToolUseContent:
    """A tool the model asked for."""

    id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ToolResultContent:
    """What the local tool returned, on its way back up."""

    tool_use_id: str
    content: str
    is_error: bool = False


Content = TextContent | ToolUseContent | ToolResultContent


@dataclass(frozen=True)
class ProviderMessage:
    role: Role
    content: list[Content]

    @classmethod
    def text(cls, role: Role, text: str) -> ProviderMessage:
        return cls(role=role, content=[TextContent(text=text)])


@dataclass(frozen=True)
class ToolSpec:
    """A local tool, described for the model. `input_schema` is JSON Schema."""

    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class ChatRequest:
    """One request to the cloud model.

    `system` and `messages` are the entire context that leaves this machine. If
    something personal is not in here, it did not go.
    """

    system: str
    messages: list[ProviderMessage]
    model: str
    max_tokens: int = 8192
    tools: list[ToolSpec] = field(default_factory=list)
    # Whether to ask for a readable summary of the model's reasoning. Off by
    # default: it costs nothing to run but it is noise for most questions.
    show_thinking: bool = False


# --- what comes back --------------------------------------------------------


@dataclass(frozen=True)
class TextEvent:
    text: str


@dataclass(frozen=True)
class ThinkingEvent:
    text: str


@dataclass(frozen=True)
class CompletionEvent:
    """The end of one model turn."""

    text: str
    stop_reason: str | None
    tool_calls: list[ToolUseContent] = field(default_factory=list)
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


@dataclass(frozen=True)
class ErrorEvent:
    message: str
    # True when trying again unchanged might work (rate limit, network, 5xx).
    retryable: bool = False


ProviderEvent = TextEvent | ThinkingEvent | CompletionEvent | ErrorEvent


@runtime_checkable
class ChatProvider(Protocol):
    """What the chat service needs from a model, and nothing else."""

    name: str

    def is_configured(self) -> bool:
        """False when the key is missing, so the UI can say so before a request
        fails rather than after."""
        ...

    def stream(self, request: ChatRequest) -> Iterator[ProviderEvent]:
        """Yields text and thinking as they arrive, then exactly one
        `CompletionEvent` - or one `ErrorEvent` and nothing after it."""
        ...


class ProviderError(RuntimeError):
    """A provider failed in a way worth showing the user verbatim."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
