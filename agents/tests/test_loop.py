"""The loop's mechanics: what makes an item valid, and which item comes next.

If ranking or validation drifts, the Builder silently works on the wrong thing or
the Strategist files items nobody can act on, so both are pinned here.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import loop


def body(**overrides: str) -> str:
    fields = {
        "kind": "feature",
        "priority": "P2",
        "impact": "3",
        "confidence": "3",
        "effort": "3",
        "area": "python",
        "needs": "none",
        "depends-on": "none",
    }
    fields.update(overrides)
    block = "\n".join(f"{k}: {v}" for k, v in fields.items())
    return (
        f"```agent-task\n{block}\n```\n\n## Why\nBecause.\n\n## What\nThis.\n\n"
        "## Acceptance criteria\n- [ ] It works\n\n## Verification\n`pytest -q`\n"
    )


def issue(
    number: int, labels: list[str], state: str = "open", created: str = "", **fields: str
) -> dict:
    return {
        "number": number,
        "title": f"item {number}",
        "body": body(**fields),
        "labels": [{"name": name} for name in ["agent-backlog", *labels]],
        "state": state,
        "created_at": created or f"2026-09-{10 + number % 20:02d}T00:00:00Z",
    }


def test_a_complete_item_has_no_problems() -> None:
    assert loop.problems(body()) == []


@pytest.mark.parametrize(
    ("text", "complaint"),
    [
        ("no block at all", "no ```agent-task block"),
        (body(kind="wish"), "`kind: wish`"),
        (body(priority="urgent"), "`priority: urgent`"),
        (body(impact="9"), "`impact` must be a whole number from 1 to 5"),
        (body(needs="gpu"), "`needs: gpu`"),
        (body(**{"depends-on": "the other one"}), "`depends-on` must list issues"),
        (body().replace("## Verification\n`pytest -q`\n", ""), "missing section `## Verification`"),
        (body().replace("- [ ] It works", "It works"), "needs at least one `- [ ]` checkbox"),
    ],
)
def test_malformed_items_are_refused_with_the_reason(text: str, complaint: str) -> None:
    assert any(complaint in p for p in loop.problems(text)), loop.problems(text)


def test_every_problem_is_reported_at_once() -> None:
    assert len(loop.problems(body(kind="wish", priority="urgent", impact="0"))) == 3


def test_ranking_order() -> None:
    issues = [
        issue(1, ["P2"], priority="P2", impact="5", confidence="5", effort="1"),
        issue(2, ["P1"], priority="P1"),
        issue(3, ["P1", "from:qa"], priority="P1"),
        issue(4, ["P3", "human-priority"], priority="P3"),
        issue(5, ["P1"], priority="P1", kind="bug"),
        issue(6, ["P1"], priority="P1", impact="5", confidence="5", effort="1"),
    ]
    order = [i.number for i in loop.rank(issues, set()).ready]
    # Human override first; then P1 defects (QA finding, bug) before new work;
    # then P1 by expected value; P2 last despite its high score.
    assert order[0] == 4
    assert order[1:3] in ([3, 5], [5, 3])
    assert order[3:] == [6, 2, 1]


def test_items_that_cannot_be_started_are_skipped_with_the_reason() -> None:
    issues = [
        issue(10, ["P1", "needs-human"], priority="P1"),
        issue(11, ["P1", "status:blocked"], priority="P1"),
        issue(12, ["P1", "status:in-progress"], priority="P1"),
        issue(13, ["P1"], priority="P1", **{"depends-on": "#14"}),
        issue(14, ["P2"], priority="P2"),
        issue(15, ["P1"], priority="P1", needs="data,swift"),
        issue(16, ["P1"], priority="P1", **{"depends-on": "#99"}),  # closed or absent: fine
        {
            "number": 17,
            "title": "bad",
            "body": "no block",
            "labels": [{"name": "agent-backlog"}],
            "state": "open",
        },
        issue(18, ["P0"], state="closed", priority="P0"),
        {**issue(19, ["P0"], priority="P0"), "labels": [{"name": "P0"}]},  # not in the backlog
    ]
    result = loop.rank(issues, have={"data"})
    assert [i.number for i in result.ready] == [16, 14]
    assert result.skipped[10] == "waiting on a human decision"
    assert result.skipped[11] == "blocked"
    assert result.skipped[12] == "already in progress"
    assert result.skipped[13] == "depends on open #14"
    assert result.skipped[15] == "needs swift, which this runner lacks"
    assert 17 in result.malformed
    assert 18 not in result.skipped and 19 not in result.skipped
    # With the toolchain, the Swift item is ready.
    assert 15 in [i.number for i in loop.rank(issues, have={"data", "swift"}).ready]


def test_labels_may_be_plain_strings() -> None:
    raw = issue(1, [], priority="P1")
    raw["labels"] = ["agent-backlog", "P1"]
    assert [i.number for i in loop.rank([raw], set()).ready] == [1]


def test_health_counts() -> None:
    issues = [
        issue(1, ["P1", "from:qa"], priority="P1", created="2026-09-20T00:00:00Z"),
        issue(2, ["P2", "needs-human"], priority="P2", created="2026-09-26T00:00:00Z"),
        issue(3, ["P2"], state="closed"),
        {"number": 4, "title": "not ours", "labels": [], "state": "open"},
    ]
    report = loop.health(issues, now=datetime(2026, 9, 30, tzinfo=UTC))
    assert report["open"] == 2 and report["closed"] == 1
    assert report["qa_findings_open"] == 1 and report["needs_human"] == 1
    assert report["open_by_priority"]["P1"] == 1
    assert report["median_open_age_days"] == 10.0


def test_the_shipped_config_is_valid() -> None:
    config = loop.load_config()
    assert config["loop"]["integration_branch"] not in ("main", "master")


def test_a_config_aimed_at_main_is_refused(tmp_path: Path) -> None:
    text = (Path(loop.CONFIG).read_text()).replace(
        'integration_branch = "claude/prompt-usage-0oy6wa"', 'integration_branch = "main"'
    )
    bad = tmp_path / "config.toml"
    bad.write_text(text)
    with pytest.raises(ValueError, match="default branch"):
        loop.load_config(bad)


def test_the_command_line(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    saved = tmp_path / "issues.json"
    saved.write_text(json.dumps({"issues": [issue(3, ["P1"], priority="P1")]}))
    assert loop.main(["rank", str(saved)]) == 0
    assert json.loads(capsys.readouterr().out)["next"][0]["number"] == 3
    draft = tmp_path / "draft.md"
    draft.write_text(body(kind="wish"))
    assert loop.main(["validate", str(draft)]) == 1


def test_the_issue_template_is_valid_once_filled_in() -> None:
    template = (Path(loop.HERE).parent / ".github" / "ISSUE_TEMPLATE" / "agent-task.md").read_text()
    filled = template.split("---", 2)[2]
    filled = filled.replace("## Why\n", "## Why\nA reason.\n").replace("- [ ]", "- [ ] Done")
    filled = filled.replace("## Verification\n", "## Verification\n`pytest -q`\n")
    assert loop.problems(filled) == []
    # The hints after each value are comments; issue references are not.
    assert (
        loop.parse_fields(body(**{"depends-on": "#12, #15  # after those"}))["depends-on"]
        == "#12, #15"
    )
