"""swingml's analysis of the phone video, read from its JSON output.

The two projects share principles and no code, and this keeps it so: swingml
writes `swingml analyse clip.mov --json out.json`, and this module reads the
parts fusion needs from that file. Nothing here imports swingml.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# swingml's eight events (GolfDB), in order.
EVENT_NAMES: tuple[str, ...] = (
    "address",
    "toe_up",
    "mid_backswing",
    "top",
    "mid_downswing",
    "impact",
    "mid_follow_through",
    "finish",
)
ADDRESS, TOP, IMPACT = 0, 3, 5
# Events swingml defines by the club shaft's angle, which a pose estimator does
# not see: its model places them from the body's timing, not from evidence.
CLUB_DEFINED = frozenset({1, 6})


class CameraSwing(BaseModel):
    """What one phone clip contributes: event times on the clip's own clock."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    clip: str | None
    event_times_s: tuple[float, ...] | None = Field(
        description="Eight event times in the clip's time base, or None if swingml refused."
    )
    event_confidence: tuple[float, ...] | None = None
    refusal: str | None = Field(default=None, description="swingml's reason, when it refused.")
    frame_period_s: float | None = Field(default=None, description="From the measured frame rate.")
    event_band_ms: tuple[float | None, ...] | None = Field(
        default=None,
        description=(
            "swingml's measured error band per event, where it was run with a "
            "calibration. None where it was not: then no band is quoted."
        ),
    )
    tempo_ratio: float | None = Field(
        default=None, description="swingml's own tempo, for comparison."
    )


def camera_swing_from_swingml(analysis: dict[str, Any]) -> CameraSwing:
    video = analysis.get("video") or {}
    fps = video.get("measured_fps")
    events = analysis.get("events") or {}
    times = analysis.get("event_times_s") or ()
    refused = "reason" in events or len(times) != len(EVENT_NAMES)
    bands: tuple[float | None, ...] | None = None
    if analysis.get("event_uncertainty"):
        bands = tuple(b.get("half_width_ms") for b in analysis["event_uncertainty"])
    metrics = analysis.get("metrics") or {}
    tempo = (metrics.get("tempo_ratio") or {}).get("value")
    return CameraSwing(
        clip=video.get("path"),
        event_times_s=None if refused else tuple(float(t) for t in times),
        event_confidence=None if refused else tuple(events.get("confidence", ())),
        refusal=events.get("reason") if refused else None,
        frame_period_s=1.0 / fps if fps else None,
        event_band_ms=bands,
        tempo_ratio=tempo,
    )


def load_swingml_json(path: Path | str) -> list[CameraSwing]:
    """Every analysis in a `swingml analyse --json` file, in order."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = [data]
    return [camera_swing_from_swingml(a) for a in data]
