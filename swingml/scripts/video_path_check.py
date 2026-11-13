"""Does the app's video path place events as well as the archived path does? (#40)

Every accuracy figure the product quotes comes through archived features: GolfDB
clips read once with OpenCV, timed frame i at i/fps, put through MediaPipe and
stored. The app reads a video through `VideoReader` instead. #19 measured that
path against the labels and got 18% within one frame on the core four, against
about 48% through the archive. This measures the paths on the same clips:

- `archive`: the archived features through the release gate's `decide`, which is
  how the quoted figures are scored;
- `video_before`: the app path as it was before #40. The poses were tracked with
  the timestamps `VideoReader` gave then, which slipped a frame partway through
  the clip; `scripts/slow_motion_rule.py poses` cached them before the fix, kept as
  `out/slowmo/poses_before_40`;
- `video_retimed`: the same cached poses with only the timestamps replaced by
  the fixed reader's. Any change from `video_before` is the timestamps alone;
- `video`: the app path now, end to end: the fixed reader, MediaPipe, then
  `analyse_pose_sequence`.

Every path is scored as the gate scores it: positions on the 60 Hz grid,
rounded, against the labelled frames. `subframe` gives the unrounded version
that #19 used. Per-event signed offsets (read minus label) carry 95% intervals
that resample golfer/video groups.

    python scripts/video_path_check.py poses --videos <GolfDB videos_160> [--part 0/3]
    python scripts/video_path_check.py score --out ../docs/audit/video-path-check.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.assets import find_event_model
from swingml.dataset.manifest import group_resamples, load, refuse_holdout_manifest, verify
from swingml.events import SwingEvent
from swingml.model.release_gate import decide
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.video.reader import VideoReader

MANIFEST = Path("swingml/manifests/golfdb-validation-v2.json")
CORE = (0, 3, 4, 5)
PATHS = ("archive", "video_before", "video_retimed", "video")


def clips(root: Path) -> list[dict[str, Any]]:
    """Every real-time clip of the split, with its archived features and labels."""
    manifest = load(MANIFEST)
    refuse_holdout_manifest(manifest)
    with np.load(verify(manifest, root)) as data:
        ends = np.cumsum(data["lengths"])
        starts = ends - data["lengths"]
        return [
            {
                "clip": int(data["seeds"][i]),
                "group": manifest.groups[i],
                "left": bool(data["left_handed"][i] > 0.5),
                "face_on": bool(data["azimuth_deg"][i] == 0.0),
                "events": data["events"][i].astype(np.int64),
                "features": data["features"][starts[i] : ends[i]],
            }
            for i in range(len(data["seeds"]))
            if data["slow"][i] < 0.5
        ]


def save_pose(path: Path, seq: PoseSequence) -> None:
    np.savez_compressed(
        path,
        xy=seq.xy,
        visibility=seq.visibility,
        timestamps_s=seq.timestamps_s,
        world_xyz=seq.world_xyz if seq.world_xyz is not None else np.zeros(0),
        detected=seq.detected if seq.detected is not None else np.zeros(0),
        size=np.array([seq.frame_width, seq.frame_height]),
    )


def read_pose(path: Path) -> PoseSequence:
    with np.load(path) as d:
        return PoseSequence(
            xy=d["xy"],
            visibility=d["visibility"],
            timestamps_s=d["timestamps_s"],
            world_xyz=d["world_xyz"] if d["world_xyz"].size else None,
            detected=d["detected"] if d["detected"].size else None,
            frame_width=int(d["size"][0]),
            frame_height=int(d["size"][1]),
        )


def cmd_poses(args: argparse.Namespace) -> None:
    """The app path's poses now: the fixed reader's frames and times into MediaPipe."""
    from swingml.pose.mediapipe_pose import MediaPipePoseEstimator

    part, parts = (int(v) for v in args.part.split("/"))
    estimator = MediaPipePoseEstimator()
    args.cache.mkdir(parents=True, exist_ok=True)
    todo = [c for k, c in enumerate(clips(args.root)) if k % parts == part]
    for done, clip in enumerate(todo, start=1):
        out = args.cache / f"{clip['clip']}.npz"
        if out.exists():
            continue
        with VideoReader(args.videos / f"{clip['clip']}.mp4") as reader:
            save_pose(out, estimator.estimate_stream(reader.frames()))
        if done % 10 == 0:
            print(f"  part {part}: {done}/{len(todo)} clips", flush=True)


def grid_positions(analysis: Any, rate: float) -> np.ndarray | None:
    """Event times as positions on the 60 Hz grid counted from the first frame."""
    if isinstance(analysis.events, NoReading):
        return None
    return np.asarray(analysis.event_times_s, dtype=np.float64) * rate


def cmd_score(args: argparse.Namespace) -> None:
    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped event model found")
    model = load_model(path)
    rows = []
    for clip in clips(args.root):
        hand = Handedness.LEFT if clip["left"] else Handedness.RIGHT
        config = AnalysisConfig(handedness=hand)
        rate = config.features.canonical_rate_hz
        decision = decide(model, clip["features"], config)
        before = read_pose(args.before / f"{clip['clip']}.npz")
        now = read_pose(args.cache / f"{clip['clip']}.npz")
        retimed = before.model_copy(update={"timestamps_s": now.timestamps_s})
        assert before.n_frames == now.n_frames, clip["clip"]
        if before.timestamps_s[0] != 0.0 or now.timestamps_s[0] != 0.0:
            raise SystemExit(f"clip {clip['clip']} does not start at zero")
        reads = {
            "archive": None if decision.positions is None else decision.positions,
            "video_before": grid_positions(analyse_pose_sequence(before, model, config), rate),
            "video_retimed": grid_positions(analyse_pose_sequence(retimed, model, config), rate),
            "video": grid_positions(analyse_pose_sequence(now, model, config), rate),
        }
        slip = np.nonzero(np.abs(before.timestamps_s - now.timestamps_s) > 1e-6)[0]
        rows.append(
            {
                "clip": clip["clip"],
                "group": clip["group"],
                "face_on": clip["face_on"],
                "labels": clip["events"].tolist(),
                "first_slipped_frame_30fps": int(slip[0]) if slip.size else None,
                "reads": {k: (None if v is None else [round(float(x), 3) for x in v])
                          for k, v in reads.items()},
            }
        )  # fmt: skip
    result: dict[str, Any] = {
        "source": "real-time clips of golfdb-validation-v2; holdout not read",
        "model_fingerprint": None,
        "all_real_time": summarise(rows, args.resamples, args.seed),
        "face_on": summarise([r for r in rows if r["face_on"]], args.resamples, args.seed),
        "clips": rows,
    }
    from swingml.analysis import model_fingerprint

    result["model_fingerprint"] = model_fingerprint(model)
    for name in ("all_real_time", "face_on"):
        part = result[name]
        print(f"{name}: n={part['n']} ({part['n_groups']} groups)")
        for p in PATHS:
            s = part[p]
            print(
                f"  {p:14s} answered {s['answered']}  "
                f"within 1 (gate) {s['within_1_core4']['share']:.3f} {s['within_1_core4']['ci95']}"
                f"  subframe {s['within_1_core4_subframe']:.3f}  "
                f"offsets {[s['offset_vs_labels'][e]['median'] for e in EVENTS]}"
            )
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


EVENTS = [e.name.lower() for e in SwingEvent.ordered()]


def interval(values: np.ndarray, groups: list[str], stat: Any, resamples: int,
             seed: int) -> list[float]:  # fmt: skip
    draws = [stat(values[i]) for i in group_resamples(groups, resamples,
                                                       np.random.default_rng(seed))]  # fmt: skip
    return [round(float(v), 4) for v in np.nanpercentile(draws, [2.5, 97.5])]


def summarise(rows: list[dict[str, Any]], resamples: int, seed: int) -> dict[str, Any]:
    # Clips every path answered, so the paths are compared on the same swings.
    both = [r for r in rows if all(r["reads"][p] is not None for p in PATHS)]
    groups = [r["group"] for r in both]
    labels = np.array([r["labels"] for r in both], dtype=np.float64)
    out: dict[str, Any] = {
        "n": len(both),
        "n_groups": len(set(groups)),
        "not_answered_by_every_path": len(rows) - len(both),
    }
    archive = np.array([r["reads"]["archive"] for r in both])
    for p in PATHS:
        read = np.array([r["reads"][p] for r in both])
        rounded = np.abs(np.rint(read) - labels)[:, list(CORE)] <= 1
        per_swing = rounded.mean(axis=1)
        signed = read - labels
        out[p] = {
            "answered": sum(r["reads"][p] is not None for r in rows),
            "within_1_core4": {
                "share": round(float(per_swing.mean()), 4),
                "ci95": interval(per_swing, groups, np.mean, resamples, seed),
            },
            "within_1_core4_subframe": round(
                float((np.abs(read - labels)[:, list(CORE)] <= 1).mean()), 4
            ),
            "offset_vs_labels": {
                name: {
                    "median": round(float(np.median(signed[:, k])), 3),
                    "ci95": interval(signed[:, k], groups, np.median, resamples, seed),
                }
                for k, name in enumerate(EVENTS)
            },
            "offset_vs_archive": {
                name: round(float(np.median((read - archive)[:, k])), 3)
                for k, name in enumerate(EVENTS)
            },
        }
    return out


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("poses", "score"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, default=Path("."))
        p.add_argument("--cache", type=Path, default=Path("out/videopath/poses"))
        if name == "poses":
            p.add_argument("--videos", type=Path, required=True)
            p.add_argument("--part", default="0/1", help="this worker's share, k/n")
        else:
            p.add_argument("--before", type=Path, default=Path("out/slowmo/poses_before_40"))
            p.add_argument("--out", type=Path, default=None)
            p.add_argument("--resamples", type=int, default=2000)
            p.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    {"poses": cmd_poses, "score": cmd_score}[args.command](args)


if __name__ == "__main__":
    main()
