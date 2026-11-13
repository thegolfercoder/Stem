"""Simple event detectors, to find out whether the temporal network earns its keep.

A network that cannot beat a few lines of kinematics on real held-out swings
should not ship, and nobody here had checked. These detectors read the same
feature matrix the network reads, on the same 60 Hz grid, and return the same
eight frames, so the benchmark can score them identically.

They are deliberately scale-free. A slow-motion clip stretches every duration by
four to eight times, so every threshold is a fraction of the clip's own peak
hand speed, never an absolute speed, and every search window is a fraction of
the clip's own swing, never a number of frames.

Two families:

- **Kinematic**: hand height and hand speed only. The top is the highest the
  hands get before their fastest descent; impact is the lowest they get after
  it; address is where the hands last left rest before the top; the finish is
  where they come to rest after impact. The positions in between are placed at
  the fraction of the way across their span that the training clips put them.
- **Template**: dynamic time warping of the clip's hand-height and hand-speed
  curves onto labelled training clips, carrying their labels across the warp,
  and taking the median over templates.

`refine` is the hybrid: the network's coarse answer, with top, impact and
address moved to the kinematic landmark nearest the network's own choice. It is
a candidate like any other and has to win on held-out footage to be used.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.features import feature_layout

ADDRESS, TOE_UP, MID_BACK, TOP, MID_DOWN, IMPACT, MID_FOLLOW, FINISH = range(8)


class Signals(BaseModel):
    """The two curves every detector here reads, smoothed, on the 60 Hz grid."""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    height: NDArray[np.float64] = Field(description="Hands relative to shoulders; down is +.")
    speed: NDArray[np.float64] = Field(description="Hand speed as a fraction of its peak.")
    vertical_velocity: NDArray[np.float64] = Field(description="d(height)/dt, down is +.")


def _smooth(values: NDArray[np.float64], width: int) -> NDArray[np.float64]:
    if width <= 1 or len(values) < width:
        return values.astype(np.float64)
    kernel = np.ones(width) / width
    padded = np.pad(values.astype(np.float64), (width // 2, width - 1 - width // 2), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def signals(features: NDArray[np.float32], smoothing: int = 5) -> Signals:
    layout = feature_layout()
    height = _smooth(features[:, layout.hands_relative[0] + 1].astype(np.float64), smoothing)
    speed = _smooth(features[:, layout.hand_speed[0]].astype(np.float64), smoothing)
    peak = float(np.percentile(speed, 99)) if speed.size else 1.0
    return Signals(
        height=height,
        speed=speed / max(peak, 1e-9),
        vertical_velocity=np.gradient(height),
    )


class KinematicParams(BaseModel):
    """What the kinematic detector is tuned on. Fitted on training clips only."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    smoothing: int = 5
    rest_speed: float = 0.12
    """Hands count as at rest below this fraction of the clip's peak speed."""
    rest_frames: int = 3
    fractions: tuple[float, float, float, float] = (0.35, 0.6, 0.5, 0.4)
    """Toe-up and mid-backswing as a share of address->top, mid-downswing of
    top->impact, mid-follow-through of impact->finish."""
    offsets: tuple[float, ...] = (0.0,) * 8
    """Median signed error of each event on the training clips, subtracted."""


def _rest_before(speed: NDArray[np.float64], end: int, threshold: float, run: int) -> int:
    """The last frame before `end` from which the hands had been still for `run` frames."""
    still = 0
    for index in range(end, -1, -1):
        still = still + 1 if speed[index] < threshold else 0
        if still >= run:
            return index + run - 1
    return 0


def _rest_after(speed: NDArray[np.float64], start: int, threshold: float, run: int) -> int:
    still = 0
    for index in range(start, len(speed)):
        still = still + 1 if speed[index] < threshold else 0
        if still >= run:
            return index - run + 1
    return len(speed) - 1


