"""Combine golfers' labelled phone swings into one frozen phone test set.

Each golfer's app exports the swings they confirmed position by position
(`scripts/make_labelled_dataset.py`). Swing numbers are local to one app, so two
golfers' swing 3 are different swings: this renumbers them 1..N, keeps which
golfer each came from as its leakage group (`phone:<golfer>`), writes one
archive, and freezes it as a `phone-holdout` manifest. From then on it is read
only by the release gate, which reports it apart from GolfDB (gate 10).

Who collects the swings, and under what consent, is the owner's decision (#20);
`--source` must say it, and it is written into the manifest.

    python scripts/make_phone_test_set.py \\
        --export alice=out/phone/alice.npz --export bob=out/phone/bob.npz \\
        --name phone-holdout-v1 --source "..." \\
        --out out/phone/holdout.npz --manifest-out out/phone/phone-holdout-v1.json

Adding the manifest to `swingml/manifests/` is a change to a protected path and
needs the owner's decision on an issue (agents/config.toml).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.dataset.manifest import Manifest, freeze

GOLFER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$")


def parse_export(text: str) -> tuple[str, Path]:
    golfer, sep, path = text.partition("=")
    if not sep or not GOLFER.match(golfer):
        raise argparse.ArgumentTypeError(
            f"{text!r}: expected GOLFER=PATH, GOLFER being letters, digits, '.', '_' or '-'"
        )
    return golfer, Path(path)


def combine(exports: list[tuple[str, Path]]) -> tuple[dict[str, NDArray[np.generic]], list[str]]:
    """One archive from several exports, swings renumbered, and each swing's golfer."""
    golfers = [g for g, _ in exports]
    if len(set(golfers)) != len(golfers):
        raise SystemExit("each golfer may be given once; merge their exports first")
    parts = [dict(np.load(path)) for _, path in exports]
    keys = set(parts[0])
    for (golfer, path), part in zip(exports, parts, strict=True):
        if set(part) != keys:
            raise SystemExit(f"{path} ({golfer}) has different columns from {exports[0][1]}")
        if (part["golfdb_split"] >= 0).any():
            raise SystemExit(f"{path} holds GolfDB clips; a phone test set holds phone swings only")
    combined = {key: np.concatenate([part[key] for part in parts], axis=0) for key in keys}
    owner = [golfer for (golfer, _), part in zip(exports, parts, strict=True)
             for _ in range(len(part["lengths"]))]  # fmt: skip
    combined["seeds"] = np.arange(1, len(owner) + 1, dtype=np.int64)
    return combined, owner


def main(argv: list[str] | None = None) -> Manifest:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--export", type=parse_export, action="append", required=True)
    parser.add_argument("--name", required=True, help="e.g. phone-holdout-v1")
    parser.add_argument(
        "--source", required=True, help="who filmed and labelled the swings, and under what consent"
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--manifest-out", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    combined, owner = combine(args.export)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, **combined)  # type: ignore[arg-type]
    groups = {i + 1: f"phone:{golfer}" for i, golfer in enumerate(owner)}
    manifest = freeze(args.out, args.name, "phone-holdout", groups, args.source, args.root)
    args.manifest_out.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_out.write_text(manifest.model_dump_json(indent=2) + "\n", encoding="utf-8")
    counts = {g: owner.count(g) for g in dict.fromkeys(owner)}
    print(f"froze {manifest.name}: {manifest.n_clips} swings from {len(counts)} golfers")
    print(json.dumps(counts))
    return manifest


if __name__ == "__main__":
    main()
