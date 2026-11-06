"""Keeping a language model to what a single camera can actually tell.

This analyser never reports spin, club face angle, club path, attack angle or
swing plane: one phone camera on a body-pose estimator cannot measure them, and a
number for any of them would be invented. A language model asked to coach from the
same pictures will happily supply them anyway, because that is what golf coaching
text is full of. It is told not to, and this is the backstop for when it does.

The filter works a sentence at a time, so it can sit on a stream: text is held
until its sentence ends, and a sentence that talks about one of those quantities is
dropped whole rather than shown and then retracted. What was dropped is counted,
so the interface can say so rather than pretend the model was never off course.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

UNMEASURABLE = re.compile(
    r"\b("
    r"club\s*face|clubface|face\s+angle|face\s+(?:is\s+)?(?:open|closed|square)|"
    r"club\s*path|swing\s*path|in-to-out|out-to-in|inside[- ]out|outside[- ]in|"
    r"attack\s+angle|angle\s+of\s+attack|swing\s+plane|on\s+plane|off\s+plane|"
    r"(?:back|side)\s*spin|spin\s+(?:rate|axis)|\bspin\b|launch\s+angle|"
    r"ball\s+speed|club\s*head\s+speed|swing\s+speed|smash\s+factor|"
    r"carry\s+distance|\d+\s*(?:yards|yds|mph|rpm)"
    r")",
    re.IGNORECASE,
)

ADMITS_LIMIT = re.compile(
    r"\b(can(?:'|\u2019)?t|cannot|can not|unable|impossible|not (?:possible|visible|able)|"
    r"(?:does|do)(?:n't|n\u2019t| not) (?:show|tell|capture|let)|no way to|beyond what)",
    re.IGNORECASE,
)
"""A sentence saying one of those things cannot be measured is the point, not a lapse."""

_SENTENCE_END = re.compile(r"([.!?])(\s+|$)|\n")


@dataclass
class GuardResult:
    text: str
    dropped: int


def _clean(sentence: str) -> bool:
    return UNMEASURABLE.search(sentence) is None or ADMITS_LIMIT.search(sentence) is not None


def guard_text(text: str) -> GuardResult:
    """The whole text with offending sentences removed."""
    kept: list[str] = []
    dropped = 0
    for sentence in _split_keeping(text):
        if _clean(sentence):
            kept.append(sentence)
        else:
            dropped += 1
    return GuardResult(text="".join(kept), dropped=dropped)


def _split_keeping(text: str) -> list[str]:
    """Sentences with their trailing punctuation and whitespace attached."""
    pieces: list[str] = []
    start = 0
    for match in _SENTENCE_END.finditer(text):
        pieces.append(text[start : match.end()])
        start = match.end()
    if start < len(text):
        pieces.append(text[start:])
    return pieces


class StreamGuard:
    """The same filter over a stream of pieces, releasing whole sentences."""

    def __init__(self) -> None:
        self._buffer = ""
        self.dropped = 0

    def feed(self, piece: str) -> str:
        """Add a piece; return whatever complete, clean sentences it finished."""
        self._buffer += piece
        out: list[str] = []
        last = 0
        for match in _SENTENCE_END.finditer(self._buffer):
            # A full stop with nothing after it yet may be inside a number ("2.9")
            # whose next digit has not arrived; wait for the next piece to tell.
            if match.group(1) and not match.group(2) and match.end() == len(self._buffer):
                break
            sentence = self._buffer[last : match.end()]
            last = match.end()
            if _clean(sentence):
                out.append(sentence)
            else:
                self.dropped += 1
        self._buffer = self._buffer[last:]
        return "".join(out)

    def finish(self) -> str:
        """Whatever was left when the stream ended."""
        rest, self._buffer = self._buffer, ""
        if not rest.strip():
            return rest
        if _clean(rest):
            return rest
        self.dropped += 1
        return ""


def guarded(pieces: Iterable[str], guard: StreamGuard | None = None) -> Iterator[str]:
    """Filter a stream of pieces, sentence by sentence."""
    guard = guard or StreamGuard()
    for piece in pieces:
        released = guard.feed(piece)
        if released:
            yield released
    tail = guard.finish()
    if tail:
        yield tail
