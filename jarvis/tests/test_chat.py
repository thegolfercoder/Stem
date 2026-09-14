"""The turn: message in, context out, answer streamed back, both ends stored."""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient
from jarvis.ai.base import ToolResultContent, ToolUseContent
from jarvis.api.deps import chat_provider

from tests.conftest import CLIENT_HEADERS, FakeProvider


def send(
    client: TestClient, message: str, conversation_id: int | None = None
) -> list[dict[str, Any]]:
    """Send a message and collect the stream as parsed events."""
    body: dict[str, object] = {"message": message}
    if conversation_id is not None:
        body["conversation_id"] = conversation_id
    events: list[dict[str, Any]] = []
    with client.stream("POST", "/api/chat", json=body, headers=CLIENT_HEADERS) as response:
        assert response.status_code == 200, response.read()
        assert response.headers["content-type"].startswith("text/event-stream")
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def test_a_turn_streams_text_and_stores_both_sides(signed_in: TestClient) -> None:
    events = send(signed_in, "Hello JARVIS")
    kinds = [event["type"] for event in events]
    assert kinds[0] == "user_message"
    assert "text" in kinds
    assert kinds[-1] == "done"

    answer = "".join(e["text"] for e in events if e["type"] == "text").strip()
    assert answer == "Understood."

    conversation_id = events[-1]["conversation_id"]
    stored = signed_in.get(f"/api/conversations/{conversation_id}").json()
    assert [m["role"] for m in stored["messages"]] == ["user", "assistant"]
    assert stored["messages"][0]["content"] == "Hello JARVIS"
    assert stored["messages"][1]["content"] == "Understood."
    assert stored["messages"][1]["output_tokens"] == 7


def test_the_conversation_is_named_after_its_first_message(signed_in: TestClient) -> None:
    events = send(signed_in, "Help me plan revision for the chemistry exam")
    assert events[-1]["title"] == "Help me plan revision for the chemistry exam"


