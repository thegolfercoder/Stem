"""The agent loop's mechanics: backlog items, ranking, validation and health.

The three agents (Strategist, Builder, QA; see agents/README.md) share a backlog
of GitHub issues. What an item must contain, which item the Builder takes next,
and how healthy the loop is are decided here, by code with tests, rather than
re-decided by each agent from prose each run. Standard library only, so it runs
in a fresh container before anything is installed.

Agents fetch issues with the GitHub tools and save them to a file. Ranking reads
only each issue's number, title, labels, state, created_at and the agent-task
block, so the saved body may be just that block: re-writing whole bodies costs
tokens for nothing. Then:

    python agents/loop.py config                         # check agents/config.toml
    python agents/loop.py validate draft.md              # is this item well formed?
    python agents/loop.py rank issues.json --have data,swift   # what to build next
    python agents/loop.py health issues.json             # backlog and loop health

An item body starts with a fenced block of `key: value` lines, then sections:

    ```agent-task
    kind: bug
    priority: P1
    impact: 4
    confidence: 3
    effort: 2
    area: web
    needs: none
    depends-on: #12
    ```
    ## Why
    ## What
    ## Acceptance criteria
    - [ ] ...
    ## Verification
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "config.toml"

KINDS = ("bug", "feature", "experiment", "refactor", "test", "docs", "infra")
PRIORITIES = ("P0", "P1", "P2", "P3")
AREAS = ("python", "ml", "web", "ios", "desktop", "product", "docs", "infra")
RESOURCES = ("none", "data", "swift", "browser")
"""What an item needs beyond a checkout: the GolfDB archives under out/, a Swift
toolchain, or a headless browser. The Builder says which it has."""
REQUIRED_SECTIONS = ("Why", "What", "Acceptance criteria", "Verification")

# Labels, as GitHub shows them.
BACKLOG = "agent-backlog"
IN_PROGRESS = "status:in-progress"
BLOCKED = "status:blocked"
NEEDS_HUMAN = "needs-human"
HUMAN_PRIORITY = "human-priority"
FROM_QA = "from:qa"

BLOCK = re.compile(r"```agent-task\s*\n(.*?)\n```", re.DOTALL)
SECTION = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
CHECKBOX = re.compile(r"^\s*-\s*\[[ xX]\]\s+\S", re.MULTILINE)
REFERENCE = re.compile(r"#(\d+)")
INLINE_COMMENT = re.compile(r"\s+#\s")


class ItemError(ValueError):
    """An item body that the loop cannot act on, with every reason at once."""


@dataclass(frozen=True)
class Item:
    number: int
    title: str
    kind: str
    priority: str
    impact: int
    confidence: int
    effort: int
    area: str
    needs: tuple[str, ...]
    depends_on: tuple[int, ...]
    labels: frozenset[str] = field(default_factory=frozenset)
    open: bool = True
    created_at: str = ""

    @property
    def score(self) -> float:
        """Expected value per unit of effort: impact times confidence over effort."""
        return self.impact * self.confidence / self.effort


def parse_fields(body: str) -> dict[str, str]:
    match = BLOCK.search(body or "")
    if match is None:
        raise ItemError("no ```agent-task block")
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # A comment is whitespace, '#', whitespace; an issue reference is '#12'.
        line = INLINE_COMMENT.split(line, maxsplit=1)[0].strip()
        key, sep, value = line.partition(":")
        if not sep:
            raise ItemError(f"not a `key: value` line in the agent-task block: {line!r}")
        fields[key.strip().lower()] = value.strip()
    return fields


def problems(body: str) -> list[str]:
    """Everything wrong with an item body; empty when it is ready to file."""
    try:
        fields = parse_fields(body)
    except ItemError as error:
        return [str(error)]
    return field_problems(fields) + section_problems(body)


def field_problems(fields: dict[str, str]) -> list[str]:
    """What is wrong with the agent-task block's values: all ranking needs."""
    found: list[str] = []

    def choice(key: str, options: tuple[str, ...]) -> None:
        value = fields.get(key)
        if value is None:
            found.append(f"missing `{key}`")
        elif value not in options:
            found.append(f"`{key}: {value}` is not one of {', '.join(options)}")

    def scale(key: str) -> None:
        value = fields.get(key)
        if value is None:
            found.append(f"missing `{key}`")
        elif not value.isdigit() or not 1 <= int(value) <= 5:
            found.append(f"`{key}` must be a whole number from 1 to 5, not {value!r}")

    choice("kind", KINDS)
    choice("priority", PRIORITIES)
    choice("area", AREAS)
    for key in ("impact", "confidence", "effort"):
        scale(key)
    needs = [n.strip() for n in fields.get("needs", "none").split(",") if n.strip()]
    for need in needs:
        if need not in RESOURCES:
            found.append(f"`needs: {need}` is not one of {', '.join(RESOURCES)}")
    depends = fields.get("depends-on", "")
    if depends and depends.lower() != "none" and not REFERENCE.search(depends):
        found.append("`depends-on` must list issues as #N, or be none")
    return found


