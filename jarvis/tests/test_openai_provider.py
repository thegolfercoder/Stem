"""The OpenAI provider, and the two shapes that make it awkward.

No network. `urlopen` is replaced by a recorder that answers in the real
server-sent-event format, so a change to the request or the parsing fails an
assertion here rather than on a bill.

The tool-call tests are the important ones. OpenAI streams a tool call in
fragments - the arguments arrive as a string split at arbitrary points, keyed by
an index - and getting that wrong produces a tool that runs with no arguments
and an assistant that looks like it ignored you. Every awkward split these
tests exercise is one that has to work: mid-key, mid-value, mid-escape, two
calls interleaved, and a stream that stops half way.
"""

from __future__ import annotations

import io
import json
from email.message import Message as EmailMessage
from typing import Any

import pytest
from jarvis.ai import openai_provider as openai
from jarvis.ai.base import (
    ChatRequest,
    CompletionEvent,
    ErrorEvent,
    ProviderMessage,
    TextContent,
    TextEvent,
    ToolResultContent,
    ToolSpec,
    ToolUseContent,
)
from jarvis.services.app_settings import AISettings

MODEL = "gpt-5.5"

TOOLS = [
    ToolSpec(
        name="create_task",
        description="Add one task.",
        input_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )
]


def sse(*chunks: dict[str, Any] | str) -> bytes:
    """The wire format: `data: {...}` lines, then `data: [DONE]`."""
    out = b""
    for chunk in chunks:
        body = chunk if isinstance(chunk, str) else json.dumps(chunk)
        out += f"data: {body}\n\n".encode()
    out += b"data: [DONE]\n\n"
    return out


def text_delta(piece: str) -> dict[str, Any]:
    return {"model": MODEL, "choices": [{"index": 0, "delta": {"content": piece}}]}


def tool_delta(index: int, **fragment: Any) -> dict[str, Any]:
    call: dict[str, Any] = {"index": index}
    if "id" in fragment:
        call["id"] = fragment["id"]
    function: dict[str, Any] = {}
    if "name" in fragment:
        function["name"] = fragment["name"]
    if "arguments" in fragment:
        function["arguments"] = fragment["arguments"]
    if function:
        call["function"] = function
    return {"model": MODEL, "choices": [{"index": 0, "delta": {"tool_calls": [call]}}]}


def done(
    reason: str = "stop", prompt: int = 214, completion: int = 37
) -> tuple[dict[str, Any], dict[str, Any]]:
    return (
        {"model": MODEL, "choices": [{"index": 0, "delta": {}, "finish_reason": reason}]},
        {
            "model": MODEL,
            "choices": [],
            "usage": {"prompt_tokens": prompt, "completion_tokens": completion},
        },
    )


class Recorder:
    """Stands in for the network: remembers each request, answers from a queue."""

    def __init__(self, *replies: bytes) -> None:
        self.sent: list[dict[str, Any]] = []
        self.replies = list(replies)
        self.fail_with: list[Any] = []

    def one(self) -> dict[str, Any]:
        assert len(self.sent) == 1, f"expected one request, got {len(self.sent)}"
        return self.sent[0]

    def __call__(self, request: Any, timeout: float = 0) -> Any:
        self.sent.append(
            {
                "url": request.full_url,
                "headers": {k.lower(): v for k, v in request.headers.items()},
                "body": json.loads(request.data),
            }
        )
        if self.fail_with:
            raise self.fail_with.pop(0)
        reply = self.replies.pop(0) if self.replies else sse(text_delta("ok"), *done())
        return _Response(reply)


class _Response(io.BytesIO):
    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def http_error(code: int, body: dict[str, Any]) -> Any:
    import urllib.error

    return urllib.error.HTTPError(
        openai.API_URL, code, "err", EmailMessage(), io.BytesIO(json.dumps(body).encode())
    )


