"""The recommendation layer: question matching, constraints and grouping."""

from __future__ import annotations

from datetime import date

import pytest

from aimodeldb.freshness import assess, issue_body, stale
from aimodeldb.loader import Database
from aimodeldb.recommend import Constraints, answer, compare, match_category, recommend, search

TODAY = date(2026, 9, 8)


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("what is best for coding", "coding"),
        ("help me write code", "coding"),
        ("best for deep research", "research"),
        ("what is best for mathematics", "mathematics"),
        ("what is best for image generation", "image-generation"),
        ("what is best for running locally", "local"),
        ("what is best for long documents", "long-context"),
        ("I need to transcribe an interview", "speech-to-text"),
        ("something for text to speech", "audio-generation"),
        ("which model for embeddings and rag", "embeddings"),
        ("building an agent with tool use", "agentic"),
        ("reading screenshots", "vision"),
        ("coding", "coding"),
        ("Long context", "long-context"),
    ],
)
def test_questions_map_to_the_right_category(
    database: Database, question: str, expected: str
) -> None:
    category = match_category(question, database)
    assert category is not None
    assert category.id == expected


def test_longer_keywords_win(database: Database) -> None:
    """'long context' must not be swallowed by 'context', nor 'speech to text' by 'speech'."""
    assert match_category("long context work", database).id == "long-context"  # type: ignore[union-attr]
    assert match_category("speech to text please", database).id == "speech-to-text"  # type: ignore[union-attr]


def test_a_precise_noun_beats_a_longer_ambiguous_verb(database: Database) -> None:
    """The regression this matcher was rewritten for.

    Under longest-match, "write" (5 letters) outranked "code" (4) and sent
    "help me write code" to the writing category.
    """
    assert match_category("help me write code", database).id == "coding"  # type: ignore[union-attr]
    assert match_category("write a test for this function", database).id == "coding"  # type: ignore[union-attr]
    assert match_category("help me draft an essay", database).id == "writing"  # type: ignore[union-attr]


def test_keywords_match_at_word_boundaries(database: Database) -> None:
    """A substring search would match "image" inside "scrimmage"."""
    assert match_category("scrimmage tactics", database) is None


def test_an_unmatchable_question_returns_nothing_rather_than_guessing(
    database: Database,
) -> None:
    assert match_category("what is the airspeed velocity of a swallow", database) is None
    assert answer(database, "zzzzz") is None


def test_a_question_about_local_running_sets_the_open_weights_constraint(
    database: Database,
) -> None:
    result = answer(database, "what can I run locally on my own hardware")
    assert result is not None
    assert result.constraints.open_weights_only
    for group in result.groups:
        for entry in group.entries:
            assert entry.openness.is_downloadable


def test_a_question_about_cheap_options_sets_a_price_ceiling(database: Database) -> None:
    result = answer(database, "what is the cheapest model for coding")
    assert result is not None
    assert result.constraints.max_input_price == 1.0


def test_recommendations_are_grouped_by_tier_not_ranked(database: Database) -> None:
    result = recommend(database, "coding")
    assert result.groups
    for group in result.groups:
        assert group.tier.definition.strip()
        names = [entry.name.lower() for entry in group.entries]
        assert names == sorted(names), "entries inside a tier must be alphabetical, not ranked"


def test_tiers_appear_in_taxonomy_order(database: Database) -> None:
    result = recommend(database, "local")
    order = [database.taxonomy.tier_order(group.tier.id) for group in result.groups]
    assert order == sorted(order)


def test_an_unknown_category_raises_with_a_useful_message(database: Database) -> None:
    with pytest.raises(KeyError, match="aimodeldb categories"):
        recommend(database, "telepathy")


def test_constraints_filter_on_open_weights(database: Database) -> None:
    results = search(database, "", Constraints(open_weights_only=True))
    assert results
    assert all(entry.openness.is_downloadable for entry in results)


def test_constraints_filter_on_price(database: Database) -> None:
    results = search(database, "", Constraints(max_input_price=1.0))
    assert results
    for entry in results:
        assert entry.input_price is not None
        assert entry.input_price <= 1.0


