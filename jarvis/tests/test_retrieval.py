"""The ranking function, and the embedding seam beside it."""

from __future__ import annotations

from jarvis import embeddings
from jarvis.retrieval import Candidate, Scored, excerpt, like_patterns, rank, tokenize


def test_tokenizing_drops_noise_and_folds_plurals() -> None:
    assert tokenize("What are my Economics goals for the classes?") == [
        "economic",
        "goal",
        "class",
    ]
    assert tokenize("") == []
    assert tokenize("the and of") == [], "a sentence of stopwords carries no query"


def test_plural_folding_does_not_mangle_short_or_double_s_words() -> None:
    # "gas" is short enough to be left alone, "class" ends in a double s, and
    # only "physics" is actually a plural to fold. Getting any of these wrong
    # silently breaks matching for a whole subject.
    assert tokenize("gas class physics") == ["gas", "class", "physic"]
    assert tokenize("notes classes studies") == ["note", "class", "study"]


def test_the_best_match_comes_first() -> None:
    candidates = [
        Candidate("goal", "My economics goal is an A* in the mock exam"),
        Candidate("note", "Economics revision: supply and demand"),
        Candidate("other", "The chemistry exam is on the third of October"),
    ]
    ranked = rank("what are my economics goals?", candidates)
    assert [item.key for item in ranked][:2] == ["goal", "note"]


def test_things_that_match_nothing_are_dropped_rather_than_ranked_last() -> None:
    """Padding a context with the least-bad match is how an assistant answers
    confidently from something irrelevant."""
    ranked = rank("quantum tunnelling", [Candidate("a", "my economics goal")])
    assert ranked == []


def test_an_empty_query_ranks_nothing() -> None:
    assert rank("", [Candidate("a", "text")]) == []
    assert rank("the of and", [Candidate("a", "text")]) == []


def test_boost_lifts_a_weaker_textual_match() -> None:
    plain = Candidate("plain", "economics")
    important = Candidate("important", "economics", boost=4.0)
    ranked = rank("economics", [plain, important])
    assert ranked[0].key == "important"


def test_matched_terms_are_reported() -> None:
    ranked = rank("economics goals", [Candidate("a", "my economics goal")])
    assert ranked[0].matched == ("economic", "goal")


def test_a_rare_word_counts_for_more_than_a_common_one() -> None:
    """Ten notes mention revision; one mentions elasticity. A question about
    both should find the one."""
    candidates = [Candidate(f"c{i}", "revision notes for the exam") for i in range(10)]
    candidates.append(Candidate("rare", "revision notes on elasticity"))
    ranked = rank("revision elasticity", candidates)
    assert ranked[0].key == "rare"


def test_the_limit_is_respected() -> None:
    candidates = [Candidate(i, "economics revision") for i in range(50)]
    assert len(rank("economics", candidates, limit=5)) == 5


def test_like_patterns_are_substrings_of_the_stemmed_terms() -> None:
    assert like_patterns("Economics goals") == ["%economic%", "%goal%"]
    assert like_patterns("   ") == []


def test_excerpt_centres_on_the_match() -> None:
    text = "a" * 400 + " the activation energy is the minimum " + "b" * 400
    shown = excerpt(text, "activation", width=120)
    assert "activation energy" in shown
    assert len(shown) < 200
    assert shown.startswith("...")


def test_excerpt_returns_short_text_untouched() -> None:
    assert excerpt("a short note", "note") == "a short note"


# --- the embedding seam ------------------------------------------------------


def test_no_embedder_is_configured_by_default() -> None:
    """Phase 2 ships the interface, not a second service seeing every note."""
    assert embeddings.is_available() is False
    assert embeddings.get_embedder().name == "none"
    assert embeddings.get_embedder().embed(["a", "b"]) == [[], []]


def test_cosine_is_safe_on_empty_and_mismatched_vectors() -> None:
    assert embeddings.cosine([], []) == 0.0
    assert embeddings.cosine([1.0, 0.0], [1.0]) == 0.0
    assert embeddings.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert embeddings.cosine([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert round(embeddings.cosine([1.0, 0.0], [0.0, 1.0]), 6) == 0.0


def test_blending_without_semantic_results_changes_nothing() -> None:
    keyword = [Scored("a", 2.0), Scored("b", 1.0)]
    assert embeddings.blend(keyword, []) == keyword


def test_blending_combines_both_rankings() -> None:
    keyword = [Scored("a", 2.0), Scored("b", 1.0)]
    semantic = [Scored("b", 1.0), Scored("c", 0.5)]
    blended = embeddings.blend(keyword, semantic, keyword_weight=0.5)
    keys = [item.key for item in blended]
    assert set(keys) == {"a", "b", "c"}
    # b is the one both agree on, so it should not come last.
    assert keys.index("b") < keys.index("c")


def test_an_installed_embedder_is_visible_to_callers() -> None:
    """The whole of what adding embeddings later requires."""

    class Fake:
        name = "fake"
        dimensions = 3

        def embed(self, texts):  # type: ignore[no-untyped-def]
            return [[1.0, 0.0, 0.0] for _ in texts]

    original = embeddings.get_embedder()
    try:
        embeddings.set_embedder(Fake())
        assert embeddings.is_available() is True
        assert embeddings.get_embedder().embed(["x"]) == [[1.0, 0.0, 0.0]]
    finally:
        embeddings.set_embedder(original)
    assert embeddings.is_available() is False
