"""The border between local data and the cloud.

Everything JARVIS knows is local. What crosses is whatever this file puts into
one request, and nothing else. That is why the budgets below are constants
rather than "enough", why retrieval goes through a registry of sources instead
of each feature reaching for the database on its way out, and why every build
leaves a `ContextTrace` behind saying exactly what went.

This file was `context.py` in phase 1 and does the same job under the name the
architecture calls it. Phase 2 adds three things: sources are told *whose* data
to search, the retrieval budget is shared out so documents cannot crowd out
memories, and the trace exists.

Reading order, if you want to know what leaves this machine: `build()` is the
whole of it.
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from sqlalchemy.orm import Session

from jarvis.ai.base import ChatRequest, ProviderMessage, ToolSpec
from jarvis.intent import Intent, IntentKind, directive

log = logging.getLogger("jarvis.context")

# Ceilings on what one request may carry. A retrieval bug should cost a clipped
# answer, never a database upload.
MAX_SNIPPETS = 12
MAX_SNIPPETS_PER_SOURCE = 8
MAX_SNIPPET_CHARS = 2_000
MAX_CONTEXT_CHARS = 12_000
# Roughly 30k tokens of history at four characters per token. Measured in
# characters on purpose: it needs no tokeniser and no network call, and the real
# ceiling is the model's, which is far above this.
MAX_HISTORY_CHARS = 120_000

# How many recent traces to keep for the context inspector. In memory only -
# writing a record of what was sent would mean a second copy of the personal
# data, on disk, forever.
TRACE_HISTORY = 20

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
    # What this came from locally, so the interface can link back to it:
    # ("memory", 12) or ("document", 3).
    reference: tuple[str, int] | None = None

    def rendered(self) -> str:
        body = self.body.strip()
        if len(body) > MAX_SNIPPET_CHARS:
            body = body[:MAX_SNIPPET_CHARS].rstrip() + " ..."
        return f"[{self.source}] {self.title}\n{body}"


@dataclass(frozen=True)
class RetrievalRequest:
    """What a source needs to answer "what of mine is relevant here?".

    It carries the user id and the database session because retrieval must be
    scoped to an owner, and that scoping is not the model's to decide - nothing
    here came from the model except `query`.
    """

    query: str
    user_id: int
    session: Session
    limit: int = MAX_SNIPPETS_PER_SOURCE
    intent: Intent = field(default_factory=lambda: Intent(kind=IntentKind.ASK))


@runtime_checkable
class ContextSource(Protocol):
    """Somewhere relevant local information can be looked up."""

    name: str

    def retrieve(self, request: RetrievalRequest) -> Sequence[ContextSnippet]:
        """At most `request.limit` snippets relevant to the query, best first."""
        ...


@dataclass
class TracedSnippet:
    source: str
    title: str
    score: float
    chars: int
    reference: tuple[str, int] | None = None


@dataclass
class ContextTrace:
    """A record of one assembled request: what was sent, and how much of it.

    Kept in memory for the context inspector. This is the feature that turns
    "only the minimum is sent" from a claim into something the owner can check
    for themselves, on the actual request, after the fact.
    """

    created_at: datetime
    query: str
    intent: str
    model: str
    system_chars: int
    history_messages: int
    history_chars: int
    snippets: list[TracedSnippet] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    # The literal system prompt that went. Local, in memory, owner-only.
    system_text: str = ""

    @property
    def total_chars(self) -> int:
        return self.system_chars + self.history_chars

    def as_dict(self, *, include_system: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "created_at": self.created_at.isoformat(),
            "query": self.query,
            "intent": self.intent,
            "model": self.model,
            "system_chars": self.system_chars,
            "history_messages": self.history_messages,
            "history_chars": self.history_chars,
            "total_chars": self.total_chars,
            "tools": self.tools,
            "snippets": [
                {
                    "source": s.source,
                    "title": s.title,
                    "score": round(s.score, 3),
                    "chars": s.chars,
                    "reference": list(s.reference) if s.reference else None,
                }
                for s in self.snippets
            ],
        }
        if include_system:
            payload["system_text"] = self.system_text
        return payload


_traces: deque[ContextTrace] = deque(maxlen=TRACE_HISTORY)


def record_trace(trace: ContextTrace) -> None:
    _traces.append(trace)


def recent_traces() -> list[ContextTrace]:
    return list(reversed(_traces))


def clear_traces() -> None:
    _traces.clear()


@dataclass
class BuiltContext:
    """The request, plus what went into it."""

    request: ChatRequest
    snippets: list[ContextSnippet] = field(default_factory=list)
    history_messages: int = 0
    trace: ContextTrace | None = None


class ContextManager:
    """Turns local state into one `ChatRequest`."""

    def __init__(
        self,
        *,
        sources: Sequence[ContextSource] | None = None,
        prompt_path: Path | None = None,
        now: datetime | None = None,
        log_context: bool = False,
    ) -> None:
        self._sources = list(sources or [])
        self._prompt_path = prompt_path
        self._now = now
        self.log_context = log_context
        # Set per request from the active prompt version. The file is only the
        # seed: once a version exists, changing the file must not quietly
        # bypass the evaluation gate, so the database wins.
        self.prompt_body: str | None = None

    def add_source(self, source: ContextSource) -> None:
        """Register a retrieval source. The seam later phases attach to."""
        self._sources.append(source)

    @property
    def sources(self) -> list[ContextSource]:
        return list(self._sources)

    def system_prompt(self, *, user_display_name: str) -> str:
        template = DEFAULT_SYSTEM_PROMPT
        if self.prompt_body:
            template = self.prompt_body
        elif self._prompt_path is not None and self._prompt_path.is_file():
            # Editable without touching the source, so the assistant's manner is
            # configuration rather than a code change.
            template = self._prompt_path.read_text(encoding="utf-8")
        now = (self._now or datetime.now()).strftime("%A %d %B %Y, %H:%M")
        return template.format(user=user_display_name or "the user", now=now)

    def retrieve(self, request: RetrievalRequest) -> list[ContextSnippet]:
        """Ask every source, keep the best few overall.

        Each source is capped before the pooled ranking, so a source with a
        thousand rows cannot take every slot from one with ten.
        """
        if not request.query.strip():
            return []

        gathered: list[ContextSnippet] = []
        for source in self._sources:
            try:
                found = list(source.retrieve(request))
            # One broken source must not take the whole answer down with it.
            except Exception:
                log.exception("context source %r failed", getattr(source, "name", source))
                continue
            gathered.extend(found[:MAX_SNIPPETS_PER_SOURCE])

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
        session: Session | None = None,
        user_id: int | None = None,
        intent: Intent | None = None,
        max_tokens: int = 8192,
        tools: Sequence[ToolSpec] = (),
        show_thinking: bool = False,
        query: str = "",
    ) -> BuiltContext:
        """Assemble the request. `history` ends with the message being answered.

        Retrieval only happens when a session and a user id are supplied. A
        caller that cannot say whose data to search gets no personal data in the
        request, which is the safe direction for that mistake to fail in.
        """
        resolved_intent = intent or Intent(kind=IntentKind.ASK)

        snippets: list[ContextSnippet] = []
        if session is not None and user_id is not None and query.strip():
            snippets = self.retrieve(
                RetrievalRequest(
                    query=query,
                    user_id=user_id,
                    session=session,
                    intent=resolved_intent,
                )
            )

        system = self.system_prompt(user_display_name=user_display_name)

        instruction = directive(resolved_intent)
        if instruction:
            system = f"{system}\n\n{instruction}"

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

        trace = ContextTrace(
            created_at=datetime.now(),
            query=query,
            intent=resolved_intent.kind.value,
            model=model,
            system_chars=len(system),
            history_messages=len(trimmed),
            history_chars=sum(
                len(getattr(block, "text", "")) for m in trimmed for block in m.content
            ),
            snippets=[
                TracedSnippet(
                    source=s.source,
                    title=s.title,
                    score=s.score,
                    chars=len(s.rendered()),
                    reference=s.reference,
                )
                for s in snippets
            ],
            tools=[t.name for t in tools],
            system_text=system,
        )
        record_trace(trace)
        if self.log_context:
            # Off by default. On, this writes the personal context to the log
            # file, which is exactly what you want while developing and exactly
            # what you do not want left on afterwards.
            log.info(
                "context for %r: %d chars, %d snippets (%s), %d history messages",
                query[:80],
                trace.total_chars,
                len(trace.snippets),
                ", ".join(f"{s.source}:{s.title}"[:60] for s in trace.snippets) or "none",
                trace.history_messages,
            )
            log.debug("system prompt sent:\n%s", system)

        return BuiltContext(
            request=request,
            snippets=snippets,
            history_messages=len(trimmed),
            trace=trace,
        )


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
