"""Per-club calibration of the IMU's clubhead radius, and the fallback it enables.

The store is driven with known radii, so acceptance, refusal and the
calibration's statistics can be checked exactly. The fusion tests then use the
same synthetic radar and IMU shots as `test_fusion.py`.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import pytest

from launchmon.dsp.pipeline import RadarResult, analyse_radar_capture
from launchmon.dsp.presets import ground_unit_radar_pipeline
from launchmon.fusion.calibration import (
    CalibrationFileError,
    CalibrationStore,
    RadiusCalibration,
    RadiusCalibrationConfig,
    SampleOutcome,
    load_calibration,
    save_calibration,
)
from launchmon.fusion.shot import FusedShot, FusionConfig, fuse_shot
from launchmon.ingest.iq import iq_to_receding_real
from launchmon.quantity import NoReading, Provenance, Quantity
from tests.synth.imu import generate_imu_swing
from tests.synth.iq import generate_iq_shot
from tests.test_fusion import (
    BACKSWING_S,
    BLE_ERROR_S,
    CAMERA_DISTANCE_M,
    CAPTURE_START,
    CLUB,
    DOWNSWING_S,
    GEOMETRY,
    _audio_impact,
    _camera,
    _imu_trace,
)

T0 = datetime(2026, 4, 1, 9, 0, tzinfo=UTC)
CONFIG = RadiusCalibrationConfig()


def _at(i: int) -> datetime:
    return T0 + timedelta(minutes=i)


def _store_with(radii: list[float], club: str = "7i") -> CalibrationStore:
    store = CalibrationStore()
    for i, r in enumerate(radii):
        store, decision = store.offer_radius(club, r, recorded_at=_at(i), shot=f"s#{i}")
        assert decision.outcome is SampleOutcome.ACCEPTED, decision
    return store


# Five samples around 1.30 m with a little scatter: MAD 0.005 m.
STEADY = [1.300, 1.305, 1.295, 1.310, 1.290]


# --- Accepting and refusing samples -------------------------------------------


def test_a_plausible_sample_is_accepted_and_kept_with_its_time() -> None:
    store, decision = CalibrationStore().offer_radius(
        "7i", 1.25, recorded_at=T0, shot="session.bin#3"
    )
    assert decision.outcome is SampleOutcome.ACCEPTED
    assert decision.n_accepted == 1
    (sample,) = store.history("7i").accepted
    assert (sample.radius_m, sample.recorded_at, sample.shot) == (1.25, T0, "session.bin#3")
    # The store is a value: the original is untouched, and other clubs are separate.
    assert CalibrationStore().history("7i").accepted == ()
    assert store.history("driver").accepted == ()


@pytest.mark.parametrize("radius", [0.30, 0.59, 1.81, 2.60])
def test_an_implausible_radius_is_refused_and_the_refusal_is_kept(radius: float) -> None:
    store, decision = CalibrationStore().offer_radius("7i", radius, recorded_at=T0)
    assert decision.outcome is SampleOutcome.REJECTED
    assert "outside the 0.60 to 1.80 m" in decision.reason
    history = store.history("7i")
    assert history.accepted == ()
    (refused,) = history.rejected
    assert refused.radius_m == radius and refused.reason == decision.reason


def test_the_plausible_bounds_are_inclusive_and_configurable() -> None:
    for r in (0.6, 1.8):
        assert CalibrationStore().offer_radius("7i", r, recorded_at=T0)[1].outcome == "accepted"
    tight = RadiusCalibrationConfig(plausible_radius_m=(0.9, 1.2))
    _, decision = CalibrationStore().offer_radius("7i", 1.3, recorded_at=T0, config=tight)
    assert decision.outcome is SampleOutcome.REJECTED


def test_a_radius_that_is_not_a_number_is_reported_and_not_stored() -> None:
    store = CalibrationStore()
    after, decision = store.offer_radius("7i", math.nan, recorded_at=T0)
    assert decision.outcome is SampleOutcome.NO_SAMPLE and "not a number" in decision.reason
    assert after is store


def test_outliers_are_refused_only_once_there_is_a_reference() -> None:
    # Four samples are not a reference: a plausible but distant fifth is accepted.
    store = _store_with(STEADY[:4])
    _, early = store.offer_radius("7i", 1.60, recorded_at=_at(10))
    assert early.outcome is SampleOutcome.ACCEPTED

    store = _store_with(STEADY)
    store, late = store.offer_radius("7i", 1.60, recorded_at=_at(10))
    assert late.outcome is SampleOutcome.REJECTED
    assert late.reason.startswith("outlier") and "median 1.300 m" in late.reason
    assert len(store.history("7i").accepted) == 5
    assert len(store.history("7i").rejected) == 1
    # A sample within the scatter still goes in.
    store, ok = store.offer_radius("7i", 1.312, recorded_at=_at(11))
    assert ok.outcome is SampleOutcome.ACCEPTED and ok.n_accepted == 6


def test_identical_early_samples_do_not_make_every_later_one_an_outlier() -> None:
    # MAD 0: without the floor, any difference at all would be refused.
    store = _store_with([1.30] * 5)
    assert store.offer_radius("7i", 1.33, recorded_at=_at(9))[1].outcome == "accepted"
    # 1.40 is 0.10 m away: five floored deviations (2 cm), beyond the 3.5 limit.
    assert store.offer_radius("7i", 1.40, recorded_at=_at(9))[1].outcome == "rejected"


def test_the_same_shot_is_not_counted_twice() -> None:
    store, first = CalibrationStore().offer_radius("7i", 1.3, recorded_at=T0, shot="a.bin#1")
    again, second = store.offer_radius("7i", 1.3, recorded_at=_at(5), shot="a.bin#1")
    assert first.outcome is SampleOutcome.ACCEPTED
    assert second.outcome is SampleOutcome.NO_SAMPLE and "already recorded" in second.reason
    assert again is store
    # Another session that reuses the file name measured a different radius.
    _, other = store.offer_radius("7i", 1.31, recorded_at=_at(6), shot="a.bin#1")
    assert other.outcome is SampleOutcome.ACCEPTED


def test_empty_club_identifiers_are_refused() -> None:
    with pytest.raises(ValueError, match="club identifier"):
        CalibrationStore().offer_radius(" ", 1.3, recorded_at=T0)


def test_recorded_times_must_carry_a_time_zone() -> None:
    with pytest.raises(ValueError):
        CalibrationStore().offer_radius("7i", 1.3, recorded_at=datetime(2026, 4, 1, 9, 0))


# --- The calibration ------------------------------------------------------------


def test_the_calibration_waits_for_the_minimum_number_of_samples() -> None:
    store = _store_with(STEADY[:4])
    pending = store.calibration("7i")
    assert isinstance(pending, NoReading)
    assert "4 of the 5" in pending.reason and pending.source == "calibration"
    assert isinstance(CalibrationStore().calibration("7i"), NoReading)

    store = _store_with(STEADY)
    cal = store.calibration("7i")
    assert isinstance(cal, RadiusCalibration)
    assert cal.club == "7i" and cal.n_samples == 5
    assert cal.radius_m == pytest.approx(1.300)
    assert cal.spread_m == pytest.approx(1.4826 * 0.005)


def test_the_minimum_is_a_parameter() -> None:
    store = _store_with(STEADY[:3])
    assert isinstance(store.calibration("7i"), NoReading)
    assert isinstance(
        store.calibration("7i", RadiusCalibrationConfig(min_samples=3)), RadiusCalibration
    )


def test_the_median_resists_a_sample_that_got_in_before_the_outlier_test() -> None:
    store = _store_with([1.30, 1.75, 1.31, 1.29, 1.30])  # 1.75 arrived second
    cal = store.calibration("7i")
    assert isinstance(cal, RadiusCalibration)
    assert cal.radius_m == pytest.approx(1.30)
    assert cal.spread_m == pytest.approx(1.4826 * 0.01)


def test_history_is_capped_at_the_most_recent_samples() -> None:
    config = RadiusCalibrationConfig(max_history=5, outlier_min_samples=100)
    store = CalibrationStore()
    radii = [1.0 + 0.01 * i for i in range(8)]
    for i, r in enumerate(radii):
        store, _ = store.offer_radius("7i", r, recorded_at=_at(i), config=config)
    for i in range(7):
        store, _ = store.offer_radius("7i", 3.0 + i, recorded_at=_at(20 + i), config=config)
    history = store.history("7i")
    assert [s.radius_m for s in history.accepted] == radii[-5:]
    assert [s.radius_m for s in history.rejected] == [5.0, 6.0, 7.0, 8.0, 9.0]
    cal = store.calibration("7i", config)
    assert isinstance(cal, RadiusCalibration) and cal.radius_m == pytest.approx(1.05)
    assert CONFIG.max_history == 50


def test_the_prediction_spread_adds_the_medians_own_uncertainty() -> None:
    cal = RadiusCalibration(club="7i", radius_m=1.3, spread_m=0.02, n_samples=10)
    assert cal.prediction_spread_m() == pytest.approx(0.02 * math.sqrt(1 + math.pi / 20))


# --- Persistence ------------------------------------------------------------------


def test_the_store_survives_a_round_trip_through_its_file(tmp_path: Path) -> None:
    store = _store_with(STEADY)
    store, _ = store.offer_radius("7i", 2.5, recorded_at=_at(30), shot="x#1")
    store, _ = store.offer_radius("driver", 1.4, recorded_at=_at(31))
    assert set(store.clubs) == {"7i", "driver"}
    path = tmp_path / "nested" / "radius.json"
    save_calibration(store, path)
    loaded = load_calibration(path)
    assert loaded == store
    assert loaded.calibration("7i") == store.calibration("7i")
    data = json.loads(path.read_text())
    assert data["format"] == "launchmon.club-radius-calibration" and data["version"] == 1
    assert data["clubs"]["7i"]["accepted"][0]["recorded_at"] == "2026-04-01T09:00:00Z"
    assert os.listdir(path.parent) == ["radius.json"]  # no temporary file left behind
    # Saving again replaces the file rather than appending to it.
    save_calibration(CalibrationStore(), path)
    assert load_calibration(path) == CalibrationStore()


def test_a_missing_file_is_an_empty_store(tmp_path: Path) -> None:
    assert load_calibration(tmp_path / "never-written.json") == CalibrationStore()


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        "",
        '{"format": "something-else", "version": 1, "clubs": {}}',
        '{"format": "launchmon.club-radius-calibration", "version": 2, "clubs": {}}',
        '{"format": "launchmon.club-radius-calibration", "version": 1, '
        '"clubs": {"7i": {"accepted": [{"radius_m": "long"}]}}}',
        "[]",
    ],
)
def test_an_unreadable_file_is_an_error_and_is_left_alone(tmp_path: Path, content: str) -> None:
    path = tmp_path / "radius.json"
    path.write_text(content)
    with pytest.raises(CalibrationFileError, match="left untouched"):
        load_calibration(path)
    assert path.read_text() == content


def test_a_failed_save_leaves_the_previous_file_whole(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "radius.json"
    save_calibration(_store_with(STEADY), path)
    before = path.read_bytes()

    def fail(*_: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", fail)
    with pytest.raises(OSError, match="disk full"):
        save_calibration(CalibrationStore(), path)
    assert path.read_bytes() == before
    assert os.listdir(tmp_path) == ["radius.json"]


# --- Fusion -------------------------------------------------------------------------


@pytest.fixture(scope="module")
def radar_result() -> RadarResult:
    shot = generate_iq_shot(launch_speed_mps=62.58)
    return analyse_radar_capture(
        iq_to_receding_real(shot.i, shot.q, shot.fmt), ground_unit_radar_pipeline()
    )


CAL = RadiusCalibration(club="driver", radius_m=1.32, spread_m=0.02, n_samples=12)


def _fuse(radar: RadarResult | None, **kwargs: object) -> FusedShot:
    args: dict[str, object] = dict(
        club=CLUB,
        geometry=GEOMETRY,
        radar=radar,
        radar_capture_start_s=CAPTURE_START if radar is not None else None,
        imu_trace=_imu_trace()[0],
        camera=_camera(),
        camera_audio_impact_s=_audio_impact(),
        config=FusionConfig(camera_to_ball_m=CAMERA_DISTANCE_M),
    )
    args.update(kwargs)
    return fuse_shot(**args)  # type: ignore[arg-type]


def test_without_the_radar_a_calibration_gives_a_derived_imu_clubhead_speed() -> None:
    shot = _fuse(None, radius_calibration=CAL)
    speed = shot.clubhead_speed_from_imu
    assert isinstance(speed, Quantity)
    assert speed.provenance is Provenance.DERIVED  # not MODELLED
    assert speed.source == "imu+calibration"
    assert isinstance(shot.shaft_rate_at_impact, Quantity)
    omega = math.radians(shot.shaft_rate_at_impact.value)
    assert speed.value == pytest.approx(omega * 1.32)
    assert any("median of 12" in a and "'driver'" in a for a in speed.assumptions)
    used = shot.imu_speed_calibration
    assert used is not None and used.calibration == CAL
    assert used.speed_spread_mps == pytest.approx(omega * CAL.prediction_spread_m())
    # Still nothing to measure the radius against, and no radar speeds invented.
    assert isinstance(shot.effective_clubhead_radius, NoReading)
    assert isinstance(shot.clubhead_speed_radial, NoReading)
    assert "imu_speed_calibration" in shot.model_dump()


def test_a_radar_that_missed_only_the_club_also_falls_back(radar_result: RadarResult) -> None:
    missed = radar_result.model_copy(
        update={"clubhead_speed": NoReading(reason="club band not found", source="radar")}
    )
    shot = _fuse(missed, radius_calibration=CAL)
    assert isinstance(shot.clubhead_speed_from_imu, Quantity)
    assert shot.clubhead_speed_from_imu.source == "imu+calibration"
    assert shot.timeline_reference == "radar"


def test_without_a_calibration_the_radar_missing_path_is_modelled_as_before() -> None:
    shot = _fuse(None)
    assert isinstance(shot.clubhead_speed_from_imu, Quantity)
    assert shot.clubhead_speed_from_imu.provenance is Provenance.MODELLED
    assert shot.imu_speed_calibration is None
    assert "imu_speed_calibration" not in shot.model_dump()
    assert "imu_speed_calibration" not in shot.model_dump_json()


def test_with_the_radar_present_a_calibration_changes_nothing(radar_result: RadarResult) -> None:
    plain = _fuse(radar_result)
    calibrated = _fuse(radar_result, radius_calibration=CAL)
    assert calibrated == plain
    assert calibrated.model_dump_json() == plain.model_dump_json()
    assert isinstance(plain.clubhead_speed_radial, Quantity)
    assert plain.clubhead_speed_radial.provenance is Provenance.MEASURED
    assert isinstance(plain.clubhead_speed_from_imu, Quantity)
    assert plain.clubhead_speed_from_imu.provenance is Provenance.MODELLED
    assert set(plain.model_dump()) == set(FusedShot.model_fields) - {"imu_speed_calibration"}


def test_a_refused_imu_rate_is_not_rescued_by_a_calibration() -> None:
    shot = fuse_shot(club=CLUB, geometry=GEOMETRY, camera=_camera(), radius_calibration=CAL)
    assert isinstance(shot.clubhead_speed_from_imu, NoReading)
    assert shot.imu_speed_calibration is None


# --- From fused shots to the store ---------------------------------------------------


def test_a_shot_both_sensors_saw_offers_its_measured_radius(radar_result: RadarResult) -> None:
    shot = _fuse(radar_result)
    assert isinstance(shot.effective_clubhead_radius, Quantity)
    store, decision = CalibrationStore().offer_shot(
        "driver", shot, recorded_at=T0, label="synthetic#1"
    )
    assert decision.outcome is SampleOutcome.ACCEPTED
    assert decision.radius_m == shot.effective_clubhead_radius.value
    assert store.history("driver").accepted[0].shot == "synthetic#1"


def test_a_shot_without_the_radar_offers_nothing_and_says_why() -> None:
    store = CalibrationStore()
    after, decision = store.offer_shot("driver", _fuse(None), recorded_at=T0)
    assert decision.outcome is SampleOutcome.NO_SAMPLE
    assert decision.reason.startswith("no radar clubhead speed")
    assert after is store


def test_a_sample_from_inputs_that_were_not_measured_is_refused(radar_result: RadarResult) -> None:
    shot = _fuse(radar_result)
    assert isinstance(shot.clubhead_speed_radial, Quantity)
    preview = shot.model_copy(
        update={
            "clubhead_speed_radial": shot.clubhead_speed_radial.model_copy(
                update={"provenance": Provenance.LOW_CONFIDENCE}
            )
        }
    )
    store, decision = CalibrationStore().offer_shot("driver", preview, recorded_at=T0)
    assert decision.outcome is SampleOutcome.REJECTED
    assert "low_confidence" in decision.reason
    assert store.history("driver").accepted == ()
    assert len(store.history("driver").rejected) == 1


def test_calibrated_from_measured_shots_then_used_on_one_the_radar_missed(
    radar_result: RadarResult,
) -> None:
    store = CalibrationStore()
    measured = _fuse(radar_result)
    assert isinstance(measured.effective_clubhead_radius, Quantity)
    r = measured.effective_clubhead_radius.value
    for i in range(5):
        # The same synthetic shot five times, under five labels.
        store, decision = store.offer_shot(
            "driver", measured, recorded_at=_at(i), label=f"shot#{i}"
        )
        assert decision.outcome is SampleOutcome.ACCEPTED
    cal = store.calibration("driver")
    assert isinstance(cal, RadiusCalibration) and cal.radius_m == pytest.approx(r)
    missed = _fuse(None, radius_calibration=cal)
    assert isinstance(missed.clubhead_speed_from_imu, Quantity)
    assert isinstance(measured.clubhead_speed_radial, Quantity)
    # Same swing, so the calibrated IMU speed recovers the radar's clubhead speed.
    assert missed.clubhead_speed_from_imu.value == pytest.approx(
        measured.clubhead_speed_radial.value, rel=0.01
    )


# --- The command line ------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent.parent


def _write_session(path: Path) -> None:
    """One shot as the ground unit streams it: raw I/Q and the pod's samples."""
    from launchmon.ingest.ground_unit import IMU_RECORD

    iq = generate_iq_shot(launch_speed_mps=53.64)
    to_codes = lambda x: np.clip(np.round((x - x.mean()) * 300 + 2048), 0, 4095)  # noqa: E731
    pairs = np.stack([to_codes(iq.i), to_codes(iq.q)], axis=1).astype("<i2")
    fs = iq.fmt.sample_rate_hz
    end_us = int((CAPTURE_START + pairs.shape[0] / fs) * 1e6)
    raw = {
        "shot_seq": 7,
        "pairs": pairs.shape[0],
        "fs_hz": fs,
        "q_lag_samples": 0.5,
        "receding_sign": 1,
        "capture_end_us": end_us % 2**32,
        "bytes": pairs.nbytes,
    }
    swing = generate_imu_swing(
        takeaway_s=1.0,
        backswing_s=BACKSWING_S,
        downswing_s=DOWNSWING_S,
        clock_offset_s=CAPTURE_START + 0.25 - (1.0 + BACKSWING_S + DOWNSWING_S) + BLE_ERROR_S,
    )
    rec = np.zeros(swing.counts.shape[0], dtype=IMU_RECORD)
    rec["counts"] = swing.counts
    rec["t_ground_us"] = np.round(swing.t_us).astype(np.int64) % 2**32
    imu = {
        "shot_seq": 7,
        "n": rec.size,
        "bytes": rec.nbytes,
        "gyro_dps_per_lsb": 0.07,
        "accel_g_per_lsb": 0.000488,
        "clip_counts": 32700,
    }
    path.write_bytes(
        b'{"type":"shot","shot_seq":7}\nRAW_BEGIN '
        + json.dumps(raw).encode()
        + b"\n"
        + pairs.tobytes()
        + b"\nRAW_END\r\nIMU_BEGIN "
        + json.dumps(imu).encode()
        + b"\n"
        + rec.tobytes()
        + b"\nIMU_END\r\n"
    )


