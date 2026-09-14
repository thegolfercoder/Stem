"""The seam for semantic search, and nothing more.

`retrieval.py` matches words. That is the right place to start and the wrong
place to stop: a note filed under "algebra" will not answer a question about
"maths" until the words line up. Fixing that means embeddings, which means
either a model running locally (a download and a dependency) or a second cloud
service seeing every note - and sending every note to a second service to make
a privacy-first assistant would be an odd trade to make by default.

So phase 2 ships the interface and no implementation. `NullEmbedder` is what is
configured, `is_available()` is False, and every caller already takes the "no
embedder" path. Adding one later is writing a class with two methods and
returning it from `get_embedder()`; `DocumentChunk.embedding_norm` is already in
the schema so it is a backfill rather than a migration.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Protocol, runtime_checkable

from jarvis.retrieval import Scored


@runtime_checkable
class Embedder(Protocol):
    """Turns text into vectors. Whatever implements this stays local or is
    explicitly chosen by the owner - see the module docstring."""

    name: str
    dimensions: int

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """One vector per input, in order."""
        ...


class NullEmbedder:
    """The configured default: no vectors, no downloads, no second service."""

    name = "none"
    dimensions = 0

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [[] for _ in texts]


_embedder: Embedder = NullEmbedder()


def get_embedder() -> Embedder:
    return _embedder


def set_embedder(embedder: Embedder) -> None:
    """Install an embedder. The one function a phase-2.5 change would call."""
    global _embedder
    _embedder = embedder


def is_available() -> bool:
    return get_embedder().dimensions > 0


def cosine(left: Sequence[float], right: Sequence[float]) -> float:
    """Similarity of two vectors, 0.0 when either is empty or degenerate."""
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)


def blend(
    keyword_results: Sequence[Scored],
    semantic_results: Sequence[Scored],
    *,
    keyword_weight: float = 0.6,
) -> list[Scored]:
    """Combine a keyword ranking with a semantic one.

    Unused while `NullEmbedder` is installed - `semantic_results` is empty and
    this returns the keyword ranking unchanged. It exists so the shape of the
    hybrid is decided now, while the decision is cheap, rather than during the
    change that introduces embeddings.
    """
    if not semantic_results:
        return list(keyword_results)

    combined: dict[object, float] = {}
    matched: dict[object, tuple[str, ...]] = {}
    for results, weight in (
        (keyword_results, keyword_weight),
        (semantic_results, 1.0 - keyword_weight),
    ):
        top = max((item.score for item in results), default=0.0) or 1.0
        for item in results:
            combined[item.key] = combined.get(item.key, 0.0) + weight * (item.score / top)
            matched.setdefault(item.key, item.matched)

    ranked = [Scored(key=key, score=score, matched=matched[key]) for key, score in combined.items()]
    ranked.sort(key=lambda item: item.score, reverse=True)
    return ranked
