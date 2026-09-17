"""Withholding the events where real footage and the generator disagree.

Measured as a share of the address-to-impact span, GolfDB's labels and this
generator's agree to about a percent on address, the top, mid-downswing and
impact, and differ by six to twelve percent on toe-up, mid-backswing,
mid-follow-through and the finish. The generator reads all eight off the rig's
geometry - its midpoint fallbacks never fire across four hundred draws - so the
gap is a real difference between the rig's kinematics and a human annotator's
reading of real video, not a bug in either label set.

A clip that disagrees on four events is still worth having for the other four.
These tests pin the mechanism that says so.
"""

from __future__ import annotations

import numpy as np

from swingml.events import BACKGROUND_CLASS, NUM_EVENTS, SwingEvent
from swingml.model.data import SwingDataset, soft_targets, unsupervised_veto
from swingml.skeleton import Handedness
from synth.dataset import Sample

N_FRAMES = 200
EVENTS = np.array([10, 40, 60, 90, 110, 120, 140, 180], dtype=np.int64)
TRUSTED = ("address", "top", "mid_downswing", "impact")


def mask(names: tuple[str, ...]) -> np.ndarray:
    out = np.zeros(NUM_EVENTS, dtype=bool)
    for name in names:
        out[int(SwingEvent[name.upper()])] = True
    return out


def sample(supervised: np.ndarray | None) -> Sample:
    return Sample(
        features=np.zeros((N_FRAMES, 132), dtype=np.float32),
        event_frames=EVENTS.copy(),
        handedness=Handedness.RIGHT,
        tempo_ratio=3.0,
        capture_rate_hz=60.0,
        azimuth_deg=0.0,
        supervised_events=supervised,
    )


def test_a_withheld_event_loses_its_frames_from_the_loss() -> None:
    keep = unsupervised_veto(EVENTS, mask(TRUSTED), N_FRAMES, radius_frames=5)
    assert keep[int(EVENTS[int(SwingEvent.TOE_UP)])] == 0.0
    assert keep[int(EVENTS[int(SwingEvent.MID_BACKSWING)])] == 0.0
    assert keep[int(EVENTS[int(SwingEvent.FINISH)])] == 0.0


def test_a_trusted_event_keeps_its_frames() -> None:
    keep = unsupervised_veto(EVENTS, mask(TRUSTED), N_FRAMES, radius_frames=5)
    for name in TRUSTED:
        assert keep[int(EVENTS[int(SwingEvent[name.upper()])])] == 1.0


def test_the_veto_reaches_exactly_the_radius() -> None:
    centre = int(EVENTS[int(SwingEvent.TOE_UP)])
    keep = unsupervised_veto(EVENTS, mask(TRUSTED), N_FRAMES, radius_frames=5)
    assert keep[centre - 5] == 0.0
    assert keep[centre - 6] == 1.0
    assert keep[centre + 5] == 0.0
    assert keep[centre + 6] == 1.0


def test_an_event_near_the_start_does_not_wrap_to_the_end() -> None:
    """A negative slice bound would blank the tail of the clip instead."""
    events = EVENTS.copy()
    events[int(SwingEvent.ADDRESS)] = 2
    keep = unsupervised_veto(events, mask(("top",)), N_FRAMES, radius_frames=10)
    assert keep[-1] == 1.0
    assert keep[0] == 0.0


def test_the_target_keeps_its_bump_where_the_weight_is_withheld() -> None:
    """Zero weight says nothing; a removed bump would say 'background', which is false."""
    target = soft_targets(EVENTS, N_FRAMES, sigma_frames=2.0)
    toe_up = int(EVENTS[int(SwingEvent.TOE_UP)])
    item = SwingDataset([sample(mask(TRUSTED))], sigma_frames=2.0, unsupervised_radius_frames=5)[0]
    assert float(item["weight"][toe_up]) == 0.0
    assert (
        float(item["target"][toe_up, int(SwingEvent.TOE_UP)])
        == target[toe_up, int(SwingEvent.TOE_UP)]
    )
    assert float(item["target"][toe_up, BACKGROUND_CLASS]) < 0.5


def test_supervising_everything_is_the_same_as_saying_nothing() -> None:
    """The default path must not change for the synthetic corpus."""
    every = mask(tuple(event.name.lower() for event in SwingEvent.ordered()))
    with_mask = SwingDataset([sample(every)], sigma_frames=2.0)[0]
    without = SwingDataset([sample(None)], sigma_frames=2.0)[0]
    assert np.array_equal(with_mask["weight"].numpy(), without["weight"].numpy())


def test_withholding_leaves_the_trusted_events_at_full_weight() -> None:
    """Otherwise the run would be quietly training on less than it reports."""
    item = SwingDataset([sample(mask(TRUSTED))], sigma_frames=2.0)[0]
    plain = SwingDataset([sample(None)], sigma_frames=2.0)[0]
    for name in TRUSTED:
        frame = int(EVENTS[int(SwingEvent[name.upper()])])
        assert float(item["weight"][frame]) == float(plain["weight"][frame])
        assert float(item["weight"][frame]) > 1.0
