"""Turning entries into text.

Two audiences: a terminal, and a markdown file a browser will render. Both get
the same content, because a summary that differs between the CLI and the docs
is a summary somebody will eventually quote from the wrong one.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from aimodeldb.loader import Database
from aimodeldb.models import Entry
from aimodeldb.recommend import Recommendation


def _tokens(count: int | None) -> str:
    if count is None:
        return "-"
    if count >= 1_000_000:
        return f"{count / 1_000_000:g}M"
    if count >= 1_000:
        return f"{count / 1_000:g}K"
    return str(count)


def entry_line(entry: Entry) -> str:
    """One entry on one line, for a list."""
    bits = [f"{entry.name} ({entry.provider})"]
    if entry.openness.is_downloadable:
        licence = f", {entry.openness.license}" if entry.openness.license else ""
        bits.append(f"{entry.openness.weights}{licence}")
    if entry.context_window and entry.context_window.input_tokens:
        bits.append(f"{_tokens(entry.context_window.input_tokens)} ctx")
    if entry.pricing:
        bits.append(entry.pricing.headline())
    if entry.status != "available":
        bits.append(entry.status)
    return "  ".join([bits[0], "·".join(f" {b} " for b in bits[1:])]).rstrip(" ·")


def entry_detail(entry: Entry, *, today: date | None = None) -> str:
    """Everything known about one entry."""
    today = today or date.today()
    age = entry.age_days(today)
    lines = [
        entry.name,
        "=" * len(entry.name),
        f"{entry.provider} · {entry.kind}" + (f" · {entry.model_id}" if entry.model_id else ""),
        "",
        entry.summary,
        "",
    ]

    facts: list[tuple[str, str]] = [("status", entry.status)]
    if entry.released:
        facts.append(("released", entry.released))
    if entry.context_window:
        window = entry.context_window
        facts.append(
            (
                "context",
                f"{_tokens(window.input_tokens)} in / {_tokens(window.output_tokens)} out",
            )
        )
        if window.note:
            facts.append(("context note", window.note))
    if entry.modalities:
        facts.append(("input", ", ".join(entry.modalities.get("input", ())) or "-"))
        facts.append(("output", ", ".join(entry.modalities.get("output", ())) or "-"))
    facts.append(("api", "yes" if entry.api.available else "no"))
    facts.append(
        (
            "weights",
            entry.openness.weights
            + (f" ({entry.openness.license})" if entry.openness.license else "")
            + (f", {entry.openness.parameters}" if entry.openness.parameters else ""),
        )
    )
    if entry.pricing:
        facts.append(("pricing", entry.pricing.headline()))
        if entry.pricing.note:
            facts.append(("pricing note", entry.pricing.note))

    width = max(len(label) for label, _ in facts)
    lines += [f"  {label:<{width}}  {value}" for label, value in facts]

    for heading, items in (
        ("Use cases", entry.use_cases),
        ("Strengths", entry.strengths),
        ("Weaknesses", entry.weaknesses),
    ):
        if items:
            lines += ["", heading, "-" * len(heading)]
            lines += [f"  - {item}" for item in items]

    if entry.categories:
        lines += ["", "Categories", "----------"]
        for placement in entry.categories:
            lines.append(f"  {placement.id} [{placement.tier}]")
            lines.append(f"    {placement.rationale}")

    if entry.notes:
        lines += ["", "Notes", "-----", f"  {entry.notes}"]

    if entry.alternatives:
        lines += ["", f"See also: {', '.join(entry.alternatives)}"]

    lines += ["", "Sources", "-------"]
    for source in entry.sources:
        title = f" — {source.title}" if source.title else ""
        lines.append(f"  [{source.kind}] {source.url}{title}  (retrieved {source.retrieved})")

    verification = entry.verification
    lines += [
        "",
        f"Last verified {verification.last_verified} "
        f"({age} day{'' if age == 1 else 's'} ago) "
        f"by {verification.method}; fields checked: "
        f"{', '.join(verification.verified_fields)}.",
    ]
    if verification.note:
        lines.append(verification.note)
    lines.append("Anything not in that list is editorial judgement rather than a verified fact.")
    return "\n".join(lines)


def recommendation_text(recommendation: Recommendation) -> str:
    """A recommendation as terminal output."""
    category = recommendation.category
    lines = [
        category.question,
        "=" * len(category.question),
        category.definition.strip(),
        "",
    ]

    if recommendation.is_empty:
        lines.append("Nothing in the database matches those constraints.")
        if recommendation.excluded:
            lines.append(
                f"{recommendation.excluded} entr"
                f"{'y was' if recommendation.excluded == 1 else 'ies were'} "
                "excluded by the filters. Loosen them, or add an entry - "
                "see CONTRIBUTING.md."
            )
        return "\n".join(lines)

    for group in recommendation.groups:
        lines.append(f"{group.tier.label}")
        lines.append("-" * len(group.tier.label))
        lines.append(f"  {group.tier.definition.strip()}")
        lines.append("")
        for entry in group.entries:
            lines.append(f"  * {entry_line(entry)}")
            placement = entry.placement(category.id)
            if placement:
                lines.append(f"      {placement.rationale.strip()}")
            lines.append(f"      {entry.primary_url}")
        lines.append("")

    if recommendation.excluded:
        lines.append(
            f"({recommendation.excluded} further entr"
            f"{'y' if recommendation.excluded == 1 else 'ies'} in this category "
            "excluded by the constraints given.)"
        )
    lines.append(
        "Tiers are groupings, not a ranking. Entries in one tier are in "
        "alphabetical order, and the differences between them are in the "
        "rationale rather than the position."
    )
    return "\n".join(lines)


def markdown_table(database: Database, category_id: str) -> str:
    """One category as a markdown table, for the generated docs."""
    entries = database.by_category(category_id)
    header = "| Tier | Name | Provider | Context | Weights | Pricing | Why |"
    rows = [header, "|---|---|---|---|---|---|---|"]
    for entry in entries:
        placement = entry.placement(category_id)
        window = entry.context_window
        rows.append(
            "| "
            + " | ".join(
                [
                    placement.tier if placement else "-",
                    f"[{entry.name}]({entry.primary_url})",
                    entry.provider,
                    _tokens(window.input_tokens) if window else "-",
                    entry.openness.weights,
                    entry.pricing.headline() if entry.pricing else "-",
                    (placement.rationale.strip().replace("\n", " ") if placement else "-"),
                ]
            )
            + " |"
        )
    return "\n".join(rows)


def to_json(database: Database) -> dict[str, Any]:
    """The whole database as one JSON document, for anyone not using Python."""
    return {
        "generated": date.today().isoformat(),
        "schema": "https://github.com/thegolfercoder/ai-model-database/schema/entry.schema.json",
        "note": (
            "Every entry carries its own sources and a last_verified date. "
            "Check that date before relying on a price or a context window."
        ),
        "taxonomy": {
            "categories": [
                {
                    "id": c.id,
                    "label": c.label,
                    "question": c.question,
                    "definition": c.definition.strip(),
                }
                for c in database.taxonomy.categories
            ],
            "tiers": [
                {"id": t.id, "label": t.label, "definition": t.definition.strip()}
                for t in database.taxonomy.tiers
            ],
            "max_age_days": database.taxonomy.max_age_days,
        },
        "entries": [entry.raw for entry in database.entries],
    }
