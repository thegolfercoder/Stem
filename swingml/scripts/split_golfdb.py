"""Split the extracted GolfDB clips into training footage and a real holdout.

The synthetic benchmark corpus is a fixed list of four archives, permuted with a
fixed seed, and every number in the project's log was measured on the validation
and test clips that fall out of it. Real footage must therefore not join that
pool: it goes into training through `--extra-train`, which leaves the held-out
sets exactly where they were.

That alone would leave no real-footage measurement at all beyond the single
fixture clip, which is the one thing the whole exercise is meant to improve. So
this carves a second, separate holdout out of the real clips, reported alongside
the synthetic numbers rather than mixed into them. Two metrics, neither able to
contaminate the other.

**Why not GolfDB's own splits.** GolfDB ships four, so results are comparable
across the papers that use it, but they are not disjoint by golfer: 100 of the
246 players appear in all four. Holding out split 4 would put the same golfer -
frequently the same tournament, camera and lens - on both sides, and the real
footage number, the one that matters most here, would come out flattering and
wrong.

**Why groups, not players.** Most of the 580 source videos contributed two
clips, so a video is the tighter unit of near-duplication: two clips off one
video are one golfer in one session, often one swing from two camera positions.
Fifteen videos carry more than one player, so grouping by player does not
contain videos and grouping by video does not contain players. The groups here
are the connected components of the player-video graph, which contains both.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from collections.abc import Sequence
from hashlib import blake2b
from itertools import combinations
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from make_golfdb_dataset import Annotation, read_annotations

HOLDOUT_FRACTION = 0.2
"""Share of real clips withheld from training and from model selection.

A fifth of thirteen hundred clips is a couple of hundred, which is enough for a
percentage at one frame to mean something and small enough that the training set
keeps most of the real footage - which is the scarce input here.
"""

CALIBRATION_FRACTION = 0.15
"""Share of real clips the error bands are measured from.

A third set, because the bands are a promise about clips the model has not seen
and the two sets that already exist are both spent: the training clips it learnt
from, and the selection clips it was chosen on. Measuring bands on either
returns a band that fits the past and under-states the next clip.

The README records that bands measured on rendered footage come out too tight
for video of a person, which is the same failure one step removed - the wrong
domain rather than the wrong clips. Real footage can fix that only if the clips
it is measured on are real clips nothing else has used.
"""

VALIDATION_FRACTION = 0.15
"""Share of real clips used to pick which epoch to keep.

Separate from the holdout because a set used to choose a checkpoint is not a set
that checkpoint can then be measured on. This project has already paid for that
once: a model chosen on generated footage alone put the finish thirty-eight
frames late on the only real swing in the repository, and the answer is not to
choose on generated footage and hope, it is to choose on real footage and keep a
different real set back to check the choice.
"""

COLUMNS = (
    "seeds",
    "tempo_ratio",
    "azimuth_deg",
    "capture_rate_hz",
    "left_handed",
    "landscape",
    "detection_rate",
    "handedness_margin",
    "slow",
    "golfdb_split",
)
"""The per-clip columns, all of them one value per clip, carried across unchanged."""


class Groups:
    """Union-find over the player and video labels sharing a clip."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, key: str) -> str:
        self.parent.setdefault(key, key)
        while self.parent[key] != key:
            self.parent[key] = self.parent[self.parent[key]]
            key = self.parent[key]
        return key

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[ra] = rb


def group_of_clip(records: Sequence[Annotation]) -> dict[int, str]:
    """Map each clip id to the name of its leakage group.

    The group is named after the alphabetically first label in it, so the name
    depends on the group's membership rather than on the order the rows were
    read: the same corpus yields the same names whichever way it is iterated.
    """
    groups = Groups()
    for record in records:
        groups.union(f"player:{record.player.upper()}", f"video:{record.youtube_id}")

    members: dict[str, list[str]] = defaultdict(list)
    for key in list(groups.parent):
        members[groups.find(key)].append(key)
    canonical = {root: min(names) for root, names in members.items()}

    return {
        record.clip_id: canonical[groups.find(f"player:{record.player.upper()}")]
        for record in records
    }


def order_key(name: str) -> str:
    """A stable shuffling key, so the holdout does not move when clips are added.

    Hashed rather than permuted by index: a permutation is a function of how many
    groups there are, so one new golfer in the corpus would reshuffle every
    assignment and silently move footage across the boundary.
    """
    return blake2b(name.encode(), digest_size=8).hexdigest()


