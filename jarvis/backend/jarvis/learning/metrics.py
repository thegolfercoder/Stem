"""What the numbers say.

Deliberately few, and all of them things that can be acted on. A dashboard of
twenty charts nobody reads is worse than four numbers that change a decision:

- how often answers are approved, which is the only direct quality signal
- how often turns fail outright, which is a bug report in aggregate
- how long answers take, at the median and at the tail
- how much context is going, because that is the cost and the privacy surface

Percentiles are computed over the window rather than stored, which is fine at
personal scale and avoids a second table that can disagree with the first.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from jarvis.models import Feedback, Interaction


@dataclass
class Metrics:
    window_days: int
    turns: int = 0
    errors: int = 0
    tool_errors: int = 0
    rated: int = 0
    approved: int = 0
    rejected: int = 0
    latency_p50_ms: int = 0
    latency_p95_ms: int = 0
    context_chars_median: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    by_intent: dict[str, int] = field(default_factory=dict)

    @property
    def error_rate(self) -> float:
        return self.errors / self.turns if self.turns else 0.0

    @property
    def approval_rate(self) -> float:
        """Of the turns that were rated. Unrated turns are not silent approval."""
        return self.approved / self.rated if self.rated else 0.0

    @property
    def rated_share(self) -> float:
        return self.rated / self.turns if self.turns else 0.0

    def as_dict(self) -> dict[str, object]:
        return {
            "window_days": self.window_days,
            "turns": self.turns,
            "errors": self.errors,
            "error_rate": round(self.error_rate, 4),
            "tool_errors": self.tool_errors,
            "rated": self.rated,
            "approved": self.approved,
            "rejected": self.rejected,
            "approval_rate": round(self.approval_rate, 4),
            "rated_share": round(self.rated_share, 4),
            "latency_p50_ms": self.latency_p50_ms,
            "latency_p95_ms": self.latency_p95_ms,
            "context_chars_median": self.context_chars_median,
            "tokens_in": self.tokens_in,
            "tokens_out": self.tokens_out,
            "by_intent": self.by_intent,
        }


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    # Nearest-rank: with nine samples there is no meaningful interpolation to do,
    # and a real observed value is easier to reason about than a computed one.
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return ordered[index]


def summarise(session: Session, *, user_id: int, window_days: int = 30) -> Metrics:
    since = (datetime.now(UTC) - timedelta(days=window_days)).replace(tzinfo=None)
    rows = list(
        session.execute(
            select(Interaction).where(
                Interaction.user_id == user_id, Interaction.created_at >= since
            )
        ).scalars()
    )

    metrics = Metrics(window_days=window_days, turns=len(rows))
    if not rows:
        return metrics

    latencies: list[int] = []
    contexts: list[int] = []
    for row in rows:
        if row.error:
            metrics.errors += 1
        metrics.tool_errors += row.tool_errors
        metrics.tokens_in += row.input_tokens
        metrics.tokens_out += row.output_tokens
        metrics.by_intent[row.intent] = metrics.by_intent.get(row.intent, 0) + 1
        latencies.append(row.latency_ms)
        contexts.append(row.context_chars)

    metrics.latency_p50_ms = _percentile(latencies, 0.5)
    metrics.latency_p95_ms = _percentile(latencies, 0.95)
    metrics.context_chars_median = _percentile(contexts, 0.5)

    ratings = list(
        session.execute(
            select(Feedback.rating).where(Feedback.interaction_id.in_([r.id for r in rows]))
        ).scalars()
    )
    metrics.rated = len(ratings)
    metrics.approved = sum(1 for r in ratings if r == "up")
    metrics.rejected = metrics.rated - metrics.approved
    return metrics


def problem_turns(session: Session, *, user_id: int, limit: int = 20) -> list[Interaction]:
    """Turns worth looking at: the ones that errored, or that the owner rejected.

    This is the error-detection half of the loop. It does not try to be clever -
    a failure is a turn that failed or a turn a person said was bad, and both are
    recorded facts rather than inferences.
    """
    rejected = set(
        session.execute(select(Feedback.interaction_id).where(Feedback.rating == "down")).scalars()
    )
    rows = list(
        session.execute(
            select(Interaction)
            .where(Interaction.user_id == user_id)
            .order_by(Interaction.id.desc())
            .limit(400)
        ).scalars()
    )
    bad = [row for row in rows if row.error or row.id in rejected or row.tool_errors]
    return bad[:limit]
