"""Check that no clip appears twice, and say what is in the corpus.

The reason this exists is that every accuracy figure in the README rests on a
held-out set being genuinely held out, and nothing was checking it. Clips are
cached in archives built by separate runs of `make_detected_dataset.py`, each
started by hand with a seed offset; two runs given overlapping offsets produce
overlapping clips, one batch ends up in training and the other in test, and the
resulting number is not an error bar too small - it is a measurement of nothing.

So the check is content-based rather than trusting the seeds: a clip is its
features, and two clips are the same clip when those bytes match. That catches an
overlap regardless of how it happened, including from before the archives
recorded which seed each clip came from.

The second half is a description, printed whether or not anything is wrong,
because deciding what footage to generate next is a question about what the
corpus already contains and that was previously answered from memory.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import defaultdict
from itertools import pairwise
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig


def clip_digest(clip: np.ndarray) -> str:
    """A clip's identity, as the bytes of its features."""
    return hashlib.blake2b(
        np.ascontiguousarray(clip, dtype=np.float32).tobytes(), digest_size=16
    ).hexdigest()


def report_tempo_coverage(tempo: np.ndarray) -> None:
    """The tempo histogram, against the range the pipeline will actually accept.

    The buckets were here before and one of them read ">4.0: 0" for the whole
    life of the project without anyone reading it as a problem, because a count
    with nothing beside it is just a count. The gate accepts 1.2 to 6.0 and the
    corpus occupied 2.1 to 4.0, so more than half the range the thing answers
    questions about had never been trained on - and tempo is the number it
    exists to report. Printing the gate next to the histogram is what turns that
    zero into a sentence.
    """
    gate_lo, gate_hi = AnalysisConfig().plausible_tempo
    edges = (gate_lo, 2.1, 3.3, 4.0, 4.6, gate_hi)
    print("\n  tempo             ", end="")
    empty: list[str] = []
    for lo, hi in pairwise(edges):
        count = int(((tempo >= lo) & (tempo < hi)).sum())
        print(f"{lo:.1f}-{hi:.1f}: {count}  ", end="")
        if count == 0:
            empty.append(f"{lo:.1f}-{hi:.1f}")
    below = int((tempo < gate_lo).sum())
    above = int((tempo >= gate_hi).sum())
    print(f"| outside the gate: {below + above}")
    print(
        f"                    the pipeline accepts {gate_lo:.1f} to {gate_hi:.1f}; "
        f"this corpus spans {tempo.min():.2f} to {tempo.max():.2f}"
    )
    if empty:
        # Not an error. Whether a hole matters depends on whether real swings
        # land in it, which this script has no way to know, so it says where the
        # hole is and leaves the judgement to whoever is choosing what to build.
        print(f"                    NO FOOTAGE in {', '.join(empty)} of the accepted range")


def audit(paths: list[Path]) -> int:
    by_digest: dict[str, list[str]] = defaultdict(list)
    by_seed: dict[int, list[str]] = defaultdict(list)
    rows: list[dict[str, float]] = []

    for path in paths:
        data = np.load(path)
        # Pulled out once each: indexing an npz decompresses the whole member on
        # every access, and doing it inside the loop turns a hundred megabytes of
        # archive into tens of gigabytes of churn.
        features = data["features"]
        lengths = data["lengths"]
        seeds = data["seeds"] if "seeds" in data.files else None
        columns = {
            key: data[key]
            for key in ("azimuth_deg", "capture_rate_hz", "tempo_ratio", "left_handed")
        }
        landscape = data["landscape"] if "landscape" in data.files else None
        offsets = np.concatenate(([0], np.cumsum(lengths)))

        for index, length in enumerate(lengths):
            where = f"{path.name}[{index}]"
            by_digest[clip_digest(features[offsets[index] : offsets[index] + length])].append(where)
            if seeds is not None:
                by_seed[int(seeds[index])].append(where)
            rows.append(
                {
                    "file": path.name,  # type: ignore[dict-item]
                    "frames": int(length),
                    "landscape": float(landscape[index]) if landscape is not None else float("nan"),
                    **{key: float(value[index]) for key, value in columns.items()},
                }
            )
        print(
            f"  {path.name:<20} {len(lengths):5d} clips"
            + ("" if seeds is not None else "   (no seeds recorded)")
        )
        del features, data

    duplicates = {k: v for k, v in by_digest.items() if len(v) > 1}
    repeated_seeds = {k: v for k, v in by_seed.items() if len(v) > 1}

    print(f"\n{len(rows)} clips, {len(by_digest)} distinct")
    if duplicates:
        print(f"DUPLICATE CLIPS: {len(duplicates)}")
        for members in list(duplicates.values())[:20]:
            print("   ", " == ".join(members))
    if repeated_seeds:
        print(f"REPEATED SEEDS: {len(repeated_seeds)}")
        for seed, members in list(repeated_seeds.items())[:20]:
            print(f"    {seed}: {' == '.join(members)}")

    azimuth = np.abs([r["azimuth_deg"] for r in rows])
    rate = np.array([r["capture_rate_hz"] for r in rows])
    tempo = np.array([r["tempo_ratio"] for r in rows])
    left = np.array([r["left_handed"] for r in rows])
    landscape_flags = np.array([r["landscape"] for r in rows])

    print("\n  camera angle       face on <30  angled 30-70  down the line 70-110  behind >110")
    counts = [
        int((azimuth < 30).sum()),
        int(((azimuth >= 30) & (azimuth < 70)).sum()),
        int(((azimuth >= 70) & (azimuth < 110)).sum()),
        int((azimuth >= 110).sum()),
    ]
    print("  " + "".join(f"{c:>21d}" for c in counts))
    rates = "  ".join(f"{r:.0f} Hz: {int((rate == r).sum())}" for r in sorted(set(rate.tolist())))
    print("\n  capture rate      " + rates)
    report_tempo_coverage(tempo)
    print(f"  left handed       {int(left.sum())} of {len(rows)}")
    known = ~np.isnan(landscape_flags)
    print(
        f"  landscape         {int(np.nansum(landscape_flags))} of {int(known.sum())} recorded"
        + ("" if known.all() else f", {int((~known).sum())} from before it was recorded")
    )

    if duplicates or repeated_seeds:
        return 1
    print("\nno clip appears twice.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        type=Path,
        nargs="*",
        default=sorted(Path("out/detected").glob("*.npz"))
        + sorted(Path("out/holdout").glob("*.npz")),
    )
    args = parser.parse_args()
    paths = [p for p in args.paths if p.is_file()]
    if not paths:
        raise SystemExit("no archives to audit")
    raise SystemExit(audit(paths))


if __name__ == "__main__":
    main()
