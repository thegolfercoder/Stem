"""The browser reads slow motion the way the desktop does.

On the real test set the desktop refused 71 of 82 slow-motion replays as "not a
swing" until it learned to re-read a refused clip as if played 2, 4 or 8 times
faster (`analyse_pose_sequence`). The browser app refused every one of them until
`readAtSpeeds` in webapp/metrics.js. These tests slow the real phone swing down
by stretching its timestamps, run it through both, and require the same answer:
the same playback factor, the same frames, the same tempo, and every duration
refused on both sides.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import (
    AnalysisConfig,
    SwingAnalysis,
    analyse_pose_sequence,
    analyse_with_positions,
    load_model,
)
from swingml.events import SwingEvent
from swingml.model.ensemble import EnsembleConfig, SwingEventEnsemble
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading, Quantity
from swingml.skeleton import Handedness

HERE = Path(__file__).parent
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"
HARNESS = HERE / "js" / "slowmo_parity.mjs"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not PAYLOAD.is_file() or not LANDMARKS.is_file(),
    reason=(
        "needs node, the real-swing fixture, and an exported web payload "
        "(python scripts/export_web_model.py)"
    ),
)


def fixture_sequence(slowed_by: float) -> PoseSequence:
    data = np.load(LANDMARKS)
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"] * slowed_by,
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )


# #32's re-reading rule failed the release gate (#41); what ships keeps the
# recorded-speed read and withholds durations (#49). The re-read cases switch the
# old rule on in both engines, so that code stays in step too.
CHECK = {"slow_motion_check_backswing_s": 1.1, "slow_motion_margin": 0.01,
         "slow_motion_check_rereads": True}  # fmt: skip


def python_read(sequence: PoseSequence, check: bool = False) -> SwingAnalysis:
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    sources = [Path(p) for p in payload.get("source_models", [payload["source_model"]])]
    model = (
        load_model(sources[0])
        if len(sources) == 1
        else SwingEventEnsemble.load(
            sources, EnsembleConfig(time_warps=tuple(payload["time_warps"]))
        )
    )
    config = AnalysisConfig(handedness=Handedness.RIGHT, **(CHECK if check else {}))
    return analyse_pose_sequence(sequence, model, config)


def browser_read(
    sequence: PoseSequence, workdir: Path, check: bool = False, positions: list[int] | None = None
) -> dict:
    payload = PAYLOAD
    if check:
        changed = json.loads(PAYLOAD.read_text(encoding="utf-8"))
        changed["thresholds"].update(CHECK)
        payload = workdir / "payload.json"
        payload.write_text(json.dumps(changed), encoding="utf-8")
    job = workdir / "job.json"
    job.write_text(
        json.dumps(
            {
                "xy": sequence.xy.tolist(),
                "visibility": sequence.visibility.tolist(),
                "world": (
                    sequence.world_xyz.tolist()
                    if sequence.world_xyz is not None
                    else np.zeros((sequence.n_frames, 33, 3)).tolist()
                ),
                "detected": [bool(v) for v in np.asarray(sequence.detected).ravel()],
                "times": sequence.timestamps_s.tolist(),
                "width": sequence.frame_width,
                "height": sequence.frame_height,
                "handedness": "right",
                "payload": str(payload),
                "positions": positions,
            }
        ),
        encoding="utf-8",
    )
    finished = subprocess.run(
        ["node", str(HARNESS), str(job)], capture_output=True, text=True, timeout=300, check=False
    )
    if finished.returncode != 0:
        pytest.fail(f"the browser pipeline would not run:\n{finished.stderr[-2000:]}")
    return dict(json.loads(finished.stdout))


@pytest.fixture(scope="module", params=[(2.0, True), (3.0, True), (4.0, False), (2.0, False),
                                        (3.0, False)])  # fmt: skip
def pair(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory):  # type: ignore[no-untyped-def]
    factor, check = request.param
    sequence = fixture_sequence(factor)
    workdir = tmp_path_factory.mktemp("slowmo")
    return python_read(sequence, check), browser_read(sequence, workdir, check)


def test_the_payload_carries_the_desktop_factors() -> None:
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    thresholds, config = payload["thresholds"], AnalysisConfig()
    assert tuple(thresholds["slow_motion_factors"]) == config.slow_motion_factors
    assert thresholds["slow_motion_check_backswing_s"] == config.slow_motion_check_backswing_s
    assert thresholds["slow_motion_margin"] == config.slow_motion_margin
    assert thresholds["slow_motion_check_rereads"] is config.slow_motion_check_rereads is False


def test_both_read_the_slowed_swing_at_the_same_factor(pair) -> None:  # type: ignore[no-untyped-def]
    python, browser = pair
    assert python.playback_slowed_by is not None, "the desktop no longer reads this as slow motion"
    assert browser["ok"], browser.get("reason")
    assert browser["slowedBy"] == python.playback_slowed_by


def test_the_positions_and_tempo_agree(pair) -> None:  # type: ignore[no-untyped-def]
    python, browser = pair
    assert not isinstance(python.events, NoReading)
    assert browser["frames"] == list(python.events.frames)
    assert not isinstance(python.metrics, NoReading)
    tempo = python.metrics.tempo_ratio
    assert isinstance(tempo, Quantity)
    assert browser["tempoRatio"] == pytest.approx(tempo.value, abs=1e-3)
    assert browser["eventTimes"] == pytest.approx(list(python.event_times_s), abs=1e-3)


def test_every_duration_is_refused_on_both_sides(pair) -> None:  # type: ignore[no-untyped-def]
    python, browser = pair
    assert not isinstance(python.metrics, NoReading)
    assert isinstance(python.metrics.backswing_duration, NoReading)
    assert isinstance(python.metrics.downswing_duration, NoReading)
    assert isinstance(python.metrics.time_to_peak_hand_speed, NoReading)
    assert browser["backswingMs"] is None
    assert browser["downswingMs"] is None
    assert browser["peakHandSpeedMs"] is None


def test_a_real_time_clip_is_not_treated_as_slow_motion(tmp_path: Path) -> None:
    browser = browser_read(fixture_sequence(1.0), tmp_path)
    assert browser["ok"]
    assert browser["slowedBy"] is None
    assert browser["backswingMs"] is not None


@pytest.mark.parametrize("factor", [2.0, 3.0])
def test_what_ships_withholds_durations_and_keeps_the_recorded_speed_read(
    factor: float, tmp_path: Path
) -> None:
    """#49: the shipped check moves no event and no tempo, in either engine."""
    sequence = fixture_sequence(factor)
    off = AnalysisConfig(handedness=Handedness.RIGHT, slow_motion_check_backswing_s=None)
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    sources = [Path(p) for p in payload.get("source_models", [payload["source_model"]])]
    model = (
        load_model(sources[0])
        if len(sources) == 1
        else SwingEventEnsemble.load(
            sources, EnsembleConfig(time_warps=tuple(payload["time_warps"]))
        )
    )
    unchecked = analyse_pose_sequence(sequence, model, off)
    shipped = python_read(sequence)
    browser = browser_read(sequence, tmp_path)
    assert not isinstance(unchecked.events, NoReading) and not isinstance(shipped.events, NoReading)
    assert shipped.playback_slowed_by is not None, "the check did not fire"
    assert shipped.events.frames == unchecked.events.frames
    assert shipped.event_times_s == unchecked.event_times_s
    assert not isinstance(shipped.metrics, NoReading) and not isinstance(
        unchecked.metrics, NoReading
    )
    assert shipped.metrics.tempo_ratio.value == unchecked.metrics.tempo_ratio.value  # type: ignore[union-attr]
    assert isinstance(shipped.metrics.backswing_duration, NoReading)
    assert browser["slowedBy"] == shipped.playback_slowed_by
    assert browser["frames"] == list(unchecked.events.frames)


