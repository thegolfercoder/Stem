"""Recording what actually happened, turn by turn.

Everything the improvement loop later claims rests on these rows. They hold
measurements and outcomes - how long it took, how much context went, which
tools ran, whether it failed - alongside the question and the answer, because a
metric you cannot trace back to a real exchange is a metric you cannot act on.

This is local data like any other: it lives in the same database, it is covered
by the same delete, and it never leaves the machine.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from jarvis.models import Feedback, Interaction


@dataclass
class TurnRecorder:
    """Accumulates the facts of one turn while it is happening."""

    user_id: int
    conversation_id: int | None = None
    prompt_version_id: int | None = None
    query: str = ""
    intent: str = "ask"
    snippets: int = 0
    context_chars: int = 0
    started: float = field(default_factory=time.monotonic)

    answer: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    tools: list[str] = field(default_factory=list)
    tool_errors: int = 0
    error: str | None = None
    message_id: int | None = None

    def tool_ran(self, name: str, *, failed: bool) -> None:
        self.tools.append(name)
        if failed:
            self.tool_errors += 1

    @property
    def latency_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def save(self, session: Session) -> Interaction:
        interaction = Interaction(
            user_id=self.user_id,
            conversation_id=self.conversation_id,
            message_id=self.message_id,
            prompt_version_id=self.prompt_version_id,
            query=self.query[:4000],
            answer=self.answer[:8000],
            intent=self.intent,
            snippets=self.snippets,
            context_chars=self.context_chars,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            latency_ms=self.latency_ms,
            # Order preserved and duplicates kept: "it called search twice" is a
            # different event from "it called search once".
            tools_used=",".join(self.tools)[:256],
            tool_errors=self.tool_errors,
            error=self.error,
        )
        session.add(interaction)
        session.flush()
        return interaction


def recent(session: Session, *, user_id: int, limit: int = 50) -> list[Interaction]:
    return list(
        session.execute(
            select(Interaction)
            .where(Interaction.user_id == user_id)
            .order_by(desc(Interaction.id))
            .limit(max(1, min(limit, 500)))
        ).scalars()
    )


def get(session: Session, *, user_id: int, interaction_id: int) -> Interaction | None:
    return session.execute(
        select(Interaction).where(Interaction.id == interaction_id, Interaction.user_id == user_id)
    ).scalar_one_or_none()


def feedback_for(session: Session, interaction_ids: list[int]) -> dict[int, Feedback]:
    """The ratings attached to a set of interactions, keyed by interaction."""
    if not interaction_ids:
        return {}
    rows = session.execute(
        select(Feedback).where(Feedback.interaction_id.in_(interaction_ids))
    ).scalars()
    return {row.interaction_id: row for row in rows}


def record_feedback(
    session: Session, *, user_id: int, interaction_id: int, rating: str, note: str = ""
) -> Feedback:
    """Rate one answer. Rating again replaces the old rating rather than adding
    a second one - a turn has one verdict, the latest."""
    if rating not in ("up", "down"):
        raise ValueError("rating must be 'up' or 'down'")

    existing = session.execute(
        select(Feedback).where(Feedback.interaction_id == interaction_id)
    ).scalar_one_or_none()
    if existing is not None:
        existing.rating = rating
        existing.note = note.strip()[:2000]
        session.flush()
        return existing

    row = Feedback(
        interaction_id=interaction_id,
        user_id=user_id,
        rating=rating,
        note=note.strip()[:2000],
    )
    session.add(row)
    session.flush()
    return row
