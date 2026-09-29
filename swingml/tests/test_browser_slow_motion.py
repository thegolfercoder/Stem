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

from swingml.analysis import AnalysisConfig, SwingAnalysis, analyse_pose_sequence, load_model
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


def python_read(sequence: PoseSequence) -> SwingAnalysis:
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    sources = [Path(p) for p in payload.get("source_models", [payload["source_model"]])]
    model = (
        load_model(sources[0])
        if len(sources) == 1
        else SwingEventEnsemble.load(
            sources, EnsembleConfig(time_warps=tuple(payload["time_warps"]))
        )
    )
    return analyse_pose_sequence(sequence, model, AnalysisConfig(handedness=Handedness.RIGHT))


def browser_read(sequence: PoseSequence, workdir: Path) -> dict:
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
                "payload": str(PAYLOAD),
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


@pytest.fixture(scope="module", params=[4.0])
def pair(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory):  # type: ignore[no-untyped-def]
    sequence = fixture_sequence(request.param)
    return python_read(sequence), browser_read(sequence, tmp_path_factory.mktemp("slowmo"))


def test_the_payload_carries_the_desktop_factors() -> None:
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    assert (
        tuple(payload["thresholds"]["slow_motion_factors"]) == AnalysisConfig().slow_motion_factors
    )


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
