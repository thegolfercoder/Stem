"""Turning per-frame scores into eight frames that could actually be a swing.

Taking the highest-scoring frame for each event independently is the obvious
thing to do and it is wrong, in a way that is worth being precise about. The
events are not independent: they happen once each, in a fixed order. An
independent pick can put impact before the top of the backswing, can put two
events on the same frame, and does so exactly when the model is least certain -
which is to say on the hardest footage, where a plausible-looking wrong answer is
most damaging.

Because the ordering is a hard constraint rather than a preference, the best
sequence *subject to that constraint* can be found exactly, by dynamic
programming, in time linear in the clip length. There is no beam, no threshold,
no heuristic, and no possibility of an invalid result. The cost is a single pass
per event over the running maximum of the previous event's scores.

This is the same argument as a Viterbi decode, with a trellis whose only legal
transitions go forward in time and up one event.
"""

from __future__ import annotations

from typing import cast

import numpy as np
from numpy.typing import NDArray

from swingml.events import NUM_EVENTS, EventSequence
from swingml.quantity import NoReading

NEGATIVE_INFINITY = -1.0e30

# The event sequence is exactly eight long, and the type says so. Casting is how
# a runtime-built tuple is admitted to that type without loosening it.
EightFrames = tuple[int, int, int, int, int, int, int, int]
EightScores = tuple[float, float, float, float, float, float, float, float]


def log_softmax(logits: NDArray[np.float32]) -> NDArray[np.float64]:
    """Numerically safe log-softmax over the last axis."""
    x = np.asarray(logits, dtype=np.float64)
    shifted = x - x.max(axis=-1, keepdims=True)
    return np.asarray(shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True)))


def decode_events(
    logits: NDArray[np.float32], min_mean_confidence: float = 0.0
) -> EventSequence | NoReading:
    """Best strictly-increasing assignment of the eight events to frames.

    Args:
        logits: (T, NUM_CLASSES) per-frame scores.
        min_mean_confidence: geometric mean probability across the eight chosen
            frames below which no sequence is returned. A clip containing no
            swing still has a best-scoring ordered sequence, and reporting one is
            worse than reporting nothing.

    Returns:
        The decoded sequence, or a refusal explaining why there is none.
    """
    scores = log_softmax(logits)[:, :NUM_EVENTS]
    n_frames = scores.shape[0]
    if n_frames < NUM_EVENTS:
        return NoReading(
            reason=f"clip is {n_frames} frames long and a swing needs at least {NUM_EVENTS}",
            source="events",
        )

    best = np.full((NUM_EVENTS, n_frames), NEGATIVE_INFINITY)
    back = np.zeros((NUM_EVENTS, n_frames), dtype=np.int64)
    best[0] = scores[:, 0]

    for event in range(1, NUM_EVENTS):
        previous = best[event - 1]
        # Running best over all frames strictly before the current one, carried
        # forward so each event costs one pass rather than one pass per frame.
        running_best = np.full(n_frames, NEGATIVE_INFINITY)
        running_arg = np.zeros(n_frames, dtype=np.int64)
        current_best = NEGATIVE_INFINITY
        current_arg = 0
        for frame in range(1, n_frames):
            if previous[frame - 1] > current_best:
                current_best = previous[frame - 1]
                current_arg = frame - 1
            running_best[frame] = current_best
            running_arg[frame] = current_arg
        best[event] = scores[:, event] + running_best
        back[event] = running_arg
        best[event, 0] = NEGATIVE_INFINITY

    if (
        not np.isfinite(best[NUM_EVENTS - 1]).any()
        or best[NUM_EVENTS - 1].max() <= NEGATIVE_INFINITY / 2
    ):
        return NoReading(
            reason="no ordering of the eight events fits in this clip", source="events"
        )

    frames = np.zeros(NUM_EVENTS, dtype=np.int64)
    frames[NUM_EVENTS - 1] = int(np.argmax(best[NUM_EVENTS - 1]))
    for event in range(NUM_EVENTS - 1, 0, -1):
        frames[event - 1] = back[event, frames[event]]

    probabilities = np.exp(scores[frames, np.arange(NUM_EVENTS)])
    subframe = _refine_subframe(scores, frames)
    mean_confidence = float(np.exp(np.mean(np.log(np.maximum(probabilities, 1e-12)))))
    if mean_confidence < min_mean_confidence:
        return NoReading(
            reason=(
                f"best ordered sequence has a mean confidence of {mean_confidence:.3f}, "
                f"below the {min_mean_confidence:.2f} required; this clip probably does "
                "not contain a swing"
            ),
            source="events",
        )

    return EventSequence(
        frames=cast(EightFrames, tuple(int(f) for f in frames)),
        confidence=cast(EightScores, tuple(float(p) for p in probabilities)),
        subframe=cast(EightScores, tuple(float(v) for v in subframe)),
    )


def _refine_subframe(
    scores: NDArray[np.float64], frames: NDArray[np.int64], half_width: int = 2
) -> NDArray[np.float64]:
    """Probability-weighted centre of each event's peak, in fractional frames.

    The model is trained against a smooth bump centred on the true instant, so the
    probability it assigns either side of its chosen frame says which way the
    instant actually lies. Taking the centre of mass of that bump recovers a
    fraction of a frame, which matters for the downswing: at sixty frames a second
    a downswing is about fifteen frames, and half a frame is three percent of it.

    The refinement is clamped to the chosen frame's own neighbourhood. It sharpens
    a good answer; it is not allowed to move a bad one somewhere else.
    """
    probabilities = np.exp(scores)
    n_frames = scores.shape[0]
    out = np.empty(len(frames), dtype=np.float64)
    for event, frame in enumerate(frames):
        lo = max(0, int(frame) - half_width)
        hi = min(n_frames, int(frame) + half_width + 1)
        window = probabilities[lo:hi, event]
        total = window.sum()
        if total <= 0.0:
            out[event] = float(frame)
            continue
        centre = float((np.arange(lo, hi) * window).sum() / total)
        out[event] = float(np.clip(centre, frame - 1.0, frame + 1.0))
    return out


def greedy_events(logits: NDArray[np.float32]) -> NDArray[np.int64]:
    """Independent per-event maximum, kept only to measure what the constraint buys.

    Not for use in the pipeline: it can and does return sequences in which impact
    precedes the top of the backswing.
    """
    scores = log_softmax(logits)[:, :NUM_EVENTS]
    return np.asarray(np.argmax(scores, axis=0), dtype=np.int64)
