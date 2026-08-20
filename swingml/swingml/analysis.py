"""Video in, swing out. The whole pipeline in one function.

The stages are: read the clip with its real frame times, run a pose estimator,
resample onto the canonical rate so a 30fps clip and a 240fps slow-motion clip
become the same thing, build features that describe a posture rather than a
placement, run the temporal model, decode the events under the constraint that
they happen in order, and measure the swing.

Two properties are worth stating because they are what the design is for.

*Nothing is calibrated.* No focal length, no camera position, no distance, no
scale reference in the frame. Every metric is a ratio, an angle, or a length in
units of the golfer's own body.

*Predictions come back in the caller's frame numbers.* The model works on a
resampled grid, which is an internal detail. An event reported at canonical frame
94 is meaningless to somebody scrubbing their video, so every event is mapped
back to a time and to the nearest original frame before it leaves.
"""

from __future__ import annotations

from pathlib import Path
from typing import cast

import numpy as np
import torch
from pydantic import BaseModel, ConfigDict, Field

from swingml.events import EventSequence, SwingEvent
from swingml.features import FeatureConfig, extract_features, normalise_pose, resample_pose
from swingml.metrics.swing import MetricConfig, SwingMetrics, compute_metrics
from swingml.model.decode import decode_events
from swingml.model.refine import RefineConfig, hand_speed, refine_events
from swingml.model.tcn import SwingEventNet
from swingml.pose.base import PoseEstimator, PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.video.reader import VideoInfo, VideoReader


class AnalysisConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    handedness: Handedness = Handedness.RIGHT
    features: FeatureConfig = FeatureConfig()
    metrics: MetricConfig = MetricConfig()
    refine: RefineConfig = RefineConfig()
    min_mean_confidence: float = Field(
        default=0.0,
        description=(
            "Confidence below which no swing is reported. Left at zero, meaning off, "
            "because the right value is a measurement on clips that contain no swing "
            "and that measurement has not been made. A guess here would be worse "
            "than leaving it open."
        ),
    )
    max_frames: int | None = Field(
        default=None, description="Cap on frames read, for very long clips."
    )


