"""Build a training set out of what the pose estimator actually reports.

Training on the generator's own landmarks and then running on MediaPipe's turned
out to be the dominant error in the whole pipeline: the same swing scored a mean
event error of half a frame through synthetic landmarks and several frames
through the real estimator. The two disagree systematically - MediaPipe reports
where its own anatomical prior puts a joint, not where the body it was shown had
one - and no amount of noise modelling fixes a difference of convention.

So the swing is rendered to video, the real estimator is run over it, and *its*
output becomes the training input. The labels are still exact, because the
generator knows where the club was; only the features change. That removes the
convention mismatch and the noise-structure mismatch at once.

What it does not remove is the difference between a rendered figure and a
photograph of a person, which is why this closes part of the gap and not all of
it. It is expensive - a clip costs seconds rather than milliseconds - so the
output is cached and the intended use is fine-tuning a model already trained on
cheap synthetic landmarks, not training from scratch.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.features import FeatureConfig, extract_features, resample_pose
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.skeleton import Handedness
from synth.camera import CameraConfig
from synth.dataset import SampleConfig, _uniform
from synth.render import RenderConfig, render_swing_video
from synth.rig import BodyProportions, SwingGeometry
from synth.swing import SwingTiming, generate_swing


def build_one(
    seed: int,
    estimator: MediaPipePoseEstimator,
    config: SampleConfig,
    height: int,
    azimuth_range: tuple[float, float] | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, float]] | None:
    """Render one randomised swing, detect it, return features and true event frames."""
    rng = np.random.default_rng(seed)
    features_config = FeatureConfig()

    backswing = _uniform(rng, config.backswing_s)
    timing = SwingTiming(
        address_hold_s=_uniform(rng, (0.2, 1.4)),
        waggle_count=int(rng.integers(config.waggle_count[0], config.waggle_count[1] + 1)),
        waggle_amplitude_deg=_uniform(rng, (3.0, 11.0)),
        waggle_period_s=_uniform(rng, (0.35, 0.8)),
        backswing_s=backswing,
        downswing_s=backswing / _uniform(rng, config.tempo_ratio),
        follow_through_s=_uniform(rng, config.follow_through_s),
        finish_hold_s=_uniform(rng, (0.25, 0.7)),
    )
    geometry = SwingGeometry(
        plane_inclination_deg=_uniform(rng, config.plane_inclination_deg),
        spine_tilt_deg=_uniform(rng, config.spine_tilt_deg),
        top_phase_deg=_uniform(rng, config.top_phase_deg),
        finish_phase_deg=_uniform(rng, config.finish_phase_deg),
        max_wrist_hinge_deg=_uniform(rng, config.wrist_hinge_deg),
        lag_retention=_uniform(rng, config.lag_retention),
        hand_radius_m=_uniform(rng, config.hand_radius_m),
        sway_amplitude_m=_uniform(rng, (0.01, 0.08)),
        lift_amplitude_m=_uniform(rng, (0.0, 0.06)),
        head_drift_m=_uniform(rng, (0.0, 0.09)),
    )
    scale = _uniform(rng, config.body_scale)
    body = BodyProportions(
        **{
            field: getattr(BodyProportions(), field) * scale
            for field in BodyProportions.model_fields
        }
    )

    left_handed = bool(rng.random() < config.left_handed_probability)
    capture_rate = float(rng.choice((30.0, 60.0, 120.0)))
    swing = generate_swing(
        timing=timing,
        geometry=geometry,
        body=body,
        frame_rate_hz=capture_rate,
        left_handed=left_handed,
    )

    if azimuth_range is not None:
        azimuth = _uniform(rng, azimuth_range)
    else:
        azimuth = (
            _uniform(rng, (-20.0, 115.0))
            if rng.random() < config.azimuth_uniform_probability
            else float(rng.choice((0.0, 90.0))) + float(rng.normal(0.0, config.azimuth_spread_deg))
        )
    if left_handed:
        azimuth = -azimuth

    width = round(height * 9 / 16)
    camera = CameraConfig(
        azimuth_deg=azimuth,
        elevation_deg=_uniform(rng, config.elevation_deg),
        distance_m=_uniform(rng, config.distance_m),
        roll_deg=_uniform(rng, config.roll_deg),
        frame_width=width,
        frame_height=height,
        vertical_fov_deg=_uniform(rng, config.vertical_fov_deg),
        look_at_height_m=_uniform(rng, (0.9, 1.5)),
    )

    frames = render_swing_video(swing, camera, RenderConfig(), seed=seed)
    sequence = estimator.estimate(frames, swing.times_s)
    if sequence.detected is None or float(np.mean(sequence.detected)) < 0.6:
        return None

    resampled, grid = resample_pose(sequence, features_config.canonical_rate_hz)
    if resampled.n_frames < 32:
        return None

    handedness = Handedness.LEFT if left_handed else Handedness.RIGHT
    features = extract_features(resampled, handedness, features_config)

    event_frames = np.rint(
        (np.asarray(swing.truth.event_times_s) - grid[0]) * features_config.canonical_rate_hz
    ).astype(np.int64)
    event_frames = np.clip(event_frames, 0, resampled.n_frames - 1)
    if np.any(np.diff(event_frames) <= 0) or event_frames[-1] >= resampled.n_frames - 1:
        return None

    return (
        features,
        event_frames,
        {
            "tempo_ratio": timing.tempo_ratio,
            "azimuth_deg": azimuth,
            "capture_rate_hz": capture_rate,
            "left_handed": float(left_handed),
            "detection_rate": float(np.mean(sequence.detected)),
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=300)
    parser.add_argument("--seed-offset", type=int, default=500_000)
    parser.add_argument(
        "--height",
        type=int,
        default=854,
        help="render height; the estimator's cost scales with pixel count",
    )
    parser.add_argument("--out", type=Path, default=Path("out/detected/train.npz"))
    parser.add_argument(
        "--wide-tempo",
        action="store_true",
        help=(
            "draw tempo from 1.5 to 5.2 rather than 2.1 to 4.0. The corpus has "
            "never held a swing outside the narrow band while the plausibility "
            "gate accepts 1.2 to 6.0, so everything between is a hole the model "
            "has never been shown"
        ),
    )
    parser.add_argument(
        "--azimuth",
        type=float,
        nargs=2,
        default=None,
        metavar=("MIN", "MAX"),
        help=(
            "restrict camera azimuth to this range, for building extra data at an "
            "angle the model handles badly"
        ),
    )
    args = parser.parse_args()

    estimator = MediaPipePoseEstimator()
    config = (
        SampleConfig(tempo_ratio=(1.5, 5.2), backswing_s=(0.45, 1.35))
        if args.wide_tempo
        else SampleConfig()
    )

    all_features: list[np.ndarray] = []
    all_events: list[np.ndarray] = []
    all_meta: list[dict[str, float]] = []

    started = time.time()
    seed = args.seed_offset
    attempts = 0
    while len(all_features) < args.n and attempts < args.n * 3:
        attempts += 1
        result = build_one(
            seed,
            estimator,
            config,
            args.height,
            tuple(args.azimuth) if args.azimuth else None,
        )
        seed += 1
        if result is None:
            continue
        features, events, meta = result
        all_features.append(features)
        all_events.append(events)
        all_meta.append(meta)

        if len(all_features) % 10 == 0:
            elapsed = time.time() - started
            rate = elapsed / len(all_features)
            remaining = rate * (args.n - len(all_features))
            print(
                f"  {len(all_features)}/{args.n}  {rate:.1f}s each, ~{remaining / 60:.0f} min left",
                flush=True,
            )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        lengths=np.array([f.shape[0] for f in all_features]),
        features=np.concatenate(all_features, axis=0),
        events=np.stack(all_events),
        tempo_ratio=np.array([m["tempo_ratio"] for m in all_meta]),
        azimuth_deg=np.array([m["azimuth_deg"] for m in all_meta]),
        capture_rate_hz=np.array([m["capture_rate_hz"] for m in all_meta]),
        left_handed=np.array([m["left_handed"] for m in all_meta]),
    )
    print(
        f"wrote {args.out}: {len(all_features)} clips from {attempts} attempts "
        f"in {(time.time() - started) / 60:.0f} min"
    )


if __name__ == "__main__":
    main()
