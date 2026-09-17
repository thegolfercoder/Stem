"""Turn GolfDB's fourteen hundred real swings into training clips.

Everything else in this corpus is a rendered figure. The measurements say that is
the binding constraint: the model reads 85.5 percent of events within one frame on
generated footage and puts the tempo of the one real swing in this repository at
3.70 against a truth of 2.10, because a real pose estimator on real video at thirty
frames a second loses the hands through impact. No amount of rendering fixes that,
and the accuracy against rendered clips stopped being the interesting number a
while ago.

GolfDB (McNally et al., CVPR Workshops 2019) is 1,400 YouTube swings of 246
players, hand-labelled with eight events. Those eight are *the same eight* this
project predicts, in the same order - the taxonomy here came from that paper - so
the labels transfer with no translation at all. 585 of the clips are down the line,
which is the view this model is worst at by fourteen points and the one coaches
actually film.

Three things about the dataset are worth knowing before trusting anything built
from it.

**Handedness is not annotated**, and feature extraction needs it to decide which
arm leads. It is inferred here, from the frame the labels say is the top of the
backswing: a right-hander's hands are above their right shoulder there. The margin
is recorded per clip so a weak call can be found later, and every run checks the
inference against the clips of players whose swing side is a matter of record.

**Just under half the clips are slow motion** - 642 of 1,400 - and the annotations
say so. Frame rate is read from the file, so a slow-motion clip looks like a slow
swing rather than a rescaled one. Tempo is a ratio and survives that; the channels
measured per second do not, and read low. The flag is stored rather than acted on,
because whether those clips help is a question for the benchmark.

**Nothing derived from the frames can be committed.** The clips are YouTube footage
and the GolfDB code is CC BY-NC 4.0, so this script reads the dataset and copies
none of it, and its output belongs in the gitignored `out/` like every other
cached corpus.

The output is the same archive format `make_detected_dataset.py` writes, so the
benchmark, the audit and `--extra-train` all read it without knowing the
difference.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np
import scipy.io as sio
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.events import SwingEvent
from swingml.features import FeatureConfig, extract_features, resample_pose
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.skeleton import Handedness, Landmark
from synth.dataset import label_frames

MIN_DETECTION_RATE = 0.6
"""Below this the estimator lost the golfer too often for the clip to be evidence.

The same gate the rendered corpus uses, so the two are filtered alike. Real
footage clears it far more easily than expected: the clips sampled while building
this scored a hundred percent.
"""

NOMINAL_AZIMUTH = {"face-on": 0.0, "down-the-line": 90.0}
"""What the view label implies about camera angle, in degrees.

