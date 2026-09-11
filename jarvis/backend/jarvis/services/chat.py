"""One turn of conversation, end to end.

This is the loop the whole application exists to run:

    the message arrives -> it is written to the local database
                        -> local sources are searched for what is relevant
                        -> a request carrying only that is sent to the cloud model
                        -> the answer streams back to the browser as it arrives
                        -> the answer is written to the local database

with an inner loop in the middle for tools: when the model asks for one, it runs
here, against local data, and only its result goes back up.

The function is a generator of plain dictionaries. The router turns those into
server-sent events; a future voice interface would turn the same events into
something else. Nothing HTTP-shaped belongs in this file.
"""

from __future__ import annotations

import dataclasses
import logging
from collections.abc import Iterator
from typing import Any

from sqlalchemy.orm import Session

from jarvis.ai.base import (
    ChatProvider,
    ChatRequest,
    CompletionEvent,
    ErrorEvent,
    ProviderMessage,
    TextContent,
    TextEvent,
    ThinkingEvent,
    ToolResultContent,
)
from jarvis.context import ContextBuilder
from jarvis.models import Conversation, User
from jarvis.services import conversations as convo_service
from jarvis.services.app_settings import AISettings
from jarvis.tools import ToolContext, ToolRegistry

log = logging.getLogger("jarvis.chat")

# A model that wants a fourth round of tools is looping, not working.
MAX_TOOL_ROUNDS = 3


def run_turn(
    session: Session,
    *,
    user: User,
    conversation: Conversation,
    user_text: str,
    provider: ChatProvider,
    builder: ContextBuilder,
    registry: ToolRegistry,
    ai_settings: AISettings,
) -> Iterator[dict[str, Any]]:
    """Run one exchange, yielding events as they happen."""
    user_text = user_text.strip()
    if not user_text:
        yield {"type": "error", "message": "An empty message has nothing to answer."}
        return

    first_message = not convo_service.load_messages(session, conversation_id=conversation.id)
    stored_user_message = convo_service.add_message(
        session, conversation=conversation, role="user", content=user_text
    )
    if first_message and conversation.title == convo_service.DEFAULT_TITLE:
        conversation.title = convo_service.derive_title(user_text)
    session.commit()

    yield {
        "type": "user_message",
        "id": stored_user_message.id,
        "conversation_id": conversation.id,
        "title": conversation.title,
    }

    history = convo_service.as_provider_messages(
        convo_service.load_messages(session, conversation_id=conversation.id)
    )
    tools = registry.specs() if ai_settings.enable_tools else []
    built = builder.build(
        user_display_name=user.display_name,
        history=history,
        model=ai_settings.model,
        max_tokens=ai_settings.max_tokens,
        tools=tools,
        show_thinking=ai_settings.show_thinking,
        query=user_text,
    )
    if built.snippets:
        yield {
            "type": "context",
            "snippets": [{"source": s.source, "title": s.title} for s in built.snippets],
        }

    request = built.request
    answer: list[str] = []
    failure: str | None = None
    model_used: str | None = None
    input_tokens = 0
    output_tokens = 0

    for round_number in range(MAX_TOOL_ROUNDS + 1):
        completion: CompletionEvent | None = None
        for event in provider.stream(request):
            if isinstance(event, TextEvent):
                answer.append(event.text)
                yield {"type": "text", "text": event.text}
            elif isinstance(event, ThinkingEvent):
                yield {"type": "thinking", "text": event.text}
            elif isinstance(event, ErrorEvent):
                failure = event.message
                yield {"type": "error", "message": event.message, "retryable": event.retryable}
                break
            elif isinstance(event, CompletionEvent):
                completion = event
                break

        if completion is None:
            break

        model_used = completion.model or request.model
        input_tokens += completion.input_tokens or 0
        output_tokens += completion.output_tokens or 0

        if not completion.tool_calls:
            break
        if round_number == MAX_TOOL_ROUNDS:
            note = "Stopped after too many tool calls in one turn."
            answer.append(f"\n\n_{note}_")
            yield {"type": "error", "message": note}
            break

        # The model asked for tools. Run them locally, hand back only the results.
        results: list[ToolResultContent] = []
        for call in completion.tool_calls:
            yield {"type": "tool", "name": call.name, "status": "running"}
            result = registry.run(
                call.name, call.input, ToolContext(user_id=user.id, session=session)
            )
            session.commit()
            yield {
                "type": "tool",
                "name": call.name,
                "status": "error" if result.is_error else "done",
            }
            results.append(
                ToolResultContent(
                    tool_use_id=call.id, content=result.content, is_error=result.is_error
                )
            )

        assistant_blocks: list[Any] = []
        if completion.text:
            assistant_blocks.append(TextContent(text=completion.text))
        assistant_blocks.extend(completion.tool_calls)
        request = dataclasses.replace(
            request,
            messages=[
                *request.messages,
                ProviderMessage(role="assistant", content=assistant_blocks),
                # Every tool result for one assistant turn goes back in a single
                # user message. Splitting them teaches the model not to ask for
                # tools in parallel.
                ProviderMessage(role="user", content=list(results)),
            ],
        )

    text = "".join(answer).strip()
    if not text and failure is None:
        failure = "The model returned an empty answer."

    stored = convo_service.add_message(
        session,
        conversation=conversation,
        role="assistant",
        content=text,
        model=model_used,
        input_tokens=input_tokens or None,
        output_tokens=output_tokens or None,
        error=failure,
    )
    session.commit()

    yield {
        "type": "done",
        "id": stored.id,
        "conversation_id": conversation.id,
        "title": conversation.title,
        "model": model_used,
        "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
        "error": failure,
    }


def preview_request(request: ChatRequest) -> dict[str, Any]:
    """What would be sent, for the settings page.

    Being able to look at exactly what leaves the machine is the difference
    between a privacy claim and a privacy property.
    """
    return {
        "model": request.model,
        "system": request.system,
        "messages": [
            {
                "role": m.role,
                "text": " ".join(getattr(b, "text", "") for b in m.content).strip(),
            }
            for m in request.messages
        ],
        "tools": [t.name for t in request.tools],
    }