def choose_holdout(group_sizes: dict[str, int], fraction: float) -> set[str]:
    """Whole groups, in hashed order, until the clip target is met."""
    return choose_spans(group_sizes, (fraction,))[0]


def choose_spans(group_sizes: dict[str, int], fractions: Sequence[float]) -> list[set[str]]:
    """Consecutive stretches of the hashed order, one per fraction.

    Taken in one pass over the same order so that adding a fraction on the end
    cannot disturb the ones before it: the holdout a checkpoint was measured on
    stays the same set when a validation slice is carved out after it.
    """
    total = sum(group_sizes.values())
    order = sorted(group_sizes, key=order_key)
    spans: list[set[str]] = []
    cursor = 0
    for fraction in fractions:
        target = fraction * total
        chosen: set[str] = set()
        running = 0
        while cursor < len(order) and running < target:
            name = order[cursor]
            chosen.add(name)
            running += group_sizes[name]
            cursor += 1
        spans.append(chosen)
    return spans


def load_archives(paths: Sequence[Path]) -> dict[str, NDArray[np.float64]]:
    """Concatenate the worker archives back into one corpus."""
    lengths: list[NDArray[np.int64]] = []
    features: list[NDArray[np.float32]] = []
    events: list[NDArray[np.int64]] = []
    columns: dict[str, list[NDArray[np.float64]]] = {name: [] for name in COLUMNS}
    for path in paths:
        data = np.load(path)
        lengths.append(data["lengths"])
        features.append(data["features"])
        events.append(data["events"])
        for name in COLUMNS:
            columns[name].append(data[name])
    merged: dict[str, NDArray[np.float64]] = {
        "lengths": np.concatenate(lengths),
        "features": np.concatenate(features),
        "events": np.concatenate(events),
    }
    for name in COLUMNS:
        merged[name] = np.concatenate(columns[name])
    return merged