# -- a position moved by the golfer on a slow-motion read (#74) -------------------


@pytest.mark.parametrize(("factor", "check"), [(2.0, False), (4.0, False), (2.0, True)])
def test_a_moved_position_is_measured_alike_and_stays_slowed(
    factor: float, check: bool, tmp_path: Path
) -> None:
    """The desktop measured a golfer's positions at the clip's recorded speed and
    dropped the slow-motion reading: a 3.5 s backswing on a 4x replay. The browser
    keeps the read's timeline and withholds the durations; both must."""
    sequence = fixture_sequence(factor)
    python = python_read(sequence, check)
    assert python.playback_slowed_by is not None and not isinstance(python.events, NoReading)
    retimed = python.playback_retimed is not False
    frames = list(python.event_source_frames)
    frames[int(SwingEvent.TOP)] += 1  # the golfer nudges the top a frame later
    moved = analyse_with_positions(
        sequence, frames, Handedness.RIGHT,
        slowed_by=python.playback_slowed_by, retimed=retimed,
    )  # fmt: skip
    browser = browser_read(sequence, tmp_path, check, positions=frames)["moved"]
    assert moved.playback_slowed_by == browser["slowedBy"] == python.playback_slowed_by
    assert moved.playback_retimed is retimed and browser["slowedRetimed"] is retimed
    assert not isinstance(moved.metrics, NoReading)
    for name in ("backswing_duration", "downswing_duration", "swing_duration",
                 "time_to_peak_hand_speed"):  # fmt: skip
        assert isinstance(getattr(moved.metrics, name), NoReading), name
    assert browser["backswingMs"] is browser["downswingMs"] is browser["wholeMs"] is None
    tempo = moved.metrics.tempo_ratio
    assert not isinstance(tempo, NoReading)
    assert tempo.value == pytest.approx(browser["tempoRatio"], abs=1e-6)
    assert any("slow motion" in a for a in tempo.assumptions)
    # Measured on the same timeline: the readings taken from the pose at each
    # position agree too, which tempo, a ratio of times, cannot show.
    for key, name, tolerance in (("shoulderTurnDeg", "shoulder_turn_foreshortened", 5e-4),
                                 ("hipTurnDeg", "hip_turn_foreshortened", 5e-4),
                                 ("headMovement", "head_movement", 1e-6),
                                 ("pelvisSway", "pelvis_sway", 1e-6)):  # fmt: skip
        reading = getattr(moved.metrics, name)
        if isinstance(reading, NoReading):
            assert browser[key] is None, (key, browser[key])
        else:
            assert reading.value == pytest.approx(browser[key], abs=tolerance), key
