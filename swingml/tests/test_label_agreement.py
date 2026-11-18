"""Label agreement between two labellers (#28), on exports with known offsets."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import label_agreement

# Where B puts each event relative to A, in 60 Hz frames: address .. finish.
OFFSETS = np.array([0, 1, 2, 0, 0, -1, 0, 3])
BASE = np.array([10, 20, 30, 40, 50, 60, 70, 80])


def _export(path: Path, ids: list[int], offset: np.ndarray) -> Path:
    """What make_labelled_dataset.py writes, reduced to the columns read here."""
    events = np.stack([BASE + k + offset for k in range(len(ids))])  # the k-th swing each side
    np.savez(path, seeds=np.array(ids), events=events, golfdb_split=np.full(len(ids), -1.0))
    return path


def test_known_offsets_give_the_known_disagreement(tmp_path: Path) -> None:
    a = _export(tmp_path / "a.npz", [1, 2, 3, 4, 5], np.zeros(8, dtype=int))
    b = _export(tmp_path / "b.npz", [1, 2, 3, 4, 9], OFFSETS)
    groups = tmp_path / "golfers.json"
    groups.write_text(json.dumps({"1": "ann", "2": "ann", "3": "bo", "4": "bo", "5": "cy"}))
    result = label_agreement.main(
        ["--a", str(a), "--b", str(b), "--groups", str(groups), "--resamples", "200"]
    )
    assert result["n_matched"] == 4 and result["n_groups"] == 2
    # Listed, not dropped: A's swing 5 and B's swing 9 were labelled by one person.
    assert result["only_in_a"] == [5] and result["only_in_b"] == [9]
    rows = [result["per_event"][e] for e in (
        "address", "toe_up", "mid_backswing", "top", "mid_downswing", "impact",
        "mid_follow_through", "finish")]  # fmt: skip
    assert [r["median_abs_frames"] for r in rows] == [float(abs(o)) for o in OFFSETS]
    assert [r["within_1"] for r in rows] == [float(abs(o) <= 1) for o in OFFSETS]
    assert [r["median_signed_frames"] for r in rows] == [float(-o) for o in OFFSETS]  # A - B
    # A's tempo is 30/20 = 1.5 on every swing, B's 30/19.
    expected = abs(1.5 - 30 / 19) / 1.5
    assert result["per_event"]["tempo_median_rel_difference"] == pytest.approx(expected)
    assert result["intervals_resample"] == "golfers"


def test_an_explicit_map_matches_swings_numbered_differently(tmp_path: Path) -> None:
    a = _export(tmp_path / "a.npz", [1, 2], np.zeros(8, dtype=int))
    b = _export(tmp_path / "b.npz", [11, 12], OFFSETS)
    mapping = tmp_path / "map.json"
    mapping.write_text(json.dumps({"1": 11, "2": 12}))
    result = label_agreement.main(["--a", str(a), "--b", str(b), "--map", str(mapping)])
    assert result["n_matched"] == 2 and result["only_in_a"] == [] == result["only_in_b"]
    assert result["per_event"]["finish"]["median_abs_frames"] == 3.0
    assert result["intervals_resample"].startswith("single swings")
    with pytest.raises(SystemExit, match="no swing was labelled by both"):
        label_agreement.main(["--a", str(a), "--b", str(b)])
