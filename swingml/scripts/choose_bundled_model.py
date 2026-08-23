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


def gate(model: object, sequence: PoseSequence, truth: dict[str, Any]) -> tuple[bool, str]:
    """Whether this checkpoint is allowed to ship, and what it did on the clip."""
    handedness = Handedness.LEFT if truth["handedness"] == "left" else Handedness.RIGHT
    analysis = analyse_pose_sequence(
        sequence,
        model,  # type: ignore[arg-type]
        AnalysisConfig(handedness=handedness),
    )
    if isinstance(analysis.events, NoReading):
        return False, "refused the clip"

    parts = []
    passed = True
    for key, event in EVENT_OF.items():
        error = abs(analysis.event_source_frames[int(event)] - truth["events"][key])
        allowed = truth["tolerance_frames"][key]
        if error > allowed:
            passed = False
        parts.append(f"{key} {error}/{allowed}" + ("!" if error > allowed else ""))
    return passed, "  ".join(parts)


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
    scored: list[tuple[Score, Path]] = []
    for path in args.members:
        model = load_model(path)
        score = evaluate(model, samples)
        allowed, detail = gate(model, sequence, truth)
        print(
            f"  {path.name:<14} {100 * score.within[1]:5.1f}%  {100 * score.within[2]:5.1f}%  "
            f"{100 * score.tempo_median_relative_error:5.1f}%   "
            f"{'pass' if allowed else 'FAIL'}  {detail}"
        )
        if allowed:
            scored.append((score, path))

    if not scored:
        raise SystemExit(
            "\nno candidate passed the real clip. Shipping one anyway would mean shipping a "
            "model already known to be wrong about the only person in this repository."
        )

    best, winner = max(scored, key=lambda pair: (pair[0].headline, pair[0].within[1]))
    print(f"\n{winner} wins: {best.summary()}")
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
