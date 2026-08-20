"""The swing card has to be checkable at a glance, so it has to actually render."""

from __future__ import annotations

import numpy as np
import pytest

from swingml.analysis import SwingAnalysis
from swingml.events import EventSequence
from swingml.metrics.swing import compute_metrics
from swingml.quantity import NoReading
from swingml.report.overlay import swing_card
from swingml.skeleton import Handedness
from synth.camera import CameraConfig
from synth.dataset import generate_sample
from synth.render import render_swing_video
from synth.swing import generate_swing


def test_the_card_renders_the_eight_events(tmp_path) -> None:  # type: ignore[no-untyped-def]
    swing = generate_swing(frame_rate_hz=30.0)
    camera = CameraConfig(frame_width=320, frame_height=568, vertical_fov_deg=55.0)
    frames = render_swing_video(swing, camera, seed=0)

    sample = generate_sample(9001, keep_pose=True)
    assert sample is not None and sample.pose is not None

    events = EventSequence(frames=tuple(int(f) for f in sample.event_frames), confidence=(0.9,) * 8)
    metrics = compute_metrics(sample.pose, events, sample.handedness)
    analysis = SwingAnalysis(
        video=None,
        detection_rate=1.0,
        canonical_frames=sample.n_frames,
        events=events,
        event_times_s=tuple(float(f) / 60.0 for f in sample.event_frames),
        event_source_frames=tuple(int(np.clip(f, 0, len(frames) - 1)) for f in sample.event_frames),
        metrics=metrics,
        handedness=Handedness.RIGHT,
    )

    path = swing_card(analysis, frames, sample.pose, tmp_path / "card.png", title="test")
    assert path.exists()
    assert path.stat().st_size > 10_000


def test_the_card_refuses_to_draw_a_swing_that_was_not_found(tmp_path) -> None:  # type: ignore[no-untyped-def]
    sample = generate_sample(9002, keep_pose=True)
    assert sample is not None and sample.pose is not None
    refusal = NoReading(reason="no swing here", source="events")
    analysis = SwingAnalysis(
        video=None,
        detection_rate=0.1,
        canonical_frames=10,
        events=refusal,
        event_times_s=(),
        event_source_frames=(),
        metrics=refusal,
        handedness=Handedness.RIGHT,
    )
    with pytest.raises(ValueError, match="nothing to draw"):
        swing_card(analysis, np.zeros((4, 8, 8, 3), np.uint8), sample.pose, tmp_path / "x.png")
