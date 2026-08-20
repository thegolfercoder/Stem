"""Refining the start of the swing from the motion itself.

Measured end to end, the eight events do not fail equally. Top and impact land
within a frame, because both are sharp reversals that a temporal model can see
clearly. Address is the worst of the eight, and it is the one that matters most
for tempo, because tempo is the backswing divided by the downswing and the
backswing is measured from address.

The reason it fails is not that the model is weak there. It is that address is
not a *shape*, it is the last quiet frame before the shape starts changing, and
a pose estimator's landmarks never sit perfectly still: they shimmer by a pixel
or two while the golfer is genuinely motionless. To a model looking for the onset
of motion, that shimmer is motion, and it fires early.

That makes address a bad fit for a network and a good fit for a threshold, so
long as the threshold is derived from *this clip's own* noise rather than picked
in advance. The golfer holds still at address for long enough to measure how much
the estimator jitters when nothing is happening, and real motion is what clears
that by a wide margin.

The network still proposes; this only refines, and only within a bounded window,
so a clip where the reasoning above does not hold cannot be dragged far.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.events import NUM_EVENTS, SwingEvent


class RefineConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    enabled: bool = False
    """Off by default, and that is a statement about evidence rather than taste.

    The reasoning above is sound and the mechanism is measurable, but the only
    end-to-end measurement made so far was of an earlier version carrying a bug
    that stopped it firing in most clips, and where it did fire it moved the
    address event closer to truth while making the tempo ratio *worse*. The bug
    is fixed; the re-measurement has not been done.

    Until it has, this stays inert, so the pipeline's reported numbers are the
    ones that were actually validated. Turn it on to measure it, not to use it.
    """

    search_radius_frames: int = Field(
        default=30,
        description=(
            "How far, on the canonical grid, the refinement may move the network's "
            "proposal. Bounded so that a clip which does not begin with a still "
            "address cannot pull the event to somewhere arbitrary."
        ),
    )
    quiet_percentile: float = Field(
        default=25.0,
        description="Percentile of pre-swing hand speed taken to represent stillness.",
    )
    threshold_multiple: float = Field(
        default=6.0,
        description=(
            "Multiples of the clip's own quiet-period spread that count as the start "
            "of motion. Derived per clip rather than fixed, because how much a pose "
            "estimator shimmers depends on the footage, not on golf."
        ),
    )
    sustained_frames: int = Field(
        default=4,
        description=(
            "How long motion must persist to count. A single frame over threshold is "
            "a landmark glitch; four in a row at sixty hertz is a takeaway."
        ),
    )


def hand_speed(
    coordinates: NDArray[np.float32], times_s: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Speed of the hands in body lengths per second, from normalised coordinates.

    The hands are used because they are the first thing to move in a takeaway and
    they move furthest, so the ratio between real motion and estimator noise is
    the best available anywhere on the body.
    """
    from swingml.skeleton import Landmark

    hands = 0.5 * (
        coordinates[:, int(Landmark.LEFT_WRIST)] + coordinates[:, int(Landmark.RIGHT_WRIST)]
    )
    dt = np.gradient(times_s)
    return np.asarray(np.linalg.norm(np.gradient(hands, axis=0) / dt[:, None], axis=1))


def refine_address(
    frames: tuple[int, ...],
    speed: NDArray[np.float64],
    config: RefineConfig,
) -> tuple[int, str]:
    """A better address frame, and a note saying what was done.

    Returns the original proposal unchanged whenever the clip does not support a
    better one - too little quiet time before the swing, no clean threshold
    crossing, or a crossing outside the permitted window. Refusing to move is a
    valid outcome and is reported as one.
    """
    proposed = frames[int(SwingEvent.ADDRESS)]
    top = frames[int(SwingEvent.TOP)]
    next_event = frames[int(SwingEvent.TOE_UP)]

    lo = max(0, proposed - config.search_radius_frames)
    hi = min(next_event - 1, proposed + config.search_radius_frames)
    if hi <= lo or top <= lo:
        return proposed, "not refined: no room to search"

    # Stillness is measured from the quietest sustained stretch anywhere before
    # the top, not from the frames before the proposal. Anchoring it to the
    # proposal is circular, and it fails in exactly the case worth fixing: when
    # the network has already fired early there is nothing left in front of it to
    # measure the noise floor against.
    window = max(config.sustained_frames * 2, 8)
    searchable = speed[:top]
    if searchable.size < window * 2:
        return proposed, "not refined: too little footage before the top of the swing"

    strides = np.lib.stride_tricks.sliding_window_view(searchable, window)
    quietest = int(np.argmin(strides.mean(axis=1)))
    quiet_region = searchable[quietest : quietest + window]

    baseline = float(np.percentile(quiet_region, config.quiet_percentile))
    spread = float(np.median(np.abs(quiet_region - np.median(quiet_region))))
    if spread <= 0.0:
        spread = float(np.std(quiet_region))
    if spread <= 0.0:
        return proposed, "not refined: no measurable jitter to threshold against"

    threshold = baseline + config.threshold_multiple * spread

    # The first place motion clears the threshold and stays clear.
    over = speed > threshold
    onset: int | None = None
    for frame in range(0, min(top, len(speed) - config.sustained_frames)):
        if bool(np.all(over[frame : frame + config.sustained_frames])):
            onset = frame
            break
    if onset is None:
        return proposed, "not refined: motion never cleared this clip's own noise"

    refined = int(np.clip(onset - 1, lo, hi))
    if refined == proposed:
        return proposed, "refined: unchanged"
    return refined, f"refined: moved {refined - proposed:+d} frames to the onset of motion"


def refine_events(
    frames: tuple[int, ...],
    speed: NDArray[np.float64],
    config: RefineConfig,
) -> tuple[tuple[int, ...], str]:
    """Apply every refinement, keeping the sequence strictly increasing."""
    if not config.enabled:
        return frames, "refinement disabled"

    address, note = refine_address(frames, speed, config)
    out = list(frames)
    out[int(SwingEvent.ADDRESS)] = address
    for index in range(1, NUM_EVENTS):
        out[index] = max(out[index], out[index - 1] + 1)
    return tuple(out), note