def section_problems(body: str) -> list[str]:
    """What is missing from the prose a Builder and QA work from."""
    found: list[str] = []
    sections = {s.strip().lower(): s for s in SECTION.findall(body)}
    for name in REQUIRED_SECTIONS:
        if name.lower() not in sections:
            found.append(f"missing section `## {name}`")
    criteria = _section(body, "Acceptance criteria")
    if criteria is not None and not CHECKBOX.search(criteria):
        found.append("`## Acceptance criteria` needs at least one `- [ ]` checkbox")
    verification = _section(body, "Verification")
    if verification is not None and not verification.strip():
        found.append("`## Verification` is empty: say what command or evidence proves it")
    return found


def _section(body: str, name: str) -> str | None:
    heads = list(SECTION.finditer(body))
    for i, head in enumerate(heads):
        if head.group(1).strip().lower() == name.lower():
            end = heads[i + 1].start() if i + 1 < len(heads) else len(body)
            return body[head.end() : end]
    return None


def _labels(issue: dict[str, Any]) -> frozenset[str]:
    raw = issue.get("labels") or []
    names = [label if isinstance(label, str) else label.get("name", "") for label in raw]
    return frozenset(n for n in names if n)


def to_item(issue: dict[str, Any]) -> Item:
    """An issue as the ranker sees it. Only the agent-task block is needed, so a
    saved issue may carry just that block as its body (see `compact`)."""
    fields = parse_fields(issue.get("body") or "")
    trouble = field_problems(fields)
    if trouble:
        raise ItemError("; ".join(trouble))
    depends = fields.get("depends-on", "")
    state = str(issue.get("state", "open")).lower()
    return Item(
        number=int(issue["number"]),
        title=str(issue.get("title", "")),
        kind=fields["kind"],
        priority=fields["priority"],
        impact=int(fields["impact"]),
        confidence=int(fields["confidence"]),
        effort=int(fields["effort"]),
        area=fields["area"],
        needs=tuple(n.strip() for n in fields.get("needs", "none").split(",") if n.strip()),
        depends_on=tuple(int(n) for n in REFERENCE.findall(depends)),
        labels=_labels(issue),
        open=state == "open",
        created_at=str(issue.get("created_at", "")),
    )


