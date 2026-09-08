"""The command line, exercised end to end against the real database."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from aimodeldb.cli import main


def run(capsys: pytest.CaptureFixture[str], *args: str) -> tuple[int, str, str]:
    code = main(list(args))
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_ask_answers_a_plain_question(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "ask", "what", "is", "best", "for", "coding")
    assert code == 0
    assert "Which model or tool should I use to write and edit code?" in out
    assert "Recommended" in out


def test_ask_prints_the_freshness_disclaimer(capsys: pytest.CaptureFixture[str]) -> None:
    """A recommendation quoted without its date is a recommendation that will go wrong."""
    _, out, _ = run(capsys, "ask", "best", "for", "coding")
    assert "last_verified" in out


def test_ask_says_so_when_it_cannot_match(capsys: pytest.CaptureFixture[str]) -> None:
    code, _, err = run(capsys, "ask", "qqqqqq")
    assert code == 1
    assert "Known categories" in err


def test_recommend_accepts_filters(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "recommend", "local", "--open-weights")
    assert code == 0
    assert "Ollama" in out or "Ministral" in out


def test_recommend_rejects_an_unknown_category(capsys: pytest.CaptureFixture[str]) -> None:
    assert run(capsys, "recommend", "telepathy")[0] == 1


def test_search_and_show(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "search", "claude")
    assert code == 0
    assert "claude-opus-5" in out

    code, out, _ = run(capsys, "show", "claude-opus-5")
    assert code == 0
    assert "Weaknesses" in out
    assert "Sources" in out
    assert "Last verified" in out
    assert "editorial judgement" in out


def test_show_suggests_a_near_match(capsys: pytest.CaptureFixture[str]) -> None:
    code, _, err = run(capsys, "show", "opus")
    assert code == 1
    assert "Did you mean" in err


def test_compare_prints_several_entries(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "compare", "claude-opus-5", "gpt-6-astra")
    assert code == 0
    assert "Claude Opus 5" in out
    assert "GPT-6 Astra" in out


def test_categories_lists_the_questions(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "categories")
    assert code == 0
    assert "general-reasoning" in out
    assert "Which model should I use for hard, open-ended thinking?" in out


def test_validate_passes_on_the_shipped_data(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "validate")
    assert code == 0
    assert "0 error(s)" in out


def test_stale_reports_nothing_today_and_everything_later(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code, out, _ = run(capsys, "stale", "--today", "2026-09-08")
    assert code == 0
    assert "0 of" in out

    code, out, _ = run(capsys, "stale", "--today", "2027-06-01", "--fail-on-stale")
    assert code == 1
    assert "need re-checking" in out


def test_stale_can_print_a_github_issue_body(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "stale", "--today", "2027-06-01", "--issue-body")
    assert code == 0
    assert out.startswith("As of")
    assert "- [ ]" in out


def test_coverage_reports_field_completeness(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(capsys, "coverage")
    assert code == 0
    assert "official_source" in out
    assert "100%" in out


def test_build_writes_a_json_index(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    destination = tmp_path / "database.json"
    code, _, _ = run(capsys, "build", "--output", str(destination))
    assert code == 0

    payload = json.loads(destination.read_text())
    assert payload["entries"]
    assert payload["taxonomy"]["categories"]
    assert "last_verified" in payload["note"]
    for entry in payload["entries"]:
        assert entry["sources"]
        assert entry["verification"]["last_verified"]


def test_a_missing_data_directory_is_reported_not_crashed(
    capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    code, _, err = run(capsys, "--data", str(tmp_path / "nope"), "categories")
    assert code == 2
    assert "error:" in err