def test_history_is_carried_into_the_next_request(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    first = send(signed_in, "My exam is on the third")
    conversation_id = first[-1]["conversation_id"]
    send(signed_in, "When was that again?", conversation_id)

    last_request = provider.requests[-1]
    texts = [
        " ".join(getattr(block, "text", "") for block in message.content)
        for message in last_request.messages
    ]
    assert any("My exam is on the third" in text for text in texts)
    assert any("When was that again?" in text for text in texts)


def test_only_the_system_prompt_and_the_conversation_are_sent(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    """The privacy property, asserted rather than asserted about.

    With no retrieval sources registered, a request carries the persona, the
    date, and the conversation itself - and nothing else from the database.
    """
    send(signed_in, "Anything at all")
    request = provider.requests[-1]
    assert "JARVIS" in request.system
    assert len(request.messages) == 1
    assert request.messages[0].role == "user"


def test_an_empty_message_is_refused_before_anything_is_sent(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    response = signed_in.post("/api/chat", json={"message": "   "}, headers=CLIENT_HEADERS)
    assert response.status_code == 200
    assert '"type": "error"' in response.text
    assert provider.requests == []


def test_a_tool_call_runs_locally_and_only_its_result_goes_back(signed_in: TestClient) -> None:
    """The whole point of the tool loop, in one test."""
    send(signed_in, "Remember: the chemistry exam is on the third of October")

    tool_provider = FakeProvider(
        reply="Your chemistry exam is on the third of October.",
        tool_calls=[
            ToolUseContent(
                id="toolu_1", name="search_conversations", input={"query": "chemistry exam"}
            )
        ],
    )
    signed_in.app.dependency_overrides[chat_provider] = lambda: tool_provider  # type: ignore[attr-defined]

    events = send(signed_in, "When is my chemistry exam?")
    tool_events = [e for e in events if e["type"] == "tool"]
    assert [e["status"] for e in tool_events] == ["running", "done"]
    assert tool_events[0]["name"] == "search_conversations"

    # The second request carries the tool result, and the result contains the
    # line from the earlier conversation - retrieved locally, not remembered by
    # the model.
    second = tool_provider.requests[-1]
    blocks = [block for message in second.messages for block in message.content]
    results = [b for b in blocks if isinstance(b, ToolResultContent)]
    assert len(results) == 1
    assert "chemistry exam is on the third" in results[0].content


def test_an_unknown_tool_comes_back_as_an_error_not_a_crash(signed_in: TestClient) -> None:
    provider = FakeProvider(
        reply="Sorry about that.",
        tool_calls=[ToolUseContent(id="toolu_9", name="make_coffee", input={})],
    )
    signed_in.app.dependency_overrides[chat_provider] = lambda: provider  # type: ignore[attr-defined]
    events = send(signed_in, "Make me a coffee")
    assert any(e["type"] == "tool" and e["status"] == "error" for e in events)
    assert events[-1]["type"] == "done"


def test_a_provider_failure_is_stored_and_shown(signed_in: TestClient) -> None:
    from collections.abc import Iterator

    from jarvis.ai.base import ChatRequest, ErrorEvent, ProviderEvent

    class BrokenProvider:
        name = "broken"

        def is_configured(self) -> bool:
            return True

        def stream(self, request: ChatRequest) -> Iterator[ProviderEvent]:
            yield ErrorEvent("The API key was rejected.")

    signed_in.app.dependency_overrides[chat_provider] = lambda: BrokenProvider()  # type: ignore[attr-defined]
    events = send(signed_in, "Hello")
    assert any(e["type"] == "error" for e in events)

    conversation_id = events[-1]["conversation_id"]
    stored = signed_in.get(f"/api/conversations/{conversation_id}").json()
    # The failed turn stays in the history rather than vanishing.
    assert stored["messages"][-1]["error"] == "The API key was rejected."


def test_chat_requires_a_session(client: TestClient) -> None:
    response = client.post("/api/chat", json={"message": "hello"}, headers=CLIENT_HEADERS)
    assert response.status_code == 401


# --- phase 2: memory in the loop ---------------------------------------------


def test_a_remembered_fact_reaches_the_next_conversation(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    """The end-to-end claim of phase 2, in one test.

    A fact is saved through the tool in one conversation; a question in a
    *different* conversation gets it back through retrieval, with no help from
    the model's own memory - the fake model has none.
    """
    saving = FakeProvider(
        reply="Noted.",
        tool_calls=[
            ToolUseContent(
                id="toolu_save",
                name="save_memory",
                input={
                    "content": "Sam wants an A* in Economics",
                    "category": "goals",
                    "importance": 5,
                },
            )
        ],
    )
    signed_in.app.dependency_overrides[chat_provider] = lambda: saving  # type: ignore[attr-defined]
    events = send(signed_in, "Remember that I want an A* in economics")
    assert any(e["type"] == "tool" and e["status"] == "done" for e in events)

    stored = signed_in.get("/api/memory").json()
    assert [m["content"] for m in stored] == ["Sam wants an A* in Economics"]
    assert stored[0]["source"] == "assistant"

    # A new conversation, a fresh provider, and no history to lean on.
    signed_in.app.dependency_overrides[chat_provider] = lambda: provider  # type: ignore[attr-defined]
    signed_in.post("/api/conversations", json={"title": "Later"}, headers=CLIENT_HEADERS)
    events = send(signed_in, "What are my economics goals?")

    assert "A* in Economics" in provider.requests[-1].system
    context_events = [e for e in events if e["type"] == "context"]
    assert context_events and context_events[0]["snippets"][0]["source"] == "memory"


DIRECTIVE = "appears to be asking you to remember"


def test_a_memory_instruction_tells_the_model_about_the_tool(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    send(signed_in, "Remember that I prefer concise answers")
    system = provider.requests[-1].system
    assert DIRECTIVE in system
    assert "save_memory" in system


def test_an_ordinary_question_carries_no_memory_instruction(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    """The persona always mentions the memory tools - the model needs to know it
    has them. What an ordinary question must not carry is the directive telling
    it to go and store something."""
    send(signed_in, "What is the boiling point of water?")
    assert DIRECTIVE not in provider.requests[-1].system


def test_the_done_event_reports_what_context_was_used(signed_in: TestClient) -> None:
    signed_in.post(
        "/api/memory",
        json={"content": "Sam is studying IGCSE Economics", "category": "subjects"},
        headers=CLIENT_HEADERS,
    )
    events = send(signed_in, "help me with economics")
    done = events[-1]
    assert done["type"] == "done"
    assert done["context"]["snippets"], "the interface needs this to show the memory indicator"
    assert done["context"]["total_chars"] > 0


def test_conversation_search_finds_earlier_messages(signed_in: TestClient) -> None:
    send(signed_in, "My chemistry exam is on the third of October")
    send(signed_in, "What is the capital of France?")

    hits = signed_in.get("/api/conversations/search?q=chemistry exam").json()
    assert hits
    assert "chemistry exam" in hits[0]["text"].lower()
    assert hits[0]["role"] == "user"
    assert signed_in.get("/api/conversations/search?q=submarines").json() == []


def test_conversation_search_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/conversations/search?q=x").status_code == 401