def load_issues(path: Path) -> list[dict[str, Any]]:
    """The saved output of the GitHub list-issues tool, in any of its shapes."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("issues", data.get("items", []))
    return [issue for issue in data if isinstance(issue, dict) and "number" in issue]


@dataclass(frozen=True)
class Ranking:
    ready: list[Item]
    skipped: dict[int, str]
    malformed: dict[int, str]


def rank(issues: list[dict[str, Any]], have: set[str]) -> Ranking:
    """Ready items, best first, and why each other open backlog item was left out.

    Order: a human's `human-priority` first; then priority P0 to P3; within a
    priority, QA findings and bugs before anything new (a known defect outranks a
    new feature of the same priority); then expected value per effort; then age.
    """
    open_numbers = {
        int(i["number"]) for i in issues if str(i.get("state", "open")).lower() == "open"
    }
    ready: list[Item] = []
    skipped: dict[int, str] = {}
    malformed: dict[int, str] = {}
    for issue in issues:
        labels = _labels(issue)
        if BACKLOG not in labels or str(issue.get("state", "open")).lower() != "open":
            continue
        number = int(issue["number"])
        try:
            item = to_item(issue)
        except ItemError as error:
            malformed[number] = str(error)
            continue
        if NEEDS_HUMAN in labels:
            skipped[number] = "waiting on a human decision"
        elif BLOCKED in labels:
            skipped[number] = "blocked"
        elif IN_PROGRESS in labels:
            skipped[number] = "already in progress"
        elif waiting := [d for d in item.depends_on if d in open_numbers]:
            skipped[number] = "depends on open " + ", ".join(f"#{d}" for d in waiting)
        elif missing := [n for n in item.needs if n != "none" and n not in have]:
            skipped[number] = "needs " + ", ".join(missing) + ", which this runner lacks"
        else:
            ready.append(item)

    def key(item: Item) -> tuple[Any, ...]:
        defect = FROM_QA in item.labels or item.kind == "bug"
        return (
            HUMAN_PRIORITY not in item.labels,
            PRIORITIES.index(item.priority),
            not defect,
            -item.score,
            item.created_at or "~",
            item.number,
        )

    return Ranking(sorted(ready, key=key), skipped, malformed)


def health(issues: list[dict[str, Any]], now: datetime | None = None) -> dict[str, Any]:
    """Counts the Strategist and the journal report, from the same issue list."""
    now = now or datetime.now(UTC)
    backlog = [i for i in issues if BACKLOG in _labels(i)]
    open_items = [i for i in backlog if str(i.get("state", "open")).lower() == "open"]

    def age_days(issue: dict[str, Any]) -> float | None:
        stamp = issue.get("created_at")
        if not stamp:
            return None
        created = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        return (now - created).total_seconds() / 86400.0

    ages = sorted(a for a in (age_days(i) for i in open_items) if a is not None)
    by_priority = {p: 0 for p in PRIORITIES}
    for issue in open_items:
        for p in PRIORITIES:
            if p in _labels(issue):
                by_priority[p] += 1
    return {
        "open": len(open_items),
        "closed": len(backlog) - len(open_items),
        "in_progress": sum(IN_PROGRESS in _labels(i) for i in open_items),
        "needs_human": sum(NEEDS_HUMAN in _labels(i) for i in open_items),
        "blocked": sum(BLOCKED in _labels(i) for i in open_items),
        "qa_findings_open": sum(FROM_QA in _labels(i) for i in open_items),
        "open_by_priority": by_priority,
        "median_open_age_days": round(ages[len(ages) // 2], 1) if ages else None,
    }


def load_config(path: Path = CONFIG) -> dict[str, Any]:
    config = tomllib.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    loop = config.get("loop", {})
    for key, kind in (
        ("enabled", bool),
        ("repo", str),
        ("integration_branch", str),
        ("integration_pr", int),
        ("control_issue", int),
    ):
        if not isinstance(loop.get(key), kind):
            errors.append(f"[loop].{key} must be a {kind.__name__}")
    if loop.get("integration_branch") in ("main", "master"):
        errors.append("[loop].integration_branch must not be the default branch")
    for section, keys in (
        ("builder", ("max_cycles_per_day", "wip_limit", "continuation_delay_minutes",
                     "max_lines_changed")),
        ("qa", ("max_findings_per_run",)),
        ("strategist", ("max_new_items_per_run", "min_ready", "max_ready")),
    ):  # fmt: skip
        for key in keys:
            value = config.get(section, {}).get(key)
            if not isinstance(value, int) or value < 0:
                errors.append(f"[{section}].{key} must be a whole number")
    if config.get("builder", {}).get("wip_limit") != 1:
        errors.append("[builder].wip_limit other than 1 is not supported by the procedures")
    if not config.get("qa", {}).get("audit_rotation"):
        errors.append("[qa].audit_rotation must name at least one area")
    if not config.get("protected", {}).get("paths"):
        errors.append("[protected].paths must not be empty")
    if errors:
        raise ValueError("agents/config.toml: " + "; ".join(errors))
    return config


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("config", help="check agents/config.toml and print it as JSON")
    validate = commands.add_parser("validate", help="check an item body before filing it")
    validate.add_argument("body", type=Path)
    ranked = commands.add_parser("rank", help="ready backlog items, best first")
    ranked.add_argument("issues", type=Path, help="saved JSON from the list-issues tool")
    ranked.add_argument("--have", default="", help="resources this runner has: data,swift,browser")
    ranked.add_argument(
        "--all", action="store_true", help="list every ready item, not just the next"
    )
    report = commands.add_parser("health", help="backlog counts for the journal")
    report.add_argument("issues", type=Path)
    args = parser.parse_args(argv)

    if args.command == "config":
        print(json.dumps(load_config(), indent=2))
        return 0
    if args.command == "validate":
        trouble = problems(args.body.read_text(encoding="utf-8"))
        for line in trouble:
            print(f"- {line}")
        print("ok" if not trouble else f"{len(trouble)} problem(s)")
        return 0 if not trouble else 1
    if args.command == "rank":
        have = {h.strip() for h in args.have.split(",") if h.strip()}
        result = rank(load_issues(args.issues), have)
        shown = result.ready if args.all else result.ready[:1]
        print(json.dumps({
            "next": [{"number": i.number, "title": i.title, "priority": i.priority,
                      "kind": i.kind, "score": round(i.score, 2)} for i in shown],
            "ready": len(result.ready),
            "skipped": {f"#{n}": why for n, why in sorted(result.skipped.items())},
            "malformed": {f"#{n}": why for n, why in sorted(result.malformed.items())},
        }, indent=2))  # fmt: skip
        return 0
    print(json.dumps(health(load_issues(args.issues)), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
