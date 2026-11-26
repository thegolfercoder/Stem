"""Range session mode (#56): when the page starts and stops recording, without a camera.

webapp/capture.js `SwingWatcher` is handed the estimator's landmarks a few times a
second and says when the golfer is at address (start recording) and when the
finish has settled (stop). These feed it the real phone swing in
tests/fixtures/real_swing_01.npz, whose address (frame 84) and finish (frame 125)
were established by hand (real_swing_01.json), at the rates the page samples at,
and that swing looped with still gaps, as at a range.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
CAPTURE = HERE.parent / "webapp" / "capture.js"
FIXTURE = HERE / "fixtures" / "real_swing_01"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

LABELS = json.loads(FIXTURE.with_suffix(".json").read_text(encoding="utf-8"))
ADDRESS, FINISH = LABELS["events"]["address"], LABELS["events"]["finish"]
FPS = LABELS["frame_rate_hz"]

# What the page needs, in frames of this 30 fps clip: the clip starts before the
# swing does, and ends after the finish but before the golfer has long walked off.
START_EARLIEST = ADDRESS - int(2.0 * FPS)
STOP_LATEST = FINISH + int(2.5 * FPS)


def frames() -> list[list[dict[str, float]] | None]:
    data = np.load(FIXTURE.with_suffix(".npz"))
    xy, visibility, detected = data["xy"], data["visibility"], data["detected"]
    return [
        [{"x": float(x), "y": float(y), "visibility": float(v)}
         for (x, y), v in zip(xy[f], visibility[f], strict=True)]
        if detected[f] else None
        for f in range(len(xy))
    ]  # fmt: skip


FRAMES = frames()


def watch(samples: list[tuple[float, Any, bool]], tmp_path: Path) -> list[dict[str, Any]]:
    path = tmp_path / "samples.json"
    path.write_text(json.dumps(samples), encoding="utf-8")
    script = (
        f"import {{ SwingWatcher }} from {json.dumps(CAPTURE.as_uri())};"
        "import { readFileSync } from 'node:fs';"
        f"const samples = JSON.parse(readFileSync({json.dumps(str(path))}, 'utf8'));"
        "const w = new SwingWatcher(); const out = [];"
        "for (const [t, lm, framed] of samples) {"
        " const e = w.push(t, lm, framed); if (e) out.push(e); }"
        "console.log(JSON.stringify(out));"
    )
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=60, check=True,
    )  # fmt: skip
    return list(json.loads(done.stdout))


def sampled(sequence: list[Any], hz: float, phase: int = 0) -> list[tuple[float, Any, bool]]:
    """Every frame the page would sample at `hz` from a 30 fps stream."""
    step = max(1, round(FPS / hz))
    return [(f / FPS, sequence[f], True) for f in range(phase, len(sequence), step)]


@pytest.mark.parametrize(("hz", "phase"), [(5, 0), (5, 3), (4, 1), (8, 2), (10, 0)])
def test_one_swing_is_recorded_from_address_to_a_settled_finish(
    hz: float, phase: int, tmp_path: Path
) -> None:
    events = watch(sampled(FRAMES, hz, phase), tmp_path)
    assert [e["type"] for e in events] == ["start", "stop"], events
    start, stop = events[0]["t"] * FPS, events[1]["t"] * FPS
    assert START_EARLIEST <= start < ADDRESS, start
    assert FINISH < stop <= STOP_LATEST, stop
    assert events[1]["swing"] and not events[1]["capped"]


def test_a_busy_phone_sampling_three_times_a_second_still_records_the_swing(
    tmp_path: Path,
) -> None:
    """While the last clip is analysed the camera is sampled less often. At 3 a
    second, from every phase, the swing is seen and recorded whole (the full page
    suite once missed one this way)."""
    for phase in range(10):
        events = watch(sampled(FRAMES, 3, phase), tmp_path)
        assert [e["type"] for e in events] == ["start", "stop"], (phase, events)
        start, stop = events[0]["t"] * FPS, events[1]["t"] * FPS
        assert START_EARLIEST <= start < ADDRESS and FINISH < stop <= STOP_LATEST, (phase, events)
        assert events[1]["swing"] is True


def test_at_two_a_second_a_swing_is_never_cancelled_or_discarded(tmp_path: Path) -> None:
    """At 2 a second the swing is recorded from before address in every phase; it
    is seen in most, and where it is not, the recording runs on (to the cap, kept
    for the analysis), never cancelled or called empty."""
    seen = 0
    for phase in range(15):
        events = watch(sampled(FRAMES, 2, phase), tmp_path)
        assert events and events[0]["type"] == "start" and events[0]["t"] * FPS < ADDRESS
        assert all(e["type"] != "cancel" for e in events), (phase, events)
        assert all(e.get("swing") is not False for e in events if e["type"] == "stop")
        seen += any(e.get("swing") is True for e in events)
    assert seen >= 14, seen


def test_too_sparse_to_tell_keeps_the_clip_for_the_analysis(tmp_path: Path) -> None:
    """At one sample a second a swing and a setup read alike: no cancel, and the
    stop at the cap says the swing is unknown rather than absent."""
    still = [FRAMES[-1]] * int(10 * FPS)
    events = watch(sampled(FRAMES + still, 1, 0), tmp_path)
    assert [e["type"] for e in events][:2] == ["start", "stop"], events
    assert events[0]["t"] * FPS < ADDRESS
    assert events[1]["capped"] and events[1]["swing"] is None


@pytest.mark.parametrize("gap_s", [0.0, 3.0])
def test_a_range_of_swings_gives_one_clip_each_none_split_or_merged(
    gap_s: float, tmp_path: Path
) -> None:
    """The fixture swing four times, with the golfer standing still between them."""
    still = [FRAMES[0]] * int(gap_s * FPS)
    loop = FRAMES + still
    sequence = loop * 4
    everything = watch(sampled(sequence, 5), tmp_path)
    # Standing still in a gap starts a clip; walking into the next address cancels
    # it before any swing. The last gap's clip is still open when the stream ends
    # (the page's Stop button closes it). What remains is one clip per swing.
    events: list[dict[str, Any]] = []
    for event in everything:
        if event["type"] == "cancel":
            assert events.pop()["type"] == "start", everything
        else:
            events.append(event)
    if events and events[-1]["type"] == "start":
        events.pop()
    assert [e["type"] for e in events] == ["start", "stop"] * 4, everything
    for k in range(4):
        offset = k * len(loop)
        start, stop = events[2 * k]["t"] * FPS - offset, events[2 * k + 1]["t"] * FPS - offset
        assert START_EARLIEST <= start < ADDRESS and FINISH < stop <= STOP_LATEST, (k, start, stop)
        assert events[2 * k + 1]["swing"]


def test_standing_still_records_once_says_no_swing_and_waits_for_movement(
    tmp_path: Path,
) -> None:
    address = FRAMES[ADDRESS - 6]
    samples = [(i / 5, address, True) for i in range(5 * 20)]
    events = watch(samples, tmp_path)
    assert [e["type"] for e in events] == ["start", "stop"]
    assert events[1]["capped"] and not events[1]["swing"]
    assert events[1]["t"] - events[0]["t"] == pytest.approx(8.0, abs=0.21)


def test_no_recording_starts_until_the_golfer_is_framed(tmp_path: Path) -> None:
    unframed = [(t, lm, False) for t, lm, _ in sampled(FRAMES, 5)]
    assert watch(unframed, tmp_path) == []


def test_walking_about_after_standing_still_is_not_a_swing(tmp_path: Path) -> None:
    """Still for 2 s, then the opening 1.4 s of the fixture (setting up, under swing speed)."""
    still = [(i / 5, FRAMES[0], True) for i in range(10)]
    setup = [(2.0 + f / FPS, FRAMES[f], True) for f in range(6, 48, 6)]
    events = watch(still + setup, tmp_path)
    assert [e["type"] for e in events] == ["start", "cancel"], events


def test_nobody_in_shot_records_nothing(tmp_path: Path) -> None:
    assert watch([(i / 5, None, False) for i in range(100)], tmp_path) == []