A category standing in for an angle, not a measurement - "face-on" is somewhere
near zero and "down-the-line" somewhere near ninety, and the dataset says nothing
tighter. Clips labelled "other" get not-a-number rather than a guess, which drops
them out of any slice taken by angle instead of putting them in the wrong one.
"""

# Left-handed golfers with clips in GolfDB, for checking the inference against
# something other than itself. Deliberately short: a name is only listed where
# the player's swing side is a matter of public record and not in dispute.
KNOWN_LEFT_HANDED = ("PHIL MICKELSON", "BUBBA WATSON", "MIKE WEIR")


class Annotation(NamedTuple):
    """One row of GolfDB, with the fields this pipeline needs."""

    clip_id: int
    player: str
    view: str
    club: str
    slow: bool
    split: int
    events: NDArray[np.int64]
    """The eight swing events, numbered from the start of the preprocessed clip."""


def read_annotations(path: Path) -> list[Annotation]:
    """The .mat rather than the .pkl, which would pull in pandas for one column read."""
    out: list[Annotation] = []
    for record in sio.loadmat(str(path))["golfDB"][0]:
        events = np.asarray(record["events"]).ravel().astype(np.int64)
        out.append(
            Annotation(
                clip_id=int(np.asarray(record["id"]).ravel()[0]),
                player=str(np.asarray(record["player"]).ravel()[0]),
                view=str(np.asarray(record["view"]).ravel()[0]),
                club=str(np.asarray(record["club"]).ravel()[0]),
                slow=bool(np.asarray(record["slow"]).ravel()[0]),
                split=int(np.asarray(record["split"]).ravel()[0]),
                # events[0] is where the clip starts in the source video and
                # events[-1] where it ends; the eight swing events sit between.
                events=events[1:-1] - events[0],
            )
        )
    return out


def read_clip(path: Path) -> tuple[NDArray[np.uint8], float] | None:
    """Every frame as RGB, and the frame rate the file declares."""
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        return None
    rate = float(capture.get(cv2.CAP_PROP_FPS))
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    capture.release()
    if not frames or not np.isfinite(rate) or rate <= 0:
        return None
    return np.asarray(frames, dtype=np.uint8), rate


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


def build_one(
    record: Annotation, videos: Path, estimator: MediaPipePoseEstimator
) -> tuple[NDArray[np.float32], NDArray[np.int64], dict[str, float]] | None:
    """One real swing as features and labelled event frames, or None if unusable."""
    clip = read_clip(videos / f"{record.clip_id}.mp4")
    if clip is None:
        return None
    frames, rate_hz = clip

    events = record.events
    if events[-1] >= len(frames):
        # The annotation reaches past the end of the preprocessed clip.
        return None

    config = FeatureConfig()
    sequence = estimator.estimate(frames, np.arange(len(frames)) / rate_hz)
    if sequence.detected is None:
        return None
    detection_rate = float(np.mean(sequence.detected))
    if detection_rate < MIN_DETECTION_RATE:
        return None

    called = infer_handedness(sequence.xy, sequence.visibility, int(events[int(SwingEvent.TOP)]))
    if called is None:
        return None
    handedness, margin = called

    resampled, grid = resample_pose(sequence, config.canonical_rate_hz)
    if resampled.n_frames < 32:
        return None

    event_frames = label_frames(
        events / rate_hz, grid, config.canonical_rate_hz, resampled.n_frames
    )
    if event_frames is None:
        return None

    top, address, impact = int(SwingEvent.TOP), int(SwingEvent.ADDRESS), int(SwingEvent.IMPACT)
    backswing = int(event_frames[top]) - int(event_frames[address])
    downswing = int(event_frames[impact]) - int(event_frames[top])
    return (
        extract_features(resampled, handedness, config),
        event_frames,
        {
            "seed": float(record.clip_id),
            "tempo_ratio": backswing / max(downswing, 1),
            "azimuth_deg": NOMINAL_AZIMUTH.get(record.view, float("nan")),
            "capture_rate_hz": rate_hz,
            "left_handed": float(handedness is Handedness.LEFT),
            "landscape": 0.0,
            "detection_rate": detection_rate,
            "handedness_margin": margin,
            "slow": float(record.slow),
            "golfdb_split": float(record.split),
        },
    )


def write_archive(
    path: Path,
    features: list[NDArray[np.float32]],
    events: list[NDArray[np.int64]],
    meta: list[dict[str, float]],
) -> None:
    if not features:
        return

    def column(key: str) -> NDArray[np.float64]:
        return np.array([m[key] for m in meta], dtype=np.float64)

    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        lengths=np.array([f.shape[0] for f in features]),
        features=np.concatenate(features, axis=0),
        events=np.stack(events),
        # The GolfDB clip id, which names the clip for good. The audit checks for
        # a clip appearing twice by hashing its features; this makes the answer
        # traceable back to a video rather than only to a row.
        seeds=column("seed").astype(np.int64),
        tempo_ratio=column("tempo_ratio"),
        azimuth_deg=column("azimuth_deg"),
        capture_rate_hz=column("capture_rate_hz"),
        left_handed=column("left_handed"),
        landscape=column("landscape"),
        detection_rate=column("detection_rate"),
        handedness_margin=column("handedness_margin"),
        slow=column("slow"),
        golfdb_split=column("golfdb_split"),
    )
    print(f"  wrote {path}: {len(features)} clips", flush=True)


def report_handedness(meta: list[dict[str, float]], records: list[Annotation]) -> None:
    """How the inference did, against players whose swing side is known."""
    by_id = {int(m["seed"]): m for m in meta}
    margins = np.array([m["handedness_margin"] for m in meta])
    left = int(sum(m["left_handed"] for m in meta))
    print(f"\nhandedness: {left} left-handed of {len(meta)}")
    print(
        f"  margin  median {np.median(margins):.3f}  "
        f"10th percentile {np.percentile(margins, 10):.3f}"
    )
    print(f"  weak calls (margin < 0.05): {int((margins < 0.05).sum())}")

    # Only the named left-handers are checked. Counting everyone else as
    # right-handed would be assuming the answer and would drown three real
    # checks in thirteen hundred assumed ones.
    checked = [r for r in records if r.player.upper() in KNOWN_LEFT_HANDED and r.clip_id in by_id]
    missed = [r for r in checked if not by_id[r.clip_id]["left_handed"]]
    for record in missed:
        print(f"  MISSED {record.player}, clip {record.clip_id}: called right-handed")
    if checked:
        print(
            f"  {len(checked) - len(missed)} of {len(checked)} clips of known "
            "left-handers called correctly"
        )
    else:
        print("  no clips of known left-handers in this batch")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, required=True, help="golfDB.mat")
    parser.add_argument("--videos", type=Path, required=True, help="the videos_160 directory")
    parser.add_argument("--out", type=Path, default=Path("out/golfdb/golfdb.npz"))
    parser.add_argument("--chunk", type=int, default=100, help="clips per archive")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many clips")
    parser.add_argument("--start", type=int, default=0, help="skip this many annotations first")
    parser.add_argument("--stride", type=int, default=1, help="take every nth, for parallel runs")
    args = parser.parse_args()

    records = read_annotations(args.annotations)[args.start :: args.stride]
    print(f"{len(records)} annotations to try from {args.annotations}", flush=True)

    estimator = MediaPipePoseEstimator()
    all_features: list[NDArray[np.float32]] = []
    all_events: list[NDArray[np.int64]] = []
    all_meta: list[dict[str, float]] = []
    kept_meta: list[dict[str, float]] = []
    written = chunk_index = refused = 0
    started = time.time()

    for attempt, record in enumerate(records, start=1):
        if args.limit and written + len(all_features) >= args.limit:
            break
        result = build_one(record, args.videos, estimator)
        if result is None:
            refused += 1
            continue
        features, events, meta = result
        all_features.append(features)
        all_events.append(events)
        all_meta.append(meta)
        kept_meta.append(meta)

        if args.chunk and len(all_features) >= args.chunk:
            write_archive(
                args.out.with_name(f"{args.out.stem}_{chunk_index:03d}{args.out.suffix}"),
                all_features,
                all_events,
                all_meta,
            )
            written += len(all_features)
            chunk_index += 1
            all_features, all_events, all_meta = [], [], []

        done = written + len(all_features)
        if done and done % 20 == 0 and attempt % 20 == 0:
            rate = (time.time() - started) / max(done, 1)
            print(
                f"  {done} kept, {refused} refused, {rate:.1f}s each, "
                f"~{rate * (len(records) - attempt) / 60:.0f} min left",
                flush=True,
            )

    write_archive(
        args.out.with_name(f"{args.out.stem}_{chunk_index:03d}{args.out.suffix}")
        if args.chunk
        else args.out,
        all_features,
        all_events,
        all_meta,
    )
    total = written + len(all_features)
    print(f"done: {total} clips kept, {refused} refused, in {(time.time() - started) / 60:.0f} min")
    if kept_meta:
        report_handedness(kept_meta, records)


if __name__ == "__main__":
    main()
