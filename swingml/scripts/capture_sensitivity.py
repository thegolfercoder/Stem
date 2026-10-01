"""How much readings move when only the capture changes (#19).

The practice loop calls a retest "moved" or "no detectable change", and decides
whether two swings can be compared, from thresholds that are judgement
(`swingml/insights/compare.py`). Part of what moves a reading between two
recordings is the measurement itself: a different frame rate, more compression,
the golfer a little nearer or off centre. That part can be measured without any
golfer by re-reading the same clip with only the capture changed.

Each face-on clip of `golfdb-validation-v2` (never the holdout) is read through
the whole pipeline, MediaPipe and then the app's decision and metrics, once as
it is and once per perturbation of its decoded frames:

- `half_rate`: every other frame dropped. The clips are 30 fps, so this is 30 to
  15 fps: the cost of halving the frame rate, not of 30 against 60.
- `jpeg20`: every frame JPEG-compressed at quality 20, a stand-in for a phone's
  heavy compression (not an H.264 re-encode).
- `scale80`, `scale120`: the picture zoomed so the golfer is 80% or 120% as tall
  (120% can crop the feet, which is part of what it tests).
- `shift10`, `shift20`: the picture moved sideways by 10% or 20% of its width.

    python scripts/capture_sensitivity.py run --videos <videos_160> --perturbation base
    python scripts/capture_sensitivity.py run --videos <videos_160> --perturbation half_rate
    ...
    python scripts/capture_sensitivity.py summarise --out ../docs/audit/capture-sensitivity.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.assets import find_event_model
from swingml.dataset.manifest import (
    group_resamples,
    load,
    refuse_holdout_manifest,
    verify,
)
from swingml.insights.compare import CameraSignature, SwingPoint, comparability
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.video.reader import VideoReader

Frame = NDArray[np.uint8]
MANIFEST = Path("swingml/manifests/golfdb-validation-v2.json")
CORE = (0, 3, 4, 5)  # address, top, mid-downswing, impact
MEASURES = {
    "tempo_ratio": "relative",
    "backswing_duration": "ms",
    "downswing_duration": "ms",
    "head_movement": "body lengths",
    "pelvis_sway": "body lengths",
    "shoulder_turn_foreshortened": "deg",
}


def _scale(frame: Frame, factor: float) -> Frame:
    h, w = frame.shape[:2]
    if factor < 1.0:
        small = cv2.resize(frame, (max(1, round(w * factor)), max(1, round(h * factor))))
        out = np.zeros_like(frame)
        y, x = (h - small.shape[0]) // 2, (w - small.shape[1]) // 2
        out[y : y + small.shape[0], x : x + small.shape[1]] = small
        return out
    ch, cw = round(h / factor), round(w / factor)
    y, x = (h - ch) // 2, (w - cw) // 2
    return np.asarray(cv2.resize(frame[y : y + ch, x : x + cw], (w, h)), dtype=np.uint8)


def _shift(frame: Frame, fraction: float) -> Frame:
    h, w = frame.shape[:2]
    move = np.array([[1, 0, fraction * w], [0, 1, 0]], dtype=np.float32)
    moved = cv2.warpAffine(frame, move, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return np.asarray(moved, dtype=np.uint8)


def _jpeg(frame: Frame, quality: int) -> Frame:
    bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
    ok, data = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    assert ok
    decoded = cv2.imdecode(data, cv2.IMREAD_COLOR)
    assert decoded is not None
    return np.asarray(cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB), dtype=np.uint8)


PERTURBATIONS: dict[str, tuple[Callable[[Frame], Frame], int]] = {
    # name: (what happens to each frame, keep every n-th frame)
    "base": (lambda f: f, 1),
    "half_rate": (lambda f: f, 2),
    "jpeg20": (lambda f: _jpeg(f, 20), 1),
    "scale80": (lambda f: _scale(f, 0.8), 1),
    "scale120": (lambda f: _scale(f, 1.2), 1),
    "shift10": (lambda f: _shift(f, 0.10), 1),
    "shift20": (lambda f: _shift(f, 0.20), 1),
}


def face_on(root: Path) -> list[dict[str, Any]]:
    manifest = load(MANIFEST)
    refuse_holdout_manifest(manifest)
    with np.load(verify(manifest, root)) as data:
        return [
            {
                "clip": int(data["seeds"][i]),
                "group": manifest.groups[i],
                "left": bool(data["left_handed"][i] > 0.5),
                "slow": bool(data["slow"][i] > 0.5),
                "events": [int(v) for v in data["events"][i]],  # 60 Hz grid from the first frame
            }
            for i in range(len(data["seeds"]))
            if data["azimuth_deg"][i] == 0.0
        ]


def read_clip(
    path: Path, change: Callable[[Frame], Frame], every: int
) -> Iterator[tuple[Frame, float]]:
    with VideoReader(path) as reader:
        for index, (frame, time_s) in enumerate(reader.frames()):
            if index % every == 0:
                yield change(frame), time_s


def reading(analysis: Any) -> dict[str, Any]:
    metrics = analysis.metrics
    values: dict[str, float | None] = {}
    for measure in MEASURES:
        r = None if isinstance(metrics, NoReading) else getattr(metrics, measure)
        values[measure] = None if r is None or isinstance(r, NoReading) else float(r.value)
    return {
        "answered": not isinstance(analysis.events, NoReading),
        "slowed_by": analysis.playback_slowed_by,
        "event_times_s": list(analysis.event_times_s),
        "camera": analysis.camera.model_dump() if analysis.camera is not None else None,
        "values": values,
    }


def cmd_run(args: argparse.Namespace) -> None:
    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped event model found")
    model = load_model(path)
    estimator = MediaPipePoseEstimator()
    change, every = PERTURBATIONS[args.perturbation]
    rows = []
    for done, clip in enumerate(face_on(args.root), start=1):
        sequence = estimator.estimate_stream(
            read_clip(args.videos / f"{clip['clip']}.mp4", change, every)
        )
        hand = Handedness.LEFT if clip["left"] else Handedness.RIGHT
        analysis = analyse_pose_sequence(sequence, model, AnalysisConfig(handedness=hand))
        row = {**clip, "t0": float(sequence.timestamps_s[0]), **reading(analysis)}
        rows.append(row)
        if done % 10 == 0:
            print(f"  {args.perturbation}: {done} clips", flush=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    (args.cache / f"{args.perturbation}.json").write_text(json.dumps(rows) + "\n", encoding="utf-8")
    print(f"wrote {args.perturbation}: {len(rows)} clips")


def _interval(
    values: NDArray[np.float64],
    groups: list[str],
    stat: Callable[[Any], float],
    resamples: int,
    seed: int,
) -> list[float]:
    rng = np.random.default_rng(seed)
    draws = [stat(values[idx]) for idx in group_resamples(groups, resamples, rng)]
    return [round(float(v), 4) for v in np.percentile(draws, [2.5, 97.5])]


def _change(base: dict[str, Any], other: dict[str, Any], measure: str) -> float | None:
    a, b = base["values"][measure], other["values"][measure]
    if a is None or b is None:
        return None
    return float(abs(b - a) / a if MEASURES[measure] == "relative" and a else abs(b - a))


def _accuracy(row: dict[str, Any]) -> tuple[float, float] | None:
    """Within 1 frame (core four, at 60 Hz) and relative tempo error, against the labels."""
    if not row["answered"] or row["slow"] or len(row["event_times_s"]) != 8:
        return None
    truth = np.asarray(row["t0"]) + np.asarray(row["events"], dtype=np.float64) / 60.0
    read = np.asarray(row["event_times_s"], dtype=np.float64)
    within = float(np.mean(np.abs(read[list(CORE)] - truth[list(CORE)]) <= 1 / 60 + 1e-6))
    true_tempo = (truth[3] - truth[0]) / (truth[5] - truth[3])
    read_tempo = (read[3] - read[0]) / (read[5] - read[3])
    return within, abs(read_tempo - true_tempo) / true_tempo


def cmd_summarise(args: argparse.Namespace) -> None:
    runs = {p: json.loads((args.cache / f"{p}.json").read_text()) for p in PERTURBATIONS}
    base = runs["base"]
    out: dict[str, Any] = {
        "clips": len(base),
        "groups": len({r["group"] for r in base}),
        "base_answered": sum(r["answered"] for r in base),
        "resamples": args.resamples,
        "perturbations": {},
    }
    for name, rows in runs.items():
        if name == "base":
            continue
        entry: dict[str, Any] = {
            "answered": sum(r["answered"] for r in rows),
            "newly_refused": sum(
                b["answered"] and not r["answered"] for b, r in zip(base, rows, strict=True)
            ),
            "measures": {},
        }
        for measure, unit in MEASURES.items():
            pairs = [(_change(b, r, measure), b["group"]) for b, r in zip(base, rows, strict=True)]
            kept = [(v, g) for v, g in pairs if v is not None and np.isfinite(v)]
            if len(kept) < 5:
                entry["measures"][measure] = {"n": len(kept)}
                continue
            values = np.array([v for v, _ in kept])
            groups = [g for _, g in kept]
            entry["measures"][measure] = {
                "unit": unit,
                "n": len(kept),
                "median_change": round(float(np.median(values)), 4),
                "median_ci95": _interval(values, groups, np.median, args.resamples, 1),
                "p90_change": round(float(np.percentile(values, 90)), 4),
                "p90_ci95": _interval(
                    values, groups, lambda v: np.percentile(v, 90), args.resamples, 2
                ),
            }
        verdicts: dict[str, list[bool]] = {"tempo_ratio": [], "head_movement": []}
        for b, r in zip(base, rows, strict=True):
            if b["camera"] is None or r["camera"] is None:
                continue
            before = [
                SwingPoint(
                    swing_id=1, value=0.0, handedness="r", camera=CameraSignature(**b["camera"])
                )
            ]
            after = [
                SwingPoint(
                    swing_id=2, value=0.0, handedness="r", camera=CameraSignature(**r["camera"])
                )
            ]
            for metric in verdicts:
                verdicts[metric].append(comparability(before, after, metric).comparable)
        entry["comparable_share"] = {
            m: {"share": round(float(np.mean(v)), 4), "n": len(v)} for m, v in verdicts.items() if v
        }
        out["perturbations"][name] = entry

    # The cost of halving the frame rate, against the labels, real-time clips only.
    paired = [
        (_accuracy(b), _accuracy(r), b["group"])
        for b, r in zip(base, runs["half_rate"], strict=True)
    ]
    both = [(a, h, g) for a, h, g in paired if a is not None and h is not None]
    groups = [g for _, _, g in both]
    accuracy: dict[str, Any] = {"n": len(both)}
    for k, key in enumerate(("within_1_core4", "tempo_rel_error")):
        full = np.array([a[k] for a, _, _ in both])
        half = np.array([h[k] for _, h, _ in both])
        stat: Callable[[Any], Any] = np.mean if k == 0 else np.median

        def gap(v: NDArray[np.float64], stat: Callable[[Any], Any] = stat) -> float:
            return float(stat(v[:, 1]) - stat(v[:, 0]))

        accuracy[key] = {
            "base": round(float(stat(full)), 4),
            "half_rate": round(float(stat(half)), 4),
            "difference": round(float(stat(half) - stat(full)), 4),
            "difference_ci95": _interval(
                np.stack([full, half], axis=1), groups, gap, args.resamples, 3 + k
            ),
        }
    out["half_rate_accuracy"] = accuracy
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="read every face-on clip under one perturbation")
    run.add_argument("--videos", type=Path, required=True)
    run.add_argument("--perturbation", choices=sorted(PERTURBATIONS), required=True)
    summarise = commands.add_parser("summarise", help="compare each perturbation with base")
    summarise.add_argument("--out", type=Path, required=True)
    summarise.add_argument("--resamples", type=int, default=2000)
    for sub in (run, summarise):
        sub.add_argument("--root", type=Path, default=Path("."))
        sub.add_argument("--cache", type=Path, default=Path("out/capture"))
    args = parser.parse_args(argv)
    {"run": cmd_run, "summarise": cmd_summarise}[args.command](args)


if __name__ == "__main__":
    main()
