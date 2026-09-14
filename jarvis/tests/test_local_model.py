"""The local model provider: the thing that makes JARVIS independent.

These run with no Ollama installed and no network. `urlopen` is replaced by a
recorder that answers in Ollama's real wire format - newline-delimited JSON,
tool calls with no id, arguments that are sometimes a JSON string - so a change
to the translation fails an assertion here rather than on a machine that has
Ollama and a model pulled.

The translation is what is being protected. Ollama and Anthropic disagree about
where tool results live and whether a tool call has an identity, and that
disagreement is exactly what the provider seam exists to absorb.
"""

from __future__ import annotations

import io
import json
from email.message import Message as EmailMessage
from typing import Any

import pytest
from jarvis.ai import ollama_provider as ollama
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

MODEL = "llama3.1:8b"

TOOLS = [
    ToolSpec(
        name="create_task",
        description="Add one task.",
        input_schema={"type": "object", "properties": {"title": {"type": "string"}}},
    )
]


def ndjson(*objects: dict[str, Any]) -> bytes:
    return b"".join((json.dumps(o) + "\n").encode() for o in objects)


def says(*words: str) -> bytes:
    """A streamed answer, then the terminating chunk with its counts."""
    chunks = [
        {"model": MODEL, "message": {"role": "assistant", "content": w}, "done": False}
        for w in words
    ]
    chunks.append(
        {
            "model": MODEL,
            "message": {"role": "assistant", "content": ""},
            "done": True,
            "done_reason": "stop",
            "prompt_eval_count": 214,
            "eval_count": 37,
        }
    )
    return ndjson(*chunks)


def asks_for(name: str, arguments: Any) -> bytes:
    """A tool call as Ollama sends it: no id anywhere."""
    return ndjson(
        {
            "model": MODEL,
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{"function": {"name": name, "arguments": arguments}}],
            },
            "done": False,
        },
        {"model": MODEL, "message": {"role": "assistant", "content": ""}, "done": True},
    )


class Recorder:
    """Stands in for the network: remembers each request, answers from a queue."""

    def __init__(self, *replies: bytes) -> None:
        self.sent: list[dict[str, Any]] = []
        self.replies = list(replies)

    def one(self) -> dict[str, Any]:
        assert len(self.sent) == 1, f"expected one request, got {len(self.sent)}"
        return self.sent[0]

    def __call__(self, request: Any, timeout: float = 0) -> Any:
        body = getattr(request, "data", None)
        self.sent.append(
            {
                "url": request.full_url,
                "body": json.loads(body) if body else None,
            }
        )
        reply = self.replies.pop(0) if self.replies else says("ok")
        return _Response(reply)


class _Response(io.BytesIO):
    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