def _cli(*args: str | Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "fuse_shot.py"), *map(str, args)],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT)},
        check=False,
    )


def test_the_command_line_updates_the_calibration_only_when_asked(tmp_path: Path) -> None:
    session = tmp_path / "session.bin"
    _write_session(session)
    cal_path = tmp_path / "radius.json"

    plain = _cli(session, "--json", tmp_path / "plain.json")
    assert plain.returncode == 0, plain.stderr
    assert "radius calibration" not in plain.stdout
    (entry,) = json.loads((tmp_path / "plain.json").read_text())
    assert "radius_sample" not in entry and "imu_speed_calibration" not in entry
    assert not cal_path.exists()

    for _ in range(2):  # fusing the same session twice must not count it twice
        run = _cli(session, "--club", "driver", "--calibration", cal_path)
        assert run.returncode == 0, run.stderr
    assert "already recorded from session.bin#7" in run.stdout
    accepted = load_calibration(cal_path).history("driver").accepted
    assert len(accepted) == 1 and accepted[0].shot == "session.bin#7"

    no_club = _cli(session, "--calibration", cal_path)
    assert no_club.returncode == 2 and "--calibration needs --club" in no_club.stderr

    cal_path.write_text("{damaged")
    corrupt = _cli(session, "--club", "driver", "--calibration", cal_path)
    assert corrupt.returncode == 2 and "left untouched" in corrupt.stderr
    assert cal_path.read_text() == "{damaged"