class SwingAnalysis(BaseModel):
    """Everything the pipeline concluded about one clip."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    video: VideoInfo | None
    detection_rate: float
    canonical_frames: int
    events: EventSequence | NoReading
    event_times_s: tuple[float, ...] = Field(
        description="Time of each event in the source clip's own time base."
    )
    event_source_frames: tuple[int, ...] = Field(
        description="Nearest frame of the source clip, for scrubbing to."
    )
    metrics: SwingMetrics | NoReading
    handedness: Handedness
    refinement_note: str = Field(
        default="",
        description=(
            "What the motion-onset refinement did to the address event, including "
            "declining to do anything. Reported rather than hidden, because a metric "
            "that was adjusted and a metric that was not are different measurements."
        ),
    )

    def describe(self) -> str:
        lines: list[str] = []
        if self.video is not None:
            v = self.video
            extra = (
                f" (container says {v.nominal_fps:.0f})"
                if abs(v.measured_fps - v.nominal_fps) > 1
                else ""
            )
            lines.append(
                f"{Path(v.path).name}: {v.width}x{v.height}, {v.n_frames} frames, "
                f"{v.measured_fps:.1f} fps measured{extra}"
            )
            if v.is_slow_motion:
                lines.append("  slow motion: capture rate is well above playback rate")
            if not v.timestamps_uniform:
                lines.append("  variable frame rate: frame spacing is not constant")
        lines.append(f"  body found in {100 * self.detection_rate:.0f}% of frames")

        if isinstance(self.events, NoReading):
            lines.append(f"  {self.events}")
            return "\n".join(lines)

        lines.append("  events:")
        for event in SwingEvent.ordered():
            index = int(event)
            lines.append(
                f"    {event.label:20s} frame {self.event_source_frames[index]:5d}  "
                f"t={self.event_times_s[index]:7.3f}s  "
                f"confidence {self.events.confidence[index]:.2f}"
            )

        if isinstance(self.metrics, NoReading):
            lines.append(f"  {self.metrics}")
            return "\n".join(lines)

        m = self.metrics
        lines.append("  swing:")
        for label, reading in (
            ("tempo ratio", m.tempo_ratio),
            ("backswing", m.backswing_duration),
            ("downswing", m.downswing_duration),
            ("peak hand speed at", m.time_to_peak_hand_speed),
            ("shoulder turn", m.shoulder_turn_projected),
            ("shoulder turn (3D)", m.shoulder_turn_3d),
            ("separation", m.separation_projected),
            ("head movement", m.head_movement),
            ("pelvis sway", m.pelvis_sway),
        ):
            lines.append(f"    {label:20s} {reading}")
        lines.append(
            f"    {'kinematic sequence':20s} {' -> '.join(m.kinematic_sequence)} "
            f"(from {m.kinematic_sequence_source})"
        )
        return "\n".join(lines)


def load_model(checkpoint_path: Path | str) -> SwingEventNet:
    """Rebuild the trained model from a checkpoint."""
    checkpoint = torch.load(str(checkpoint_path), map_location="cpu", weights_only=False)
    model = SwingEventNet(
        in_features=int(checkpoint["in_features"]), channels=int(checkpoint["channels"])
    )
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model


def analyse_pose_sequence(
    sequence: PoseSequence,
    model: SwingEventNet,
    config: AnalysisConfig | None = None,
    video: VideoInfo | None = None,
) -> SwingAnalysis:
    """Analyse landmarks that have already been extracted.

    Separated from the video path so the model can be exercised on generated
    sequences without rendering and re-detecting them, and so a different pose
    source can be dropped in without touching anything here.
    """
    config = config or AnalysisConfig()
    original_times = sequence.timestamps_s.copy()

    resampled, grid = resample_pose(sequence, config.features.canonical_rate_hz)
    detection_rate = float(np.mean(resampled.detected)) if resampled.detected is not None else 1.0

    features = extract_features(resampled, config.handedness, config.features)
    with torch.no_grad():
        logits = model(torch.from_numpy(features).unsqueeze(0))[0].numpy()

    events = decode_events(logits, config.min_mean_confidence)
    if isinstance(events, NoReading):
        return SwingAnalysis(
            video=video,
            detection_rate=detection_rate,
            canonical_frames=resampled.n_frames,
            events=events,
            event_times_s=(),
            event_source_frames=(),
            metrics=events,
            handedness=config.handedness,
        )

    # Address is the weakest of the eight events and the one tempo depends on
    # most, so it is refined against the onset of motion in this clip's own
    # landmarks before anything is measured from it.
    coordinates, _, _ = normalise_pose(resampled, config.features)
    speed = hand_speed(coordinates, resampled.timestamps_s)
    refined_frames, refinement_note = refine_events(events.frames, speed, config.refine)
    if refined_frames != events.frames:
        refined_positions = list(
            events.subframe
            if events.subframe is not None
            else tuple(float(f) for f in events.frames)
        )
        for index, (old, new) in enumerate(zip(events.frames, refined_frames, strict=True)):
            if new != old:
                refined_positions[index] = float(new)
        for index in range(1, len(refined_positions)):
            refined_positions[index] = max(
                refined_positions[index], refined_positions[index - 1] + 1e-3
            )
        events = EventSequence(
            frames=cast("tuple[int, int, int, int, int, int, int, int]", refined_frames),
            confidence=events.confidence,
            subframe=cast(
                "tuple[float, float, float, float, float, float, float, float]",
                tuple(refined_positions),
            ),
        )

    # Back into the caller's time base. The canonical grid is an internal detail,
    # and an event reported in its frame numbers is of no use to anyone.
    positions = np.array([events.position_of(e) for e in SwingEvent.ordered()])
    lower = np.clip(np.floor(positions).astype(int), 0, len(grid) - 1)
    upper = np.clip(lower + 1, 0, len(grid) - 1)
    fraction = positions - lower
    times = grid[lower] + fraction * (grid[upper] - grid[lower])
    source_frames = np.abs(original_times[None, :] - times[:, None]).argmin(axis=1)

    metrics = compute_metrics(resampled, events, config.handedness, config.metrics)

    return SwingAnalysis(
        video=video,
        detection_rate=detection_rate,
        canonical_frames=resampled.n_frames,
        events=events,
        event_times_s=tuple(float(t) for t in times),
        event_source_frames=tuple(int(f) for f in source_frames),
        metrics=metrics,
        handedness=config.handedness,
        refinement_note=refinement_note,
    )


def analyse_video(
    path: Path | str,
    model: SwingEventNet,
    estimator: PoseEstimator,
    config: AnalysisConfig | None = None,
) -> SwingAnalysis:
    """Read a clip, find the body, find the swing, measure it."""
    config = config or AnalysisConfig()
    with VideoReader(path) as reader:
        frames, timestamps, info = reader.read_all(max_frames=config.max_frames)

    sequence = estimator.estimate(frames, timestamps)
    return analyse_pose_sequence(sequence, model, config, video=info)
