"""How often the application answers real swings and refuses clips with no swing.

Measured through the application's own decision - decoder thresholds, the
plausible-timing gate, and the slow-motion retry - on a frozen test archive and on
no-swing stretches cut from the same videos (standing over the ball, walking off,
a swing cut off after the top). Printed with the retry and without it, so the
retry's cost in false accepts is on the same line as what it recovers.

The first published refusal figure (0.9% of real swings refused) was measured on
the decoder's confidence rule alone. Through the timing gate as well, 71 of 82
held-out slow-motion swings were refused; this script is how that was found.

    python scripts/measure_refusals.py --archive out/golfdb/split/holdout.npz
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig
from swingml.model.release_gate import decide, load_any, no_swing_stretches, read_archive, tempo_of


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--model", type=Path, default=Path("swingml/data/swing_event_net.pt"))
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    model = load_any(args.model)
    clips = read_archive(args.archive)
    negatives = no_swing_stretches(clips)
    slow = np.array([c.slow for c in clips])
    report: dict[str, dict[str, float]] = {}
    for label, config in (
        ("without_retry", AnalysisConfig(slow_motion_factors=())),
        ("with_retry", AnalysisConfig()),
    ):
        decisions = [decide(model, c.features, config) for c in clips]
        answered = np.array([d.positions is not None for d in decisions])
        retried = np.array([d.slowed_by is not None for d in decisions])
        errors = np.array(
            [
                abs(tempo_of(d.positions) - tempo_of(c.events)) / tempo_of(c.events)
                if d.positions is not None
                else np.nan
                for d, c in zip(decisions, clips, strict=True)
            ]
        )
        accepted = [decide(model, f, config).positions is not None for f in negatives]
        report[label] = {
            "real_time_answered": float(answered[~slow].mean()),
            "real_time_n": float((~slow).sum()),
            "slow_motion_answered": float(answered[slow].mean()) if slow.any() else float("nan"),
            "slow_motion_n": float(slow.sum()),
            "read_as_slow_motion": float(retried.sum()),
            "tempo_median_rel_error_real_time": float(np.nanmedian(errors[~slow])),
            "tempo_median_rel_error_slow_motion": float(np.nanmedian(errors[slow]))
            if slow.any()
            else float("nan"),
            "no_swing_accepted": float(np.mean(accepted)),
            "no_swing_n": float(len(accepted)),
        }
        print(label, json.dumps({k: round(v, 4) for k, v in report[label].items()}))
    if args.json is not None:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
