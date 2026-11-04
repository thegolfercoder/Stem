"""Fusion of radar, club IMU and phone camera, scored against a shot with known truth.

The synthetic shot has one timeline. Each sensor's data is generated on it and
then moved onto that sensor's own clock with a known offset - the ground
unit's, the pod's after a Bluetooth mapping with a residual error, and the
phone's - so the test can check that fusion puts them back.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from launchmon.config import load_clubs, load_hardware
from launchmon.dsp.pipeline import analyse_radar_capture
from launchmon.dsp.presets import ground_unit_radar_pipeline
from launchmon.fusion.audio import impact_transient_time
from launchmon.fusion.camera import CameraSwing, camera_swing_from_swingml
from launchmon.fusion.shot import SPEED_OF_SOUND_MPS, FusedShot, FusionConfig, fuse_shot
from launchmon.imu.trace import trace_from_counts
from launchmon.ingest.iq import iq_to_receding_real
from launchmon.quantity import NoReading, Provenance, Quantity
from tests.synth.imu import generate_imu_swing
from tests.synth.iq import generate_iq_shot

CLUB = load_clubs().by_name("driver")
GEOMETRY = load_hardware().radar_geometry

BACKSWING_S, DOWNSWING_S = 0.80, 0.27
CAPTURE_START = 100.0  # ground-unit clock
BLE_ERROR_S = 0.006  # residual error of the pod -> ground clock mapping
CLIP_IMPACT = 3.0  # phone clip clock
CAMERA_DISTANCE_M = 3.0


@pytest.fixture(scope="module")
def radar_shot():  # type: ignore[no-untyped-def]
    shot = generate_iq_shot(launch_speed_mps=62.58)
    result = analyse_radar_capture(
        iq_to_receding_real(shot.i, shot.q, shot.fmt), ground_unit_radar_pipeline()
    )
    return shot, result


def _imu_trace(error_s: float = BLE_ERROR_S, **kwargs: object):  # type: ignore[no-untyped-def]
    takeaway = 1.0
    impact_local = takeaway + BACKSWING_S + DOWNSWING_S
    impact_ground = CAPTURE_START + 0.25
    swing = generate_imu_swing(
        takeaway_s=takeaway,
        backswing_s=BACKSWING_S,
        downswing_s=DOWNSWING_S,
        clock_offset_s=impact_ground - impact_local + error_s,
        **kwargs,
    )  # type: ignore[arg-type]
    return trace_from_counts(swing.t_us, swing.counts, clock="ground"), swing.truth


def _camera(top_error_s: float = 0.0, fps: float = 240.0, refused: bool = False) -> CameraSwing:
    offsets = (
        -(BACKSWING_S + DOWNSWING_S),
        -0.85,
        -0.55,
        -DOWNSWING_S + top_error_s,
        -0.10,
        0.0,
        0.12,
        0.9,
    )
    return CameraSwing(
        clip="swing.mov",
        event_times_s=None if refused else tuple(CLIP_IMPACT + o for o in offsets),
        event_confidence=None if refused else (0.9,) * 8,
        refusal="no body found" if refused else None,
        frame_period_s=1 / fps,
        tempo_ratio=None if refused else BACKSWING_S / DOWNSWING_S,
    )


def _audio_impact() -> Quantity:
    return Quantity(
        value=CLIP_IMPACT + CAMERA_DISTANCE_M / SPEED_OF_SOUND_MPS,
        unit="s",
        provenance=Provenance.MEASURED,
        source="camera-audio",
    )


def _fuse(radar_shot, **kwargs: object) -> FusedShot:  # type: ignore[no-untyped-def]
    _, result = radar_shot
    args: dict[str, object] = dict(
        club=CLUB,
        geometry=GEOMETRY,
        radar=result,
        radar_capture_start_s=CAPTURE_START,
        imu_trace=_imu_trace()[0],
        camera=_camera(),
        camera_audio_impact_s=_audio_impact(),
        config=FusionConfig(camera_to_ball_m=CAMERA_DISTANCE_M),
    )
    args.update(kwargs)
    return fuse_shot(**args)  # type: ignore[arg-type]


def _event(shot: FusedShot, name: str) -> float:
    e = next(e for e in shot.events if e.event == name)
    assert isinstance(e.time_s, Quantity), e.time_s
    return e.time_s.value


def test_all_three_sensors_land_on_one_timeline(radar_shot) -> None:  # type: ignore[no-untyped-def]
    shot = _fuse(radar_shot)
    assert shot.timeline_reference == "radar"
    assert {a.sensor for a in shot.alignment} == {"radar", "imu", "camera"}
    imu = next(a for a in shot.alignment if a.sensor == "imu")
    # The IMU's shock was found near where the Bluetooth mapping put it.
    radar = next(a for a in shot.alignment if a.sensor == "radar")
    assert abs((imu.impact_on_own_clock_s - radar.impact_on_own_clock_s) - BLE_ERROR_S) < 0.003

    assert next(e for e in shot.events if e.event == "impact").source == "radar"
    assert next(e for e in shot.events if e.event == "top").source == "imu"
    assert next(e for e in shot.events if e.event == "address").source == "imu"
    assert next(e for e in shot.events if e.event == "mid_downswing").source == "camera"
    assert abs(_event(shot, "top") - (-DOWNSWING_S)) < 0.003
    assert abs(_event(shot, "address") - (-(BACKSWING_S + DOWNSWING_S))) < 0.015
    # The camera agreed with the IMU, and its audio and impact event agreed.
    assert shot.disagreements == ()


def test_tempo_comes_from_the_best_sensor_for_each_event(radar_shot) -> None:  # type: ignore[no-untyped-def]
    shot = _fuse(radar_shot)
    assert isinstance(shot.tempo_ratio, Quantity)
    assert shot.tempo_ratio.provenance is Provenance.DERIVED
    assert "imu" in shot.tempo_ratio.source and "radar" in shot.tempo_ratio.source
    assert (
        abs(shot.tempo_ratio.value - BACKSWING_S / DOWNSWING_S) / (BACKSWING_S / DOWNSWING_S) < 0.03
    )


def test_true_ball_speed_is_modelled_until_a_launch_angle_is_measured(radar_shot) -> None:  # type: ignore[no-untyped-def]
    shot = _fuse(radar_shot)
    assert isinstance(shot.ball_speed_radial, Quantity)
    assert shot.ball_speed_radial.provenance is Provenance.MEASURED
    assert isinstance(shot.ball_speed, Quantity)
    assert shot.ball_speed.provenance is Provenance.MODELLED
    assert any("prior" in a for a in shot.ball_speed.assumptions)
    assert shot.ball_speed.value > shot.ball_speed_radial.value

    measured = Quantity(value=12.0, unit="deg", provenance=Provenance.MEASURED, source="camera")
    shot2 = _fuse(radar_shot, measured_launch_angle_deg=measured)
    assert isinstance(shot2.ball_speed, Quantity)
    assert shot2.ball_speed.provenance is Provenance.DERIVED


def test_imu_clubhead_speed_is_modelled_and_the_radius_is_measured_against_the_radar(
    radar_shot,  # type: ignore[no-untyped-def]
) -> None:
    shot = _fuse(radar_shot)
    assert isinstance(shot.clubhead_speed_from_imu, Quantity)
    assert shot.clubhead_speed_from_imu.provenance is Provenance.MODELLED
    assert isinstance(shot.effective_clubhead_radius, Quantity)
    assert shot.effective_clubhead_radius.provenance is Provenance.DERIVED
    assert isinstance(shot.clubhead_speed_radial, Quantity)
    assert isinstance(shot.shaft_rate_at_impact, Quantity)
    omega = math.radians(shot.shaft_rate_at_impact.value)
    assert shot.effective_clubhead_radius.value == pytest.approx(
        shot.clubhead_speed_radial.value / omega
    )


def test_a_camera_that_disagrees_with_the_imu_is_reported_not_believed(radar_shot) -> None:  # type: ignore[no-untyped-def]
    shot = _fuse(radar_shot, camera=_camera(top_error_s=0.030))
    assert any(d.event == "top" and d.sensors == ("imu", "camera") for d in shot.disagreements)
    # The IMU's top still stands.
    assert abs(_event(shot, "top") - (-DOWNSWING_S)) < 0.003


def test_without_sound_travel_correction_the_note_says_so(radar_shot) -> None:  # type: ignore[no-untyped-def]
    shot = _fuse(radar_shot, config=FusionConfig())
    cam = next(a for a in shot.alignment if a.sensor == "camera")
    assert any("not removed" in n for n in cam.notes)


def test_no_radar_puts_the_imu_on_the_timeline_and_refuses_the_speeds() -> None:
    shot = fuse_shot(
        club=CLUB,
        geometry=GEOMETRY,
        imu_trace=_imu_trace()[0],
        camera=_camera(),
        camera_audio_impact_s=_audio_impact(),
        config=FusionConfig(camera_to_ball_m=CAMERA_DISTANCE_M),
    )
    assert shot.timeline_reference == "imu"
    assert isinstance(shot.ball_speed, NoReading)
    assert isinstance(shot.clubhead_speed_radial, NoReading)
    assert isinstance(shot.effective_clubhead_radius, NoReading)
    assert next(e for e in shot.events if e.event == "impact").source == "imu"
    assert isinstance(shot.tempo_ratio, Quantity)


def test_camera_alone_still_gives_a_timeline_with_its_limits_stated() -> None:
    shot = fuse_shot(club=CLUB, geometry=GEOMETRY, camera=_camera())
    assert shot.timeline_reference == "camera"
    toe_up = next(e for e in shot.events if e.event == "toe_up")
    assert isinstance(toe_up.time_s, Quantity)
    assert toe_up.time_s.provenance is Provenance.MODELLED
    assert isinstance(shot.peak_shaft_rate, NoReading)


def test_nothing_usable_is_a_set_of_refusals_not_a_crash() -> None:
    shot = fuse_shot(club=CLUB, geometry=GEOMETRY, camera=_camera(refused=True))
    assert shot.timeline_reference == "none"
    assert all(isinstance(e.time_s, NoReading) for e in shot.events)
    assert isinstance(shot.tempo_ratio, NoReading)


def test_the_strike_is_found_in_the_audio_to_a_fraction_of_a_millisecond() -> None:
    fs = 48_000
    rng = np.random.default_rng(3)
    audio = 0.01 * rng.standard_normal(fs * 4)
    strike = 2.3456
    k = round(strike * fs)
    burst = rng.standard_normal(2400) * np.exp(-np.arange(2400) / 300)
    audio[k : k + 2400] += 0.8 * burst
    # Speech-like low-frequency energy elsewhere must not be taken for it.
    t = np.arange(audio.size) / fs
    audio += 0.3 * np.sin(2 * np.pi * 180 * t) * ((t > 0.5) & (t < 1.5))
    found = impact_transient_time(audio, fs)
    assert isinstance(found, Quantity)
    assert abs(found.value - strike) < 0.0005


def test_silence_is_not_a_strike() -> None:
    audio = 0.01 * np.random.default_rng(0).standard_normal(48_000)
    assert isinstance(impact_transient_time(audio, 48_000), NoReading)


def test_swingml_json_is_read_without_swingml() -> None:
    ok = camera_swing_from_swingml(
        {
            "video": {"path": "a.mov", "measured_fps": 240.0},
            "events": {"frames": [1, 2, 3, 4, 5, 6, 7, 8], "confidence": [0.9] * 8},
            "event_times_s": [0.1 * i for i in range(8)],
            "event_uncertainty": [{"half_width_ms": 12.5}] * 8,
            "metrics": {"tempo_ratio": {"value": 3.1}},
        }
    )
    assert ok.event_times_s is not None and len(ok.event_times_s) == 8
    assert ok.frame_period_s == pytest.approx(1 / 240)
    assert ok.event_band_ms == (12.5,) * 8
    assert ok.tempo_ratio == 3.1
    refused = camera_swing_from_swingml(
        {
            "video": None,
            "events": {"reason": "no swing", "source": "events"},
            "event_times_s": [],
        }
    )
    assert refused.event_times_s is None and refused.refusal == "no swing"


def test_end_to_end_from_a_ground_unit_stream() -> None:
    """The same path as scripts/fuse_shot.py: USB stream bytes in, fused shot out."""
    import json as _json

    from launchmon.ingest.ground_unit import IMU_RECORD, parse_ground_unit_stream

    iq = generate_iq_shot(launch_speed_mps=53.64)
    to_codes = lambda x: np.clip(np.round((x - x.mean()) * 300 + 2048), 0, 4095)  # noqa: E731
    pairs = np.stack([to_codes(iq.i), to_codes(iq.q)], axis=1).astype("<i2")
    fs = iq.fmt.sample_rate_hz
    end_us = int((CAPTURE_START + pairs.shape[0] / fs) * 1e6)
    raw_header = {
        "shot_seq": 7,
        "pairs": pairs.shape[0],
        "fs_hz": fs,
        "q_lag_samples": 0.5,
        "receding_sign": 1,
        "capture_end_us": end_us % 2**32,
        "bytes": pairs.nbytes,
    }

    takeaway = 1.0
    swing = generate_imu_swing(
        takeaway_s=takeaway,
        backswing_s=BACKSWING_S,
        downswing_s=DOWNSWING_S,
        clock_offset_s=CAPTURE_START + 0.25 - (takeaway + BACKSWING_S + DOWNSWING_S) + BLE_ERROR_S,
    )
    rec = np.zeros(swing.counts.shape[0], dtype=IMU_RECORD)
    rec["counts"] = swing.counts
    rec["t_ground_us"] = np.round(swing.t_us).astype(np.int64) % 2**32
    imu_header = {
        "shot_seq": 7,
        "n": rec.size,
        "bytes": rec.nbytes,
        "gyro_dps_per_lsb": 0.07,
        "accel_g_per_lsb": 0.000488,
        "clip_counts": 32700,
    }

    stream = (
        b'{"type":"shot","shot_seq":7}\n'
        + b"RAW_BEGIN "
        + _json.dumps(raw_header).encode()
        + b"\n"
        + pairs.tobytes()
        + b"\nRAW_END\r\n"
        + b"IMU_BEGIN "
        + _json.dumps(imu_header).encode()
        + b"\n"
        + rec.tobytes()
        + b"\nIMU_END\r\n"
    )
    log = parse_ground_unit_stream(stream)
    cap, block = log.capture(7), log.imu(7)
    assert cap is not None and block is not None
    radar = analyse_radar_capture(
        iq_to_receding_real(cap.i, cap.q, cap.fmt), ground_unit_radar_pipeline()
    )
    shot = fuse_shot(
        club=CLUB,
        geometry=GEOMETRY,
        radar=radar,
        radar_capture_start_s=cap.capture_start_s,
        imu_trace=block.trace(near_s=cap.capture_end_s),
        camera=_camera(),
        camera_audio_impact_s=_audio_impact(),
        config=FusionConfig(camera_to_ball_m=CAMERA_DISTANCE_M),
    )
    assert shot.timeline_reference == "radar"
    assert isinstance(shot.ball_speed_radial, Quantity)
    truth = iq.single_channel.ground_truth.radial_launch_speed_mps
    assert abs(shot.ball_speed_radial.value - truth) / truth < 0.005
    assert abs(_event(shot, "top") - (-DOWNSWING_S)) < 0.003
    assert isinstance(shot.tempo_ratio, Quantity)
    assert shot.disagreements == ()