@pytest.fixture
def wire(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    recorder = Recorder()
    monkeypatch.setattr("urllib.request.urlopen", recorder)
    return recorder


def ask(provider: ollama.OllamaProvider, **kwargs: Any) -> list[Any]:
    request = ChatRequest(
        system=kwargs.pop("system", "You are JARVIS."),
        messages=kwargs.pop("messages", [ProviderMessage.text("user", "hello")]),
        model=kwargs.pop("model", MODEL),
        **kwargs,
    )
    return list(provider.stream(request))


# --- it speaks the wire format ----------------------------------------------


def test_an_answer_streams_and_reports_its_counts(wire: Recorder) -> None:
    wire.replies.append(says("Running ", "entirely ", "on ", "your ", "machine."))
    events = ask(ollama.OllamaProvider())

    text = "".join(e.text for e in events if isinstance(e, TextEvent))
    assert text == "Running entirely on your machine."

    done = [e for e in events if isinstance(e, CompletionEvent)]
    assert len(done) == 1, "exactly one completion, as the protocol promises"
    assert done[0].stop_reason == "stop"
    assert (done[0].input_tokens, done[0].output_tokens) == (214, 37)


def test_the_request_is_the_shape_ollama_expects(wire: Recorder) -> None:
    wire.replies.append(says("ok"))
    ask(ollama.OllamaProvider(), tools=TOOLS, max_tokens=1234)

    body = wire.one()["body"]
    assert body["stream"] is True
    assert body["options"]["num_predict"] == 1234
    assert body["messages"][0] == {"role": "system", "content": "You are JARVIS."}
    assert body["tools"][0]["type"] == "function"
    assert body["tools"][0]["function"]["name"] == "create_task"


def test_a_malformed_chunk_does_not_lose_the_turn(wire: Recorder) -> None:
    """A truncated line mid-stream is not worth failing a whole answer over."""
    wire.replies.append(
        b'{"message":{"content":"good "},"done":false}\n'
        b"{not json at all\n"
        b'{"message":{"content":"still here"},"done":true,"done_reason":"stop"}\n'
    )
    events = ask(ollama.OllamaProvider())
    text = "".join(e.text for e in events if isinstance(e, TextEvent))
    assert text == "good still here"
    assert any(isinstance(e, CompletionEvent) for e in events)


# --- the translation, which is the whole point of the seam ------------------


def test_a_tool_call_gets_an_id_because_ollama_sends_none(wire: Recorder) -> None:
    """Anthropic's calls carry ids and the chat loop matches results to them.
    Ollama's do not, so one is minted here and the difference stops at this file."""
    wire.replies.append(asks_for("create_task", {"title": "finish the paper"}))
    events = ask(ollama.OllamaProvider(), tools=TOOLS)

    done = next(e for e in events if isinstance(e, CompletionEvent))
    assert done.stop_reason == "tool_use", "the chat loop keys off this to run tools"
    assert len(done.tool_calls) == 1
    call = done.tool_calls[0]
    assert call.id, "a call with no id cannot be matched to its result"
    assert call.name == "create_task"
    assert call.input == {"title": "finish the paper"}


def test_arguments_sent_as_a_json_string_are_parsed(wire: Recorder) -> None:
    """Real models do this. Left as a string, every tool would see no arguments."""
    wire.replies.append(asks_for("create_task", json.dumps({"title": "revise"})))
    events = ask(ollama.OllamaProvider(), tools=TOOLS)
    done = next(e for e in events if isinstance(e, CompletionEvent))
    assert done.tool_calls[0].input == {"title": "revise"}


def test_unparseable_arguments_become_empty_rather_than_crashing(wire: Recorder) -> None:
    wire.replies.append(asks_for("create_task", "{not json"))
    events = ask(ollama.OllamaProvider(), tools=TOOLS)
    done = next(e for e in events if isinstance(e, CompletionEvent))
    assert done.tool_calls[0].input == {}


def test_a_tool_result_becomes_its_own_message_not_a_user_turn() -> None:
    """Anthropic carries results inside a user message; Ollama wants `role: tool`.

    The blank-user-turn case is the one that matters: a turn that is nothing but
    tool results must not also emit an empty user message, or the model sees a
    blank question and answers it.
    """
    encoded = ollama._encode(
        ProviderMessage(role="user", content=[ToolResultContent(tool_use_id="x", content="done")])
    )
    assert encoded == [{"role": "tool", "content": "done"}]
    assert not any(m["role"] == "user" for m in encoded)


def test_a_failed_tool_says_so_in_the_result() -> None:
    encoded = ollama._encode(
        ProviderMessage(
            role="user",
            content=[ToolResultContent(tool_use_id="x", content="no such task", is_error=True)],
        )
    )
    assert "Error" in encoded[0]["content"]


def test_an_assistant_turn_carries_its_text_and_its_calls() -> None:
    encoded = ollama._encode(
        ProviderMessage(
            role="assistant",
            content=[
                TextContent(text="Adding that."),
                ToolUseContent(id="local_0", name="create_task", input={"title": "x"}),
            ],
        )
    )
    assert len(encoded) == 1
    assert encoded[0]["content"] == "Adding that."
    assert encoded[0]["tool_calls"][0]["function"]["name"] == "create_task"


def test_the_whole_loop_round_trips(wire: Recorder) -> None:
    """Call, local result, answer - the sequence `services/chat.py` produces."""
    wire.replies.append(asks_for("create_task", {"title": "paper"}))
    wire.replies.append(says("Added ", "it."))

    provider = ollama.OllamaProvider()
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

    roles = [m["role"] for m in wire.sent[1]["body"]["messages"]]
    assert roles == ["system", "user", "assistant", "tool"]


# --- when it is not there ----------------------------------------------------


def test_a_missing_model_names_the_one_that_was_asked_for(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Naming the provider's default instead would send you to pull the wrong thing."""
    import urllib.error

    def refuse(request: Any, timeout: float = 0) -> Any:
        raise urllib.error.HTTPError(
            request.full_url,
            404,
            "Not Found",
            EmailMessage(),
            io.BytesIO(b'{"error":"model not found"}'),
        )

    monkeypatch.setattr("urllib.request.urlopen", refuse)
    events = ask(ollama.OllamaProvider(model="llama3.1:8b"), model="qwen2.5:7b")
    message = next(e for e in events if isinstance(e, ErrorEvent)).message
    assert "qwen2.5:7b" in message
    assert "llama3.1:8b" not in message
    assert "ollama pull" in message


def test_ollama_not_running_says_how_to_start_it(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    def down(request: Any, timeout: float = 0) -> Any:
        raise urllib.error.URLError("Connection refused")

    monkeypatch.setattr("urllib.request.urlopen", down)
    provider = ollama.OllamaProvider()

    assert provider.is_configured() is False, "not reachable is not configured"
    assert ollama.installed_models() == [], "absence is the normal state, not an error"

    message = next(e for e in ask(provider) if isinstance(e, ErrorEvent)).message
    assert "ollama serve" in message
    assert "Settings" in message, "the way out should be part of the error"


def test_an_error_in_the_stream_stops_the_turn(wire: Recorder) -> None:
    wire.replies.append(ndjson({"error": "out of memory"}))
    events = ask(ollama.OllamaProvider())
    assert isinstance(events[-1], ErrorEvent)
    assert "out of memory" in events[-1].message
    assert not any(isinstance(e, CompletionEvent) for e in events)


# --- it is a ChatProvider, and the settings know it -------------------------


def test_it_satisfies_the_same_interface_as_the_cloud_provider() -> None:
    """The property that matters: the chat service imports neither by name."""
    from jarvis.ai.base import ChatProvider

    assert isinstance(ollama.OllamaProvider(), ChatProvider)


def test_the_model_name_follows_the_provider() -> None:
    """A request built with the cloud model's name and sent to the local one
    fails with a confusing 404 about a model nobody chose."""
    cloud = AISettings(provider="anthropic", model="claude-opus-5", local_model="llama3.1:8b")
    local = AISettings(provider="ollama", model="claude-opus-5", local_model="llama3.1:8b")
    assert cloud.active_model == "claude-opus-5"
    assert local.active_model == "llama3.1:8b"


def test_an_unknown_provider_is_refused() -> None:
    with pytest.raises(ValueError, match="provider must be one of"):
        AISettings(provider="telepathy")


def test_switching_provider_keeps_both_model_names() -> None:
    """So going local and back does not lose whichever name you had set."""
    settings = AISettings(provider="anthropic", model="claude-opus-5", local_model="qwen2.5:7b")
    swapped = AISettings.model_validate({**settings.model_dump(), "provider": "ollama"})
    assert swapped.model == "claude-opus-5"
    assert swapped.local_model == "qwen2.5:7b"


def test_the_local_provider_needs_no_key() -> None:
    """The whole point: there is nothing to be missing except Ollama itself."""
    import inspect

    source = inspect.getsource(ollama)
    for word in ("api_key", "API_KEY", "Authorization", "Bearer"):
        assert word not in source, f"{word} has no business in a local provider"
