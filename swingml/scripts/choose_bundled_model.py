"""Decide which trained checkpoint ships inside the package.

An ensemble is better than any of its members and too heavy to bundle, so one
member goes into `swingml/data/` and into the browser payload. Which one had been
a judgement made once by hand, on the best score over generated clips - and that
picked a member which puts the finish thirty-eight frames late on the only real
swing in the repository. It scored well on rendered footage and was wrong about a
person.

So the real clip is a gate rather than a tiebreak, which is what the fixture has
always claimed it is for: it is not a benchmark and proves nothing about the
general case, but it stops a change that looks fine on generated data from
quietly breaking the real thing. A member that misses it does not ship, whatever
it scores. Among the members that pass, the best score on held-out generated
clips wins, because that is a hundred and sixty clips against one.

The tolerances are the fixture's own, so this and the regression test cannot
disagree about what passing means.

There is a second acceptance criterion this script reports but does not enforce,
because enforcing it would mean calibrating every candidate: whether a candidate's
own measured error bands contain the truth on that clip. A wrong error bar is
worse than none, and bands measured on rendered footage come out too tight for
video of a person. `tests/test_real_swing.py` is where that is checked, against
the checkpoint actually installed. Run it before believing this script.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.events import SwingEvent
from swingml.model.benchmark import Score, evaluate, load_samples
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
MARGIN_POINTS = 0.02
"""Within-one-frame difference this holdout cannot resolve, as a fraction.

