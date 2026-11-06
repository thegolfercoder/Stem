"""The body model: which landmarks exist, what connects to what, and what to trust.

The 33-landmark topology is MediaPipe Pose's. It is adopted rather than invented
so that synthetic sequences and real footage share one schema, and so that
anything trained here can be pointed at another source using the same layout
without a translation layer that would silently reorder joints.

Not every landmark is equally useful for a golf swing. The face landmarks are
numerous and nearly redundant; the hands carry the club and are the fastest,
most motion-blurred, most frequently occluded points in the whole sequence. Both
facts are recorded here rather than rediscovered in each module.
"""

from __future__ import annotations

from enum import IntEnum, StrEnum

import numpy as np
from numpy.typing import NDArray


class Landmark(IntEnum):
    """MediaPipe Pose landmark indices. The numbering is theirs and is load-bearing."""

    NOSE = 0
    LEFT_EYE_INNER = 1
    LEFT_EYE = 2
    LEFT_EYE_OUTER = 3
    RIGHT_EYE_INNER = 4
    RIGHT_EYE = 5
    RIGHT_EYE_OUTER = 6
    LEFT_EAR = 7
    RIGHT_EAR = 8
    MOUTH_LEFT = 9
    MOUTH_RIGHT = 10
    LEFT_SHOULDER = 11
    RIGHT_SHOULDER = 12
    LEFT_ELBOW = 13
    RIGHT_ELBOW = 14
    LEFT_WRIST = 15
    RIGHT_WRIST = 16
    LEFT_PINKY = 17
    RIGHT_PINKY = 18
    LEFT_INDEX = 19
    RIGHT_INDEX = 20
    LEFT_THUMB = 21
    RIGHT_THUMB = 22
    LEFT_HIP = 23
    RIGHT_HIP = 24
    LEFT_KNEE = 25
    RIGHT_KNEE = 26
    LEFT_ANKLE = 27
    RIGHT_ANKLE = 28
    LEFT_HEEL = 29
    RIGHT_HEEL = 30
    LEFT_FOOT_INDEX = 31
    RIGHT_FOOT_INDEX = 32


NUM_LANDMARKS = len(Landmark)

BONES: tuple[tuple[Landmark, Landmark], ...] = (
    (Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER),
    (Landmark.LEFT_SHOULDER, Landmark.LEFT_ELBOW),
    (Landmark.LEFT_ELBOW, Landmark.LEFT_WRIST),
    (Landmark.RIGHT_SHOULDER, Landmark.RIGHT_ELBOW),
    (Landmark.RIGHT_ELBOW, Landmark.RIGHT_WRIST),
    (Landmark.LEFT_SHOULDER, Landmark.LEFT_HIP),
    (Landmark.RIGHT_SHOULDER, Landmark.RIGHT_HIP),
    (Landmark.LEFT_HIP, Landmark.RIGHT_HIP),
    (Landmark.LEFT_HIP, Landmark.LEFT_KNEE),
    (Landmark.LEFT_KNEE, Landmark.LEFT_ANKLE),
    (Landmark.LEFT_ANKLE, Landmark.LEFT_HEEL),
    (Landmark.LEFT_HEEL, Landmark.LEFT_FOOT_INDEX),
    (Landmark.RIGHT_HIP, Landmark.RIGHT_KNEE),
    (Landmark.RIGHT_KNEE, Landmark.RIGHT_ANKLE),
    (Landmark.RIGHT_ANKLE, Landmark.RIGHT_HEEL),
    (Landmark.RIGHT_HEEL, Landmark.RIGHT_FOOT_INDEX),
    (Landmark.NOSE, Landmark.LEFT_EAR),
    (Landmark.NOSE, Landmark.RIGHT_EAR),
)

# The landmarks a golf swing is actually described by. The face landmarks beyond
# the nose and ears add twenty-odd dimensions that all move together and tell you
# nothing about a swing, so they are excluded from the feature set. They are still
# captured, because discarding raw data is not reversible.
SWING_LANDMARKS: tuple[Landmark, ...] = (
    Landmark.NOSE,
    Landmark.LEFT_EAR,
    Landmark.RIGHT_EAR,
    Landmark.LEFT_SHOULDER,
    Landmark.RIGHT_SHOULDER,
    Landmark.LEFT_ELBOW,
    Landmark.RIGHT_ELBOW,
    Landmark.LEFT_WRIST,
    Landmark.RIGHT_WRIST,
    Landmark.LEFT_INDEX,
    Landmark.RIGHT_INDEX,
    Landmark.LEFT_HIP,
    Landmark.RIGHT_HIP,
    Landmark.LEFT_KNEE,
    Landmark.RIGHT_KNEE,
    Landmark.LEFT_ANKLE,
    Landmark.RIGHT_ANKLE,
    Landmark.LEFT_FOOT_INDEX,
    Landmark.RIGHT_FOOT_INDEX,
)

NUM_SWING_LANDMARKS = len(SWING_LANDMARKS)
SWING_LANDMARK_INDICES = np.array([int(landmark) for landmark in SWING_LANDMARKS], dtype=np.int64)

