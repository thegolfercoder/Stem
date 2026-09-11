"""Assembling the context for one request.

This module is the border. Everything JARVIS knows is local; what crosses to the
cloud is whatever this file puts in the request and nothing else. That is why the
budgets here are explicit constants rather than "enough", and why retrieval goes
through a registry of sources instead of letting each feature reach for the
database on its way out.

Phase 1 registers no sources, so the retrieved section is empty and only the
conversation itself is sent. Phase 2 registers the memory store and the document
index against the same interface; nothing below has to change to accommodate
them.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Protocol, runtime_checkable

from jarvis.ai.base import ChatRequest, ProviderMessage, ToolSpec

# Ceilings on what one request may carry. A retrieval bug should cost a clipped
# answer, never a database upload.
MAX_SNIPPETS = 12
MAX_SNIPPET_CHARS = 2_000
MAX_CONTEXT_CHARS = 12_000
# Roughly 30k tokens of history at four characters per token. Phase 1 measures in
# characters on purpose: it needs no tokeniser and no network call, and the real
# ceiling is the model's, which is far above this.
MAX_HISTORY_CHARS = 120_000

DEFAULT_SYSTEM_PROMPT = """You are JARVIS, a personal assistant running on {user}'s own computer.

Answer from the context below when it is relevant, say so plainly when it does not
cover the question, and never invent tasks, deadlines or events. The current date
and time is {now}."""


@dataclass(frozen=True)
class ContextSnippet:
    """One piece of local knowledge, on its way into a request."""

    source: str
    title: str
    body: str
    score: float = 0.0

    def rendered(self) -> str:
        body = self.body.strip()
        if len(body) > MAX_SNIPPET_CHARS:
            body = body[:MAX_SNIPPET_CHARS].rstrip() + " ..."
        return f"[{self.source}] {self.title}\n{body}"


@runtime_checkable
class ContextSource(Protocol):
    """Somewhere relevant local information can be looked up.

    Phase 2 implements this over the memory table and a vector index of
    `data/documents`; phase 3 over tasks, the calendar and school records.
    """

    name: str

    def retrieve(self, query: str, limit: int) -> Sequence[ContextSnippet]:
        """Return at most `limit` snippets relevant to `query`, best first."""
        ...


@dataclass
class BuiltContext:
    """The request, plus what went into it.

    `snippets` is returned so the interface can show which local records were
    consulted. An assistant that cites nothing is impossible to check.
    """

    request: ChatRequest
    snippets: list[ContextSnippet] = field(default_factory=list)
    history_messages: int = 0


class ContextBuilder:
    """Turns local state into one `ChatRequest`."""

    def __init__(
        self,
        *,
        sources: Sequence[ContextSource] | None = None,
        prompt_path: Path | None = None,
        now: datetime | None = None,
    ) -> None:
        self._sources = list(sources or [])
        self._prompt_path = prompt_path
        self._now = now

    def add_source(self, source: ContextSource) -> None:
        """Register a retrieval source. The seam phases 2 and 3 attach to."""
        self._sources.append(source)

    @property
    def sources(self) -> list[ContextSource]:
        return list(self._sources)

    def system_prompt(self, *, user_display_name: str) -> str:
        template = DEFAULT_SYSTEM_PROMPT
        if self._prompt_path is not None and self._prompt_path.is_file():
            # Editable without touching the source, so the assistant's manner is
            # configuration rather than a code change.
            template = self._prompt_path.read_text(encoding="utf-8")
        now = (self._now or datetime.now()).strftime("%A %d %B %Y, %H:%M")
        return template.format(user=user_display_name or "the user", now=now)

    def retrieve(self, query: str) -> list[ContextSnippet]:
        """Ask every source, keep the best few overall."""
        if not query.strip():
            return []
        gathered: list[ContextSnippet] = []
        for source in self._sources:
            try:
                gathered.extend(source.retrieve(query, MAX_SNIPPETS))
            # One broken source must not take the whole answer down with it.
            except Exception:
                continue
        gathered.sort(key=lambda s: s.score, reverse=True)

        kept: list[ContextSnippet] = []
        used = 0
        for snippet in gathered[:MAX_SNIPPETS]:
            rendered = snippet.rendered()
            if used + len(rendered) > MAX_CONTEXT_CHARS:
                break
            kept.append(snippet)
            used += len(rendered)
        return kept

    def build(
        self,
        *,
        user_display_name: str,
        history: Sequence[ProviderMessage],
        model: str,
        max_tokens: int = 8192,
        tools: Sequence[ToolSpec] = (),
        show_thinking: bool = False,
        query: str = "",
    ) -> BuiltContext:
        """Assemble the request. `history` ends with the message being answered."""
        snippets = self.retrieve(query)
        system = self.system_prompt(user_display_name=user_display_name)
        if snippets:
            body = "\n\n".join(s.rendered() for s in snippets)
            system = (
                f"{system}\n\n"
                "<context>\n"
                "Local records retrieved for this message. They are the only part of "
                f"{user_display_name or 'the user'}'s data you have been given.\n\n"
                f"{body}\n"
                "</context>"
            )

        trimmed = _trim_history(history, MAX_HISTORY_CHARS)
        request = ChatRequest(
            system=system,
            messages=list(trimmed),
            model=model,
            max_tokens=max_tokens,
            tools=list(tools),
            show_thinking=show_thinking,
        )
        return BuiltContext(request=request, snippets=snippets, history_messages=len(trimmed))


def _trim_history(history: Sequence[ProviderMessage], budget: int) -> list[ProviderMessage]:
    """Keep the most recent turns that fit.

    Trimmed from the front, and never so far that the first kept message is an
    assistant turn answering a question the model can no longer see.
    """
    kept: list[ProviderMessage] = []
    used = 0
    for message in reversed(history):
        size = sum(len(getattr(block, "text", "")) for block in message.content) or 1
        if kept and used + size > budget:
            break
        kept.append(message)
        used += size
    kept.reverse()
    while len(kept) > 1 and kept[0].role == "assistant":
        kept.pop(0)
    return kept
