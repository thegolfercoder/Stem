"""Tests over the shipped data.

The data is the product. These tests are what stop a pull request adding an
entry with an invented price, a dead category, or a claim that something is the
best available with nothing behind it.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from aimodeldb.freshness import coverage
from aimodeldb.loader import Database
from aimodeldb.validate import taxonomy_is_valid, validate_all

TODAY = date(2026, 9, 8)


def test_the_shipped_database_validates(repo_root: Path) -> None:
    report = validate_all(repo_root / "data", repo_root / "schema", today=TODAY)
    assert report.ok, "\n".join(str(f) for f in report.errors)


def test_the_shipped_database_has_no_warnings_either(repo_root: Path) -> None:
    """Warnings are things a maintainer should have dealt with, not background noise.

    Letting warnings accumulate is how a validator becomes something people
    stop reading. If a warning here is wrong, fix the rule; if it is right, fix
    the entry.
    """
    report = validate_all(repo_root / "data", repo_root / "schema", today=TODAY)
    assert not report.warnings, "\n".join(str(f) for f in report.warnings)


def test_the_taxonomy_is_structurally_sound(repo_root: Path) -> None:
    assert taxonomy_is_valid(repo_root / "data") == []


def test_every_entry_cites_an_official_source(database: Database) -> None:
    """The rule the whole repository rests on."""
    for entry in database.entries:
        assert entry.official_sources, f"{entry.slug} has no official source"


def test_every_entry_lists_a_weakness(database: Database) -> None:
    for entry in database.entries:
        assert entry.weaknesses, f"{entry.slug} lists no weaknesses"


def test_every_entry_records_who_checked_it_and_when(database: Database) -> None:
    for entry in database.entries:
        assert entry.verification.verified_fields
        assert entry.verification.last_verified <= TODAY


def test_no_category_is_empty(database: Database) -> None:
    for category in database.taxonomy.categories:
        assert database.by_category(category.id), f"{category.id} has no entries"


def test_every_category_has_a_recommended_or_open_weight_entry(database: Database) -> None:
    """A category whose only entries are 'budget' answers its question badly."""
    for category in database.taxonomy.categories:
        tiers = {
            placement.tier
            for entry in database.by_category(category.id)
            if (placement := entry.placement(category.id))
        }
        assert tiers & {"recommended", "open-weight", "specialized"}, (
            f"{category.id} has no recommended, specialized or open-weight entry"
        )


def test_slugs_are_unique(database: Database) -> None:
    slugs = [entry.slug for entry in database.entries]
    assert len(slugs) == len(set(slugs))


def test_alternatives_resolve(database: Database) -> None:
    known = {entry.slug for entry in database.entries}
    for entry in database.entries:
        for alternative in entry.alternatives:
            assert alternative in known, f"{entry.slug} -> {alternative}"


def test_recorded_prices_are_plausible(database: Database) -> None:
    """A price of zero for a hosted API, or a five-figure one, is a typo."""
    for entry in database.entries:
        pricing = entry.pricing
        if pricing is None or pricing.unit != "per_million_tokens":
            continue
        for value in (pricing.input_usd, pricing.output_usd):
            if value is None:
                continue
            assert 0 < value < 1000, f"{entry.slug}: implausible price {value}"


def test_output_is_never_cheaper_than_input(database: Database) -> None:
    """True of every hosted token API in this database, and a good typo detector."""
    for entry in database.entries:
        pricing = entry.pricing
        if pricing is None or pricing.input_usd is None or pricing.output_usd is None:
            continue
        assert pricing.output_usd >= pricing.input_usd, (
            f"{entry.slug}: output cheaper than input, which is almost certainly a swap"
        )


def test_context_windows_are_plausible(database: Database) -> None:
    for entry in database.entries:
        window = entry.context_window
        if window is None or window.input_tokens is None:
            continue
        assert 1000 <= window.input_tokens <= 20_000_000, f"{entry.slug}"
        if window.output_tokens is not None:
            assert window.output_tokens <= window.input_tokens, f"{entry.slug}"


def test_self_hosted_entries_have_downloadable_weights(database: Database) -> None:
    """`unit: self_hosted` is a claim about openness and has to match it."""
    for entry in database.entries:
        if entry.pricing and entry.pricing.unit == "self_hosted":
            assert entry.openness.is_downloadable, (
                f"{entry.slug} is priced as self-hosted but its weights are not downloadable"
            )


def test_open_weight_placements_match_the_openness_field(database: Database) -> None:
    for entry in database.entries:
        for placement in entry.categories:
            if placement.tier == "open-weight":
                assert entry.openness.is_downloadable, (
                    f"{entry.slug} is tiered open-weight in {placement.id} "
                    "but its weights are not downloadable"
                )


def test_evidence_ids_resolve(database: Database) -> None:
    for entry in database.entries:
        for placement in entry.categories:
            for reference in placement.evidence:
                assert entry.source(reference), f"{entry.slug}: no source {reference!r}"


def test_coverage_is_reported_honestly(database: Database) -> None:
    """Coverage may be low. It may not be silently wrong."""
    numbers = coverage(database)
    assert numbers["official_source"] == 1.0
    assert numbers["weaknesses"] == 1.0
    assert 0.0 <= numbers["pricing"] <= 1.0


def test_the_database_covers_more_than_one_provider(database: Database) -> None:
    """A catalogue with one vendor in it is a brochure."""
    assert len(database.providers) >= 5


def test_open_and_closed_options_both_exist(database: Database) -> None:
    downloadable = [e for e in database.entries if e.openness.is_downloadable]
    hosted = [e for e in database.entries if not e.openness.is_downloadable]
    assert len(downloadable) >= 5
    assert len(hosted) >= 5


@pytest.mark.parametrize(
    "question",
    [
        "what is best for coding",
        "what should I use for deep research",
        "best for mathematics",
        "which model for image generation",
        "what can I run locally",
        "what is good for long documents",
        "I need transcription",
        "something for building an agent",
    ],
)
def test_the_documented_questions_all_get_answers(database: Database, question: str) -> None:
    """Every question quoted in the README must actually return something."""
    from aimodeldb.recommend import answer

    result = answer(database, question)
    assert result is not None, f"no category matched {question!r}"
    assert not result.is_empty, f"{question!r} matched {result.category.id} but returned nothing"
