"""Validation.

Three layers, in order of how much they catch:

1. **JSON Schema** - shape. Required keys, types, enums, string lengths.
2. **Referential** - the things a schema cannot express: category ids that exist
   in the taxonomy, source ids that resolve, slugs matching filenames,
   ``alternatives`` pointing at entries that are present.
3. **Editorial** - the rules that make this database worth reading rather than
   merely well-formed: every entry cites an official source, every entry lists
   at least one weakness, and no entry claims to be "the best" at anything
   without a citation.

The third layer is the unusual one and it is the reason this file is longer
than a schema check would need to be. A catalogue of AI tools with no stated
weaknesses and a "best in class" on every page is a marketing site, and nothing
about its file format would tell you that. These rules are how the promise in
the README is kept by the build rather than by good intentions.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import jsonschema

from aimodeldb.loader import DEFAULT_DATA_DIR, load_raw_entries, load_taxonomy, read_yaml
from aimodeldb.models import Taxonomy

SCHEMA_DIR = Path("schema")

#: Claims that assert one thing is objectively better than everything else.
#: Allowed only when the placement cites evidence, because sometimes a
#: leaderboard really does say that and quoting it is fine.
SUPERLATIVES = re.compile(
    r"\b("
    r"the best|world'?s best|best[- ]in[- ]class|best available|"
    r"unmatched|unrivalled|unrivaled|second to none|"
    r"state[- ]of[- ]the[- ]art|SOTA|"
    r"strictly better|beats (?:all|every|everything)|"
    r"the (?:only|definitive|undisputed) (?:choice|option|model|tool)"
    r")\b",
    re.IGNORECASE,
)

#: Words that make a claim untestable rather than merely wrong.
MARKETING = re.compile(
    r"\b(revolutionary|game[- ]chang(?:er|ing)|cutting[- ]edge|next[- ]generation|"
    r"paradigm shift|magical|seamlessly|effortlessly|blazing[- ]fast)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True, slots=True)
class Finding:
    """One problem, tied to the file it is in."""

    path: Path
    slug: str
    rule: str
    message: str
    severity: str = "error"

    def __str__(self) -> str:
        marker = "ERROR" if self.severity == "error" else "warn "
        return f"{marker} {self.path.name}: [{self.rule}] {self.message}"


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)
    entries_checked: int = 0

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def add(self, path: Path, slug: str, rule: str, message: str, severity: str = "error") -> None:
        self.findings.append(Finding(path, slug, rule, message, severity))

    def summary(self) -> str:
        return (
            f"{self.entries_checked} entries checked, "
            f"{len(self.errors)} error(s), {len(self.warnings)} warning(s)"
        )


def load_schema(name: str, schema_dir: Path | str = SCHEMA_DIR) -> dict[str, Any]:
    import json

    path = Path(schema_dir) / name
    return dict(json.loads(path.read_text(encoding="utf-8")))


def validate_all(
    data_dir: Path | str = DEFAULT_DATA_DIR,
    schema_dir: Path | str = SCHEMA_DIR,
    *,
    today: date | None = None,
) -> Report:
    """Run every check over every entry."""
    today = today or date.today()
    report = Report()
    taxonomy = load_taxonomy(data_dir)
    schema = load_schema("entry.schema.json", schema_dir)
    validator = jsonschema.Draft202012Validator(schema)

    raw_entries = load_raw_entries(data_dir)
    report.entries_checked = len(raw_entries)
    slugs = {raw.get("slug") for _, raw in raw_entries}

    for path, raw in raw_entries:
        slug = str(raw.get("slug", path.stem))
        _check_schema(validator, report, path, slug, raw)
        _check_identity(report, path, slug, raw)
        _check_vocabulary(report, path, slug, raw, taxonomy)
        _check_sources(report, path, slug, raw)
        _check_freshness(report, path, slug, raw, taxonomy, today)
        _check_editorial(report, path, slug, raw)
        _check_cross_references(report, path, slug, raw, slugs)

    _check_categories_are_populated(report, raw_entries, taxonomy)
    return report


def _check_schema(
    validator: jsonschema.Draft202012Validator,
    report: Report,
    path: Path,
    slug: str,
    raw: dict[str, Any],
) -> None:
    for error in sorted(validator.iter_errors(raw), key=lambda e: list(e.path)):
        location = ".".join(str(part) for part in error.path) or "(root)"
        report.add(path, slug, "schema", f"{location}: {error.message}")


def _check_identity(report: Report, path: Path, slug: str, raw: dict[str, Any]) -> None:
    if raw.get("slug") != path.stem:
        report.add(
            path,
            slug,
            "slug-matches-filename",
            f"slug is {raw.get('slug')!r} but the file is {path.name}",
        )


def _check_vocabulary(
    report: Report, path: Path, slug: str, raw: dict[str, Any], taxonomy: Taxonomy
) -> None:
    if raw.get("kind") not in taxonomy.kinds:
        report.add(path, slug, "vocabulary", f"unknown kind {raw.get('kind')!r}")

    openness = (raw.get("openness") or {}).get("weights")
    if openness is not None and openness not in taxonomy.openness_values:
        report.add(path, slug, "vocabulary", f"unknown openness {openness!r}")

    seen: set[str] = set()
    for placement in raw.get("categories") or []:
        category_id, tier = placement.get("id"), placement.get("tier")
        if category_id not in taxonomy.category_ids:
            report.add(path, slug, "vocabulary", f"unknown category {category_id!r}")
        if tier not in taxonomy.tier_ids:
            report.add(path, slug, "vocabulary", f"unknown tier {tier!r}")
        if category_id in seen:
            report.add(path, slug, "vocabulary", f"category {category_id!r} listed twice")
        seen.add(str(category_id))

    for source in raw.get("sources") or []:
        if source.get("kind") not in taxonomy.source_kinds:
            report.add(path, slug, "vocabulary", f"unknown source kind {source.get('kind')!r}")


def _check_sources(report: Report, path: Path, slug: str, raw: dict[str, Any]) -> None:
    sources = raw.get("sources") or []
    ids = [source.get("id") for source in sources]
    if len(ids) != len(set(ids)):
        report.add(path, slug, "sources", "two sources share an id")

    if not any(source.get("kind") == "official" for source in sources):
        report.add(
            path,
            slug,
            "official-source-required",
            "no official source; an entry backed only by third-party write-ups "
            "cannot be checked by a reader and is not accepted",
        )

    known = set(ids)
    references: list[tuple[str, str]] = []
    for placement in raw.get("categories") or []:
        references += [
            (str(e), f"categories[{placement.get('id')}].evidence")
            for e in placement.get("evidence") or []
        ]
    for section in ("pricing", "context_window"):
        block = raw.get(section)
        if isinstance(block, dict) and block.get("source"):
            references.append((str(block["source"]), f"{section}.source"))

    for reference, where in references:
        if reference not in known:
            report.add(path, slug, "sources", f"{where} refers to unknown source id {reference!r}")

    for source in sources:
        url = str(source.get("url", ""))
        if url and not url.startswith("https://"):
            report.add(
                path, slug, "sources", f"source {source.get('id')!r} is not https", "warning"
            )


def _check_freshness(
    report: Report,
    path: Path,
    slug: str,
    raw: dict[str, Any],
    taxonomy: Taxonomy,
    today: date,
) -> None:
    verification = raw.get("verification") or {}
    stamp = verification.get("last_verified")
    if not stamp:
        return
    try:
        checked = date.fromisoformat(str(stamp))
    except ValueError:
        report.add(path, slug, "freshness", f"last_verified {stamp!r} is not a date")
        return

    if checked > today:
        report.add(path, slug, "freshness", f"last_verified {checked} is in the future")
        return

    age = (today - checked).days
    if age > taxonomy.hard_max_age_days:
        report.add(
            path,
            slug,
            "freshness",
            f"last verified {age} days ago, beyond the {taxonomy.hard_max_age_days}-day limit",
        )
    elif age > taxonomy.max_age_days:
        report.add(
            path,
            slug,
            "freshness",
            f"last verified {age} days ago; re-check against the cited sources",
            "warning",
        )

    if verification.get("method") == "secondary_only":
        report.add(
            path,
            slug,
            "freshness",
            "verified against secondary sources only; check the provider's own docs",
            "warning",
        )

    # A claim about a field nobody checked is editorial, and saying so is the
    # difference between a catalogue and a rumour.
    checked_fields = set(verification.get("verified_fields") or ())
    pricing = raw.get("pricing") or {}
    has_amount = any(
        pricing.get(key) is not None for key in ("input_usd", "output_usd", "amount_usd")
    )
    if has_amount and "pricing" not in checked_fields:
        report.add(
            path, slug, "freshness", "pricing is recorded but not listed as verified", "warning"
        )
    if raw.get("context_window") and "context_window" not in checked_fields:
        report.add(
            path,
            slug,
            "freshness",
            "context_window is recorded but not listed as verified",
            "warning",
        )


def _check_editorial(report: Report, path: Path, slug: str, raw: dict[str, Any]) -> None:
    if not raw.get("weaknesses"):
        report.add(
            path,
            slug,
            "weaknesses-required",
            "no weaknesses listed; every tool has trade-offs and an entry without "
            "them is advertising",
        )

    for placement in raw.get("categories") or []:
        rationale = str(placement.get("rationale", ""))
        match = SUPERLATIVES.search(rationale)
        if match and not placement.get("evidence"):
            report.add(
                path,
                slug,
                "no-unsupported-superlatives",
                f"categories[{placement.get('id')}].rationale claims {match.group(0)!r} "
                "with no evidence cited",
            )

    # Only strings are inspected here. A non-string in a string list is a
    # schema violation and is already reported by _check_schema; crashing on it
    # would hide every other finding in the same run, which is the opposite of
    # what a validator is for. This happened for real: an unquoted colon in a
    # YAML list item turns "Not a model: it runs one" into a mapping, and six
    # entries carried one before the schema check was allowed to report it.
    texts: list[tuple[str, str]] = [
        ("summary", str(raw.get("summary", ""))),
        ("notes", str(raw.get("notes") or "")),
    ]
    texts += [
        (f"strengths[{i}]", item)
        for i, item in enumerate(raw.get("strengths") or [])
        if isinstance(item, str)
    ]
    for where, text in texts:
        match = MARKETING.search(text)
        if match:
            report.add(
                path,
                slug,
                "no-marketing-language",
                f"{where} contains {match.group(0)!r}, which describes nothing testable",
                "warning",
            )


def _check_cross_references(
    report: Report, path: Path, slug: str, raw: dict[str, Any], slugs: set[str | None]
) -> None:
    for alternative in raw.get("alternatives") or []:
        if alternative == slug:
            report.add(path, slug, "alternatives", "an entry lists itself as an alternative")
        elif alternative not in slugs:
            report.add(path, slug, "alternatives", f"unknown entry {alternative!r}")


def _check_categories_are_populated(
    report: Report, raw_entries: list[tuple[Path, dict[str, Any]]], taxonomy: Taxonomy
) -> None:
    """A category nobody is in answers its own question with silence."""
    populated: set[str] = set()
    for _, raw in raw_entries:
        for placement in raw.get("categories") or []:
            populated.add(str(placement.get("id")))

    for category in taxonomy.categories:
        if category.id not in populated:
            report.add(
                Path("data/taxonomy.yaml"),
                category.id,
                "empty-category",
                f"category {category.id!r} has no entries; either populate it or remove it",
                "warning",
            )


def check_url_shapes(data_dir: Path | str = DEFAULT_DATA_DIR) -> list[str]:
    """Cheap structural URL checks. Does not make network requests.

    Fetching every source on every CI run would be slow, flaky, and would fail
    the build for reasons outside the repository's control. Link rot is real,
    and it is handled by the staleness workflow re-checking entries on a
    schedule instead.
    """
    problems: list[str] = []
    for path, raw in load_raw_entries(data_dir):
        for source in raw.get("sources") or []:
            url = str(source.get("url", ""))
            if " " in url or not url.startswith("http"):
                problems.append(f"{path.name}: malformed url {url!r}")
    return problems


def taxonomy_is_valid(data_dir: Path | str = DEFAULT_DATA_DIR) -> list[str]:
    """Structural checks on the taxonomy itself."""
    raw = read_yaml(Path(data_dir) / "taxonomy.yaml")
    problems: list[str] = []
    for section in ("categories", "tiers", "kinds", "openness", "source_kinds"):
        ids = [item["id"] for item in raw.get(section, [])]
        if len(ids) != len(set(ids)):
            problems.append(f"{section}: duplicate ids")
        if not ids:
            problems.append(f"{section}: empty")
    return problems
