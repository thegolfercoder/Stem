"""The camera's distance to the ball, for the strike's sound travel.

The phone films from the ground unit's dock stem, so unless told otherwise
fusion takes it to be where the radar is: `range_from_tee_m` behind the ball.
That is configured geometry, and it must say so wherever it is used. A phone
elsewhere takes its own distance, and "none" leaves the travel in.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from launchmon.config import load_clubs, load_hardware
from launchmon.fusion.camera import CameraSwing
from launchmon.fusion.shot import (
    SPEED_OF_SOUND_MPS,
    FusedShot,
    FusionConfig,
    SensorAlignment,
    camera_on_the_unit,
    fuse_shot,
)
from launchmon.quantity import Provenance, Quantity

ROOT = Path(__file__).resolve().parent.parent
CLUB = load_clubs().by_name("driver")
GEOMETRY = load_hardware().radar_geometry
HEARD = 2.0  # the strike's onset in the clip's audio, on the clip's clock


def _camera() -> CameraSwing:
    offsets = (-1.07, -0.85, -0.55, -0.27, -0.10, 0.0, 0.12, 0.9)
    return CameraSwing(
        clip="swing.mov",
        event_times_s=tuple(HEARD + o for o in offsets),
        event_confidence=(0.9,) * 8,
        frame_period_s=1 / 240,
    )


def _fuse(config: FusionConfig) -> FusedShot:
    heard = Quantity(value=HEARD, unit="s", provenance=Provenance.MEASURED, source="camera-audio")
    return fuse_shot(
        club=CLUB, geometry=GEOMETRY, camera=_camera(), camera_audio_impact_s=heard, config=config
    )


def _camera_alignment(shot: FusedShot) -> SensorAlignment:
    return next(a for a in shot.alignment if a.sensor == "camera")


def test_on_the_unit_the_camera_is_the_radars_configured_distance_and_says_so() -> None:
    metres, basis = camera_on_the_unit(GEOMETRY)
    assert metres == GEOMETRY.range_from_tee_m
    assert f"{GEOMETRY.range_from_tee_m:.2f} m" in basis
    assert "range_from_tee_m" in basis
    assert "configured geometry, not a measurement" in basis

    shot = _fuse(FusionConfig(camera_to_ball_m=metres, camera_to_ball_basis=basis))
    cam = _camera_alignment(shot)
    assert cam.impact_on_own_clock_s == pytest.approx(HEARD - metres / SPEED_OF_SOUND_MPS)
    assert f"sound travel over {metres:.1f} m removed" in cam.notes
    assert basis in cam.notes


def test_a_distance_given_for_the_session_is_used_without_a_basis_note() -> None:
    shot = _fuse(FusionConfig(camera_to_ball_m=3.0))
    cam = _camera_alignment(shot)
    assert cam.impact_on_own_clock_s == pytest.approx(HEARD - 3.0 / SPEED_OF_SOUND_MPS)
    assert "sound travel over 3.0 m removed" in cam.notes
    assert not any("assumed" in n for n in cam.notes)


def test_an_unknown_distance_leaves_the_travel_in_and_says_so() -> None:
    cam = _camera_alignment(_fuse(FusionConfig()))
    assert cam.impact_on_own_clock_s == HEARD
    assert any("not removed" in n for n in cam.notes)


@pytest.mark.parametrize("bad", [-0.1, math.nan, math.inf])
def test_a_distance_that_is_not_one_is_refused(bad: float) -> None:
    with pytest.raises(ValueError):
        FusionConfig(camera_to_ball_m=bad)


def test_a_basis_without_a_distance_is_refused() -> None:
    with pytest.raises(ValueError, match="describes a distance"):
        FusionConfig(camera_to_ball_basis="assumed: somewhere")


# --- The command line ------------------------------------------------------------


def _cli(*args: str | Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "fuse_shot.py"), *map(str, args)],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT)},
        check=False,
    )


def _write_clip(tmp_path: Path) -> tuple[Path, Path]:
    """swingml's JSON for one swing, and a clip whose audio holds its strike."""
    camera = tmp_path / "camera.json"
    camera.write_text(
        json.dumps(
            {
                "video": {"path": "swing.wav", "measured_fps": 240.0},
                "events": {"frames": list(range(8)), "confidence": [0.9] * 8},
                "event_times_s": list(_camera().event_times_s or ()),
            }
        )
    )
    fs = 48_000
    rng = np.random.default_rng(5)
    audio = 0.005 * rng.standard_normal(fs * 3)
    k = round(HEARD * fs)
    audio[k : k + 2400] += 0.8 * rng.standard_normal(2400) * np.exp(-np.arange(2400) / 300)
    clip = tmp_path / "swing.wav"
    with wave.open(str(clip), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(fs)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    return camera, clip


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="reading a clip's audio needs ffmpeg")
def test_the_command_line_assumes_the_unit_unless_told_otherwise(tmp_path: Path) -> None:
    camera, clip = _write_clip(tmp_path)

    def run(*extra: str) -> dict[str, Any]:
        out = tmp_path / "fused.json"
        done = _cli("--camera", camera, "--video", clip, *extra, "--json", out)
        assert done.returncode == 0, done.stderr
        (entry,) = json.loads(out.read_text())
        assert isinstance(entry, dict)
        return entry

    def camera_of(entry: dict[str, Any]) -> dict[str, Any]:
        found = next(a for a in entry["alignment"] if a["sensor"] == "camera")
        assert isinstance(found, dict)
        return found

    default = run()
    tripod = run("--camera-distance", "3.0")
    unknown = run("--camera-distance", "none")
    heard = camera_of(unknown)["impact_on_own_clock_s"]
    d = GEOMETRY.range_from_tee_m
    impact = "impact_on_own_clock_s"
    assert camera_of(default)[impact] == pytest.approx(heard - d / SPEED_OF_SOUND_MPS)
    assert camera_of(tripod)[impact] == pytest.approx(heard - 3.0 / SPEED_OF_SOUND_MPS)

    assert any("configured geometry, not a measurement" in n for n in camera_of(default)["notes"])
    assert not any("assumed" in n for n in camera_of(tripod)["notes"])
    assert any("not removed" in n for n in camera_of(unknown)["notes"])

    # The camera defines this timeline, so every event it placed moves by the travel removed.
    for with_unit, without in zip(default["events"], unknown["events"], strict=True):
        shift = with_unit["time_s"]["value"] - without["time_s"]["value"]
        assert shift == pytest.approx(d / SPEED_OF_SOUND_MPS)


@pytest.mark.parametrize("bad", ["-1", "far", "nan"])
def test_the_command_line_refuses_a_distance_that_is_not_one(bad: str) -> None:
    done = _cli("--camera-distance", bad)
    assert done.returncode == 2
    assert "--camera-distance" in done.stderr and "not a distance in metres" in done.stderr
