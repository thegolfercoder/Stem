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

from collections.abc import Callable, Iterator
from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from swingml.events import EventSequence, SwingEvent
from swingml.features import FeatureConfig, extract_features, resample_pose
from swingml.metrics.swing import MetricConfig, SwingMetrics, compute_metrics
from swingml.model.calibration import (
    ErrorBand,
    ModelCalibration,
    RelativeBand,
    fingerprint_state,
    load_calibration,
)
from swingml.model.decode import decode_events
from swingml.model.ensemble import (
    SERVING_TIME_WARPS,
    EnsembleConfig,
    SwingEventEnsemble,
)
from swingml.model.tcn import DEFAULT_DILATIONS, PaddingMode, SwingEventNet
from swingml.pose.base import PoseEstimator, PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.video.reader import VideoInfo, VideoReader


class AnalysisConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    handedness: Handedness = Handedness.RIGHT
    features: FeatureConfig = FeatureConfig()
    metrics: MetricConfig = MetricConfig()
    calibration: ModelCalibration | None = Field(
        default=None,
        description=(
            "Measured error bands for the model being run, if they have been "
            "measured. Optional because a table belongs to one model on one "
            "corpus: supplying the wrong one would quote an error bar the model "
            "cannot keep, and supplying none reports frames without a band."
        ),
    )
    min_mean_confidence: float = Field(
        default=0.30,
        description=(
            "Mean event confidence below which no swing is reported.\n\n"
            "This was left switched off until there was something to set it from, "
            "because a guessed threshold is worse than none. Measured over a set of "
            "clips built to contain no swing - somebody standing at address, a swing "
            "cut off at the top, an empty frame - the model returned 0.02, 0.27 and "
            "0.15. Over clips that did contain a swing, filmed face on, down the "
            "line, at forty-five degrees, tilted, left handed, near, far, and at "
            "three frame rates, it returned 0.38 at worst and 0.89 or better on "
            "eleven of twelve. The gap is wide and this sits in it, close enough to "
            "the bad group to keep the hardest real angle."
        ),
    )
    min_detection_rate: float = Field(
        default=0.5,
        description=(
            "Share of frames in which a body must have been found. A clip where the "
            "estimator saw nobody most of the time cannot contain a measurable swing, "
            "whatever the event model then makes of the empty landmarks it was handed."
        ),
    )
    plausible_backswing_s: tuple[float, float] = Field(
        default=(0.30, 2.50),
        description=(
            "How long a backswing can take. Not a tuned parameter - the bounds are "
            "loose enough to hold any golfer and tight enough to reject a clip whose "
            "'backswing' lasted nineteen milliseconds, which is what a clip of "
            "somebody standing still produced."
        ),
    )
    plausible_downswing_s: tuple[float, float] = Field(default=(0.10, 1.00))
    plausible_tempo: tuple[float, float] = Field(
        default=(1.2, 6.0),
        description=(
            "Backswing over downswing. Tour players sit near three; club golfers "
            "spread either side. A clip cut off at the top produced thirty-four."
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
    event_uncertainty: tuple[ErrorBand | NoReading, ...] = Field(
        default=(),
        description=(
            "Per event, how far from the truth a prediction like this one has been "
            "observed to fall. Empty when no calibration was supplied, which is the "
            "honest state rather than a default of zero."
        ),
    )
    tempo_uncertainty: RelativeBand | None = Field(
        default=None,
        description=(
            "Measured spread on the tempo ratio, as a fraction of it. Kept here "
            "rather than on the Quantity itself because a Quantity deliberately has "
            "no slot for an error bar: an optional field is an invitation to fill it "
            "with a guess, and this one has to come from measured data or not exist."
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
            band = ""
            if index < len(self.event_uncertainty):
                measured = self.event_uncertainty[index]
                band = (
                    f"  +/-{measured.half_width_frames:.0f} frames "
                    f"({measured.half_width_ms:.0f} ms)"
                    if isinstance(measured, ErrorBand)
                    else "  (no measured band)"
                )
            lines.append(
                f"    {event.label:20s} frame {self.event_source_frames[index]:5d}  "
                f"t={self.event_times_s[index]:7.3f}s  "
                f"confidence {self.events.confidence[index]:.2f}{band}"
            )
        measured_on = next(
            (b.measured_on for b in self.event_uncertainty if isinstance(b, ErrorBand)), None
        )
        if measured_on is not None:
            coverage = next(b.coverage for b in self.event_uncertainty if isinstance(b, ErrorBand))
            lines.append(
                f"    bands hold for {100 * coverage:.0f}% of held-out events on {measured_on}"
            )

        if isinstance(self.metrics, NoReading):
            lines.append(f"  {self.metrics}")
            return "\n".join(lines)

        m = self.metrics
        lines.append("  swing:")
        if self.tempo_uncertainty is not None and not isinstance(m.tempo_ratio, NoReading):
            low, high = self.tempo_uncertainty.interval(m.tempo_ratio.value)
            lines.append(
                f"    {'tempo ratio':20s} {m.tempo_ratio.value:.2f}, and between "
                f"{low:.1f} and {high:.1f} on {self.tempo_uncertainty}"
            )
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


def save_model(model: SwingEventNet, path: Path | str) -> None:
    """Write a checkpoint that `load_model` can rebuild without being told anything.

    Paired with the loader deliberately. Three training scripts were writing this
    format by hand and one of them omitted the channel count, which produced
    checkpoints that trained perfectly and could not be loaded afterwards - a fault
    that costs however long the training run took to discover.

    Every argument the constructor takes is written, including the two that were
    missing here for the same reason as the original bug: the experiment script
    offers a kernel size and a padding mode, and a run that changed either wrote a
    checkpoint that quietly came back as a different network.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "in_features": int(model.input_projection.in_channels),
            "channels": int(model.channels),
            "dilations": list(model.dilations),
            "kernel_size": int(model.kernel_size),
            "padding_mode": str(model.padding_mode),
        },
        str(path),
    )


def load_model(checkpoint_path: Path | str) -> SwingEventNet:
    """Rebuild the trained model from a checkpoint.

    Tolerant of a checkpoint that predates a field, because a model that took an
    hour to train should not become unloadable over a missing dictionary key.
    """
    checkpoint = torch.load(str(checkpoint_path), map_location="cpu", weights_only=False)
    state = checkpoint["state_dict"]

    in_features = int(checkpoint.get("in_features", state["input_projection.weight"].shape[1]))
    channels = int(checkpoint.get("channels", state["input_projection.weight"].shape[0]))
    dilations = checkpoint.get("dilations")

    # A checkpoint from before either field was written is a zero-padded network
    # with a kernel of three, because that is what every script that could write
    # one was using at the time.
    replicated = checkpoint.get("padding_mode") == "replicate"
    padding_mode: PaddingMode = "replicate" if replicated else "zeros"
    model = SwingEventNet(
        in_features=in_features,
        channels=channels,
        dilations=tuple(int(d) for d in dilations) if dilations else DEFAULT_DILATIONS,
        kernel_size=int(checkpoint.get("kernel_size", 3)),
        padding_mode=padding_mode,
    )
    model.load_state_dict(state)
    model.eval()
    return model


def _implausible_timing(
    backswing_s: float, downswing_s: float, tempo: float, config: AnalysisConfig
) -> str | None:
    """Why this is not a golf swing, or None if nothing rules it out.

    Deliberately about durations rather than about the model's confidence. The two
    catch different failures: confidence catches a clip the model found confusing,
    these catch a clip the model was confident about and wrong.
    """
    low, high = config.plausible_backswing_s
    if not low <= backswing_s <= high:
        return (
            f"the backswing would have lasted {backswing_s * 1000:.0f} ms, outside the "
            f"{low * 1000:.0f} to {high * 1000:.0f} ms a golf swing takes. Whatever is "
            "in this clip, it is not a swing being made"
        )
    low, high = config.plausible_downswing_s
    if not low <= downswing_s <= high:
        return (
            f"the downswing would have lasted {downswing_s * 1000:.0f} ms, outside the "
            f"{low * 1000:.0f} to {high * 1000:.0f} ms a golf swing takes"
        )
    low, high = config.plausible_tempo
    if not low <= tempo <= high:
        return (
            f"the two halves imply a tempo of {tempo:.1f} to one, outside the {low:.1f} "
            f"to {high:.1f} a golf swing produces"
        )
    return None


def model_fingerprint(model: SwingEventNet | SwingEventEnsemble) -> str:
    """The digest a calibration is checked against.

    An ensemble folds in every member and the settings that change its answers,
    because those are part of what was measured: the same five members averaged
    with a different set of time warps make different predictions and deserve
    different bands.
    """
    if isinstance(model, SwingEventEnsemble):
        parts: list[tuple[str, NDArray[np.float32]]] = []
        for index, member in enumerate(model.members):
            for name, tensor in member.state_dict().items():
                parts.append((f"{index}.{name}", tensor.detach().numpy()))
        warps = ",".join(f"{w:.6f}" for w in model.config.time_warps)
        return fingerprint_state(
            [
                *parts,
                (
                    "time_warps",
                    np.frombuffer(warps.encode("utf-8"), dtype=np.uint8).astype(np.float32),
                ),
            ]
        )
    return fingerprint_state(
        (name, tensor.detach().numpy()) for name, tensor in model.state_dict().items()
    )


class ResolvedModel(BaseModel):
    """The model that will run, and where it came from.

    Three places used to work this out for themselves - the web service, the
    command line, and the tests - and they had drifted: the service preferred an
    ensemble and the others took the first single checkpoint they found. That was
    survivable while a model was just a model. It stopped being survivable when
    error bands arrived, because bands are measured through one particular set of
    weights and the answer to "which model runs" has to be the same everywhere or
    they are quoted against the wrong one.
    """

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    model: SwingEventNet | SwingEventEnsemble
    paths: tuple[Path, ...]
    calibration: ModelCalibration | None

    @property
    def description(self) -> str:
        if len(self.paths) > 1:
            return f"an ensemble of {len(self.paths)} models"
        return str(self.paths[0])


def resolve_model(
    explicit: Path | None = None, ensemble_config: EnsembleConfig | None = None
) -> ResolvedModel | None:
    """Load whichever model this installation should run, with its bands if they fit.

    An explicitly named checkpoint wins. Otherwise an ensemble if one has been
    trained, and a single model if not, because members disagree in different
    places and averaging them removes error none of them could remove alone.

    The calibration is attached only when it was measured through these exact
    weights. Found on disk by searching a path, a table has no way of knowing what
    it will be asked to describe, so the check happens here rather than being left
    to each caller to remember.
    """
    from swingml.assets import find_event_calibrations, find_event_ensemble, find_event_model

    paths: tuple[Path, ...]
    if explicit is not None:
        paths = (Path(explicit),)
        model: SwingEventNet | SwingEventEnsemble = load_model(explicit)
    else:
        members = find_event_ensemble()
        if members:
            paths = tuple(members)
            model = SwingEventEnsemble.load(
                list(members),
                ensemble_config or EnsembleConfig(time_warps=SERVING_TIME_WARPS),
            )
        else:
            single = find_event_model()
            if single is None:
                return None
            paths = (single,)
            model = load_model(single)

    # Whichever table was measured through these weights, if any of them was.
    # Choosing by fingerprint rather than by where the file sits means a machine
    # holding several tables cannot quote the wrong one, and a machine holding a
    # stale one quotes nothing.
    calibration = None
    digest = model_fingerprint(model)
    for candidate_path in find_event_calibrations():
        candidate = load_calibration(candidate_path)
        if candidate.matches(digest):
            calibration = candidate
            break

    return ResolvedModel(model=model, paths=paths, calibration=calibration)


def analyse_pose_sequence(
    sequence: PoseSequence,
    model: SwingEventNet | SwingEventEnsemble,
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
    if isinstance(model, SwingEventEnsemble):
        logits = model.logits(features)
    else:
        with torch.no_grad():
            logits = model(torch.from_numpy(features).unsqueeze(0))[0].numpy()

    if detection_rate < config.min_detection_rate:
        refusal = NoReading(
            reason=(
                f"a body was found in only {100 * detection_rate:.0f} percent of frames, "
                f"below the {100 * config.min_detection_rate:.0f} percent a swing needs. "
                "There may be nobody in shot, or the golfer may be too small, too dark "
                "or too far outside the frame to follow"
            ),
            source="pose",
        )
        return SwingAnalysis(
            video=video,
            detection_rate=detection_rate,
            canonical_frames=resampled.n_frames,
            events=refusal,
            event_times_s=(),
            event_source_frames=(),
            metrics=refusal,
            handedness=config.handedness,
        )

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

    # Whether what was found is shaped like a golf swing at all. The event model
    # will always return eight frames in order, because the decoder makes it - so
    # ordering alone proves nothing about a clip of somebody standing still. What
    # does prove something is how long the halves lasted. Nineteen milliseconds is
    # not a backswing and a tempo of thirty-four is not a swing, and both of those
    # came back confidently from clips containing no swing at all.
    grid_rate = config.features.canonical_rate_hz
    backswing_s = events.duration_frames(SwingEvent.ADDRESS, SwingEvent.TOP) / grid_rate
    downswing_s = events.duration_frames(SwingEvent.TOP, SwingEvent.IMPACT) / grid_rate
    tempo = backswing_s / downswing_s if downswing_s > 0 else float("inf")

    implausible = _implausible_timing(backswing_s, downswing_s, tempo, config)
    if implausible is not None:
        refusal = NoReading(reason=implausible, source="events")
        return SwingAnalysis(
            video=video,
            detection_rate=detection_rate,
            canonical_frames=resampled.n_frames,
            events=refusal,
            event_times_s=(),
            event_source_frames=(),
            metrics=refusal,
            handedness=config.handedness,
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

    # The band comes from the model's own confidence, looked up in a table of
    # errors measured on clips it was held out from. Without a table there is no
    # band, rather than a band of zero.
    uncertainty: tuple[ErrorBand | NoReading, ...] = ()
    tempo_band: RelativeBand | None = None
    if config.calibration is not None:
        # A table found by searching a path is not necessarily a table for the
        # model that got loaded. Quoting one model's error bars beside another
        # model's answers is worse than quoting none, so the weights are checked
        # and a mismatch reports the mismatch.
        if config.calibration.matches(model_fingerprint(model)):
            uncertainty = config.calibration.events.bands(events.confidence)
            tempo_band = config.calibration.tempo
        else:
            uncertainty = tuple(
                NoReading(
                    reason=(
                        "the error bands on disk were measured through different "
                        "weights than the model that ran, so they do not describe "
                        "this answer"
                    ),
                    source="calibration",
                )
                for _ in SwingEvent.ordered()
            )

    return SwingAnalysis(
        video=video,
        detection_rate=detection_rate,
        canonical_frames=resampled.n_frames,
        events=events,
        event_times_s=tuple(float(t) for t in times),
        event_source_frames=tuple(int(f) for f in source_frames),
        metrics=metrics,
        handedness=config.handedness,
        event_uncertainty=uncertainty,
        tempo_uncertainty=tempo_band,
    )


def analyse_video(
    path: Path | str,
    model: SwingEventNet | SwingEventEnsemble,
    estimator: PoseEstimator,
    config: AnalysisConfig | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> SwingAnalysis:
    """Read a clip, find the body, find the swing, measure it.

    Frames are streamed rather than loaded. A minute of phone video is tens of
    gigabytes of pixels and only a few hundred kilobytes of landmarks, so holding
    the clip in memory would cap the length of video this can accept for no
    reason connected to the problem.

    Args:
        on_progress: called with (frames done, frames expected) as the clip is
            read, so a caller can show something moving. The expected count comes
            from the container and can be wrong or absent, in which case it is
            reported as zero rather than guessed at.
    """
    config = config or AnalysisConfig()
    with VideoReader(path) as reader:
        expected = reader.declared_frames if reader.declared_frames > 0 else 0
        limit = config.max_frames

        def limited() -> Iterator[tuple[NDArray[np.uint8], float]]:
            for index, (frame, time_s) in enumerate(reader.frames()):
                if limit is not None and index >= limit:
                    break
                yield frame, time_s

        def relay(frames_done: int) -> None:
            if on_progress is not None:
                on_progress(frames_done, expected)

        sequence = estimator.estimate_stream(limited(), on_progress=relay)
        info = reader.describe_stream(sequence.n_frames, sequence.timestamps_s)

    return analyse_pose_sequence(sequence, model, config, video=info)
