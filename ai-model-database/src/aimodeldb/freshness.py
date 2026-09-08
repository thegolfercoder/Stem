"""Staleness.

An AI model catalogue is wrong by default. Prices change, context windows grow,
models are deprecated, and the entry that was right in March is quietly
misleading by July. The only defence is to make the age of every claim visible
and to make going stale an event that something notices.

``last_verified`` is the date a person checked an entry against its sources -
not the date the file changed. Fixing a typo does not make a price current, and
using the git mtime as a freshness signal would make it look as though it did.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from aimodeldb.loader import Database
from aimodeldb.models import Entry


@dataclass(frozen=True, slots=True)
class Staleness:
    """One entry's freshness, measured against the policy in the taxonomy."""

    entry: Entry
    age_days: int
    level: str  # fresh | due | overdue

    @property
    def is_stale(self) -> bool:
        return self.level != "fresh"


def assess(database: Database, *, today: date | None = None) -> list[Staleness]:
    """Every entry, oldest check first."""
    today = today or date.today()
    policy = database.taxonomy
    results = []
    for entry in database.entries:
        age = entry.age_days(today)
        if age > policy.hard_max_age_days:
            level = "overdue"
        elif age > policy.max_age_days:
            level = "due"
        else:
            level = "fresh"
        results.append(Staleness(entry=entry, age_days=age, level=level))
    return sorted(results, key=lambda s: -s.age_days)


def stale(database: Database, *, today: date | None = None) -> list[Staleness]:
    return [item for item in assess(database, today=today) if item.is_stale]


def coverage(database: Database) -> dict[str, float]:
    """What fraction of entries actually record each verifiable field.

    Reported because a database that is 100% schema-valid and 20% populated
    looks healthy from the outside. This is the number that says otherwise.
    """
    total = len(database.entries) or 1
    counts = {
        "pricing": sum(1 for e in database.entries if e.pricing is not None),
        "context_window": sum(
            1
            for e in database.entries
            if e.context_window is not None and e.context_window.input_tokens
        ),
        "modalities": sum(1 for e in database.entries if e.modalities),
        "weaknesses": sum(1 for e in database.entries if e.weaknesses),
        "official_source": sum(1 for e in database.entries if e.official_sources),
        "pricing_verified": sum(
            1 for e in database.entries if "pricing" in e.verification.verified_fields
        ),
    }
    return {name: count / total for name, count in counts.items()}


def issue_body(items: list[Staleness], *, today: date | None = None) -> str:
    """The body of the tracking issue the scheduled workflow opens."""
    today = today or date.today()
    if not items:
        return (
            f"As of {today}, every entry has been verified within the policy window. Nothing to do."
        )

    overdue = [item for item in items if item.level == "overdue"]
    due = [item for item in items if item.level == "due"]

    lines = [
        f"As of **{today}**, {len(items)} entr{'y' if len(items) == 1 else 'ies'} "
        "need re-checking against their cited sources.",
        "",
        "Re-checking means opening the entry's official source, confirming the "
        "fields listed under `verification.verified_fields`, and updating "
        "`verification.last_verified`. Bumping the date without opening the "
        "source is worse than leaving it stale, because it removes the only "
        "signal that anything is wrong.",
        "",
    ]

    if overdue:
        lines += ["## Overdue (past the hard limit)", ""]
        lines += [_row(item) for item in overdue]
        lines.append("")
    if due:
        lines += ["## Due", ""]
        lines += [_row(item) for item in due]
        lines.append("")

    lines += [
        "---",
        "",
        "Opened automatically by `.github/workflows/staleness.yml`. "
        "See [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md#updating-an-entry).",
    ]
    return "\n".join(lines)


def _row(item: Staleness) -> str:
    entry = item.entry
    return (
        f"- [ ] **{entry.name}** (`{entry.slug}`, {entry.provider}) — "
        f"last verified {entry.verification.last_verified}, {item.age_days} days ago — "
        f"[source]({entry.primary_url})"
    )
