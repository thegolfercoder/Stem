"""What a swing slowed 1.5 to 3 times looks like to the pipeline at recorded speed (#32).

The slow-motion retry in `analyse_pose_sequence` runs only when the first pass,
at recorded speed, is refused for its events. A clip slowed two or three times
passes every gate at recorded speed, because a doubled backswing still fits the
0.30 to 2.50 s bound, and its durations are then reported as measured. A rule that
catches it must not also catch real swings with a slow backswing, so it is chosen
here on `golfdb-validation-v2` (never the holdout), from what the pipeline
actually sees:

- every real-time clip read as recorded and re-timed as if slowed by 1.5, 2, 2.5
  and 3 (timestamps multiplied, the same frames);
- the split's own slow-motion replays, as recorded;
- for each, at recorded speed and read faster by each candidate factor: whether
  the events decode, the core confidence (geometric mean over address, top,
  mid-downswing and impact, as the retry uses), the backswing and downswing, and
  whether the timing gates pass.

    python scripts/slow_motion_rule.py poses --videos <GolfDB videos_160>
    python scripts/slow_motion_rule.py probe
    python scripts/slow_motion_rule.py summarise --out ../docs/audit/slow-motion-rule.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import (
    AnalysisConfig,
    _implausible_timing,
    analyse_pose_sequence,
    load_model,
)
from swingml.assets import find_event_model
from swingml.dataset.manifest import load, refuse_holdout_manifest, verify
from swingml.events import SwingEvent
from swingml.features import extract_features, resample_pose
from swingml.model.decode import decode_events
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

MANIFEST = Path("swingml/manifests/golfdb-validation-v2.json")
CORE = (0, 3, 4, 5)
SLOWED = (1.0, 1.5, 2.0, 2.5, 3.0)  # how much a real-time clip is slowed
READ_AT = (1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 8.0)  # how much faster it is then read


def clips(root: Path) -> list[dict[str, Any]]:
    manifest = load(MANIFEST)
    refuse_holdout_manifest(manifest)
    with np.load(verify(manifest, root)) as data:
        return [
            {
                "clip": int(data["seeds"][i]),
                "group": manifest.groups[i],
                "left": bool(data["left_handed"][i] > 0.5),
                "slow": bool(data["slow"][i] > 0.5),
                "azimuth": float(data["azimuth_deg"][i]),
                "tempo_label": float(data["tempo_ratio"][i]),
            }
            for i in range(len(data["seeds"]))
        ]


def cmd_poses(args: argparse.Namespace) -> None:
    from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
    from swingml.video.reader import VideoReader

    estimator = MediaPipePoseEstimator()
    args.cache.mkdir(parents=True, exist_ok=True)
    todo = clips(args.root)
    for done, clip in enumerate(todo, start=1):
        out = args.cache / f"{clip['clip']}.npz"
        if out.exists():
            continue
        with VideoReader(args.videos / f"{clip['clip']}.mp4") as reader:
            seq = estimator.estimate_stream(reader.frames())
        np.savez_compressed(
            out,
            xy=seq.xy,
            visibility=seq.visibility,
            timestamps_s=seq.timestamps_s,
            world_xyz=seq.world_xyz if seq.world_xyz is not None else np.zeros(0),
            detected=seq.detected if seq.detected is not None else np.zeros(0),
            size=np.array([seq.frame_width, seq.frame_height]),
        )
        if done % 10 == 0:
            print(f"  {done}/{len(todo)} clips", flush=True)


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


def logits_of(model: Any, features: np.ndarray) -> np.ndarray:
    """The same call `_analyse_at_recorded_speed` makes, for either kind of model."""
    if hasattr(model, "logits"):
        return np.asarray(model.logits(features))
    import torch

    model.eval()
    with torch.no_grad():
        return np.asarray(model(torch.from_numpy(features).unsqueeze(0))[0].numpy())


def probe(sequence: PoseSequence, model: Any, config: AnalysisConfig) -> dict[str, Any]:
    """One pass at the sequence's own timestamps, keeping what the gates would hide."""
    resampled, _ = resample_pose(sequence, config.features.canonical_rate_hz)
    logits = logits_of(model, extract_features(resampled, config.handedness, config.features))
    events = decode_events(logits, 0.0, 0.0)  # thresholds applied below, not here
    if isinstance(events, NoReading):
        return {"decoded": False}
    conf = np.maximum([events.confidence[i] for i in CORE], 1e-12)
    rate = config.features.canonical_rate_hz
    back = events.duration_frames(SwingEvent.ADDRESS, SwingEvent.TOP) / rate
    down = events.duration_frames(SwingEvent.TOP, SwingEvent.IMPACT) / rate
    tempo = back / down if down > 0 else float("inf")
    gated = decode_events(logits, config.min_mean_confidence, config.min_core_confidence)
    return {
        "decoded": True,
        "core": float(np.exp(np.mean(np.log(conf)))),
        "confident": not isinstance(gated, NoReading),
        "backswing_s": back,
        "downswing_s": down,
        "tempo": tempo,
        "timing_ok": _implausible_timing(back, down, tempo, config) is None,
    }


def cmd_probe(args: argparse.Namespace) -> None:
    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped event model found")
    model = load_model(path)
    rows = []
    for done, clip in enumerate(clips(args.root), start=1):
        base = read_pose(args.cache / f"{clip['clip']}.npz")
        hand = Handedness.LEFT if clip["left"] else Handedness.RIGHT
        config = AnalysisConfig(handedness=hand)
        for slowed in (1.0,) if clip["slow"] else SLOWED:
            seq = base.model_copy(update={"timestamps_s": base.timestamps_s * slowed})
            shipped = analyse_pose_sequence(seq, model, config)
            reads = {}
            for factor in READ_AT:
                faster = seq.model_copy(update={"timestamps_s": seq.timestamps_s / factor})
                reads[str(factor)] = probe(faster, model, config)
            metrics = shipped.metrics
            tempo = None if isinstance(metrics, NoReading) else metrics.tempo_ratio
            rows.append(
                {
                    **clip,
                    "slowed": slowed,
                    "shipped": {
                        "answered": not isinstance(shipped.events, NoReading),
                        "slowed_by": shipped.playback_slowed_by,
                        "tempo": None if tempo is None or isinstance(tempo, NoReading)
                        else float(tempo.value),
                    },
                    "reads": reads,
                }
            )  # fmt: skip
        if done % 10 == 0:
            print(f"  {done} clips", flush=True)
    out = args.cache.parent / "probe.json"
    out.write_text(json.dumps(rows) + "\n", encoding="utf-8")
    print(f"wrote {out}: {len(rows)} rows")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("poses", "probe", "summarise"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, default=Path("."))
        p.add_argument("--cache", type=Path, default=Path("out/slowmo/poses"))
        if name == "poses":
            p.add_argument("--videos", type=Path, required=True)
        if name == "summarise":
            p.add_argument("--out", type=Path, default=None)
            p.add_argument("--resamples", type=int, default=2000)
            p.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    {"poses": cmd_poses, "probe": cmd_probe, "summarise": cmd_summarise}[args.command](args)


def cmd_summarise(args: argparse.Namespace) -> None:  # filled in once the probe exists
    raise SystemExit("not yet")


if __name__ == "__main__":
    main()
