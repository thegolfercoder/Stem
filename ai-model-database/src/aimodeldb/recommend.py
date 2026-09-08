"""The recommendation layer.

The question this repository exists to answer is "which of these should I use
for X", and the honest answer is almost never one name. It is a short list with
the trade-offs attached, and a note about what would change the answer.

So `recommend` returns entries grouped by tier, never sorted into a single
ranking, and every group carries the tier's definition. `answer` maps a plain
question onto a category so that "what's good for long documents" and "which
model handles big PDFs" reach the same place.

There is no scoring function. A weighted sum over price, context window and a
benchmark number would produce a number that looks objective and encodes an
opinion about how much a dollar is worth against a token - an opinion nobody
asked for and nobody could check. Filtering on constraints and grouping by
evidence is what the data actually supports.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache

from aimodeldb.loader import Database
from aimodeldb.models import Category, Entry, Tier

#: Words that point at a category, matched at a word boundary with an open end
#: so that "image" catches "images" and "agent" catches "agentic".
#:
#: Scoring is by *how many* of a category's keywords appear, with the longest
#: single match as the tie-break. Longest-match alone was the first rule here
#: and it got "help me write code" wrong: "write" is longer than "code", so the
#: question went to the writing category. Counting matches fixes the general
#: case, and the bare verb "write" was dropped because it is genuinely
#: ambiguous - "write code", "write a test", "write a query" are all not about
#: prose.
KEYWORDS: dict[str, tuple[str, ...]] = {
    "coding": (
        "coding",
        "code",
        "programming",
        "software engineering",
        "refactor",
        "debug",
        "pull request",
        "developer",
        "swe",
        "unit test",
        "function",
        "bug",
        "script",
        "repository",
        "codebase",
        "compile",
    ),
    "mathematics": (
        "math",
        "maths",
        "mathematics",
        "algebra",
        "calculus",
        "proof",
        "theorem",
        "arithmetic",
        "olympiad",
    ),
    "research": (
        "deep research",
        "research",
        "literature review",
        "citations",
        "sources",
        "fact check",
        "investigate",
    ),
    "writing": (
        "writing",
        "essay",
        "prose",
        "copywriting",
        "editing",
        "draft",
        "blog",
        "article",
        "manuscript",
    ),
    "image-generation": (
        "image generation",
        "generate images",
        "image",
        "picture",
        "illustration",
        "logo",
        "photo",
        "artwork",
    ),
    "video-generation": ("video generation", "video", "film", "animation", "clip"),
    "audio-generation": (
        "text to speech",
        "tts",
        "voice",
        "speech generation",
        "narration",
        "music",
        "audio",
        "sound",
    ),
    "speech-to-text": (
        "speech to text",
        "stt",
        "transcription",
        "transcribe",
        "subtitles",
        "captions",
        "dictation",
    ),
    "data-analysis": (
        "data analysis",
        "analyse data",
        "analyze data",
        "spreadsheet",
        "csv",
        "statistics",
        "chart",
    ),
    "vision": (
        "vision",
        "read images",
        "screenshot",
        "ocr",
        "document understanding",
        "scanned",
        "diagram",
    ),
    "agentic": (
        "agent",
        "agentic",
        "tool use",
        "automation",
        "workflow",
        "browser use",
        "computer use",
        "mcp",
    ),
    "long-context": (
        "long context",
        "long document",
        "long documents",
        "large context",
        "whole codebase",
        "big pdf",
        "entire book",
    ),
    "local": (
        "locally",
        "local",
        "on my own hardware",
        "self host",
        "self-hosted",
        "offline",
        "on device",
        "own machine",
        "private",
    ),
    "education": (
        "learn",
        "learning",
        "teaching",
        "teach",
        "tutor",
        "study",
        "student",
        "revision",
        "explain",
    ),
    "productivity": (
        "productivity",
        "notes",
        "meeting",
        "summarise",
        "summarize",
        "email",
        "organise",
        "organize",
    ),
    "embeddings": ("embedding", "embeddings", "rag", "semantic search", "vector"),
    "general-reasoning": (
        "reasoning",
        "thinking",
        "general",
        "everything",
        "assistant",
        "chat",
        "hard problems",
    ),
}

#: Phrases in a question that are constraints rather than categories.
_OPEN_WEIGHTS = re.compile(
    r"\b(open[- ]?(?:weight|weights|source)|self[- ]host|locally|on my own hardware|offline)\b",
    re.IGNORECASE,
)
_CHEAP = re.compile(r"\b(cheap|cheapest|budget|low[- ]cost|inexpensive|free)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Constraints:
    """What the caller can and cannot accept, independent of capability."""

    open_weights_only: bool = False
    api_required: bool = False
    max_input_price: float | None = None
    min_context_tokens: int | None = None
    provider: str | None = None
    kind: str | None = None
    modality_in: str | None = None
    modality_out: str | None = None
    include_deprecated: bool = False

    def accepts(self, entry: Entry) -> bool:
        if not self.include_deprecated and entry.status in {"deprecated", "retired"}:
            return False
        if self.open_weights_only and not entry.openness.is_downloadable:
            return False
        if self.api_required and not entry.api.available:
            return False
        if self.provider and self.provider.lower() not in entry.provider.lower():
            return False
        if self.kind and entry.kind != self.kind:
            return False
        if self.modality_in and not entry.accepts(self.modality_in):
            return False
        if self.modality_out and not entry.produces(self.modality_out):
            return False
        if self.max_input_price is not None:
            price = entry.input_price
            # An entry with no recorded token price is excluded by a price
            # filter rather than assumed free. Silence is not zero.
            if price is None or price > self.max_input_price:
                return False
        if self.min_context_tokens is not None:
            window = entry.context_window
            if window is None or window.input_tokens is None:
                return False
            if window.input_tokens < self.min_context_tokens:
                return False
        return True

    @classmethod
    def from_question(cls, question: str) -> Constraints:
        """Read the constraints a plain question implies."""
        return cls(
            open_weights_only=bool(_OPEN_WEIGHTS.search(question)),
            max_input_price=1.0 if _CHEAP.search(question) else None,
        )


@dataclass(frozen=True)
class Group:
    """One tier's worth of answers, with the tier's own definition attached."""

    tier: Tier
    entries: tuple[Entry, ...]


@dataclass(frozen=True)
class Recommendation:
    """The answer to one question."""

    category: Category
    groups: tuple[Group, ...]
    constraints: Constraints
    excluded: int

    @property
    def is_empty(self) -> bool:
        return not any(group.entries for group in self.groups)

    @property
    def total(self) -> int:
        return sum(len(group.entries) for group in self.groups)


@cache
def _patterns() -> dict[str, tuple[tuple[re.Pattern[str], str], ...]]:
    """Keyword regexes, compiled once.

    A leading word boundary and an open end: "image" matches "images", "agent"
    matches "agentic", and neither matches inside an unrelated word the way a
    plain substring search would.
    """
    return {
        category_id: tuple(
            (re.compile(r"\b" + re.escape(word), re.IGNORECASE), word) for word in words
        )
        for category_id, words in KEYWORDS.items()
    }


def match_category(question: str, database: Database) -> Category | None:
    """Map a plain question onto a category.

    An exact category id or label wins outright. Otherwise the category with the
    most matching keywords wins, with the longest single match breaking a tie -
    so "long context" beats "context" and a two-word phrase beats a one-word
    one, without a bare verb in one category outranking a precise noun in
    another. Returns None rather than guessing when nothing matches.
    """
    text = question.strip().lower()
    if not text:
        return None

    for category in database.taxonomy.categories:
        if text in {category.id, category.label.lower()}:
            return category

    best: tuple[int, int, str] | None = None
    for category_id, patterns in _patterns().items():
        hits = [word for pattern, word in patterns if pattern.search(text)]
        if not hits:
            continue
        score = (len(hits), max(len(word) for word in hits), category_id)
        if best is None or score[:2] > best[:2]:
            best = score
    if best is None:
        return None
    return database.taxonomy.category(best[2])


def recommend(
    database: Database,
    category_id: str,
    constraints: Constraints | None = None,
) -> Recommendation:
    """Everything in a category that meets the constraints, grouped by tier."""
    category = database.taxonomy.category(category_id)
    if category is None:
        raise KeyError(f"unknown category {category_id!r}; try `aimodeldb categories`")
    constraints = constraints or Constraints()

    candidates = database.by_category(category_id)
    kept = tuple(entry for entry in candidates if constraints.accepts(entry))

    groups = []
    for tier in database.taxonomy.tiers:
        in_tier = tuple(
            entry
            for entry in kept
            if (placement := entry.placement(category_id)) and placement.tier == tier.id
        )
        if in_tier:
            groups.append(Group(tier=tier, entries=in_tier))

    return Recommendation(
        category=category,
        groups=tuple(groups),
        constraints=constraints,
        excluded=len(candidates) - len(kept),
    )


def answer(database: Database, question: str) -> Recommendation | None:
    """Answer a plain question, reading both its category and its constraints."""
    category = match_category(question, database)
    if category is None:
        return None
    return recommend(database, category.id, Constraints.from_question(question))


def search(
    database: Database, text: str = "", constraints: Constraints | None = None
) -> tuple[Entry, ...]:
    """Free-text search over names, summaries, use cases and strengths."""
    constraints = constraints or Constraints()
    needle = text.strip().lower()

    def matches(entry: Entry) -> bool:
        if not needle:
            return True
        haystack = " ".join(
            [
                entry.name,
                entry.slug,
                entry.provider,
                entry.summary,
                entry.model_id or "",
                *entry.use_cases,
                *entry.strengths,
            ]
        ).lower()
        return needle in haystack

    return tuple(
        sorted(
            (e for e in database.entries if matches(e) and constraints.accepts(e)),
            key=lambda e: (e.provider.lower(), e.name.lower()),
        )
    )


def compare(database: Database, slugs: list[str]) -> tuple[Entry, ...]:
    """Fetch several entries by slug, in the order asked for."""
    entries = []
    for slug in slugs:
        entry = database.get(slug)
        if entry is None:
            raise KeyError(f"unknown entry {slug!r}")
        entries.append(entry)
    return tuple(entries)
