"""Command line interface.

`aimodeldb ask "what should I use for coding"` is the shortest path from the
question to an answer, and everything else is a more precise way of asking the
same thing.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from aimodeldb import __version__
from aimodeldb.freshness import assess, coverage, issue_body, stale
from aimodeldb.loader import DEFAULT_DATA_DIR, Database, DatabaseError, load
from aimodeldb.recommend import Constraints, answer, compare, recommend, search
from aimodeldb.render import entry_detail, entry_line, recommendation_text, to_json
from aimodeldb.validate import validate_all

DISCLAIMER = (
    "Entries carry their own sources and a last_verified date. "
    "AI models change weekly; check that date before relying on a price."
)


def _constraints(args: argparse.Namespace) -> Constraints:
    return Constraints(
        open_weights_only=getattr(args, "open_weights", False),
        api_required=getattr(args, "api", False),
        max_input_price=getattr(args, "max_price", None),
        min_context_tokens=getattr(args, "min_context", None),
        provider=getattr(args, "provider", None),
        kind=getattr(args, "kind", None),
        modality_in=getattr(args, "input", None),
        modality_out=getattr(args, "output", None),
        include_deprecated=getattr(args, "include_deprecated", False),
    )


def _load(args: argparse.Namespace) -> Database:
    return load(args.data)


def command_ask(args: argparse.Namespace) -> int:
    database = _load(args)
    question = " ".join(args.question)
    result = answer(database, question)
    if result is None:
        print(
            f"Could not map {question!r} onto a category.\n"
            f"Known categories: {', '.join(database.taxonomy.category_ids)}\n"
            "Try `aimodeldb categories` to see the question each one answers.",
            file=sys.stderr,
        )
        return 1
    print(recommendation_text(result))
    print()
    print(DISCLAIMER)
    return 0


def command_recommend(args: argparse.Namespace) -> int:
    database = _load(args)
    try:
        result = recommend(database, args.category, _constraints(args))
    except KeyError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(recommendation_text(result))
    print()
    print(DISCLAIMER)
    return 0


def command_search(args: argparse.Namespace) -> int:
    database = _load(args)
    results = search(database, " ".join(args.text), _constraints(args))
    if not results:
        print("No entries match.", file=sys.stderr)
        return 1
    for entry in results:
        print(f"{entry.slug:<28} {entry_line(entry)}")
    print(f"\n{len(results)} of {len(database)} entries.")
    return 0


def command_show(args: argparse.Namespace) -> int:
    database = _load(args)
    entry = database.get(args.slug)
    if entry is None:
        near = [e.slug for e in database.entries if args.slug.lower() in e.slug.lower()]
        print(
            f"No entry {args.slug!r}." + (f" Did you mean: {', '.join(near)}?" if near else ""),
            file=sys.stderr,
        )
        return 1
    print(entry_detail(entry))
    return 0


def command_compare(args: argparse.Namespace) -> int:
    database = _load(args)
    try:
        entries = compare(database, args.slugs)
    except KeyError as exc:
        print(exc, file=sys.stderr)
        return 1
    for index, entry in enumerate(entries):
        if index:
            print("\n" + "-" * 72 + "\n")
        print(entry_detail(entry))
    return 0


def command_categories(args: argparse.Namespace) -> int:
    database = _load(args)
    for category in database.taxonomy.categories:
        count = len(database.by_category(category.id))
        label = "entry " if count == 1 else "entries"
        print(f"{category.id:<20} {count:>3} {label}   {category.question}")
    print(
        "\nA category with one entry is a gap, not an answer. "
        "See CONTRIBUTING.md if you can fill one."
    )
    return 0


def command_validate(args: argparse.Namespace) -> int:
    report = validate_all(args.data, args.schema)
    for finding in report.findings:
        if finding.severity == "error" or not args.errors_only:
            print(finding)
    print(f"\n{report.summary()}")
    if not report.ok:
        print("\nvalidation failed", file=sys.stderr)
        return 1
    return 0


def command_stale(args: argparse.Namespace) -> int:
    database = _load(args)
    today = date.fromisoformat(args.today) if args.today else None

    if args.issue_body:
        print(issue_body(stale(database, today=today), today=today))
        return 0

    items = assess(database, today=today)
    shown = [item for item in items if args.all or item.is_stale]
    for item in shown:
        marker = {"fresh": "ok  ", "due": "due ", "overdue": "OLD "}[item.level]
        print(
            f"{marker} {item.entry.slug:<28} verified "
            f"{item.entry.verification.last_verified} ({item.age_days} days ago)"
        )
    count = sum(1 for item in items if item.is_stale)
    print(
        f"\n{count} of {len(items)} entries need re-checking "
        f"(policy: {database.taxonomy.max_age_days} days)"
    )
    return 1 if count and args.fail_on_stale else 0


def command_coverage(args: argparse.Namespace) -> int:
    database = _load(args)
    print(f"{len(database)} entries from {len(database.providers)} providers\n")
    for field_name, fraction in sorted(coverage(database).items()):
        bar = "#" * round(fraction * 30)
        print(f"  {field_name:<18} {fraction:>6.0%}  {bar}")
    print(
        "\nA field left blank is a field nobody has verified. That is the "
        "intended behaviour: an omitted price is honest, an invented one is not."
    )
    return 0


def command_build(args: argparse.Namespace) -> int:
    database = _load(args)
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(to_json(database), indent=2, default=str) + "\n")
    print(f"wrote {destination} ({len(database)} entries)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="aimodeldb",
        description=(
            "Which AI model or tool should I use for this task? A source-verified catalogue."
        ),
        epilog=DISCLAIMER,
    )
    parser.add_argument("--version", action="version", version=f"aimodeldb {__version__}")
    parser.add_argument("--data", default=str(DEFAULT_DATA_DIR), help="path to the data directory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_filters(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--open-weights", action="store_true", help="only downloadable weights")
        sub.add_argument("--api", action="store_true", help="only entries with a public API")
        sub.add_argument(
            "--max-price", type=float, metavar="USD", help="max USD per million input tokens"
        )
        sub.add_argument(
            "--min-context", type=int, metavar="TOKENS", help="minimum input context window"
        )
        sub.add_argument("--provider", help="filter by provider, substring match")
        sub.add_argument("--kind", choices=("model", "tool", "runtime"))
        sub.add_argument("--input", metavar="MODALITY", help="must accept this input modality")
        sub.add_argument("--output", metavar="MODALITY", help="must produce this output modality")
        sub.add_argument("--include-deprecated", action="store_true")

    ask = subparsers.add_parser("ask", help="answer a plain question")
    ask.add_argument("question", nargs="+")
    ask.set_defaults(func=command_ask)

    rec = subparsers.add_parser("recommend", help="recommendations for one category")
    rec.add_argument("category")
    add_filters(rec)
    rec.set_defaults(func=command_recommend)

    find = subparsers.add_parser("search", help="free-text search with filters")
    find.add_argument("text", nargs="*", default=[])
    add_filters(find)
    find.set_defaults(func=command_search)

    show = subparsers.add_parser("show", help="everything known about one entry")
    show.add_argument("slug")
    show.set_defaults(func=command_show)

    cmp_ = subparsers.add_parser("compare", help="show several entries together")
    cmp_.add_argument("slugs", nargs="+")
    cmp_.set_defaults(func=command_compare)

    cats = subparsers.add_parser("categories", help="list categories and their questions")
    cats.set_defaults(func=command_categories)

    check = subparsers.add_parser("validate", help="schema, references and editorial rules")
    check.add_argument("--schema", default="schema")
    check.add_argument("--errors-only", action="store_true")
    check.set_defaults(func=command_validate)

    old = subparsers.add_parser("stale", help="entries due for re-verification")
    old.add_argument("--all", action="store_true", help="show fresh entries too")
    old.add_argument("--today", help="pretend it is this date (YYYY-MM-DD)")
    old.add_argument("--fail-on-stale", action="store_true", help="exit non-zero if any are stale")
    old.add_argument("--issue-body", action="store_true", help="print a GitHub issue body")
    old.set_defaults(func=command_stale)

    cov = subparsers.add_parser("coverage", help="how much of the database is actually filled in")
    cov.set_defaults(func=command_coverage)

    build = subparsers.add_parser("build", help="write the whole database as one JSON file")
    build.add_argument("--output", default="dist/database.json")
    build.set_defaults(func=command_build)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except DatabaseError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
