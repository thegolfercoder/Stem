"""Memory: the durable things JARVIS knows about its owner.

Imported as `from jarvis.services import memory`, which makes the call sites
read `memory.save(...)`, `memory.search(...)`, `memory.update(...)`,
`memory.delete(...)`, `memory.list_all(...)`.

Two rules are enforced here rather than left to the model's good behaviour.
Nothing is saved that was not asked for - there is no path from "a conversation
happened" to "a row was written", only from a tool call or the memory page. And
every read is scoped to a user id the caller supplies, never one that arrived in
an argument from the model.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from jarvis import retrieval
from jarvis.db import deleted_rows
from jarvis.models import MEMORY_CATEGORIES, MEMORY_SOURCES, Memory, utcnow

DEFAULT_CATEGORY = "important_facts"
DEFAULT_IMPORTANCE = 3
MAX_CONTENT_CHARS = 1_000
# How many rows the ranking may consider. A personal database will not come
# close; the cap is here so a pathological query cannot load the table.
MAX_CANDIDATES = 400


class MemoryValidationError(ValueError):
    """A memory could not be saved or changed, with a sentence saying why."""


@dataclass(frozen=True)
class ScoredMemory:
    memory: Memory
    score: float
    matched: tuple[str, ...] = ()


def normalise_category(category: str | None) -> str:
    value = (category or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not value:
        return DEFAULT_CATEGORY
    if value not in MEMORY_CATEGORIES:
        raise MemoryValidationError(
            f"{category!r} is not a memory category. Use one of: {', '.join(MEMORY_CATEGORIES)}."
        )
    return value


def normalise_tags(tags: Sequence[str] | str | None) -> str:
    """Tags as stored: lowercase, comma separated, de-duplicated, no blanks."""
    if tags is None:
        return ""
    raw = tags.split(",") if isinstance(tags, str) else list(tags)
    cleaned = []
    for tag in raw:
        slug = re.sub(r"[^a-z0-9_-]+", "-", str(tag).strip().lower()).strip("-")
        if slug and slug not in cleaned:
            cleaned.append(slug)
    return ",".join(cleaned[:12])[:256]


def _normalised_content(content: str) -> str:
    return " ".join(content.lower().split())


def save(
    session: Session,
    *,
    user_id: int,
    content: str,
    category: str | None = None,
    importance: int = DEFAULT_IMPORTANCE,
    source: str = "user",
    tags: Sequence[str] | str | None = None,
) -> Memory:
    """Store one fact.

    Saving something already known updates that row instead of adding a second
    copy - otherwise a model that helpfully re-saves a preference every session
    fills the retrieval budget with ten identical sentences.
    """
    content = " ".join((content or "").split())
    if not content:
        raise MemoryValidationError("A memory needs some content.")
    if len(content) > MAX_CONTENT_CHARS:
        raise MemoryValidationError(
            f"That is {len(content)} characters; a memory should be a sentence or two "
            f"(limit {MAX_CONTENT_CHARS}). Add it as a document instead."
        )
    if source not in MEMORY_SOURCES:
        source = "user"
    try:
        importance = max(1, min(int(importance), 5))
    except (TypeError, ValueError):
        importance = DEFAULT_IMPORTANCE

    resolved_category = normalise_category(category)
    resolved_tags = normalise_tags(tags)

    existing = _find_duplicate(session, user_id=user_id, content=content)
    if existing is not None:
        existing.category = resolved_category
        existing.importance = max(existing.importance, importance)
        if resolved_tags:
            existing.tags = normalise_tags(f"{existing.tags},{resolved_tags}")
        existing.updated_at = utcnow().replace(tzinfo=None)
        session.flush()
        return existing

    memory = Memory(
        user_id=user_id,
        category=resolved_category,
        content=content,
        importance=importance,
        source=source,
        tags=resolved_tags,
    )
    session.add(memory)
    session.flush()
    return memory


def _find_duplicate(session: Session, *, user_id: int, content: str) -> Memory | None:
    target = _normalised_content(content)
    rows = session.execute(select(Memory).where(Memory.user_id == user_id)).scalars()
    for row in rows:
        if _normalised_content(row.content) == target:
            return row
    return None


def get(session: Session, *, user_id: int, memory_id: int) -> Memory | None:
    """By id and owner, always. The model supplies ids; it does not supply whose."""
    return session.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    ).scalar_one_or_none()


def list_all(
    session: Session,
    *,
    user_id: int,
    category: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[Memory]:
    statement = select(Memory).where(Memory.user_id == user_id)
    if category:
        statement = statement.where(Memory.category == normalise_category(category))
    statement = (
        statement.order_by(Memory.importance.desc(), Memory.updated_at.desc())
        .limit(max(1, min(limit, 500)))
        .offset(max(0, offset))
    )
    return list(session.execute(statement).scalars())


def count(session: Session, *, user_id: int) -> int:
    return len(list(session.execute(select(Memory.id).where(Memory.user_id == user_id)).scalars()))


def search(
    session: Session,
    *,
    user_id: int,
    query: str,
    limit: int = 8,
    categories: Sequence[str] = (),
    boost_categories: Sequence[str] = (),
) -> list[ScoredMemory]:
    """The memories relevant to `query`, best first.

    Narrow in SQL, rank in Python. Importance and a category hint from intent
    detection tilt the ranking; neither can promote something that did not match
    the words at all, which is what keeps an unrelated memory out of a request.
    """
    terms = retrieval.like_patterns(query)
    if not terms:
        return []

    statement = select(Memory).where(Memory.user_id == user_id)
    if categories:
        statement = statement.where(
            Memory.category.in_([normalise_category(c) for c in categories])
        )
    # Tags are matched here as well as in the ranking below. They are searchable
    # without being visible, so a memory tagged "igcse" answers a question that
    # says IGCSE even when the sentence never does - but only if the prefilter
    # loads the row in the first place.
    conditions = []
    for term in terms:
        bare = term.strip("%")
        conditions.append(Memory.content.icontains(bare))
        conditions.append(Memory.tags.icontains(bare))
    statement = statement.where(or_(*conditions)).limit(MAX_CANDIDATES)

    rows = list(session.execute(statement).scalars())
    if not rows:
        return []

    hinted = {c for c in boost_categories}
    candidates = [
        retrieval.Candidate(
            key=row.id,
            # Tags are searchable without being shown: a memory tagged
            # "igcse" should answer a question that says "IGCSE".
            text=f"{row.content} {row.tags.replace(',', ' ')}",
            boost=_boost(row, hinted),
        )
        for row in rows
    ]
    # Keyed by `object` because `Scored.key` is: the ranker is deliberately
    # ignorant of rows, and this is where that generality is paid for.
    by_id: dict[object, Memory] = {row.id: row for row in rows}
    return [
        ScoredMemory(memory=by_id[scored.key], score=scored.score, matched=scored.matched)
        for scored in retrieval.rank(query, candidates, limit=limit)
        if scored.key in by_id
    ]


def _boost(memory: Memory, hinted_categories: set[str]) -> float:
    # Importance moves the score by about a third either way; a category hinted
    # by the question is worth roughly one extra importance point.
    boost = 0.7 + 0.15 * memory.importance
    if memory.category in hinted_categories:
        boost *= 1.25
    return boost


def update(
    session: Session,
    *,
    user_id: int,
    memory_id: int,
    content: str | None = None,
    category: str | None = None,
    importance: int | None = None,
    tags: Sequence[str] | str | None = None,
) -> Memory | None:
    memory = get(session, user_id=user_id, memory_id=memory_id)
    if memory is None:
        return None
    if content is not None:
        cleaned = " ".join(content.split())
        if not cleaned:
            raise MemoryValidationError("A memory needs some content.")
        if len(cleaned) > MAX_CONTENT_CHARS:
            raise MemoryValidationError(f"Too long; the limit is {MAX_CONTENT_CHARS} characters.")
        memory.content = cleaned
    if category is not None:
        memory.category = normalise_category(category)
    if importance is not None:
        memory.importance = max(1, min(int(importance), 5))
    if tags is not None:
        memory.tags = normalise_tags(tags)
    memory.updated_at = utcnow().replace(tzinfo=None)
    session.flush()
    return memory


def delete(session: Session, *, user_id: int, memory_id: int) -> bool:
    memory = get(session, user_id=user_id, memory_id=memory_id)
    if memory is None:
        return False
    session.delete(memory)
    session.flush()
    return True


def delete_all(session: Session, *, user_id: int) -> int:
    from sqlalchemy import delete as sql_delete

    return deleted_rows(session.execute(sql_delete(Memory).where(Memory.user_id == user_id)))


def mark_used(session: Session, memories: Sequence[Memory]) -> None:
    """Record that these were sent to the model.

    Cheap, and it answers the question the memory page exists to answer: which
    of these has JARVIS ever actually used?
    """
    now = utcnow().replace(tzinfo=None)
    for memory in memories:
        memory.last_used_at = now
        memory.use_count += 1
    if memories:
        session.flush()
