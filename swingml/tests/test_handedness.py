"""Which way round the golfer stands, and what happens when nobody can tell.

GolfDB does not annotate handedness, so it has to be inferred from the pose
before a clip can be turned into features. The inference used to answer
right-handed whenever it had nothing to go on, which is the majority class: two
of the three clips it got wrong on Bubba Watson were that branch firing, not a
misread. A guess dressed as a reading is worse than no reading, because the
margin recorded beside it says the call was certain.

The measured cost of the label is small - flipping it on every test clip moves
the detector 1.8 points at one frame, because handedness reaches five channels
out of several hundred - which is why the cue is allowed to be imperfect. It is
not why it is allowed to invent answers.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from swingml.skeleton import Handedness, Landmark

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from make_golfdb_dataset import infer_handedness

N_FRAMES, N_LANDMARKS, TOP = 9, 33, 4


def pose(
    hands_over: Landmark, visible: float = 1.0
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """A stationary pose with the hands parked over one shoulder."""
    xy = np.zeros((N_FRAMES, N_LANDMARKS, 2), dtype=np.float32)
    xy[:, int(Landmark.LEFT_SHOULDER)] = (-1.0, 0.0)
    xy[:, int(Landmark.RIGHT_SHOULDER)] = (1.0, 0.0)
    over = xy[0, int(hands_over)]
    xy[:, int(Landmark.LEFT_WRIST)] = over
    xy[:, int(Landmark.RIGHT_WRIST)] = over
    return xy, np.full((N_FRAMES, N_LANDMARKS), visible, dtype=np.float32)


def test_hands_over_the_right_shoulder_read_as_right_handed() -> None:
    called = infer_handedness(*pose(Landmark.RIGHT_SHOULDER), TOP)
    assert called is not None
    handedness, margin = called
    assert handedness is Handedness.RIGHT
    assert margin > 0.5


def test_hands_over_the_left_shoulder_read_as_left_handed() -> None:
    called = infer_handedness(*pose(Landmark.LEFT_SHOULDER), TOP)
    assert called is not None
    handedness, margin = called
    assert handedness is Handedness.LEFT
    assert margin > 0.5


def test_invisible_wrists_refuse_rather_than_assume_right_handed() -> None:
    """The regression: no reading must not become the commoner answer."""
    assert infer_handedness(*pose(Landmark.RIGHT_SHOULDER, visible=0.0), TOP) is None


def test_hands_between_the_shoulders_answer_with_a_margin_near_zero() -> None:
    """A weak call still answers, but says so, so it can be filtered later."""
    xy, visibility = pose(Landmark.RIGHT_SHOULDER)
    xy[:, int(Landmark.LEFT_WRIST)] = (-0.01, -1.0)
    xy[:, int(Landmark.RIGHT_WRIST)] = (0.01, -1.0)
    called = infer_handedness(xy, visibility, TOP)
    assert called is not None
    assert called[1] < 0.05