def write_subset(path: Path, corpus: dict[str, NDArray[np.float64]], chosen: Sequence[int]) -> None:
    """Write the named clips out, feature blocks reassembled.

    The columns are named one by one rather than unpacked from a dict. It reads
    as duplication of `COLUMNS`, and it is, but an archive written by unpacking a
    mapping is an archive whose schema is whatever the mapping happened to hold;
    spelling them out here means a column that goes missing upstream fails at the
    write rather than producing a file the loader silently reads short.
    """
    rows = list(chosen)
    lengths = corpus["lengths"].astype(np.int64)
    offsets = np.concatenate(([0], np.cumsum(lengths)))

    def column(name: str) -> NDArray[np.float64]:
        return corpus[name][rows]

    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        lengths=lengths[rows],
        features=np.concatenate([corpus["features"][offsets[i] : offsets[i + 1]] for i in rows]),
        events=corpus["events"][rows],
        seeds=column("seeds").astype(np.int64),
        tempo_ratio=column("tempo_ratio"),
        azimuth_deg=column("azimuth_deg"),
        capture_rate_hz=column("capture_rate_hz"),
        left_handed=column("left_handed"),
        landscape=column("landscape"),
        detection_rate=column("detection_rate"),
        handedness_margin=column("handedness_margin"),
        slow=column("slow"),
        golfdb_split=column("golfdb_split"),
    )
    print(f"  wrote {path}: {len(rows)} clips")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--annotations", type=Path, required=True, help="golfDB.mat")
    parser.add_argument("--archives", type=Path, nargs="+", required=True)
    parser.add_argument("--train-out", type=Path, required=True)
    parser.add_argument("--validation-out", type=Path, required=True)
    parser.add_argument(
        "--calibration-out",
        type=Path,
        default=None,
        help="clips reserved for measuring error bands; omitted, they go to training",
    )
    parser.add_argument("--holdout-out", type=Path, required=True)
    parser.add_argument("--assignment-out", type=Path, required=True)
    parser.add_argument(
        "--hold-out-player",
        default="",
        help=(
            "a golfer whose every clip goes to the holdout, whatever the hash order "
            "says, so results on them are a blind test. Decided before training, "
            "and the general holdout is still reported alongside"
        ),
    )
    parser.add_argument(
        "--player-out",
        type=Path,
        default=None,
        help="also write that golfer's held-out clips on their own, to report separately",
    )
    args = parser.parse_args()

    records = read_annotations(args.annotations)
    group = group_of_clip(records)
    corpus = load_archives(args.archives)
    clip_ids = [int(v) for v in corpus["seeds"]]
    print(f"{len(clip_ids)} extracted clips of {len(records)} annotated")

    sizes: dict[str, int] = defaultdict(int)
    for clip_id in clip_ids:
        sizes[group[clip_id]] += 1
    by_id = {r.clip_id: r for r in records}
    named = args.hold_out_player.upper()
    forced = {group[c] for c in clip_ids if named and by_id[c].player.upper() == named}
    if named and not forced:
        raise SystemExit(f"no extracted clips of {args.hold_out_player}")

    wanted = [HOLDOUT_FRACTION, VALIDATION_FRACTION]
    if args.calibration_out is not None:
        wanted.append(CALIBRATION_FRACTION)
    spans = choose_spans({g: n for g, n in sizes.items() if g not in forced}, wanted)
    held, validated = spans[0] | forced, spans[1]
    calibrated = spans[2] if len(spans) > 2 else set()
    spoken_for = held | validated | calibrated

    rows = {
        "holdout": [i for i, c in enumerate(clip_ids) if group[c] in held],
        "validation": [i for i, c in enumerate(clip_ids) if group[c] in validated],
        "calibration": [i for i, c in enumerate(clip_ids) if group[c] in calibrated],
        "train": [i for i, c in enumerate(clip_ids) if group[c] not in spoken_for],
    }
    parts = [name for name in ("train", "validation", "calibration", "holdout") if rows[name]]
    print(
        f"{len(sizes)} groups -> {len(held)} held out, {len(validated)} for selection"
        + (f", {len(calibrated)} for calibration" if calibrated else "")
    )
    for name in parts:
        share = len(rows[name]) / max(len(clip_ids), 1)
        print(f"  {name:<12}{len(rows[name]):>5} clips ({share:.1%})")

    for label, field in (("player", "player"), ("video", "youtube_id")):
        names = {
            part: {getattr(by_id[clip_ids[i]], field).upper() for i in indices}
            for part, indices in rows.items()
        }
        # The whole point of the grouping. If this ever prints a name, the number
        # that side produces is measuring memorisation and must not be quoted.
        for a, b in combinations(parts, 2):
            shared = names[a] & names[b]
            if shared:
                print(f"  {label}s in both {a} and {b}: {sorted(shared)[:5]}")
                raise SystemExit(f"leak: {len(shared)} {label}s in both {a} and {b}")
        print(f"  no {label} appears in more than one part")

    write_subset(args.train_out, corpus, rows["train"])
    write_subset(args.validation_out, corpus, rows["validation"])
    if args.calibration_out is not None:
        write_subset(args.calibration_out, corpus, rows["calibration"])
    write_subset(args.holdout_out, corpus, rows["holdout"])
    if args.player_out is not None and forced:
        # The golfer's own clips only. Their group is larger - a source video
        # showing them beside other golfers chains those golfers in, and the whole
        # group has to be held out together or the blind test leaks - but a result
        # reported under their name should be about their swings.
        player_rows = [i for i, c in enumerate(clip_ids) if by_id[c].player.upper() == named]
        group_rows = sum(1 for c in clip_ids if group[c] in forced)
        print(
            f"  {args.hold_out_player}: {len(player_rows)} of their own clips, in a group of "
            f"{group_rows} held out together"
        )
        write_subset(args.player_out, corpus, player_rows)
    args.assignment_out.write_text(
        json.dumps(
            {
                "holdout_fraction": HOLDOUT_FRACTION,
                "validation_fraction": VALIDATION_FRACTION,
                "calibration_fraction": (
                    CALIBRATION_FRACTION if args.calibration_out is not None else 0.0
                ),
                "holdout_groups": sorted(held),
                "validation_groups": sorted(validated),
                "calibration_groups": sorted(calibrated),
                "train_clips": sorted(clip_ids[i] for i in rows["train"]),
                "validation_clips": sorted(clip_ids[i] for i in rows["validation"]),
                "calibration_clips": sorted(clip_ids[i] for i in rows["calibration"]),
                "holdout_clips": sorted(clip_ids[i] for i in rows["holdout"]),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nwrote {args.train_out}, {args.validation_out}, {args.holdout_out}")


if __name__ == "__main__":
    main()
