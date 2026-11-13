"""Withholding the events where real footage and the generator disagree.

Measured on GolfDB against this corpus, in matched tempo bands, the two label
sets agree within a frame on address, the top, mid-downswing and impact, and
disagree by four to seven frames on toe-up, nine to thirteen on mid-backswing,
and eleven to fourteen on the finish.

Matching the tempo band is the whole trick. The top's position as a share of the
address-to-impact span is the tempo ratio rewritten, so pooling all tempos put
the top 2.6 frames out when the two in fact agree on it to under a frame - the
gap was the generator's drawn tempo median sitting below the real one, not a
disagreement about what the top is.

The generator reads all eight events off the rig's geometry, and its midpoint
fallbacks never fire across four hundred draws, so where a gap survives the
tempo control it is a real difference between the rig and a human annotator
watching real video, not a bug in either label set.

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


def test_a_swing_longer_than_the_frame_cap_is_left_uncropped() -> None:
    """The crop arithmetic had no guard for this, and real slow-motion hits it.

    When the events span more frames than the cap, the window that would hold
    them does not exist. The old arithmetic opened the window after the address
    anyway and shifted it negative, handing the model a target outside its own
    clip. Generated clips top out near 160 frames so nothing reached it; real
    slow-motion footage has swings spanning 839.
    """
    long_events = np.array([10, 60, 110, 180, 240, 300, 360, 420], dtype=np.int64)
    sample = Sample(
        features=np.zeros((500, 132), dtype=np.float32),
        event_frames=long_events,
        handedness=Handedness.RIGHT,
        tempo_ratio=3.0,
        capture_rate_hz=60.0,
        azimuth_deg=0.0,
    )
    item = SwingDataset([sample], sigma_frames=2.0, max_frames=200)[0]
    assert int(item["events"].min()) >= 0, "an event was cropped outside the clip"
    assert int(item["events"].max()) < int(item["length"]), "an event fell past the end"


def test_a_swing_inside_the_cap_is_still_cropped() -> None:
    """The guard must not turn the cap off for the clips it was meant for."""
    sample = Sample(
        features=np.zeros((500, 132), dtype=np.float32),
        event_frames=EVENTS.copy(),
        handedness=Handedness.RIGHT,
        tempo_ratio=3.0,
        capture_rate_hz=60.0,
        azimuth_deg=0.0,
    )
    item = SwingDataset([sample], sigma_frames=2.0, max_frames=250)[0]
    assert int(item["length"]) == 250
    assert int(item["events"].min()) >= 0