def test_an_unpriced_entry_is_excluded_by_a_price_filter_not_assumed_free(
    database: Database,
) -> None:
    """Silence is not zero. An entry with no recorded price cannot satisfy a budget."""
    unpriced = [e for e in database.entries if e.input_price is None]
    assert unpriced, "the fixture assumption no longer holds"
    results = search(database, "", Constraints(max_input_price=1000.0))
    assert all(entry.input_price is not None for entry in results)


def test_constraints_filter_on_context_window(database: Database) -> None:
    results = search(database, "", Constraints(min_context_tokens=1_000_000))
    assert results
    for entry in results:
        assert entry.context_window is not None
        assert entry.context_window.input_tokens is not None
        assert entry.context_window.input_tokens >= 1_000_000


def test_constraints_filter_on_modality(database: Database) -> None:
    results = search(database, "", Constraints(modality_out="image"))
    assert results
    assert all(entry.produces("image") for entry in results)


def test_constraints_filter_on_kind_and_provider(database: Database) -> None:
    runtimes = search(database, "", Constraints(kind="runtime"))
    assert runtimes
    assert all(entry.kind == "runtime" for entry in runtimes)

    anthropic = search(database, "", Constraints(provider="anthropic"))
    assert anthropic
    assert all("anthropic" in entry.provider.lower() for entry in anthropic)


def test_deprecated_entries_are_hidden_unless_asked_for(database: Database) -> None:
    default = search(database, "")
    assert all(entry.status not in {"deprecated", "retired"} for entry in default)


def test_free_text_search_covers_summaries_and_model_ids(database: Database) -> None:
    assert search(database, "apache")
    assert search(database, "claude-opus-5")


def test_an_over_constrained_question_says_so_rather_than_returning_junk(
    database: Database,
) -> None:
    result = recommend(
        database, "coding", Constraints(open_weights_only=True, max_input_price=0.0001)
    )
    assert result.is_empty
    assert result.excluded > 0


def test_compare_returns_entries_in_the_order_asked_for(database: Database) -> None:
    entries = compare(database, ["claude-opus-5", "gpt-6-astra"])
    assert [entry.slug for entry in entries] == ["claude-opus-5", "gpt-6-astra"]
    with pytest.raises(KeyError):
        compare(database, ["not-a-model"])


def test_staleness_uses_the_policy_from_the_taxonomy(database: Database) -> None:
    fresh = assess(database, today=date(2026, 9, 8))
    assert all(item.level == "fresh" for item in fresh)

    later = assess(database, today=date(2027, 1, 15))
    assert all(item.level == "due" for item in later)

    much_later = assess(database, today=date(2028, 1, 15))
    assert all(item.level == "overdue" for item in much_later)


def test_staleness_is_ordered_oldest_first(database: Database) -> None:
    items = assess(database, today=date(2027, 6, 1))
    ages = [item.age_days for item in items]
    assert ages == sorted(ages, reverse=True)


def test_the_issue_body_names_the_stale_entries(database: Database) -> None:
    body = issue_body(stale(database, today=date(2027, 1, 15)), today=date(2027, 1, 15))
    assert "claude-opus-5" in body
    assert "last verified" in body
    assert "Bumping the date without opening the source" in body


def test_the_issue_body_says_so_when_nothing_is_stale(database: Database) -> None:
    body = issue_body(stale(database, today=TODAY), today=TODAY)
    assert "Nothing to do" in body


def test_a_one_sided_price_renders_without_crashing(database: Database) -> None:
    """An embedding model has an input price and no output price."""
    from aimodeldb.models import Pricing

    one_sided = Pricing(unit="per_million_tokens", source="x", input_usd=0.2)
    assert one_sided.headline() == "$0.2 per 1M input tokens"
    assert Pricing(unit="per_million_tokens", source="x").headline().endswith("not recorded")
    assert Pricing(unit="self_hosted", source="x").headline() == "self-hosted (your hardware)"
    assert Pricing(unit="free", source="x").headline() == "free"

    for entry in database.entries:
        if entry.pricing is not None:
            assert entry.pricing.headline()
