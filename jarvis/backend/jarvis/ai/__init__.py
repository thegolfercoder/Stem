"""The cloud side of JARVIS.

Everything provider-specific lives behind `ChatProvider`. The rest of the
application speaks in the neutral types in `base.py`, which is what makes adding
a second provider - or a local model in phase 5 - an addition rather than a
rewrite.
"""

from jarvis.ai.base import (
    ChatProvider,
    ChatRequest,
    CompletionEvent,
    ErrorEvent,
    ProviderEvent,
    ProviderMessage,
    TextContent,
    TextEvent,
    ThinkingEvent,
    ToolResultContent,
    ToolSpec,
    ToolUseContent,
)

__all__ = [
    "ChatProvider",
    "ChatRequest",
    "CompletionEvent",
    "ErrorEvent",
    "ProviderEvent",
    "ProviderMessage",
    "TextContent",
    "TextEvent",
    "ThinkingEvent",
    "ToolResultContent",
    "ToolSpec",
    "ToolUseContent",
]
