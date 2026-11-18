"""How much two people's labels of the same swings disagree, event by event.

An accuracy figure on phone swings is a comparison with one person's labels. If
two careful people place address 5 frames apart, a model 5 frames from either
of them is as good as a labeller, and no number below that means anything. This
measures that floor before any phone accuracy is claimed
(docs/ml/evaluation-plan.md, item 5).

Each labeller confirms positions in their own copy of the app and exports them
with `scripts/make_labelled_dataset.py`. Swings are matched by swing number by
default (two labellers working from one copy of the swing database), or with
`--map`, a JSON object from labeller A's swing numbers to B's. A swing labelled
by only one person is listed, never silently dropped. Events are compared on the
model's 60 Hz grid, which both exports use.

Intervals resample golfers when `--groups` (A's swing number to golfer) is given,
and single swings otherwise, which the output says.

    python scripts/label_agreement.py --a out/phone/alice.npz --b out/phone/bob.npz \\
        --groups out/phone/golfers.json --out docs/audit/label-agreement.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.dataset.manifest import group_resamples, guard_archive
from swingml.events import SwingEvent


def read_events(path: Path) -> dict[int, NDArray[np.int64]]:
    """Each swing's eight labelled frames, by swing number."""
    guard_archive(path)
    with np.load(path) as data:
        return {
            int(seed): np.asarray(events, dtype=np.int64)
            for seed, events in zip(data["seeds"], data["events"], strict=True)
        }


def tempo(events: NDArray[np.int64]) -> float:
    top, address, impact = int(SwingEvent.TOP), int(SwingEvent.ADDRESS), int(SwingEvent.IMPACT)
    down = float(events[impact] - events[top])
    return float(events[top] - events[address]) / down if down > 0 else float("nan")


def pair_up(
    a: dict[int, NDArray[np.int64]], b: dict[int, NDArray[np.int64]], mapping: dict[int, int]
) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Matched (A, B) swing numbers, and the swings only one labeller has."""
    pairs = [(i, mapping.get(i, i)) for i in sorted(a) if mapping.get(i, i) in b]
    only_a = [i for i in sorted(a) if mapping.get(i, i) not in b]
    matched_b = {j for _, j in pairs}
    only_b = [j for j in sorted(b) if j not in matched_b]
    return pairs, only_a, only_b


def summary(differences: NDArray[np.int64], tempo_gap: NDArray[np.float64]) -> dict[str, Any]:
    """Per event: median and 90th-percentile |A - B| in frames, share within 1."""
    absolute = np.abs(differences)
    out: dict[str, Any] = {}
    for event in SwingEvent.ordered():
        column = absolute[:, int(event)]
        out[event.name.lower()] = {
            "median_abs_frames": float(np.median(column)),
            "p90_abs_frames": float(np.percentile(column, 90)),
            "within_1": float(np.mean(column <= 1)),
            "median_signed_frames": float(np.median(differences[:, int(event)])),
        }
    finite = tempo_gap[np.isfinite(tempo_gap)]
    out["tempo_median_rel_difference"] = float(np.median(finite)) if finite.size else float("nan")
    return out


def agreement(
    a: dict[int, NDArray[np.int64]],
    b: dict[int, NDArray[np.int64]],
    mapping: dict[int, int],
    groups: dict[int, str] | None,
    resamples: int,
    seed: int,
) -> dict[str, Any]:
    pairs, only_a, only_b = pair_up(a, b, mapping)
    if not pairs:
        raise SystemExit("no swing was labelled by both; check --map")
    differences = np.stack([a[i] - b[j] for i, j in pairs])  # B relative to A, in frames
    tempo_a = np.array([tempo(a[i]) for i, _ in pairs])
    tempo_b = np.array([tempo(b[j]) for _, j in pairs])
    tempo_gap = np.abs(tempo_a - tempo_b) / tempo_a
    point = summary(differences, tempo_gap)

    labels = [groups[i] if groups else f"swing{i}" for i, _ in pairs]
    rng = np.random.default_rng(seed)
    draws = [
        summary(differences[idx], tempo_gap[idx]) for idx in group_resamples(labels, resamples, rng)
    ]

    def interval(pick: Any) -> list[float]:
        values = np.array([pick(d) for d in draws], dtype=np.float64)
        values = values[np.isfinite(values)]
        return [float(v) for v in np.percentile(values, [2.5, 97.5])] if values.size else []

    for event in SwingEvent.ordered():
        name = event.name.lower()
        for key in ("median_abs_frames", "within_1"):
            point[name][f"{key}_ci95"] = interval(lambda d, n=name, k=key: d[n][k])
    point["tempo_median_rel_difference_ci95"] = interval(lambda d: d["tempo_median_rel_difference"])
    return {
        "n_matched": len(pairs),
        "n_groups": len(set(labels)),
        "intervals_resample": "golfers" if groups else "single swings (no --groups given)",
        "only_in_a": only_a,
        "only_in_b": only_b,
        "per_event": point,
    }


def main(argv: list[str] | None = None) -> dict[str, Any]:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--a", type=Path, required=True, help="labeller A's export")
    parser.add_argument("--b", type=Path, required=True, help="labeller B's export")
    parser.add_argument("--map", type=Path, default=None, help="JSON: A swing number -> B's")
    parser.add_argument("--groups", type=Path, default=None, help="JSON: A swing number -> golfer")
    parser.add_argument("--resamples", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)

    def int_keys(path: Path | None) -> dict[int, Any]:
        if path is None:
            return {}
        return {int(k): v for k, v in json.loads(path.read_text(encoding="utf-8")).items()}

    mapping = {k: int(v) for k, v in int_keys(args.map).items()}
    groups = {k: str(v) for k, v in int_keys(args.groups).items()} or None
    result = agreement(
        read_events(args.a), read_events(args.b), mapping, groups, args.resamples, args.seed
    )
    print(
        f"{result['n_matched']} swings labelled by both ({result['n_groups']} groups; "
        f"intervals resample {result['intervals_resample']})"
    )
    if result["only_in_a"] or result["only_in_b"]:
        print(f"  labelled by A only: {result['only_in_a']}; by B only: {result['only_in_b']}")
    for event in SwingEvent.ordered():
        row = result["per_event"][event.name.lower()]
        print(
            f"  {event.label:20s} median |A-B| {row['median_abs_frames']:.1f} frames, "
            f"p90 {row['p90_abs_frames']:.1f}, within 1 frame {100 * row['within_1']:.0f}%"
        )
    gap = result["per_event"]["tempo_median_rel_difference"]
    print(f"  tempo median relative difference {gap:.3f}")
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    main()
