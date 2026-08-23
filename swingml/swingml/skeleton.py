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
