"""Ranking text against a query, locally.

This is the part people reach for a vector database to do, and for a personal
assistant that is the wrong first move: a machine holding a few thousand notes
does not need an index server, it needs a ranking function that works offline,
starts instantly and can be read in one sitting. So: BM25 over candidates the
database has already narrowed, scored in Python.

The honest limitation is that it matches words, not meaning - "maths" will not
find "algebra" unless the word is there. `embeddings.py` is where that gets
fixed, and `rank()` is deliberately the only thing that would have to change.

One approximation worth knowing about: document frequency is computed over the
candidate set rather than the whole table, because the candidates are what we
are ordering among. It shifts the absolute scores and not, in practice, the
order of the top few.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

# Words carrying no signal for retrieval. Short by design: an aggressive stop
# list throws away "what do I need for physics" until it is "physics", which is
# usually right, and occasionally throws away the only word that mattered.
_STOPWORD_TEXT = """
    a about all am an and any are as at be been being but by can cant could did
    do does doing dont for from get got had has have he her him his how i if in
    into is it its me more most my need needs of on or our out over please put
    said same she should so some such than that the their them then there these
    they this those to too up us very was we were what when where which while
    who why will with would you your
"""

STOPWORDS = frozenset(_STOPWORD_TEXT.split())

_WORD = re.compile(r"[a-z0-9][a-z0-9'+#-]*")

# BM25's usual constants. k1 controls how fast repeating a word stops helping;
# b controls how much a long passage is penalised for its length.
K1 = 1.5
B = 0.75


def tokenize(text: str) -> list[str]:
    """Words, lowercased, stopwords dropped, plurals folded.

    The plural folding is two rules deep on purpose. Real stemming needs a
    dictionary to avoid mangling words, and the two cases that actually come up
    in a personal knowledge base are "notes"/"note" and "classes"/"class".
    """
    words = _WORD.findall(text.lower())
    out: list[str] = []
    for word in words:
        if word in STOPWORDS or len(word) < 2:
            continue
        out.append(_singular(word))
    return out


def _singular(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("es") and word[-3] in "sxzh":
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


@dataclass(frozen=True)
class Candidate:
    """Something rankable. `key` is handed back untouched - it is usually a row
    id, and this module deliberately knows nothing about rows."""

    key: object
    text: str
    # A multiplier applied after scoring, for signals that are not about words:
    # a memory's importance, a document's subject matching the question.
    boost: float = 1.0


@dataclass(frozen=True)
class Scored:
    key: object
    score: float
    matched: tuple[str, ...] = field(default=())


def rank(query: str, candidates: Sequence[Candidate], *, limit: int = 10) -> list[Scored]:
    """Best first, dropping anything that matched nothing.

    Returning fewer results than asked for is the point: padding the context
    with the least-bad match is how an assistant ends up answering from
    something irrelevant with total confidence.
    """
    terms = tokenize(query)
    if not terms or not candidates:
        return []

    tokenized = [tokenize(candidate.text) for candidate in candidates]
    lengths = [len(tokens) or 1 for tokens in tokenized]
    average_length = sum(lengths) / len(lengths)

    unique_terms = set(terms)
    document_frequency = Counter(
        term for tokens in tokenized for term in unique_terms.intersection(tokens)
    )
    total = len(candidates)

    scored: list[Scored] = []
    for candidate, tokens, length in zip(candidates, tokenized, lengths, strict=True):
        counts = Counter(tokens)
        score = 0.0
        matched: list[str] = []
        for term in unique_terms:
            frequency = counts.get(term, 0)
            if not frequency:
                continue
            matched.append(term)
            # The +0.5/+0.5 smoothing keeps a term appearing in every candidate
            # from scoring zero or negative, which plain BM25 idf does.
            frequency_in_corpus = document_frequency[term]
            idf = math.log(1 + (total - frequency_in_corpus + 0.5) / (frequency_in_corpus + 0.5))
            saturation = (frequency * (K1 + 1)) / (
                frequency + K1 * (1 - B + B * length / average_length)
            )
            score += idf * saturation
        if not matched:
            continue
        scored.append(
            Scored(
                key=candidate.key,
                score=score * candidate.boost,
                matched=tuple(sorted(matched)),
            )
        )

    scored.sort(key=lambda item: item.score, reverse=True)
    return scored[:limit]


def like_patterns(query: str) -> list[str]:
    """SQL LIKE patterns for narrowing a table before ranking.

    The database's job here is only to avoid loading rows that cannot possibly
    match; the ranking is done above. Substring rather than word matching, so
    "chem" still finds "chemistry".
    """
    return [f"%{term}%" for term in dict.fromkeys(tokenize(query))]


def excerpt(text: str, query: str, *, width: int = 320) -> str:
    """The part of `text` worth showing, centred on the first match."""
    text = text.strip()
    if len(text) <= width:
        return text
    terms = tokenize(query)
    lowered = text.lower()
    position = -1
    for term in terms:
        position = lowered.find(term)
        if position >= 0:
            break
    if position < 0:
        return text[:width].rstrip() + " ..."
    start = max(0, position - width // 3)
    end = min(len(text), start + width)
    prefix = "... " if start > 0 else ""
    suffix = " ..." if end < len(text) else ""
    return f"{prefix}{text[start:end].strip()}{suffix}"
