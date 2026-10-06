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
from synth.dataset import SampleConfig, SwingDraw, draw_swing, label_frames
from synth.render import RenderConfig, render_swing_video

MIN_DETECTION_RATE = 0.6
"""Below this the estimator lost the golfer often enough that the clip is not
evidence about a swing. Rejecting is cheap here and the alternative is training
on interpolation."""


def build_one(
    draw: SwingDraw, estimator: MediaPipePoseEstimator, long_edge: int
) -> tuple[np.ndarray, np.ndarray, dict[str, float]] | None:
    """Render one drawn swing, detect it, return features and true event frames.

    The expensive half. Everything random about the clip was decided by
    `draw_swing`; what happens here is the part that costs seconds - drawing the
    frames and running a real pose estimator over them - and the part that can
    fail, because a rendered figure can go off the edge of the frame or come out
    too small for the estimator to find.
    """
    features_config = FeatureConfig()
    swing = draw.swing()
    frames = render_swing_video(swing, draw.camera(long_edge), RenderConfig(), seed=draw.seed)
    sequence = estimator.estimate(frames, swing.times_s)
    if sequence.detected is None or float(np.mean(sequence.detected)) < MIN_DETECTION_RATE:
        return None

    resampled, grid = resample_pose(sequence, features_config.canonical_rate_hz)
    if resampled.n_frames < 32:
        return None

    event_frames = label_frames(
        swing.truth.event_times_s, grid, features_config.canonical_rate_hz, resampled.n_frames
    )
    if event_frames is None:
        return None

    meta = draw.metadata()
    meta["detection_rate"] = float(np.mean(sequence.detected))
    return (
        extract_features(resampled, draw.handedness, features_config),
        event_frames,
        meta,
    )


def write_archive(
    path: Path,
    features: list[np.ndarray],
    events: list[np.ndarray],
    meta: list[dict[str, float]],
) -> None:
    """One cached batch of clips, with everything needed to slice or audit it."""
    if not features:
        return

    def column(key: str) -> np.ndarray:
        return np.array([m[key] for m in meta])

    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        lengths=np.array([f.shape[0] for f in features]),
        features=np.concatenate(features, axis=0),
        events=np.stack(events),
        # The seed is what makes a cached clip identifiable after the fact. Without
        # it there is no way to tell whether two batches overlap, and an overlap
        # between a training batch and a held-out one is the one mistake that makes
        # every number downstream of it a lie.
        seeds=column("seed").astype(np.int64),
        tempo_ratio=column("tempo_ratio"),
        azimuth_deg=column("azimuth_deg"),
        capture_rate_hz=column("capture_rate_hz"),
        left_handed=column("left_handed"),
        landscape=column("landscape"),
        detection_rate=column("detection_rate"),
    )
    print(f"  wrote {path}: {len(features)} clips", flush=True)


def chunk_path(out: Path, index: int) -> Path:
    return out.with_name(f"{out.stem}_{index:03d}{out.suffix}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=300)
    parser.add_argument("--seed-offset", type=int, default=500_000)
    parser.add_argument(
        "--long-edge",
        type=int,
        default=854,
        help=(
            "the long side of the rendered frame; the short side is 9/16 of it. "
            "The estimator's cost scales with pixel count, and sizing by the long "
            "edge rather than the height keeps a landscape clip as cheap as a "
            "portrait one instead of three times the price"
        ),
    )
    parser.add_argument("--out", type=Path, default=Path("out/detected/train.npz"))
    parser.add_argument(
        "--chunk",
        type=int,
        default=0,
        help=(
            "write a numbered archive every this many clips instead of one at the "
            "end. Rendering three hundred clips is over an hour and an archive is "
            "only written when it finishes, so an interruption at any point during "
            "that hour left nothing at all - which happened twice. The corpus is a "
            "list of archives anyway, so several small ones cost nothing"
        ),
    )
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
    # 240 Hz is left out deliberately. It is eight times the frames to render and
    # to detect as 30 Hz and it is the easy case - the measured accuracy at 120 is
    # already the best of the three rates in the corpus.
    rates = (30.0, 60.0, 120.0)
    config = (
        SampleConfig(capture_rates_hz=rates, tempo_ratio=(1.5, 5.2), backswing_s=(0.45, 1.35))
        if args.wide_tempo
        else SampleConfig(capture_rates_hz=rates)
    )
    azimuth = tuple(args.azimuth) if args.azimuth else None

    all_features: list[np.ndarray] = []
    all_events: list[np.ndarray] = []
    all_meta: list[dict[str, float]] = []

    started = time.time()
    seed = args.seed_offset
    attempts = 0
    written = 0
    chunk_index = 0
    while written + len(all_features) < args.n and attempts < args.n * 3:
        attempts += 1
        result = build_one(draw_swing(seed, config, azimuth), estimator, args.long_edge)
        seed += 1
        if result is None:
            continue
        features, events, meta = result
        all_features.append(features)
        all_events.append(events)
        all_meta.append(meta)

        if args.chunk and len(all_features) >= args.chunk:
            write_archive(chunk_path(args.out, chunk_index), all_features, all_events, all_meta)
            written += len(all_features)
            chunk_index += 1
            all_features, all_events, all_meta = [], [], []

        if (written + len(all_features)) % 10 == 0:
            done = written + len(all_features)
            elapsed = time.time() - started
            rate = elapsed / max(done, 1)
            print(
                f"  {done}/{args.n}  {rate:.1f}s each, ~{rate * (args.n - done) / 60:.0f} min left",
                flush=True,
            )

    args.out.parent.mkdir(parents=True, exist_ok=True)

    last = chunk_path(args.out, chunk_index) if args.chunk else args.out
    write_archive(last, all_features, all_events, all_meta)
    print(
        f"done: {written + len(all_features)} clips from {attempts} attempts "
        f"in {(time.time() - started) / 60:.0f} min"
    )


if __name__ == "__main__":
    main()
