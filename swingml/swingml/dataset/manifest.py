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
from collections.abc import Iterable, Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from itertools import combinations
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
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


MANIFESTS = Path(__file__).resolve().parent.parent / "manifests"
SWINGML_ROOT = MANIFESTS.parent.parent
"""Where the manifests' relative archive paths (`out/golfdb/...`) are rooted."""

HOLDOUT_RULE = (
    "the holdout is read only through `python -m swingml.model.release_gate`, once per "
    "candidate (agents/CHARTER.md section 3)"
)


class HoldoutError(ManifestError):
    """Something other than the release gate tried to read the frozen holdout."""


_holdout_access = False


@contextmanager
def holdout_access() -> Iterator[None]:
    """Let the release gate, and only the release gate, read the holdout."""
    global _holdout_access
    before = _holdout_access
    _holdout_access = True
    try:
        yield
    finally:
        _holdout_access = before


def frozen(split: str | None = None) -> list[Manifest]:
    """Every manifest in the package (read at call time, so tests can repoint it)."""
    found = [load(path) for path in sorted(MANIFESTS.glob("*.json"))]
    return [m for m in found if split is None or m.split == split]


def refuse_holdout_manifest(manifest: Manifest) -> None:
    if manifest.split == "holdout" and not _holdout_access:
        raise HoldoutError(f"{manifest.name} is a holdout manifest: {HOLDOUT_RULE}")


_digests: dict[tuple[str, int, int], str] = {}


def _digest(path: Path) -> str:
    stat = path.stat()
    key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
    if key not in _digests:
        _digests[key] = sha256_of(path)
    return _digests[key]


def guard_archive(path: Path) -> None:
    """Refuse to load `path` if it is, or holds clips of, the frozen holdout.

    Called by every loader that trains or scores (`benchmark.load_samples`,
    `release_gate.read_archive`, the research scripts), so no flag or file name
    reaches the holdout by accident. Matched two ways: the archive's bytes against
    each holdout manifest, and, for GolfDB archives (they carry `golfdb_split`),
    its clip ids against the holdout's, which also catches a copy re-extracted or
    re-ordered into different bytes. Tools that must see every clip to build or
    audit the splits (`scripts/split_golfdb.py`, `scripts/audit_corpus.py`) read
    no labels to score and load archives directly, unguarded.
    """
    if _holdout_access:
        return
    holdouts = frozen("holdout")
    if not holdouts:
        return
    digest = _digest(Path(path))
    for manifest in holdouts:
        if manifest.sha256 == digest:
            raise HoldoutError(f"{path} is the frozen holdout {manifest.name}: {HOLDOUT_RULE}")
    with np.load(path) as data:
        if "golfdb_split" not in data.files or "seeds" not in data.files:
            return
        ids = [int(v) for v in data["seeds"]]
    refuse_holdout_clips(ids, str(path))


def refuse_holdout_clips(ids: Iterable[int], what: str) -> None:
    """Refuse clip ids that belong to a frozen holdout (GolfDB ids are global)."""
    if _holdout_access:
        return
    wanted = set(ids)
    for manifest in frozen("holdout"):
        shared = wanted & set(manifest.clip_ids)
        if shared:
            raise HoldoutError(
                f"{what} holds {len(shared)} clips of the frozen holdout {manifest.name} "
                f"(e.g. {sorted(shared)[:3]}): {HOLDOUT_RULE}"
            )


def require_split(path: Path, split: str) -> Manifest:
    """The frozen manifest of `split` whose archive is exactly `path`, or refuse."""
    digest = _digest(Path(path))
    for manifest in frozen(split):
        if manifest.sha256 == digest:
            return manifest
    raise ManifestError(f"{path} is not the archive of any frozen `{split}` manifest")


def groups_for(archive: Path, manifests: Path = MANIFESTS) -> tuple[str, ...] | None:
    """The leakage group of each clip in `archive`, from the manifest that froze it.

    Matched by the archive's SHA-256, so a changed archive finds no manifest
    rather than someone else's groups. None when no manifest froze these bytes.
    """
    digest = sha256_of(archive)
    for path in sorted(manifests.glob("*.json")):
        manifest = load(path)
        if manifest.sha256 == digest:
            return manifest.groups
    return None


def group_resamples(
    groups: Sequence[str], resamples: int, rng: np.random.Generator
) -> list[NDArray[np.int64]]:
    """Row indices for each bootstrap draw, drawing whole golfer/video groups.

    Clips of one golfer from one video are not independent: resampling them one
    at a time makes an interval narrower than the evidence, by as much as clips
    within a group agree. Each draw picks as many groups as there are, with
    replacement, and takes every row of each group it picked.
    """
    labels = np.asarray(groups)
    members = [np.nonzero(labels == g)[0] for g in sorted(set(labels.tolist()))]
    draws = []
    for _ in range(resamples):
        chosen = rng.integers(0, len(members), len(members))
        draws.append(np.concatenate([members[i] for i in chosen]).astype(np.int64))
    return draws


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