@pytest.fixture
def wire(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder()
    monkeypatch.setattr("urllib.request.urlopen", recorder)
    return recorder


def ask(provider: openai.OpenAIProvider, **kwargs: Any) -> list[Any]:
    request = ChatRequest(
        system=kwargs.pop("system", "You are JARVIS."),
        messages=kwargs.pop("messages", [ProviderMessage.text("user", "hello")]),
        model=kwargs.pop("model", MODEL),
        **kwargs,
    )
    return list(provider.stream(request))


def keyed(model: str = MODEL) -> openai.OpenAIProvider:
    return openai.OpenAIProvider("sk-test-key", model=model)


# --- the wire format ---------------------------------------------------------


def test_an_answer_streams_and_reports_its_counts(wire: Recorder) -> None:
    wire.replies.append(
        sse(text_delta("Four "), text_delta("words "), text_delta("exactly."), *done())
    )
    events = ask(keyed())

    assert "".join(e.text for e in events if isinstance(e, TextEvent)) == "Four words exactly."
    completions = [e for e in events if isinstance(e, CompletionEvent)]
    assert len(completions) == 1, "exactly one completion, as the protocol promises"
    assert completions[0].stop_reason == "stop"
    assert (completions[0].input_tokens, completions[0].output_tokens) == (214, 37)


def test_the_request_is_the_shape_openai_expects(wire: Recorder) -> None:
    ask(keyed(), tools=TOOLS, max_tokens=1234)
    call = wire.one()

    assert call["url"] == openai.API_URL
    assert call["headers"]["authorization"] == "Bearer sk-test-key"
    body = call["body"]
    assert body["stream"] is True
    assert body["stream_options"] == {"include_usage": True}, "no usage without this"
    assert body["messages"][0] == {"role": "system", "content": "You are JARVIS."}
    assert body["tools"][0]["function"]["name"] == "create_task"


def test_a_malformed_chunk_does_not_lose_the_turn(wire: Recorder) -> None:
    wire.replies.append(
        b'data: {"choices":[{"delta":{"content":"good "}}]}\n\n'
        b"data: {not json at all\n\n"
        b": a comment line\n\n"
        b'data: {"choices":[{"delta":{"content":"still here"},"finish_reason":"stop"}]}\n\n'
        b"data: [DONE]\n\n"
    )
    events = ask(keyed())
    assert "".join(e.text for e in events if isinstance(e, TextEvent)) == "good still here"
    assert any(isinstance(e, CompletionEvent) for e in events)


# --- tool calls, fragment by fragment ----------------------------------------


def test_a_tool_call_is_reassembled_from_its_fragments(wire: Recorder) -> None:
    """The arguments arrive as a string split wherever the server felt like it."""
    wire.replies.append(
        sse(
            tool_delta(0, id="call_abc", name="create_task", arguments=""),
            tool_delta(0, arguments='{"ti'),
            tool_delta(0, arguments='tle": "finish the '),
            tool_delta(0, arguments='chemistry paper"}'),
            *done("tool_calls"),
        )
    )
    events = ask(keyed(), tools=TOOLS)
    completion = next(e for e in events if isinstance(e, CompletionEvent))

    assert completion.stop_reason == "tool_use", "the chat loop keys off this to run tools"
    assert len(completion.tool_calls) == 1
    call = completion.tool_calls[0]
    assert call.id == "call_abc", "the API's own id, so the result can be matched to it"
    assert call.name == "create_task"
    assert call.input == {"title": "finish the chemistry paper"}


def test_arguments_split_inside_an_escape_sequence_survive(wire: Recorder) -> None:
    """Parsing a fragment as it arrives would fail on perfectly valid JSON."""
    wire.replies.append(
        sse(
            tool_delta(0, id="c1", name="create_task"),
            tool_delta(0, arguments='{"title": "say \\'),
            tool_delta(0, arguments='"hello\\" once"}'),
            *done("tool_calls"),
        )
    )
    completion = next(e for e in ask(keyed(), tools=TOOLS) if isinstance(e, CompletionEvent))
    assert completion.tool_calls[0].input == {"title": 'say "hello" once'}


def test_two_tool_calls_interleaved_stay_separate(wire: Recorder) -> None:
    """`index` is the only thing keeping them apart."""
    wire.replies.append(
        sse(
            tool_delta(0, id="a", name="create_task", arguments='{"title":'),
            tool_delta(1, id="b", name="create_task", arguments='{"title":'),
            tool_delta(0, arguments=' "first"}'),
            tool_delta(1, arguments=' "second"}'),
            *done("tool_calls"),
        )
    )
    completion = next(e for e in ask(keyed(), tools=TOOLS) if isinstance(e, CompletionEvent))
    assert [c.input["title"] for c in completion.tool_calls] == ["first", "second"]
    assert [c.id for c in completion.tool_calls] == ["a", "b"]


def test_a_call_with_no_arguments_is_an_empty_object(wire: Recorder) -> None:
    wire.replies.append(sse(tool_delta(0, id="c", name="list_tasks"), *done("tool_calls")))
    completion = next(e for e in ask(keyed(), tools=TOOLS) if isinstance(e, CompletionEvent))
    assert completion.tool_calls[0].input == {}


def test_truncated_arguments_do_not_kill_the_turn(wire: Recorder) -> None:
    """A cut-off stream leaves half a JSON string. The tool should get an empty
    object and report what is missing, rather than the whole turn dying."""
    wire.replies.append(
        sse(
            tool_delta(0, id="c", name="create_task", arguments='{"title": "unfin'),
            *done("tool_calls"),
        )
    )
    completion = next(e for e in ask(keyed(), tools=TOOLS) if isinstance(e, CompletionEvent))
    assert completion.tool_calls[0].input == {}
    assert completion.tool_calls[0].name == "create_task"


def test_a_call_without_an_id_still_gets_one(wire: Recorder) -> None:
    """The rest of the codebase matches a result to the call that asked for it."""
    wire.replies.append(sse(tool_delta(0, name="create_task", arguments="{}"), *done("tool_calls")))
    completion = next(e for e in ask(keyed(), tools=TOOLS) if isinstance(e, CompletionEvent))
    assert completion.tool_calls[0].id, "a call with no id cannot be answered"


# --- translation -------------------------------------------------------------


def test_a_tool_result_becomes_its_own_message_carrying_the_call_id() -> None:
    """OpenAI wants `role: tool` with `tool_call_id`, not a block inside a user
    message. A turn that is only results must not also emit a blank user turn,
    or the model sees an empty question and answers it."""
    encoded = openai._encode(
        ProviderMessage(
            role="user", content=[ToolResultContent(tool_use_id="call_abc", content="done")]
        )
    )
    assert encoded == [{"role": "tool", "tool_call_id": "call_abc", "content": "done"}]
    assert not any(m["role"] == "user" for m in encoded)


def test_a_failed_tool_says_so_in_its_result() -> None:
    encoded = openai._encode(
        ProviderMessage(
            role="user",
            content=[ToolResultContent(tool_use_id="c", content="no such task", is_error=True)],
        )
    )
    assert "Error" in encoded[0]["content"]


def test_an_assistant_turn_that_only_calls_tools_sends_null_content() -> None:
    """Which is what the API expects there, rather than an empty string."""
    encoded = openai._encode(
        ProviderMessage(
            role="assistant",
            content=[ToolUseContent(id="c1", name="create_task", input={"title": "x"})],
        )
    )
    assert len(encoded) == 1
    assert encoded[0]["content"] is None
    assert encoded[0]["tool_calls"][0]["function"]["name"] == "create_task"
    assert json.loads(encoded[0]["tool_calls"][0]["function"]["arguments"]) == {"title": "x"}


def test_an_assistant_turn_with_text_and_calls_carries_both() -> None:
    encoded = openai._encode(
        ProviderMessage(
            role="assistant",
            content=[
                TextContent(text="Adding that."),
                ToolUseContent(id="c1", name="create_task", input={}),
            ],
        )
    )
    assert encoded[0]["content"] == "Adding that."
    assert encoded[0]["tool_calls"]


def test_the_whole_loop_round_trips(wire: Recorder) -> None:
    """Call, local result, answer - the sequence `services/chat.py` produces."""
    wire.replies.append(
        sse(
            tool_delta(0, id="call_1", name="create_task", arguments='{"title": "paper"}'),
            *done("tool_calls"),
        )
    )
    wire.replies.append(sse(text_delta("Added it."), *done()))

    provider = keyed()
    first = next(e for e in ask(provider, tools=TOOLS) if isinstance(e, CompletionEvent))
    call = first.tool_calls[0]

    events = ask(
        provider,
        tools=TOOLS,
        messages=[
            ProviderMessage.text("user", "paper due friday"),
            ProviderMessage(role="assistant", content=[call]),
            ProviderMessage(
                role="user", content=[ToolResultContent(tool_use_id=call.id, content='{"ok":1}')]
            ),
        ],
    )
    assert "".join(e.text for e in events if isinstance(e, TextEvent)) == "Added it."

    second = wire.sent[1]["body"]["messages"]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "tool"]
    assert second[3]["tool_call_id"] == "call_1", "the result must name the call it answers"


