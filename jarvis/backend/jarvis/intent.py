"""Working out what a message is asking for, locally and before anything is sent.

"Remember that I prefer short answers" should reliably produce a memory. There
are two ways to get there: parse it here and write the row ourselves, or notice
it here and make sure the model has the tool and the instruction to do it.

This takes the second. Parsing English with regular expressions is a losing
game past the first dozen phrasings - "don't let me forget", "keep in mind",
"note for later", "actually, scratch that" - and the failure mode is silent:
the pattern misses, nothing is saved, and the user finds out weeks later. What
this module is reliably good at is the cheap, useful half: noticing which
*kind* of thing is being asked so retrieval can look in the right place and the
system prompt can say "you have a tool for this". The model, which is good at
the part regular expressions are bad at, does the rest.

So a miss here costs a little retrieval quality, never a lost memory.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class IntentKind(StrEnum):
    REMEMBER = "remember"
    FORGET = "forget"
    UPDATE = "update"
    RECALL = "recall"
    ASK = "ask"


@dataclass(frozen=True)
class Intent:
    kind: IntentKind
    # The part after the trigger phrase, when there is one: the subject of
    # "remember that ___". Used to search with, not to store.
    subject: str = ""
    # Categories worth searching first, from words in the message.
    categories: tuple[str, ...] = ()

    @property
    def touches_memory(self) -> bool:
        """Whether this message is about JARVIS's memory rather than merely
        answerable from it."""
        return self.kind in (IntentKind.REMEMBER, IntentKind.FORGET, IntentKind.UPDATE)


# Ordered: the first pattern that matches wins, so the more specific phrasings
# come first. Each captures the subject as group 1 where there is one.
_PATTERNS: tuple[tuple[IntentKind, re.Pattern[str]], ...] = (
    (
        IntentKind.FORGET,
        re.compile(
            r"^\s*(?:please\s+)?(?:forget|delete|remove|drop)\b"
            r"(?:\s+(?:that|about|the|my|any|all))?\s*(?P<subject>.*)$",
            re.IGNORECASE,
        ),
    ),
    (
        IntentKind.FORGET,
        re.compile(
            r"\b(?:stop remembering|no longer (?:true|the case)|that'?s? wrong)\b.*", re.IGNORECASE
        ),
    ),
    (
        IntentKind.UPDATE,
        re.compile(
            r"^\s*(?:please\s+)?(?:update|change|correct|revise)\b"
            r"(?:\s+(?:that|my|the))?\s*(?P<subject>.*)$",
            re.IGNORECASE,
        ),
    ),
    (
        IntentKind.RECALL,
        re.compile(
            r"\b(?:what do you (?:remember|know)|do you (?:remember|know)|"
            r"what have i told you|what did i tell you)\b"
            r"(?:\s+about)?\s*(?P<subject>.*)$",
            re.IGNORECASE,
        ),
    ),
    (
        IntentKind.REMEMBER,
        re.compile(
            r"\b(?:remember|note|make a note|keep in mind|don'?t forget|bear in mind|"
            r"save (?:this|that)|for future reference)\b"
            r"(?:\s+(?:that|this|the|it))?[:,]?\s*(?P<subject>.*)$",
            re.IGNORECASE,
        ),
    ),
)

# Words that suggest where to look. Not exhaustive and does not need to be: it
# reorders a search that would have run anyway.
_CATEGORY_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "subjects",
        (
            "maths",
            "math",
            "mathematics",
            "chemistry",
            "physics",
            "biology",
            "economics",
            "history",
            "geography",
            "english",
            "french",
            "spanish",
            "computer science",
            "additional mathematics",
            "igcse",
            "a-level",
        ),
    ),
    (
        "school",
        (
            "school",
            "class",
            "lesson",
            "teacher",
            "exam",
            "test",
            "homework",
            "assignment",
            "revision",
            "study",
            "syllabus",
            "grade",
            "coursework",
        ),
    ),
    ("goals", ("goal", "target", "aim", "ambition", "grade i want", "aiming")),
    ("projects", ("project", "building", "repo", "repository", "codebase", "app")),
    ("preferences", ("prefer", "preference", "like", "dislike", "rather", "style")),
    (
        "people",
        (
            "friend",
            "teacher",
            "mum",
            "mother",
            "dad",
            "father",
            "brother",
            "sister",
            "tutor",
            "classmate",
        ),
    ),
    (
        "routines",
        ("routine", "schedule", "every day", "daily", "weekly", "habit", "morning", "evening"),
    ),
    ("instructions", ("always", "never", "from now on", "going forward", "rule")),
    ("personal", ("my name", "i am", "i'm", "birthday", "live in", "age")),
)


def detect(message: str) -> Intent:
    """Classify one user message. Never raises; unknown is `ASK`."""
    text = (message or "").strip()
    if not text:
        return Intent(kind=IntentKind.ASK)

    categories = _categories(text)

    for kind, pattern in _PATTERNS:
        match = pattern.search(text)
        if match is None:
            continue
        subject = ""
        if "subject" in (match.groupdict() or {}):
            subject = (match.group("subject") or "").strip(" .?!,:;")
        # "remember" with nothing after it is a question about memory, not an
        # instruction to store the empty string.
        if kind in (IntentKind.REMEMBER, IntentKind.UPDATE) and not subject:
            continue
        return Intent(kind=kind, subject=subject, categories=categories)

    return Intent(kind=IntentKind.ASK, subject=text, categories=categories)


def _categories(text: str) -> tuple[str, ...]:
    lowered = text.lower()
    found = [
        category for category, words in _CATEGORY_WORDS if any(word in lowered for word in words)
    ]
    return tuple(dict.fromkeys(found))


# What the model is told when the message is about memory. Kept here next to the
# detection so the two cannot drift apart.
_DIRECTIVES: dict[IntentKind, str] = {
    IntentKind.REMEMBER: (
        "The user appears to be asking you to remember something. Call save_memory "
        "with the fact stated plainly in the third person, and confirm briefly what "
        "you stored. Do not store a memory they did not ask for."
    ),
    IntentKind.FORGET: (
        "The user appears to be asking you to forget something. Call search_memory "
        "to find the matching memory, then delete_memory with its id, and say which "
        "one you removed. If nothing matches, say so rather than deleting the "
        "nearest thing."
    ),
    IntentKind.UPDATE: (
        "The user appears to be correcting something you know. Call search_memory to "
        "find it, then update_memory with its id. Do not create a second memory that "
        "contradicts the first."
    ),
    IntentKind.RECALL: (
        "The user is asking what you remember. Answer from the context below and "
        "from search_memory. If you have nothing on the subject, say so plainly - do "
        "not invent a memory."
    ),
}


def directive(intent: Intent) -> str:
    """The instruction added to the system prompt for this intent, if any."""
    return _DIRECTIVES.get(intent.kind, "")
