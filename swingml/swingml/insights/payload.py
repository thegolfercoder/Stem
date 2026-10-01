"""The practice loop's fixed inputs, packed for the browser and iPhone engines.

The rules themselves are ported (webapp/practice.js); their inputs are not. The
drills, the tour tempo reference, the comparability tolerances and the t table
go out in the exported model payload from here, so the three engines cannot
drift on a number or a sentence, and tests/test_browser_practice.py holds the
ported rules to `choose` and `compare` on the same swings.
"""

from __future__ import annotations

from typing import Any

from swingml.insights import compare, engine
from swingml.insights.drills import DRILLS
from swingml.insights.reference import TOUR_TEMPO_READINGS


def practice_payload() -> dict[str, Any]:
    return {
        "min_swings": compare.MIN_SWINGS,
        "shoulder_ratio_tolerance": compare.SHOULDER_RATIO_TOLERANCE,
        "body_height_tolerance": compare.BODY_HEIGHT_TOLERANCE,
        "centre_tolerance": compare.CENTRE_TOLERANCE,
        "scale_free_metrics": sorted(compare.SCALE_FREE_METRICS),
        "t95": [[df, value] for df, value in sorted(compare._T95.items())],
        "drills": [drill.model_dump(mode="json") for drill in DRILLS],
        "trackable": [list(choice) for choice in engine.TRACKABLE],
        "tour_tempo": TOUR_TEMPO_READINGS.model_dump(mode="json"),
        "tempo_limits": list(engine.TEMPO_LIMITS),
        "tempo_limits_left_handed": list(engine.TEMPO_LIMITS_LEFT_HANDED),
        "one_swing": dict(engine.ONE_SWING),
    }