def kinematic_landmarks(sig: Signals, params: KinematicParams) -> NDArray[np.float64]:
    """Address, top, impact and finish from the hand curves alone (length-8, NaN elsewhere)."""
    n = len(sig.height)
    out = np.full(8, np.nan)
    if n < 16:
        return out
    # The fastest descent of the hands is the downswing, and it is the one part of
    # the swing no waggle, practice swing or walk into shot reproduces.
    descent = int(np.argmax(sig.vertical_velocity))
    before = sig.height[: descent + 1]
    top = int(np.argmin(before))
    after = sig.height[descent:]
    # Impact: the lowest the hands get before they start rising into the finish.
    rising = np.nonzero(sig.vertical_velocity[descent:] < 0)[0]
    stop = descent + (int(rising[0]) if rising.size else len(after) - 1)
    impact = descent + int(np.argmax(sig.height[descent : stop + 1]))
    address = _rest_before(sig.speed, top, params.rest_speed, params.rest_frames)
    finish = _rest_after(sig.speed, impact + 1, params.rest_speed, params.rest_frames)
    out[[ADDRESS, TOP, IMPACT, FINISH]] = [address, top, impact, finish]
    return out


def _fill_between(landmarks: NDArray[np.float64], params: KinematicParams) -> NDArray[np.float64]:
    out = landmarks.copy()
    toe, mid_back, mid_down, mid_follow = params.fractions
    a, t, i, f = out[ADDRESS], out[TOP], out[IMPACT], out[FINISH]
    out[TOE_UP] = a + toe * (t - a)
    out[MID_BACK] = a + mid_back * (t - a)
    out[MID_DOWN] = t + mid_down * (i - t)
    out[MID_FOLLOW] = i + mid_follow * (f - i)
    return out


def _ordered(positions: NDArray[np.float64], n: int) -> NDArray[np.float64] | None:
    """Clip to the clip, force strict order; None if there is no room for eight events."""
    if not np.all(np.isfinite(positions)):
        return None
    out = np.clip(positions, 0, n - 1).astype(np.float64)
    for index in range(1, 8):
        out[index] = max(out[index], out[index - 1] + 1)
    if out[-1] > n - 1:
        return None
    return out


def kinematic(features: NDArray[np.float32], params: KinematicParams) -> NDArray[np.float64] | None:
    sig = signals(features, params.smoothing)
    landmarks = kinematic_landmarks(sig, params)
    if not np.all(np.isfinite(landmarks[[ADDRESS, TOP, IMPACT, FINISH]])):
        return None
    positions = _fill_between(landmarks, params) - np.asarray(params.offsets)
    return _ordered(positions, len(features))


def fit_kinematic(
    clips: Sequence[tuple[NDArray[np.float32], NDArray[np.int64]]],
    smoothing: Sequence[int] = (3, 5, 9),
    rest_speed: Sequence[float] = (0.06, 0.09, 0.12, 0.16, 0.2),
    rest_frames: Sequence[int] = (2, 4, 8),
) -> KinematicParams:
    """Grid search on training clips; fractions and offsets from their medians."""
    truths = [np.asarray(t, dtype=np.float64) for _, t in clips]
    fractions = (
        float(np.median([(t[1] - t[0]) / max(t[3] - t[0], 1) for t in truths])),
        float(np.median([(t[2] - t[0]) / max(t[3] - t[0], 1) for t in truths])),
        float(np.median([(t[4] - t[3]) / max(t[5] - t[3], 1) for t in truths])),
        float(np.median([(t[6] - t[5]) / max(t[7] - t[5], 1) for t in truths])),
    )
    best: tuple[float, KinematicParams] | None = None
    for width in smoothing:
        cached = [signals(features, width) for features, _ in clips]
        for speed in rest_speed:
            for run in rest_frames:
                params = KinematicParams(
                    smoothing=width, rest_speed=speed, rest_frames=run, fractions=fractions
                )
                errors = []
                for sig, truth in zip(cached, truths, strict=True):
                    marks = kinematic_landmarks(sig, params)
                    core = marks[[ADDRESS, TOP, IMPACT]]
                    if not np.all(np.isfinite(core)):
                        errors.append(1e3)
                        continue
                    errors.append(float(np.mean(np.abs(core - truth[[ADDRESS, TOP, IMPACT]]))))
                cost = float(np.median(errors))
                if best is None or cost < best[0]:
                    best = (cost, params)
    assert best is not None
    chosen = best[1]
    residuals = []
    for features, labels in clips:
        sig = signals(features, chosen.smoothing)
        marks = kinematic_landmarks(sig, chosen)
        if np.all(np.isfinite(marks[[ADDRESS, TOP, IMPACT, FINISH]])):
            residuals.append(_fill_between(marks, chosen) - np.asarray(labels, dtype=np.float64))
    offsets = tuple(float(v) for v in np.median(np.stack(residuals), axis=0))
    return chosen.model_copy(update={"offsets": offsets})


