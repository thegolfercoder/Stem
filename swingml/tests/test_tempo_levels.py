"""The per-tempo-level band check (#18), on rows whose answers are known by hand."""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from tempo_experiments import Row, level_cells


def _row(true: float, read: float, confidence: float = 0.8) -> Row:
    return Row(answered=True, slow=False, true_tempo=true, read_tempo=read,
               core_confidence=confidence)  # fmt: skip


def test_cells_split_by_true_and_by_read_tempo() -> None:
    cuts = {"true": [3.0, 4.0], "read": [3.0, 4.0]}
    rows = [
        _row(2.5, 3.5),  # true low, read middle: +40%, outside a 27% band
        _row(2.5, 2.6),  # true low, read low: +4%
        _row(3.5, 3.5),  # middle, exact
        _row(4.5, 3.6, confidence=0.3),  # true high, read middle: -20%, inside, unsure
        Row(answered=False, slow=False, true_tempo=4.5),  # refused, high true tempo
    ]
    cells = level_cells(rows, cuts, band=0.27)
    assert cells["true_0"]["n"] == 2 and cells["true_0"]["coverage"] == 0.5
    assert cells["true_0"]["false_confidence_rate"] == 0.5
    assert math.isclose(cells["true_0"]["median_signed_rel_error"], (0.4 + 0.04) / 2)
    assert cells["true_2"]["n"] == 1 and cells["true_2"]["answered"] == 0.5
    assert cells["true_2"]["false_confidence_rate"] == 0.0
    assert cells["read_1"]["n"] == 3 and math.isclose(cells["read_1"]["coverage"], 2 / 3)
    assert cells["read_0"]["n"] == 1 and "answered" not in cells["read_0"]
    assert math.isnan(cells["read_2"]["coverage"]) and cells["read_2"]["n"] == 0
