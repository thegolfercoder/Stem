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
    python scripts/slow_motion_rule.py withhold --out ../docs/audit/slow-motion-withhold.json

`withhold` (#49) checks what ships, on the same clips: the check keeps the
recorded-speed read and withholds durations, so every clip's events, times and
tempo must equal the read with the check off, and durations must be withheld
exactly where the check fires.
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
from swingml.dataset.manifest import group_resamples, load, refuse_holdout_manifest, verify
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
    rows, missing = [], 0
    for done, clip in enumerate(clips(args.root), start=1):
        pose = args.cache / f"{clip['clip']}.npz"
        if not pose.exists():
            missing += 1
            continue
        base = read_pose(pose)
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
    print(f"wrote {out}: {len(rows)} rows; {missing} clips had no poses yet")


def tempo_of(metrics: Any) -> float | None:
    if isinstance(metrics, NoReading):
        return None
    return getattr(metrics.tempo_ratio, "value", None)


def cmd_withhold(args: argparse.Namespace) -> None:
    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped model")
    model = load_model(path)
    reads = []
    for clip in clips(args.root):
        sequence = read_pose(args.cache / f"{clip['clip']}.npz")
        hand = Handedness.LEFT if clip["left"] else Handedness.RIGHT
        shipped = AnalysisConfig(handedness=hand)
        off = AnalysisConfig(handedness=hand, slow_motion_check_backswing_s=None)
        for by in (1.0,) if clip["slow"] else SLOWED:
            slowed = sequence.model_copy(update={"timestamps_s": sequence.timestamps_s * by})
            a = analyse_pose_sequence(slowed, model, shipped)
            b = analyse_pose_sequence(slowed, model, off)
            answered = not isinstance(a.events, NoReading)
            row: dict[str, Any] = {
                "clip": clip["clip"], "group": clip["group"], "replay": clip["slow"],
                "slowed_by": by, "answered": answered,
                "same_answer": answered == (not isinstance(b.events, NoReading)),
            }  # fmt: skip
            if not isinstance(a.events, NoReading) and not isinstance(b.events, NoReading):
                fired = a.playback_slowed_by is not None and b.playback_slowed_by is None
                ma, mb = a.metrics, b.metrics
                # A refused measurement (both None) is the same answer.
                same_tempo = tempo_of(ma) == tempo_of(mb)
                # No duration is shown when the metrics themselves were refused.
                withheld = isinstance(ma, NoReading) or isinstance(ma.backswing_duration, NoReading)
                row |= {
                    "same_events": a.events.frames == b.events.frames,
                    "same_times": a.event_times_s == b.event_times_s,
                    "same_tempo": bool(same_tempo),
                    "check_fired": fired,
                    "durations_withheld": withheld,
                    "withheld_only_where_slowed": withheld == (a.playback_slowed_by is not None),
                }  # fmt: skip
            reads.append(row)
    both = [r for r in reads if "same_events" in r]

    def count(rows: list[dict[str, Any]], key: str) -> int:
        return sum(1 for r in rows if r.get(key))

    summary: dict[str, Any] = {
        "reads": len(reads),
        "answered_by_both": len(both),
        "same_answer_or_refusal": count(reads, "same_answer"),
        "same_events": count(both, "same_events"),
        "same_event_times": count(both, "same_times"),
        "same_tempo": count(both, "same_tempo"),
        "durations_withheld_only_where_slowed": count(both, "withheld_only_where_slowed"),
        "check_fired": {},
    }
    for label, replay in (("real time", False), ("replays", True)):
        rows = [r for r in both if r["replay"] is replay and r["slowed_by"] == 1.0]
        summary["check_fired"][label] = {"n": len(rows), "fired": count(rows, "check_fired")}
    for by in SLOWED[1:]:
        rows = [r for r in both if not r["replay"] and r["slowed_by"] == by]
        summary["check_fired"][f"slowed {by:g}x"] = {
            "n": len(rows), "durations_withheld": count(rows, "durations_withheld"),
        }  # fmt: skip
    out = {
        "manifest": str(MANIFEST), "model": path.name,
        "holdout_read": False, "summary": summary, "reads": reads,
    }  # fmt: skip
    text = json.dumps(out, indent=2) + "\n"
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(json.dumps(summary, indent=2))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("poses", "probe", "summarise", "withhold"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, default=Path("."))
        p.add_argument("--cache", type=Path, default=Path("out/slowmo/poses"))
        if name == "poses":
            p.add_argument("--videos", type=Path, required=True)
        if name in ("summarise", "withhold"):
            p.add_argument("--out", type=Path, default=None)
            p.add_argument("--resamples", type=int, default=2000)
            p.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    {"poses": cmd_poses, "probe": cmd_probe, "summarise": cmd_summarise,
     "withhold": cmd_withhold}[args.command](args)  # fmt: skip


# The rules compared. `None` for the backswing is today's rule: retry only a clip
# refused at recorded speed. Otherwise a clip answered at recorded speed whose
# backswing is longer than `backswing_s` is also read at each factor, and is read
# as slow motion when the most confident of those beats the recorded-speed core
# confidence by more than `margin`.
FACTOR_SETS = {"2,4,8": (2.0, 4.0, 8.0), "2,3,4,8": (2.0, 3.0, 4.0, 8.0)}
BACKSWINGS = (None, 0.0, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5)
MARGINS = (0.0, 0.01, 0.02, 0.03, 0.05)
# Chosen before any result was seen: among rules whose false-slow rate on real-time
# swings is at most this, the one that reads the most 2x and 3x clips as slow
# motion; ties go to the larger backswing bound (fewer extra passes), then to the
# larger margin.
MAX_FALSE_SLOW = 0.02


def answered(read: dict[str, Any]) -> bool:
    return bool(read.get("decoded") and read["confident"] and read["timing_ok"])


def outcome(
    row: dict[str, Any], factors: tuple[float, ...], backswing: float | None, margin: float
) -> tuple[str, float | None]:
    """("real time" | "slow" | "refused", the factor read at)."""  # fmt: skip
    first = row["reads"]["1.0"]
    tried = [(row["reads"][str(f)], f) for f in factors]
    tried = [(r, f) for r, f in tried if answered(r)]
    best = max(tried, key=lambda t: t[0]["core"], default=None)
    if not answered(first):
        return ("slow", best[1]) if best else ("refused", None)
    if backswing is None or first["backswing_s"] <= backswing or best is None:
        return "real time", None
    return ("slow", best[1]) if best[0]["core"] > first["core"] + margin else ("real time", None)


def rate(flags: np.ndarray, groups: list[str], resamples: int, seed: int) -> dict[str, Any]:
    if not len(flags):
        return {"n": 0}
    draws = [
        float(np.mean(flags[i]))
        for i in group_resamples(groups, resamples, np.random.default_rng(seed))
    ]
    low, high = np.percentile(draws, [2.5, 97.5])
    return {
        "n": len(flags),
        "share": round(float(np.mean(flags)), 4),
        "ci95": [round(float(low), 4), round(float(high), 4)],
    }


def evaluate(rows: list[dict[str, Any]], factors: tuple[float, ...], backswing: float | None,
             margin: float, resamples: int, seed: int) -> dict[str, Any]:  # fmt: skip
    got = [outcome(r, factors, backswing, margin) for r in rows]
    result: dict[str, Any] = {}
    real = [i for i, r in enumerate(rows) if not r["slow"] and r["slowed"] == 1.0]
    answered_real = [i for i in real if answered(rows[i]["reads"]["1.0"])]
    result["false_slow"] = rate(
        np.array([got[i][0] == "slow" for i in answered_real]),
        [rows[i]["group"] for i in answered_real], resamples, seed,
    )  # fmt: skip
    for k in SLOWED[1:]:
        idx = [i for i, r in enumerate(rows) if not r["slow"] and r["slowed"] == k]
        result[f"slowed_{k:g}x"] = {
            "read_as_slow": rate(
                np.array([got[i][0] == "slow" for i in idx]),
                [rows[i]["group"] for i in idx], resamples, seed,
            ),
            "reported_as_measured": round(
                float(np.mean([got[i][0] == "real time" for i in idx])), 4
            ) if idx else None,
        }  # fmt: skip
    replays = [i for i, r in enumerate(rows) if r["slow"]]
    result["slow_motion_replays"] = {
        name: round(float(np.mean([got[i][0] == name for i in replays])), 4) if replays else None
        for name in ("slow", "real time", "refused")
    }
    result["n_replays"] = len(replays)
    return result


def cmd_summarise(args: argparse.Namespace) -> None:
    rows = json.loads((args.cache.parent / "probe.json").read_text(encoding="utf-8"))
    rules = []
    for name, factors in FACTOR_SETS.items():
        for backswing in BACKSWINGS:
            for margin in MARGINS if backswing is not None else (0.0,):
                rules.append(
                    {
                        "factors": name,
                        "backswing_s": backswing,
                        "margin": margin,
                        **evaluate(rows, factors, backswing, margin, args.resamples, args.seed),
                    }
                )

    def caught(rule: dict[str, Any]) -> float:
        return float(np.mean([rule[f"slowed_{k:g}x"]["read_as_slow"]["share"] for k in (2.0, 3.0)]))

    eligible = [r for r in rules if r["false_slow"]["share"] <= MAX_FALSE_SLOW]
    chosen = max(
        eligible,
        key=lambda r: (
            caught(r),
            -1.0 if r["backswing_s"] is None else r["backswing_s"],
            r["margin"],
            r["factors"] == "2,4,8",
        ),
    )
    today = next(r for r in rules if r["backswing_s"] is None and r["factors"] == "2,4,8")
    for rule in [*sorted(rules, key=caught, reverse=True)[:12], today]:
        print(
            f"{rule['factors']:8s} back>{rule['backswing_s']!s:5s} margin {rule['margin']:.2f}: "
            f"false slow {rule['false_slow']['share']:.3f} "
            f"caught 2x {rule['slowed_2x']['read_as_slow']['share']:.2f} "
            f"3x {rule['slowed_3x']['read_as_slow']['share']:.2f} "
            f"1.5x {rule['slowed_1.5x']['read_as_slow']['share']:.2f}"
        )
    print("chosen:", {k: chosen[k] for k in ("factors", "backswing_s", "margin")})

    def gap(row: dict[str, Any]) -> float | None:
        """Best slowed core confidence (2, 4, 8) minus the recorded-speed one."""
        first = row["reads"]["1.0"]
        slowed = [row["reads"][str(f)]["core"] for f in (2.0, 4.0, 8.0)]
        slowed = [c for c, f in zip(slowed, (2.0, 4.0, 8.0), strict=True)
                  if answered(row["reads"][str(f)])]  # fmt: skip
        return max(slowed) - first["core"] if slowed and answered(first) else None

    separation: dict[str, Any] = {}
    for k in SLOWED:
        gaps = [g for r in rows if not r["slow"] and r["slowed"] == k if (g := gap(r)) is not None]
        separation[f"slowed_{k:g}x"] = {
            "n": len(gaps),
            "min": round(min(gaps), 4),
            "p10": round(float(np.percentile(gaps, 10)), 4),
            "median": round(float(np.median(gaps)), 4),
            "max": round(max(gaps), 4),
        }
    real = [r for r in rows if not r["slow"] and r["slowed"] == 1.0]
    n_groups = len({r["group"] for r in real})
    result = {
        "source": "golfdb-validation-v2 through the shipped pipeline; holdout not read",
        "core_gap_best_slowed_minus_recorded": separation,
        "false_slow_zero_count_upper_95": {
            "swings_independent": round(3 / len(real), 4),
            "groups_as_units": round(3 / n_groups, 4),
            "n_swings": len(real),
            "n_groups": n_groups,
        },
        "n_clips": len({r["clip"] for r in rows}),
        "criterion": (
            f"false-slow share on answered real-time swings at most {MAX_FALSE_SLOW}; then "
            "the most 2x and 3x clips read as slow motion; ties to the larger backswing "
            "bound, then the larger margin"
        ),
        "today": today,
        "chosen": chosen,
        "rules": rules,
    }
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