# -- dynamic time warping -------------------------------------------------------


def _curve(features: NDArray[np.float32], step: int) -> NDArray[np.float64]:
    sig = signals(features, 5)
    height = (sig.height - sig.height.mean()) / max(float(sig.height.std()), 1e-6)
    return np.stack([height, sig.speed * 2.0], axis=1)[::step]


def dtw_path(a: NDArray[np.float64], b: NDArray[np.float64]) -> NDArray[np.int64]:
    """Index pairs of the cheapest monotone alignment of two curves."""
    n, m = len(a), len(b)
    cost: NDArray[np.float64] = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=-1))
    acc = np.full((n + 1, m + 1), np.inf)
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        row = acc[i - 1]
        # min(diagonal, up) is vectorised; the left neighbour needs a running pass.
        best_up = np.minimum(row[:-1], row[1:]) + cost[i - 1]
        current = acc[i]
        for j in range(1, m + 1):
            current[j] = min(best_up[j - 1], current[j - 1] + cost[i - 1, j - 1])
    i, j = n, m
    path = [(n - 1, m - 1)]
    while i > 1 or j > 1:
        options = (acc[i - 1, j - 1], acc[i - 1, j], acc[i, j - 1])
        move = int(np.argmin(options))
        i, j = (i - 1, j - 1) if move == 0 else (i - 1, j) if move == 1 else (i, j - 1)
        path.append((max(i - 1, 0), max(j - 1, 0)))
    return np.asarray(path[::-1], dtype=np.int64)


class TemplateSet(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    curves: tuple[NDArray[np.float64], ...]
    labels: tuple[NDArray[np.int64], ...]
    step: int


def build_templates(
    clips: Sequence[tuple[NDArray[np.float32], NDArray[np.int64]]], count: int, step: int, seed: int
) -> TemplateSet:
    rng = np.random.default_rng(seed)
    chosen = rng.choice(len(clips), size=min(count, len(clips)), replace=False)
    return TemplateSet(
        curves=tuple(_curve(clips[i][0], step) for i in chosen),
        labels=tuple(np.asarray(clips[i][1]) // step for i in chosen),
        step=step,
    )


def template(features: NDArray[np.float32], templates: TemplateSet) -> NDArray[np.float64] | None:
    query = _curve(features, templates.step)
    estimates = []
    for curve, labels in zip(templates.curves, templates.labels, strict=True):
        path = dtw_path(query, curve)
        mapped = []
        for label in labels:
            hits = path[path[:, 1] == min(int(label), len(curve) - 1), 0]
            mapped.append(float(np.median(hits)) if hits.size else np.nan)
        estimates.append(mapped)
    positions = np.nanmedian(np.asarray(estimates), axis=0) * templates.step
    return _ordered(positions, len(features))


# -- the hybrid -----------------------------------------------------------------


class RefineParams(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    events: tuple[int, ...] = (TOP, IMPACT)
    """Which of the network's events are moved to the kinematic landmark."""
    window: float = 0.15
    """How far, as a share of the network's address-to-impact span, a landmark may
    be from the network's choice and still replace it."""
    kinematic: KinematicParams = KinematicParams()


def refine(
    features: NDArray[np.float32], network: NDArray[np.float64], params: RefineParams
) -> NDArray[np.float64]:
    """The network's positions, with chosen events snapped to nearby kinematic landmarks."""
    sig = signals(features, params.kinematic.smoothing)
    out = network.astype(np.float64).copy()
    span = max(float(network[IMPACT] - network[ADDRESS]), 8.0)
    reach = max(2, round(params.window * span))
    for event in params.events:
        centre = round(float(network[event]))
        lo, hi = max(0, centre - reach), min(len(sig.height) - 1, centre + reach)
        if hi <= lo:
            continue
        segment = sig.height[lo : hi + 1]
        if event == TOP:
            out[event] = lo + int(np.argmin(segment))
        elif event == IMPACT:
            out[event] = lo + int(np.argmax(segment))
        elif event == ADDRESS:
            out[event] = float(
                min(
                    max(
                        _rest_before(
                            sig.speed, hi, params.kinematic.rest_speed, params.kinematic.rest_frames
                        ),
                        lo,
                    ),
                    hi,
                )
            )
    ordered = _ordered(out, len(features))
    return ordered if ordered is not None else network.astype(np.float64)
