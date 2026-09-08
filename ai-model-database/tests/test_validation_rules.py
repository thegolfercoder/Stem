"""Each validation rule, aimed at data that should trip it.

A validator nobody has tested against bad input is a validator that reports
nothing on bad input. Every rule here gets a case that breaks it.
"""

from __future__ import annotations

import copy
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest

from aimodeldb.validate import validate_all

TODAY = date(2026, 9, 8)
SCHEMA = Path(__file__).resolve().parent.parent / "schema"


def rules(sandbox: Path) -> set[str]:
    report = validate_all(sandbox, SCHEMA, today=TODAY)
    return {f.rule for f in report.findings if f.severity == "error"}


def warnings(sandbox: Path) -> set[str]:
    report = validate_all(sandbox, SCHEMA, today=TODAY)
    return {f.rule for f in report.findings if f.severity == "warning"}


def test_the_fixture_itself_is_clean(sandbox: Path) -> None:
    """If the baseline is dirty, every test below is measuring the wrong thing."""
    assert rules(sandbox) == set()


def test_a_missing_required_field_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    broken = copy.deepcopy(minimal_entry)
    del broken["summary"]
    write_entry(broken)
    assert "schema" in rules(sandbox)


def test_a_slug_that_does_not_match_its_filename_is_caught(
    sandbox: Path, minimal_entry: dict[str, Any]
) -> None:
    import yaml

    entry = copy.deepcopy(minimal_entry)
    entry["slug"] = "something-else"
    (sandbox / "entries" / "example-model.yaml").write_text(yaml.safe_dump(entry))
    assert "slug-matches-filename" in rules(sandbox)


def test_an_unknown_category_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["categories"][0]["id"] = "telepathy"
    write_entry(entry)
    assert "vocabulary" in rules(sandbox)


def test_an_unknown_tier_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["categories"][0]["tier"] = "amazing"
    write_entry(entry)
    assert "vocabulary" in rules(sandbox)


def test_a_duplicate_category_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["categories"].append(dict(entry["categories"][0]))
    write_entry(entry)
    assert "vocabulary" in rules(sandbox)


def test_an_entry_with_no_official_source_is_rejected(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    """The central rule. An entry backed only by a blog post cannot be checked."""
    entry = copy.deepcopy(minimal_entry)
    entry["sources"][0]["kind"] = "secondary"
    write_entry(entry)
    assert "official-source-required" in rules(sandbox)


def test_an_entry_with_no_weaknesses_is_rejected(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["weaknesses"] = []
    write_entry(entry)
    assert "weaknesses-required" in rules(sandbox)


@pytest.mark.parametrize(
    "claim",
    [
        "It is the best model available for this task.",
        "Unmatched performance on every benchmark that exists.",
        "This is state-of-the-art and nothing else comes close.",
        "It beats all other models in this category by a distance.",
        "The only choice for serious work in this area.",
    ],
)
def test_an_unsupported_superlative_is_rejected(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any], claim: str
) -> None:
    """The rule that keeps this a catalogue rather than a set of vendor blurbs."""
    entry = copy.deepcopy(minimal_entry)
    entry["categories"][0]["rationale"] = claim + " " * 5 + "Padding to reach the length floor."
    write_entry(entry)
    assert "no-unsupported-superlatives" in rules(sandbox)


def test_a_superlative_with_a_citation_is_allowed(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    """Sometimes a leaderboard really does say that, and quoting it is fine."""
    entry = copy.deepcopy(minimal_entry)
    entry["categories"][0]["rationale"] = (
        "Reported as state-of-the-art on the cited benchmark at the time of checking."
    )
    entry["categories"][0]["evidence"] = ["example-docs"]
    write_entry(entry)
    assert "no-unsupported-superlatives" not in rules(sandbox)


def test_marketing_language_is_flagged(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["strengths"] = ["A revolutionary approach that seamlessly handles everything"]
    write_entry(entry)
    assert "no-marketing-language" in warnings(sandbox)


def test_a_dangling_evidence_reference_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["categories"][0]["evidence"] = ["no-such-source"]
    write_entry(entry)
    assert "sources" in rules(sandbox)


def test_a_dangling_alternative_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["alternatives"] = ["a-model-that-does-not-exist"]
    write_entry(entry)
    assert "alternatives" in rules(sandbox)


def test_an_entry_listing_itself_as_an_alternative_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["alternatives"] = [entry["slug"]]
    write_entry(entry)
    assert "alternatives" in rules(sandbox)


def test_a_future_verification_date_is_caught(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["verification"]["last_verified"] = (TODAY + timedelta(days=30)).isoformat()
    write_entry(entry)
    assert "freshness" in rules(sandbox)


def test_a_stale_entry_warns_and_a_very_stale_one_fails(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["verification"]["last_verified"] = (TODAY - timedelta(days=120)).isoformat()
    write_entry(entry)
    assert "freshness" in warnings(sandbox)

    entry["verification"]["last_verified"] = (TODAY - timedelta(days=500)).isoformat()
    write_entry(entry)
    assert "freshness" in rules(sandbox)


def test_a_secondary_only_verification_warns(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["verification"]["method"] = "secondary_only"
    write_entry(entry)
    assert "freshness" in warnings(sandbox)


def test_recording_a_price_nobody_checked_warns(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    entry = copy.deepcopy(minimal_entry)
    entry["pricing"] = {
        "unit": "per_million_tokens",
        "input_usd": 1.0,
        "output_usd": 5.0,
        "source": "example-docs",
    }
    write_entry(entry)
    assert "freshness" in warnings(sandbox)


def test_a_self_hosted_price_does_not_warn(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    """There is no number to have verified, so demanding a verification is noise."""
    entry = copy.deepcopy(minimal_entry)
    entry["pricing"] = {"unit": "self_hosted", "source": "example-docs"}
    write_entry(entry)
    assert warnings(sandbox) - {"empty-category"} == set()


def test_an_empty_category_warns(sandbox: Path) -> None:
    """The fixture has one entry, so almost every category is empty."""
    assert "empty-category" in warnings(sandbox)


def test_one_broken_entry_does_not_hide_the_others(
    sandbox: Path, write_entry: Any, minimal_entry: dict[str, Any]
) -> None:
    """A validator that stops at the first fault makes fixing a batch a slog.

    This is also the regression test for a real crash: an unquoted colon in a
    YAML list item turns a string into a mapping, and the editorial check used
    to raise a TypeError on it - taking down the schema report that would have
    explained the problem.
    """
    first = copy.deepcopy(minimal_entry)
    first["slug"] = "broken-one"
    first["strengths"] = [{"a mapping": "where a string belongs"}]
    write_entry(first)

    second = copy.deepcopy(minimal_entry)
    second["slug"] = "broken-two"
    second["weaknesses"] = []
    write_entry(second)

    report = validate_all(sandbox, SCHEMA, today=TODAY)
    slugs = {finding.slug for finding in report.errors}
    assert {"broken-one", "broken-two"} <= slugs


def test_yaml_dates_are_accepted_unquoted(sandbox: Path) -> None:
    """PyYAML parses a bare 2026-09-01 into a date; the loader normalises it back."""
    raw = (sandbox / "entries" / "example-model.yaml").read_text()
    assert "'2026-09-01'" in raw or "2026-09-01" in raw
    (sandbox / "entries" / "example-model.yaml").write_text(
        raw.replace("'2026-09-01'", "2026-09-01")
    )
    assert rules(sandbox) == set()