Two points. Measured, not chosen: a paired bootstrap over these 160 clips puts the
95 percent interval on a difference between two members at roughly plus or minus
two points, so anything inside that is a tie however confidently it is printed.
"""

EVENT_OF = {
    "address": SwingEvent.ADDRESS,
    "top": SwingEvent.TOP,
    "impact": SwingEvent.IMPACT,
    "finish": SwingEvent.FINISH,
}


def real_clip(landmarks: Path) -> PoseSequence:
    data = np.load(landmarks)
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )


def gate(model: object, sequence: PoseSequence, truth: dict[str, Any]) -> tuple[bool, float, str]:
    """Whether this checkpoint may ship, how wrong its tempo is, and what it did.

    Tempo is reported rather than gated, and the reason is worth writing down: no
    checkpoint ever trained here reads this clip's tempo correctly. The truth is
    2.10 and eleven models spread from 2.92 to 4.14, because every one of them puts
    impact a frame early and the top two or three frames late, which turns a
    ten-frame downswing into six or seven. A gate that rejected them all would
    leave nothing to ship and would be a way of not saying so.

    The cause is largely upstream. This clip is thirty frames a second and the
    estimator loses the hands through impact - the fixture's own notes record hand
    speed reading 19.8, 6.7, 1.9 then 3.9 across four consecutive frames, which no
    body does - so the model is asked to find impact in landmarks that have already
    lost it. At thirty frames a second one frame is ten percent of a downswing.
    """
    handedness = Handedness.LEFT if truth["handedness"] == "left" else Handedness.RIGHT
    analysis = analyse_pose_sequence(
        sequence,
        model,  # type: ignore[arg-type]
        AnalysisConfig(handedness=handedness),
    )
    if isinstance(analysis.events, NoReading):
        return False, float("inf"), "refused the clip"

    true_tempo = (truth["events"]["top"] - truth["events"]["address"]) / (
        truth["events"]["impact"] - truth["events"]["top"]
    )
    metrics = analysis.metrics
    tempo_error = float("inf")
    if not isinstance(metrics, NoReading) and not isinstance(metrics.tempo_ratio, NoReading):
        tempo_error = abs(metrics.tempo_ratio.value - true_tempo) / true_tempo

    parts = []
    passed = True
    for key, event in EVENT_OF.items():
        error = abs(analysis.event_source_frames[int(event)] - truth["events"][key])
        allowed = truth["tolerance_frames"][key]
        if error > allowed:
            passed = False
        parts.append(f"{key} {error}/{allowed}" + ("!" if error > allowed else ""))
    parts.append(f"tempo {100 * tempo_error:.0f}%")
    return passed, tempo_error, "  ".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--members", type=Path, nargs="+", required=True)
    parser.add_argument(
        "--holdout",
        type=Path,
        nargs="+",
        required=True,
        help="generated clips no candidate was trained on",
    )
    parser.add_argument("--landmarks", type=Path, default=FIXTURES / "real_swing_01.npz")
    parser.add_argument("--truth", type=Path, default=FIXTURES / "real_swing_01.json")
    parser.add_argument(
        "--install",
        type=Path,
        default=None,
        help="copy the winner here, which is how it gets into the package",
    )
    args = parser.parse_args()

    samples = load_samples(args.holdout)
    if not samples:
        raise SystemExit("no holdout clips")
    sequence = real_clip(args.landmarks)
    truth = json.loads(args.truth.read_text(encoding="utf-8"))

    print(f"{len(samples)} held-out clips, and the real swing as a gate\n")
    print("  member            ±1f     ±2f   tempo    real clip")
    scored: list[tuple[Score, float, Path]] = []
    for path in args.members:
        model = load_model(path)
        score = evaluate(model, samples)
        allowed, tempo_error, detail = gate(model, sequence, truth)
        print(
            f"  {path.name:<14} {100 * score.within[1]:5.1f}%  {100 * score.within[2]:5.1f}%  "
            f"{100 * score.tempo_median_relative_error:5.1f}%   "
            f"{'pass' if allowed else 'FAIL'}  {detail}"
        )
        if allowed:
            scored.append((score, tempo_error, path))

    best_score = max(row[0].within[1] for row in scored) if scored else 0.0
    if not scored:
        raise SystemExit(
            "\nno candidate passed the real clip. Shipping one anyway would mean shipping a "
            "model already known to be wrong about the only person in this repository."
        )

    # Two keys, because one is not enough and the reason is measured rather than
    # assumed.
    #
    # The first version ranked on `headline`, which is within two frames - the right
    # key for comparing two *experiments*, being the more stable of the two, and the
    # wrong key for picking a checkpoint. Run over five members it chose one leading
    # by two tenths of a point within two frames while trailing by 1.4 within one
    # frame, and two tenths across 160 clips is not a difference, it is which clips
    # were drawn.
    #
    # Ranking on within-one-frame instead exposed the real problem: across the
    # candidates that pass the gate the spread is 82.1 to 83.5, and a paired
    # bootstrap over these same 160 clips puts the 95 percent interval on any such
    # difference at roughly plus or minus two points. So the primary key cannot
    # separate them, and pretending it can is how the choice ends up being made by
    # noise.
    #
    # Everything within `MARGIN_POINTS` of the best is therefore treated as tied,
    # and the tie is broken on the one real swing - by how wrong its tempo is, which
    # is the number the interface leads with and the thing no generated clip can
    # speak to. Both rules were changed after seeing what they picked, which is
    # worth stating; neither justification depends on that.
    close = [row for row in scored if row[0].within[1] >= best_score - MARGIN_POINTS]
    best, tempo_error, winner = min(close, key=lambda row: row[1])
    if len(close) > 1:
        print(
            f"\n{len(close)} of {len(scored)} are within {100 * MARGIN_POINTS:.0f} "
            "points within one frame, which this holdout cannot separate. "
            "Broken on the real clip's tempo."
        )
    print(f"\n{winner} wins: {best.summary()}")
    print(f"  and is off by {100 * tempo_error:.0f}% on the real clip's tempo")
    if len(scored) < len(args.members):
        rejected = len(args.members) - len(scored)
        print(f"  {rejected} of {len(args.members)} were excluded by the real clip")

    if args.install is not None:
        args.install.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(winner, args.install)
        print(f"  copied to {args.install}")
        print("  the calibration on disk no longer describes it - measure a new one")


if __name__ == "__main__":
    main()
