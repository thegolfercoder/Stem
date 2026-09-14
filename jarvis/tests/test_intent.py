"""Intent detection.

What this is allowed to get wrong matters as much as what it gets right: a miss
falls through to `ASK`, which costs a little retrieval quality and never a lost
memory. So these tests check the common phrasings work and, just as important,
that ordinary questions are not mistaken for instructions.
"""

from __future__ import annotations

import pytest
from jarvis.intent import Intent, IntentKind, detect, directive


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("Remember that I prefer concise answers.", IntentKind.REMEMBER),
        ("remember I want to study economics tomorrow", IntentKind.REMEMBER),
        ("Keep in mind: my chemistry teacher is Mr Adams", IntentKind.REMEMBER),
        ("Don't forget that my mocks start on the third", IntentKind.REMEMBER),
        ("Make a note that I revise after dinner", IntentKind.REMEMBER),
        ("Forget that I was working on project X", IntentKind.FORGET),
        ("delete what you know about my old school", IntentKind.FORGET),
        ("Update my preferred programming language to Python", IntentKind.UPDATE),
        ("change my target grade to an A*", IntentKind.UPDATE),
        ("What do you remember about my math goals?", IntentKind.RECALL),
        ("do you know anything about my revision schedule", IntentKind.RECALL),
        ("Help me plan my maths study session", IntentKind.ASK),
        ("What are my economics goals?", IntentKind.ASK),
        ("What is the capital of France?", IntentKind.ASK),
        ("", IntentKind.ASK),
    ],
)
def test_intent_of_realistic_messages(message: str, expected: IntentKind) -> None:
    assert detect(message).kind is expected


def test_the_subject_is_the_part_worth_searching_for() -> None:
    """ "remember that" is the instruction; the rest is the fact."""
    assert detect("Remember that I prefer concise answers").subject == "I prefer concise answers"
    assert detect("What do you remember about my math goals?").subject == "my math goals"
    assert detect("Forget that I was working on project X").subject == "I was working on project X"


def test_a_trigger_word_with_nothing_after_it_is_not_an_instruction() -> None:
    """ "remember" on its own is someone asking what you remember, not an
    instruction to store the empty string."""
    assert detect("remember").kind is IntentKind.ASK
    assert detect("remember?").kind is IntentKind.ASK


def test_categories_are_guessed_from_the_words_used() -> None:
    assert "subjects" in detect("help me with my chemistry revision").categories
    assert "goals" in detect("what is my target grade in economics").categories
    assert "preferences" in detect("I prefer short answers").categories
    assert detect("what is the capital of France").categories == ()


def test_only_memory_intents_are_flagged_as_touching_memory() -> None:
    assert detect("Remember that I like tea").touches_memory is True
    assert detect("Forget my old address").touches_memory is True
    assert detect("Update my grade to an A").touches_memory is True
    # Asking what is remembered does not change anything.
    assert detect("What do you remember about me?").touches_memory is False
    assert detect("What is 2 + 2?").touches_memory is False


def test_directives_name_the_tool_the_model_should_use() -> None:
    assert "save_memory" in directive(detect("Remember that I like tea"))
    assert "delete_memory" in directive(detect("Forget my old address"))
    assert "update_memory" in directive(detect("Update my grade to an A"))
    assert "search_memory" in directive(detect("What do you remember about me?"))


def test_an_ordinary_question_gets_no_directive() -> None:
    assert directive(detect("What is the capital of France?")) == ""
    assert directive(Intent(kind=IntentKind.ASK)) == ""


def test_detection_never_raises_on_odd_input() -> None:
    for message in ("?!", "🙂", "a" * 5_000, "REMEMBER THAT I SHOUT", "forget"):
        assert detect(message).kind in set(IntentKind)