# --- the two names for one parameter -----------------------------------------


def test_it_asks_with_the_modern_token_limit_first(wire: Recorder) -> None:
    ask(keyed(), max_tokens=555)
    assert wire.one()["body"]["max_completion_tokens"] == 555
    assert "max_tokens" not in wire.one()["body"]


def test_a_model_that_wants_the_old_name_gets_it(wire: Recorder) -> None:
    """Keeping a list of which models take which name would be wrong the moment
    a model ships. It asks, and adapts once."""
    wire.fail_with.append(
        http_error(
            400,
            {
                "error": {
                    "message": "Unsupported parameter: 'max_completion_tokens' is not "
                    "supported with this model. Use 'max_tokens' instead."
                }
            },
        )
    )
    wire.replies.append(sse(text_delta("fine"), *done()))
    events = ask(keyed(), max_tokens=99)

    assert len(wire.sent) == 2, "one rejected attempt, then one that works"
    assert "max_completion_tokens" in wire.sent[0]["body"]
    assert wire.sent[1]["body"]["max_tokens"] == 99
    assert "".join(e.text for e in events if isinstance(e, TextEvent)) == "fine"


def test_an_unrelated_400_is_not_retried(wire: Recorder) -> None:
    """Only the parameter-name complaint earns a second attempt; retrying
    everything would double every bad request."""
    wire.fail_with.append(http_error(400, {"error": {"message": "messages: too long"}}))
    events = ask(keyed())
    assert len(wire.sent) == 1
    assert "too long" in next(e for e in events if isinstance(e, ErrorEvent)).message


