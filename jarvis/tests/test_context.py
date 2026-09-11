"""The context builder: the border between local data and the cloud."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from jarvis.ai.base import ProviderMessage
from jarvis.context import (
    MAX_CONTEXT_CHARS,
    MAX_SNIPPET_CHARS,
    BuiltContext,
    ContextBuilder,
    ContextSnippet,
)


class Source:
    def __init__(self, name: str, snippets: Sequence[ContextSnippet]) -> None:
        self.name = name
        self._snippets = list(snippets)
        self.queries: list[str] = []

    def retrieve(self, query: str, limit: int) -> Sequence[ContextSnippet]:
        self.queries.append(query)
        return self._snippets[:limit]


class BrokenSource:
    name = "broken"

    def retrieve(self, query: str, limit: int) -> Sequence[ContextSnippet]:
        raise RuntimeError("the index is corrupt")


def build(builder: ContextBuilder, query: str = "exam") -> BuiltContext:
    return builder.build(
        user_display_name="Sam",
        history=[ProviderMessage.text("user", query)],
        model="test-model",
        query=query,
    )


def test_with_no_sources_nothing_but_the_conversation_is_sent() -> None:
    """Phase 1's actual behaviour, pinned so a later phase cannot widen it by
    accident."""
    built = build(ContextBuilder())
    assert "<context>" not in built.request.system
    assert built.snippets == []
    assert len(built.request.messages) == 1


def test_a_registered_source_is_retrieved_and_rendered() -> None:
    source = Source("memory", [ContextSnippet("memory", "Chemistry exam", "3 October", 0.9)])
    builder = ContextBuilder()
    builder.add_source(source)

    built = build(builder)
    assert source.queries == ["exam"]
    assert "<context>" in built.request.system
    assert "3 October" in built.request.system
    assert [s.title for s in built.snippets] == ["Chemistry exam"]


def test_snippets_come_back_best_first_and_are_capped() -> None:
    many = [ContextSnippet("memory", f"n{i}", "body", score=i / 100) for i in range(50)]
    builder = ContextBuilder(sources=[Source("memory", many)])
    built = build(builder)
    assert len(built.snippets) <= 12
    scores = [s.score for s in built.snippets]
    assert scores == sorted(scores, reverse=True)


def test_one_oversized_snippet_cannot_smuggle_the_database_out() -> None:
    huge = ContextSnippet("files", "war and peace", "x" * 500_000, 1.0)
    builder = ContextBuilder(sources=[Source("files", [huge])])
    built = build(builder)
    assert len(built.request.system) < MAX_CONTEXT_CHARS + MAX_SNIPPET_CHARS + 2_000


def test_a_broken_source_does_not_break_the_answer() -> None:
    working = Source("memory", [ContextSnippet("memory", "Still here", "body", 0.5)])
    builder = ContextBuilder(sources=[BrokenSource(), working])
    built = build(builder)
    assert [s.title for s in built.snippets] == ["Still here"]


def test_an_empty_query_retrieves_nothing() -> None:
    source = Source("memory", [ContextSnippet("memory", "t", "b", 1.0)])
    builder = ContextBuilder(sources=[source])
    assert builder.retrieve("   ") == []
    assert source.queries == []


def test_the_system_prompt_carries_the_name_and_the_date() -> None:
    builder = ContextBuilder(now=datetime(2026, 10, 3, 9, 30))
    prompt = builder.system_prompt(user_display_name="Sam")
    assert "Sam" in prompt
    assert "03 October 2026" in prompt


def test_history_is_trimmed_from_the_front_to_fit() -> None:
    history = [
        ProviderMessage.text("user" if i % 2 == 0 else "assistant", "x" * 20_000) for i in range(20)
    ]
    built = ContextBuilder().build(
        user_display_name="Sam", history=history, model="test-model", query="hello"
    )
    assert 0 < len(built.request.messages) < len(history)
    # Never left starting on an answer to a question the model can no longer see.
    assert built.request.messages[0].role == "user"
