"""How face-on a clip looks, from the shoulder ratio at address (#52, QA on read.js).

The tour body readings (#12) were measured on face-on clips only, so the browser's
read compares head, sway and turn with them only when the clip looks face on.
The app already measures `shoulder_ratio` (shoulder width over torso length at
address, `insights/compare.camera_signature`): about 1 face on, near 0 down the
line. This reads it through the shipped pipeline on every real-time clip of
`golfdb-validation-v2` (never the holdout), by GolfDB's labelled view, so the
threshold is taken from the face-on clips' own ratios.

    python scripts/face_on_ratio.py --out ../docs/audit/face-on-shoulder-ratio.json

Uses the pose cache of `scripts/slow_motion_rule.py poses`.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from slow_motion_rule import MANIFEST, clips, read_pose

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.assets import find_event_model
from swingml.insights.reference import FACE_ON_MIN_SHOULDER_RATIO
from swingml.skeleton import Handedness


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--cache", type=Path, default=Path("out/slowmo/poses"))
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)

    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped model")
    model = load_model(path)
    rows: list[dict[str, Any]] = []
    for clip in clips(args.root):
        if clip["slow"]:
            continue
        hand = Handedness.LEFT if clip["left"] else Handedness.RIGHT
        analysis = analyse_pose_sequence(
            read_pose(args.cache / f"{clip['clip']}.npz"), model, AnalysisConfig(handedness=hand)
        )
        ratio = analysis.camera.shoulder_ratio if analysis.camera else float("nan")
        view = clip["azimuth"]
        rows.append({
            "clip": clip["clip"],
            "view": "face on" if view == 0.0 else "down the line" if view == 90.0 else "other",
            "shoulder_ratio": None if math.isnan(ratio) else round(ratio, 4),
        })  # fmt: skip

    def spread(view: str) -> dict[str, Any]:
        values = np.array([r["shoulder_ratio"] for r in rows
                           if r["view"] == view and r["shoulder_ratio"] is not None])  # fmt: skip
        if not values.size:
            return {"n": 0}
        cut = FACE_ON_MIN_SHOULDER_RATIO
        return {
            "n": int(values.size),
            "min": round(float(values.min()), 3),
            "p5": round(float(np.percentile(values, 5)), 3),
            "median": round(float(np.median(values)), 3),
            "max": round(float(values.max()), 3),
            "at_or_above_threshold": int((values >= cut).sum()),
        }

    summary = {view: spread(view) for view in ("face on", "down the line", "other")}
    out = {
        "manifest": str(MANIFEST), "model": path.name, "holdout_read": False,
        "threshold": FACE_ON_MIN_SHOULDER_RATIO, "summary": summary, "clips": rows,
    }  # fmt: skip
    if args.out:
        args.out.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