# --- failures worth reading --------------------------------------------------


def test_no_key_says_what_to_do_and_costs_nothing(wire: Recorder) -> None:
    events = ask(openai.OpenAIProvider(None))
    message = next(e for e in events if isinstance(e, ErrorEvent)).message
    assert "JARVIS_OPENAI_API_KEY" in message
    assert "Settings" in message, "the way out should be part of the error"
    assert len(wire.sent) == 0, "a missing key must not become a request"
    assert openai.OpenAIProvider(None).is_configured() is False


def test_an_exhausted_account_is_not_described_as_rate_limiting(wire: Recorder) -> None:
    """Both arrive as 429 and the fixes are opposite: one is solved by waiting,
    the other never is. This is the error the key in hand actually returns."""
    wire.fail_with.append(
        http_error(
            429,
            {
                "error": {
                    "message": "You have no credits remaining. Add credits to continue "
                    "using the API.",
                    "code": "credit_balance_exhausted",
                }
            },
        )
    )
    message = next(e for e in ask(keyed()) if isinstance(e, ErrorEvent)).message
    assert "no credits" in message
    assert "Switch provider" in message, "there is a way to keep working"
    assert "Wait a moment" not in message, "waiting will never help here"


def test_a_rejected_key_names_the_setting(wire: Recorder) -> None:
    wire.fail_with.append(http_error(401, {"error": {"message": "Incorrect API key"}}))
    message = next(e for e in ask(keyed()) if isinstance(e, ErrorEvent)).message
    assert "JARVIS_OPENAI_API_KEY" in message


def test_an_unknown_model_names_the_one_that_was_asked_for(wire: Recorder) -> None:
    wire.fail_with.append(http_error(404, {"error": {"message": "model not found"}}))
    message = next(
        e for e in ask(keyed(), model="gpt-does-not-exist") if isinstance(e, ErrorEvent)
    ).message
    assert "gpt-does-not-exist" in message


def test_an_error_in_the_stream_stops_the_turn(wire: Recorder) -> None:
    wire.replies.append(sse({"error": {"message": "overloaded"}}))
    events = ask(keyed())
    assert isinstance(events[-1], ErrorEvent)
    assert "overloaded" in events[-1].message
    assert not any(isinstance(e, CompletionEvent) for e in events)


# --- it is a ChatProvider like the others ------------------------------------


def test_it_satisfies_the_same_interface() -> None:
    from jarvis.ai.base import ChatProvider

    assert isinstance(openai.OpenAIProvider("k"), ChatProvider)


def test_the_model_name_follows_the_provider() -> None:
    """A request built with one provider's model name and sent to another fails
    with a confusing 404 about a model nobody chose."""
    settings = AISettings(
        provider="openai", model="claude-opus-5", openai_model="gpt-5.5", local_model="llama3.1:8b"
    )
    assert settings.active_model == "gpt-5.5"
    assert (
        AISettings(**{**settings.model_dump(), "provider": "anthropic"}).active_model
        == "claude-opus-5"
    )
    assert (
        AISettings(**{**settings.model_dump(), "provider": "ollama"}).active_model == "llama3.1:8b"
    )


def test_switching_provider_keeps_every_model_name() -> None:
    settings = AISettings(provider="anthropic", openai_model="gpt-4.1", local_model="qwen2.5:7b")
    swapped = AISettings.model_validate({**settings.model_dump(), "provider": "openai"})
    assert (swapped.model, swapped.openai_model, swapped.local_model) == (
        settings.model,
        "gpt-4.1",
        "qwen2.5:7b",
    )


def test_the_key_is_never_written_into_the_module() -> None:
    """It comes from the environment on every request, like every other key."""
    import inspect

    source = inspect.getsource(openai)
    assert "sk-proj-" not in source
    assert "sk-" not in source.replace("sk-test-key", "").replace("JARVIS_OPENAI_API_KEY", "")
