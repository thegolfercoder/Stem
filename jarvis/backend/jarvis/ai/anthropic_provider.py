"""The Anthropic implementation of `ChatProvider`.

Three things here are worth knowing about rather than rediscovering:

- The request is opened through a short list of attempts, best first. Optional
  features - server-side refusal fallbacks, summarised thinking - are dropped one
  at a time if the account or the installed SDK rejects them, so an account
  without a beta enabled degrades to a working assistant instead of a 400.
- Retries only happen before the first byte. Once text has been yielded the turn
  is committed; silently restarting it would duplicate output on screen.
- `stop_reason == "refusal"` is checked before the content is read, because on a
  refusal the content is not the answer.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Sequence
from contextlib import ExitStack
from typing import Any

import anthropic

from jarvis.ai.base import (
    ChatRequest,
    CompletionEvent,
    Content,
    ErrorEvent,
    ProviderError,
    ProviderEvent,
    ProviderMessage,
    TextContent,
    TextEvent,
    ThinkingEvent,
    ToolUseContent,
)

log = logging.getLogger("jarvis.ai.anthropic")

# The scalar form of server-side refusal fallbacks: on a policy decline the API
# re-runs the request on a suitable model inside the same call, instead of the
# turn simply stopping. Routed by category, so there is no model list to keep.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

DEFAULT_MODEL = "claude-opus-5"


class AnthropicProvider:
    """Talks to the Messages API. Holds no state about the conversation."""

    name = "anthropic"

    def __init__(
        self,
        api_key: str | None,
        *,
        client: Any | None = None,
        use_fallbacks: bool = True,
    ) -> None:
        self._api_key = api_key
        self._client = client
        self._use_fallbacks = use_fallbacks

    def is_configured(self) -> bool:
        return bool(self._api_key) or self._client is not None

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self._api_key:  # pragma: no cover - stream() checks this first
                raise ProviderError("No API key is configured.")
            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    # --- request construction ------------------------------------------------

    def _base_kwargs(self, request: ChatRequest) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": request.model or DEFAULT_MODEL,
            "max_tokens": request.max_tokens,
            "system": request.system,
            "messages": [_encode_message(m) for m in request.messages],
        }
        if request.tools:
            kwargs["tools"] = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                }
                for tool in request.tools
            ]
        return kwargs

    def _attempts(self, request: ChatRequest) -> list[dict[str, Any]]:
        """Attempts in order of preference. Each entry is the keyword arguments
        for one way of opening the stream; later entries drop optional features."""
        base = self._base_kwargs(request)
        thinking = {"type": "adaptive", "display": "summarized"} if request.show_thinking else None

        attempts: list[dict[str, Any]] = []
        if self._use_fallbacks:
            first: dict[str, Any] = dict(
                base, _beta=True, betas=[FALLBACK_BETA], fallbacks="default"
            )
            if thinking:
                first["thinking"] = thinking
            attempts.append(first)
        plain: dict[str, Any] = dict(base, _beta=False)
        if thinking:
            attempts.append(dict(plain, thinking=thinking))
        attempts.append(plain)
        return attempts

    def _open(self, stack: ExitStack, kwargs: dict[str, Any]) -> Any:
        call = dict(kwargs)
        beta = call.pop("_beta", False)
        endpoint = self.client.beta.messages if beta else self.client.messages
        return stack.enter_context(endpoint.stream(**call))

    # --- the stream ----------------------------------------------------------

    def stream(self, request: ChatRequest) -> Iterator[ProviderEvent]:
        if not self.is_configured():
            yield ErrorEvent(
                "No API key. Put JARVIS_ANTHROPIC_API_KEY in jarvis/.env and restart, "
                "then check Settings.",
            )
            return

        attempts = self._attempts(request)
        with ExitStack() as stack:
            for index, attempt in enumerate(attempts):
                last = index == len(attempts) - 1
                try:
                    stream = self._open(stack, attempt)
                except (TypeError, anthropic.BadRequestError) as exc:
                    if last:
                        yield ErrorEvent(_describe(exc))
                        return
                    log.warning(
                        "request rejected with optional features on (%s); retrying without",
                        type(exc).__name__,
                    )
                    continue
                except anthropic.APIStatusError as exc:
                    yield ErrorEvent(_describe(exc), retryable=exc.status_code >= 500)
                    return
                except anthropic.APIConnectionError:
                    yield ErrorEvent(
                        "Could not reach the API. Check this machine's internet connection.",
                        retryable=True,
                    )
                    return
                # Opened. From here the turn is committed: anything that fails
                # now has already put text on the user's screen, so it is
                # reported rather than retried.
                yield from self._consume(stream)
                return

    def _consume(self, stream: Any) -> Iterator[ProviderEvent]:
        try:
            for event in stream:
                if getattr(event, "type", None) != "content_block_delta":
                    continue
                delta = event.delta
                kind = getattr(delta, "type", None)
                if kind == "text_delta":
                    yield TextEvent(delta.text)
                elif kind == "thinking_delta":
                    yield ThinkingEvent(delta.thinking)
            final = stream.get_final_message()
        except anthropic.APIStatusError as exc:
            yield ErrorEvent(_describe(exc), retryable=exc.status_code >= 500)
            return
        except anthropic.APIConnectionError:
            yield ErrorEvent("The connection dropped mid-answer.", retryable=True)
            return

        if getattr(final, "stop_reason", None) == "refusal":
            details = getattr(final, "stop_details", None)
            category = getattr(details, "category", None)
            suffix = f" (category: {category})" if category else ""
            yield ErrorEvent(f"The model declined to answer this one{suffix}.")
            return

        text_parts: list[str] = []
        tool_calls: list[ToolUseContent] = []
        for block in final.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolUseContent(id=block.id, name=block.name, input=dict(block.input or {}))
                )

        usage = getattr(final, "usage", None)
        yield CompletionEvent(
            text="".join(text_parts),
            stop_reason=getattr(final, "stop_reason", None),
            tool_calls=tool_calls,
            model=getattr(final, "model", None),
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )


def _encode_message(message: ProviderMessage) -> dict[str, Any]:
    return {"role": message.role, "content": [_encode_block(b) for b in message.content]}


def _encode_block(block: Content) -> dict[str, Any]:
    if isinstance(block, TextContent):
        return {"type": "text", "text": block.text}
    if isinstance(block, ToolUseContent):
        return {"type": "tool_use", "id": block.id, "name": block.name, "input": block.input}
    return {
        "type": "tool_result",
        "tool_use_id": block.tool_use_id,
        "content": block.content,
        "is_error": block.is_error,
    }


def _describe(exc: Exception) -> str:
    """A sentence the user can act on, rather than a stack trace."""
    if isinstance(exc, anthropic.AuthenticationError):
        return "The API key was rejected. Check JARVIS_ANTHROPIC_API_KEY in jarvis/.env."
    if isinstance(exc, anthropic.PermissionDeniedError):
        return "The API key does not have access to this model. Try another model in Settings."
    if isinstance(exc, anthropic.NotFoundError):
        return "That model name was not found. Check the model in Settings."
    if isinstance(exc, anthropic.RateLimitError):
        return "Rate limited by the API. Wait a moment and send it again."
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code >= 500:
            return f"The API returned a server error ({exc.status_code}). Worth retrying."
        return f"The API rejected the request: {_message_of(exc)}"
    return f"The request could not be built: {exc}"


def _message_of(exc: anthropic.APIStatusError) -> str:
    message = getattr(exc, "message", None)
    return str(message) if message else str(exc)


def tool_specs_to_dicts(specs: Sequence[Any]) -> list[dict[str, Any]]:  # pragma: no cover
    """Kept for callers that want the wire shape without a request."""
    return [
        {"name": s.name, "description": s.description, "input_schema": s.input_schema}
        for s in specs
    ]
