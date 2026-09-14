"""The context manager: the border between local data and the cloud.

These are the tests that hold the privacy claim up. If the budgets stop being
enforced or a source starts being consulted without a user id, this is where it
should be noticed.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from jarvis.ai.base import ProviderMessage
from jarvis.context_manager import (
    MAX_CONTEXT_CHARS,
    MAX_SNIPPET_CHARS,
    BuiltContext,
    ContextManager,
    ContextSnippet,
    RetrievalRequest,
    clear_traces,
    recent_traces,
)
from jarvis.intent import Intent, IntentKind


class Source:
    def __init__(self, name: str, snippets: Sequence[ContextSnippet]) -> None:
        self.name = name
        self._snippets = list(snippets)
        self.requests: list[RetrievalRequest] = []

    def retrieve(self, request: RetrievalRequest) -> Sequence[ContextSnippet]:
        self.requests.append(request)
        return self._snippets[: request.limit]


class BrokenSource:
    name = "broken"

    def retrieve(self, request: RetrievalRequest) -> Sequence[ContextSnippet]:
        raise RuntimeError("the index is corrupt")


def build(
    manager: ContextManager,
    query: str = "exam",
    *,
    session: object | None = object(),
    user_id: int | None = 1,
    intent: Intent | None = None,
) -> BuiltContext:
    return manager.build(
        user_display_name="Sam",
        history=[ProviderMessage.text("user", query)],
        model="test-model",
        session=session,  # type: ignore[arg-type]
        user_id=user_id,
        intent=intent,
        query=query,
    )


def test_with_no_sources_nothing_but_the_conversation_is_sent() -> None:
    built = build(ContextManager())
    assert "<context>" not in built.request.system
    assert built.snippets == []
    assert len(built.request.messages) == 1


def test_a_registered_source_is_retrieved_and_rendered() -> None:
    source = Source("memory", [ContextSnippet("memory", "Chemistry exam", "3 October", 0.9)])
    manager = ContextManager()
    manager.add_source(source)

    built = build(manager)
    assert source.requests[0].query == "exam"
    assert "<context>" in built.request.system
    assert "3 October" in built.request.system
    assert [s.title for s in built.snippets] == ["Chemistry exam"]


def test_sources_are_told_whose_data_to_search() -> None:
    """The user id reaches the source, and comes from the caller rather than
    from anything the model said."""
    source = Source("memory", [])
    manager = ContextManager(sources=[source])
    build(manager, user_id=42)
    assert source.requests[0].user_id == 42


def test_without_a_user_id_no_personal_data_is_retrieved() -> None:
    """The safe direction for that mistake to fail in."""
    source = Source("memory", [ContextSnippet("memory", "Private", "secret", 1.0)])
    manager = ContextManager(sources=[source])

    built = build(manager, user_id=None)
    assert source.requests == []
    assert built.snippets == []
    assert "secret" not in built.request.system


def test_snippets_come_back_best_first_and_are_capped() -> None:
    many = [ContextSnippet("memory", f"n{i}", "body", score=i / 100) for i in range(50)]
    manager = ContextManager(sources=[Source("memory", many)])
    built = build(manager)
    assert len(built.snippets) <= 12
    scores = [s.score for s in built.snippets]
    assert scores == sorted(scores, reverse=True)


def test_one_source_cannot_take_every_slot() -> None:
    """Without the per-source cap, a thousand documents crowd out ten memories."""
    loud = [ContextSnippet("document", f"d{i}", "body", score=0.9) for i in range(40)]
    quiet = [ContextSnippet("memory", "the one that matters", "body", score=0.5)]
    manager = ContextManager(sources=[Source("documents", loud), Source("memory", quiet)])

    built = build(manager)
    assert "the one that matters" in [s.title for s in built.snippets]


def test_one_oversized_snippet_cannot_smuggle_the_database_out() -> None:
    huge = ContextSnippet("files", "war and peace", "x" * 500_000, 1.0)
    manager = ContextManager(sources=[Source("files", [huge])])
    built = build(manager)
    assert len(built.request.system) < MAX_CONTEXT_CHARS + MAX_SNIPPET_CHARS + 2_000


def test_a_broken_source_does_not_break_the_answer() -> None:
    working = Source("memory", [ContextSnippet("memory", "Still here", "body", 0.5)])
    manager = ContextManager(sources=[BrokenSource(), working])
    built = build(manager)
    assert [s.title for s in built.snippets] == ["Still here"]


def test_an_empty_query_retrieves_nothing() -> None:
    source = Source("memory", [ContextSnippet("memory", "t", "b", 1.0)])
    manager = ContextManager(sources=[source])
    assert build(manager, query="   ").snippets == []
    assert source.requests == []


def test_the_system_prompt_carries_the_name_and_the_date() -> None:
    manager = ContextManager(now=datetime(2026, 10, 3, 9, 30))
    prompt = manager.system_prompt(user_display_name="Sam")
    assert "Sam" in prompt
    assert "03 October 2026" in prompt


def test_a_memory_intent_adds_an_instruction_about_the_tools() -> None:
    manager = ContextManager()
    built = build(
        manager,
        query="Remember that I prefer short answers",
        intent=Intent(kind=IntentKind.REMEMBER, subject="I prefer short answers"),
    )
    assert "save_memory" in built.request.system


def test_an_ordinary_question_gets_no_extra_instruction() -> None:
    manager = ContextManager()
    built = build(manager, query="what is the capital of France")
    assert "save_memory" not in built.request.system


def test_history_is_trimmed_from_the_front_to_fit() -> None:
    history = [
        ProviderMessage.text("user" if i % 2 == 0 else "assistant", "x" * 20_000) for i in range(20)
    ]
    built = ContextManager().build(
        user_display_name="Sam", history=history, model="test-model", query="hello"
    )
    assert 0 < len(built.request.messages) < len(history)
    # Never left starting on an answer to a question the model can no longer see.
    assert built.request.messages[0].role == "user"


def test_every_build_leaves_a_trace_of_what_was_sent() -> None:
    """The inspector's data. Without this, "only the minimum is sent" is a claim
    with nothing behind it."""
    clear_traces()
    manager = ContextManager(
        sources=[Source("memory", [ContextSnippet("memory", "Chemistry exam", "3 October", 0.9)])]
    )
    built = build(manager, query="when is my exam")

    assert built.trace is not None
    assert built.trace.query == "when is my exam"
    assert [s.title for s in built.trace.snippets] == ["Chemistry exam"]
    assert built.trace.system_chars == len(built.request.system)
    assert built.trace.total_chars > 0

    traces = recent_traces()
    assert traces[0].query == "when is my exam"
    # The full text is available to the owner, and only in memory.
    assert "3 October" in traces[0].system_text
    assert "system_text" not in traces[0].as_dict()
    assert "system_text" in traces[0].as_dict(include_system=True)


def test_traces_do_not_grow_without_bound() -> None:
    clear_traces()
    manager = ContextManager()
    for i in range(40):
        build(manager, query=f"question {i}")
    assert len(recent_traces()) <= 20
