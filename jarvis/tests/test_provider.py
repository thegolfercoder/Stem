"""The Anthropic provider, against a stand-in for the SDK.

No network: the tests drive the same objects the SDK yields, which is enough to
pin the mapping from its events to ours - and, more usefully, the behaviour when
the account rejects an optional feature.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2 as httpx
import pytest
from jarvis.ai.anthropic_provider import AnthropicProvider
from jarvis.ai.base import (
    ChatRequest,
    CompletionEvent,
    ErrorEvent,
    ProviderMessage,
    TextEvent,
    ThinkingEvent,
    ToolResultContent,
    ToolSpec,
    ToolUseContent,
)


def delta(kind: str, **fields: Any) -> SimpleNamespace:
    return SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type=kind, **fields))


class FakeStream:
    def __init__(self, events: list[Any], final: Any) -> None:
        self._events = events
        self._final = final

    def __enter__(self) -> FakeStream:
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    def __iter__(self) -> Any:
        return iter(self._events)

    def get_final_message(self) -> Any:
        return self._final


class FakeMessages:
    """Stands in for `client.messages` or `client.beta.messages`."""

    def __init__(self, stream: FakeStream, *, raises: Exception | None = None) -> None:
        self._stream = stream
        self._raises = raises
        self.calls: list[dict[str, Any]] = []

    def stream(self, **kwargs: Any) -> FakeStream:
        self.calls.append(kwargs)
        if self._raises is not None:
            raise self._raises
        return self._stream


class FakeClient:
    def __init__(self, messages: FakeMessages, beta_messages: FakeMessages | None = None) -> None:
        self.messages = messages
        self.beta = SimpleNamespace(messages=beta_messages or messages)


def bad_request(message: str = "unknown beta") -> anthropic.BadRequestError:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(400, request=request, json={"error": {"message": message}})
    return anthropic.BadRequestError(message, response=response, body=None)


def request(**overrides: Any) -> ChatRequest:
    base: dict[str, Any] = {
        "system": "You are JARVIS.",
        "messages": [ProviderMessage.text("user", "hello")],
        "model": "claude-opus-5",
    }
    base.update(overrides)
    return ChatRequest(**base)


def final_message(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "content": [SimpleNamespace(type="text", text="Hello there.")],
        "stop_reason": "end_turn",
        "model": "claude-opus-5",
        "usage": SimpleNamespace(input_tokens=11, output_tokens=4),
        "stop_details": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_text_and_thinking_are_mapped_then_a_completion() -> None:
    stream = FakeStream(
        [
            delta("text_delta", text="Hello "),
            delta("thinking_delta", thinking="considering"),
            delta("text_delta", text="there."),
        ],
        final_message(),
    )
    provider = AnthropicProvider("key", client=FakeClient(FakeMessages(stream)))
    events = list(provider.stream(request()))

    assert [type(e) for e in events] == [TextEvent, ThinkingEvent, TextEvent, CompletionEvent]
    completion = events[-1]
    assert isinstance(completion, CompletionEvent)
    assert completion.text == "Hello there."
    assert (completion.input_tokens, completion.output_tokens) == (11, 4)


def test_tool_calls_are_surfaced() -> None:
    final = final_message(
        stop_reason="tool_use",
        content=[
            SimpleNamespace(
                type="tool_use", id="toolu_1", name="search_conversations", input={"query": "exam"}
            )
        ],
    )
    provider = AnthropicProvider("key", client=FakeClient(FakeMessages(FakeStream([], final))))
    completion = list(provider.stream(request()))[-1]
    assert isinstance(completion, CompletionEvent)
    assert completion.tool_calls == [
        ToolUseContent(id="toolu_1", name="search_conversations", input={"query": "exam"})
    ]


def test_a_refusal_is_reported_rather_than_read_as_an_answer() -> None:
    final = final_message(
        stop_reason="refusal",
        stop_details=SimpleNamespace(type="refusal", category="cyber"),
        content=[SimpleNamespace(type="text", text="")],
    )
    provider = AnthropicProvider("key", client=FakeClient(FakeMessages(FakeStream([], final))))
    events = list(provider.stream(request()))
    assert isinstance(events[-1], ErrorEvent)
    assert "declined" in events[-1].message


def test_optional_features_are_dropped_when_the_account_rejects_them() -> None:
    """An account without the fallbacks beta gets a working assistant, not a 400."""
    plain = FakeMessages(FakeStream([delta("text_delta", text="ok")], final_message()))
    beta = FakeMessages(FakeStream([], final_message()), raises=bad_request("unknown beta"))
    provider = AnthropicProvider("key", client=FakeClient(plain, beta))

    events = list(provider.stream(request()))
    assert isinstance(events[-1], CompletionEvent)
    assert len(beta.calls) == 1, "the beta path was tried first"
    assert "fallbacks" not in plain.calls[0], "and dropped on the retry"


def test_thinking_is_dropped_if_the_model_rejects_it() -> None:
    attempts: list[dict[str, Any]] = []

    class Fussy(FakeMessages):
        def stream(self, **kwargs: Any) -> FakeStream:
            attempts.append(kwargs)
            if "thinking" in kwargs:
                raise bad_request("thinking is not supported")
            return self._stream

    messages = Fussy(FakeStream([delta("text_delta", text="ok")], final_message()))
    provider = AnthropicProvider("key", client=FakeClient(messages), use_fallbacks=False)
    events = list(provider.stream(request(show_thinking=True)))

    assert isinstance(events[-1], CompletionEvent)
    assert len(attempts) == 2
    assert "thinking" not in attempts[-1]


def test_a_hard_failure_becomes_one_error_event() -> None:
    messages = FakeMessages(FakeStream([], final_message()), raises=bad_request("model not found"))
    provider = AnthropicProvider("key", client=FakeClient(messages), use_fallbacks=False)
    events = list(provider.stream(request()))
    assert len(events) == 1
    assert isinstance(events[0], ErrorEvent)


def test_no_key_is_reported_before_a_request_is_attempted() -> None:
    provider = AnthropicProvider(None)
    events = list(provider.stream(request()))
    assert isinstance(events[0], ErrorEvent)
    assert "JARVIS_ANTHROPIC_API_KEY" in events[0].message


def test_the_wire_shape_of_tools_and_tool_results() -> None:
    messages = FakeMessages(FakeStream([], final_message()))
    provider = AnthropicProvider("key", client=FakeClient(messages), use_fallbacks=False)
    conversation = [
        ProviderMessage.text("user", "when is my exam?"),
        ProviderMessage(
            role="assistant",
            content=[
                ToolUseContent(id="toolu_1", name="search_conversations", input={"query": "exam"})
            ],
        ),
        ProviderMessage(
            role="user",
            content=[ToolResultContent(tool_use_id="toolu_1", content="3 October", is_error=False)],
        ),
    ]
    list(
        provider.stream(
            request(
                messages=conversation,
                tools=[
                    ToolSpec("search_conversations", "Search past messages.", {"type": "object"})
                ],
            )
        )
    )

    sent = messages.calls[0]
    assert sent["tools"] == [
        {
            "name": "search_conversations",
            "description": "Search past messages.",
            "input_schema": {"type": "object"},
        }
    ]
    assert sent["messages"][1]["content"][0]["type"] == "tool_use"
    assert sent["messages"][2]["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "toolu_1",
        "content": "3 October",
        "is_error": False,
    }


@pytest.mark.parametrize(
    ("exception_class", "status", "expected"),
    [
        (anthropic.AuthenticationError, 401, "key"),
        (anthropic.PermissionDeniedError, 403, "access"),
        (anthropic.NotFoundError, 404, "model"),
        (anthropic.RateLimitError, 429, "rate limited"),
        (anthropic.InternalServerError, 500, "server error"),
    ],
)
def test_errors_are_translated_into_something_actionable(
    exception_class: type[anthropic.APIStatusError], status: int, expected: str
) -> None:
    """The user gets a sentence naming what to change, not a status code."""
    from jarvis.ai.anthropic_provider import _describe

    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=req, json={"error": {"message": "nope"}})
    error = exception_class("nope", response=response, body=None)
    assert expected in _describe(error).lower()
