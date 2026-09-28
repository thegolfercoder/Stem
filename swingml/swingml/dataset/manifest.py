"""Frozen dataset manifests: which clips a split holds, provably, for good.

A benchmark number is only comparable to another if both were measured on the
same clips, and "the holdout" has already meant two different sets in this
project's history (201 clips, then 320 after the corpus grew). A manifest pins
one: the archive's SHA-256, every clip id in it, and the leakage group each clip
belongs to (the connected component of golfer and source video, as
`scripts/split_golfdb.py` builds it). The release gate refuses to score a model
against an archive whose bytes no longer match its manifest, and refuses a test
manifest that shares a clip or a group with the calibration manifest.

Manifests hold identifiers and hashes, never footage or features: the GolfDB
clips are CC BY-NC YouTube footage and nothing derived from their frames is
committed. The archives they describe live under the gitignored `out/`.

    python -m swingml.dataset.manifest freeze --archive out/golfdb/split/holdout.npz \\
        --assignment out/golfdb/split/assignment.json --split holdout \\
        --name golfdb-holdout-v1 --out swingml/manifests/golfdb-holdout-v1.json
    python -m swingml.dataset.manifest check swingml/manifests/*.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from itertools import combinations
from pathlib import Path

import numpy as np
from pydantic import BaseModel, ConfigDict, Field


class Manifest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    split: str = Field(description="train, validation, calibration or holdout.")
    archive: str = Field(description="Path of the archive, relative to the swingml directory.")
    sha256: str
    n_clips: int
    clip_ids: tuple[int, ...]
    groups: tuple[str, ...] = Field(
        description="Leakage group of each clip, in clip_ids order: golfer and source video."
    )
    source: str = Field(description="Where the clips came from and under what terms.")
    frozen_at: str


class ManifestError(ValueError):
    """The archive on disk is not the one the manifest froze, or the manifests leak."""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def clip_ids_of(path: Path) -> tuple[int, ...]:
    with np.load(path) as data:
        return tuple(int(v) for v in data["seeds"])


def freeze(
    archive: Path,
    name: str,
    split: str,
    groups_by_clip: dict[int, str],
    source: str,
    relative_to: Path,
) -> Manifest:
    ids = clip_ids_of(archive)
    missing = [c for c in ids if c not in groups_by_clip]
    if missing:
        raise ManifestError(f"{len(missing)} clips have no leakage group, e.g. {missing[:5]}")
    return Manifest(
        name=name,
        split=split,
        archive=str(archive.resolve().relative_to(relative_to.resolve())),
        sha256=sha256_of(archive),
        n_clips=len(ids),
        clip_ids=ids,
        groups=tuple(groups_by_clip[c] for c in ids),
        source=source,
        frozen_at=datetime.now(UTC).date().isoformat(),
    )


def load(path: Path) -> Manifest:
    return Manifest.model_validate_json(path.read_text(encoding="utf-8"))


def verify(manifest: Manifest, root: Path) -> Path:
    """The archive's path, if its bytes and clips are exactly what was frozen."""
    archive = root / manifest.archive
    if not archive.is_file():
        raise ManifestError(f"{manifest.name}: archive {archive} is missing")
    actual = sha256_of(archive)
    if actual != manifest.sha256:
        raise ManifestError(
            f"{manifest.name}: {archive} has changed since it was frozen "
            f"(sha256 {actual[:12]}, frozen {manifest.sha256[:12]})"
        )
    if clip_ids_of(archive) != manifest.clip_ids:
        raise ManifestError(f"{manifest.name}: clip ids differ from the frozen list")
    return archive


def leaks(manifests: Sequence[Manifest]) -> list[str]:
    """Every clip or group that appears in more than one manifest."""
    problems: list[str] = []
    for a, b in combinations(manifests, 2):
        shared_clips = set(a.clip_ids) & set(b.clip_ids)
        shared_groups = set(a.groups) & set(b.groups)
        if shared_clips:
            problems.append(f"{a.name} and {b.name} share {len(shared_clips)} clips")
        if shared_groups:
            problems.append(
                f"{a.name} and {b.name} share {len(shared_groups)} golfer/video groups, "
                f"e.g. {sorted(shared_groups)[:3]}"
            )
    return problems


def _groups_from_assignment(assignment: Path, annotations: Path | None) -> dict[int, str]:
    """Clip id to leakage group, from the split script's assignment and the annotations."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    from make_golfdb_dataset import read_annotations  # type: ignore[import-not-found,unused-ignore]
    from split_golfdb import group_of_clip  # type: ignore[import-not-found,unused-ignore]

    if annotations is None:
        raise ManifestError("--annotations (golfDB.mat) is needed to name each clip's group")
    groups: dict[int, str] = group_of_clip(read_annotations(annotations))
    json.loads(assignment.read_text())  # validated as JSON; the groups come from the records
    return groups


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("freeze", help="freeze one split's archive")
    make.add_argument("--archive", type=Path, required=True)
    make.add_argument("--assignment", type=Path, required=True)
    make.add_argument("--annotations", type=Path, default=None)
    make.add_argument("--split", required=True)
    make.add_argument("--name", required=True)
    make.add_argument(
        "--source",
        default=(
            "GolfDB (McNally et al. 2019), YouTube footage, CC BY-NC 4.0 annotations; "
            "landmarks from MediaPipe pose landmarker heavy; split by golfer and video"
        ),
    )
    make.add_argument("--root", type=Path, default=Path("."))
    make.add_argument("--out", type=Path, required=True)
    check = commands.add_parser("check", help="verify archives and cross-manifest leakage")
    check.add_argument("manifests", type=Path, nargs="+")
    check.add_argument("--root", type=Path, default=Path("."))
    args = parser.parse_args(argv)

    if args.command == "freeze":
        groups = _groups_from_assignment(args.assignment, args.annotations)
        manifest = freeze(args.archive, args.name, args.split, groups, args.source, args.root)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(manifest.model_dump_json(indent=2) + "\n", encoding="utf-8")
        print(f"froze {manifest.name}: {manifest.n_clips} clips, sha256 {manifest.sha256[:12]}")
        return 0

    manifests = [load(p) for p in args.manifests]
    failed = False
    for manifest in manifests:
        try:
            verify(manifest, args.root)
            print(f"ok    {manifest.name}: {manifest.n_clips} clips match")
        except ManifestError as error:
            failed = True
            print(f"FAIL  {error}")
    for problem in leaks(manifests):
        failed = True
        print(f"LEAK  {problem}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