# Landmarks whose confidence should be read sceptically during the swing itself.
# The hands travel fastest, blur most, cross the body, and are occluded by it.
FAST_LANDMARKS: frozenset[Landmark] = frozenset(
    {
        Landmark.LEFT_WRIST,
        Landmark.RIGHT_WRIST,
        Landmark.LEFT_INDEX,
        Landmark.RIGHT_INDEX,
        Landmark.LEFT_PINKY,
        Landmark.RIGHT_PINKY,
        Landmark.LEFT_THUMB,
        Landmark.RIGHT_THUMB,
    }
)


class Handedness(StrEnum):
    """Which way round the golfer stands. Decides which arm is the lead arm."""

    RIGHT = "right"
    LEFT = "left"

    @property
    def lead_shoulder(self) -> Landmark:
        return Landmark.LEFT_SHOULDER if self is Handedness.RIGHT else Landmark.RIGHT_SHOULDER

    @property
    def lead_elbow(self) -> Landmark:
        return Landmark.LEFT_ELBOW if self is Handedness.RIGHT else Landmark.RIGHT_ELBOW

    @property
    def lead_wrist(self) -> Landmark:
        return Landmark.LEFT_WRIST if self is Handedness.RIGHT else Landmark.RIGHT_WRIST

    @property
    def trail_shoulder(self) -> Landmark:
        return Landmark.RIGHT_SHOULDER if self is Handedness.RIGHT else Landmark.LEFT_SHOULDER

    @property
    def trail_wrist(self) -> Landmark:
        return Landmark.RIGHT_WRIST if self is Handedness.RIGHT else Landmark.LEFT_WRIST

    @property
    def lead_hip(self) -> Landmark:
        return Landmark.LEFT_HIP if self is Handedness.RIGHT else Landmark.RIGHT_HIP

    @property
    def trail_hip(self) -> Landmark:
        return Landmark.RIGHT_HIP if self is Handedness.RIGHT else Landmark.LEFT_HIP


def infer_handedness(
    xy: NDArray[np.float32], visibility: NDArray[np.float32], top_frame: int
) -> tuple[Handedness, float] | None:
    """Which way round the golfer stands, from the top of the backswing.

    At the top, a right-hander's hands are above their right shoulder and a
    left-hander's above their left. That is a fact about anatomy rather than about
    the camera, and the estimator labels left and right anatomically, so the test
    holds from any view - which matters here, because a third of these clips are
    filmed from neither of the two usual positions.

    The labels give the top frame outright, so this needs no model and cannot be
    contaminated by one. The returned margin is the difference between the two
    distances over their sum: near zero means the hands were squarely between the
    shoulders and the call is weak.

    Averaged over a few frames either side of the top, because one frame of a
    thirty-frame-a-second video through the fastest part of a swing is a coin
    toss on motion blur.

    Measured against 51 clips of players whose handedness is known, this is right
    45 times out of the 48 it will answer at all. Two stronger-sounding cues were
    tried and are worse: which arm is straighter at the top gets 39 of 48, and the
    shoulder tilt at address - which ought to follow from the lower trail hand on
    the grip - gets 38 of 51, its errors separated by hundredths of a torso
    length, so camera perspective swamps the grip.

    Requiring a second cue to agree does reach 41 of 42, but drops nine clips of
    the fifty-one to buy it. That trade is refused on measurement rather than
    taste: flipping the label on *every* test clip moves the detector by 1.8
    points at one frame (88.2 to 86.4), and at a realistic 6 percent error rate by
    0.1 points, because handedness reaches only the two arm-angle pairs and the
    lead-arm length out of several hundred channels. Four points of label accuracy
    is worth a fraction of a point of model accuracy; real swings are the scarce
    thing this corpus is being built to get.

    Returns None when no frame near the top has both wrists visible. The weaker
    tilt cue is deliberately *not* used to fill those in: the margin is recorded
    alongside the label, and a margin that meant one thing on some rows and
    another on others would be a number whose meaning depends on how it was
    produced.
    """
    window = range(max(0, top_frame - 2), min(xy.shape[0], top_frame + 3))
    left_distance, right_distance = [], []
    for frame in window:
        seen = visibility[frame]
        wrists = [Landmark.LEFT_WRIST, Landmark.RIGHT_WRIST]
        if min(seen[int(w)] for w in wrists) < 0.3:
            continue
        hands = 0.5 * (xy[frame, int(Landmark.LEFT_WRIST)] + xy[frame, int(Landmark.RIGHT_WRIST)])
        left_distance.append(np.linalg.norm(hands - xy[frame, int(Landmark.LEFT_SHOULDER)]))
        right_distance.append(np.linalg.norm(hands - xy[frame, int(Landmark.RIGHT_SHOULDER)]))
    if not left_distance:
        return None

    left = float(np.mean(left_distance))
    right = float(np.mean(right_distance))
    margin = abs(right - left) / max(right + left, 1e-9)
    return (Handedness.RIGHT if right < left else Handedness.LEFT), margin
