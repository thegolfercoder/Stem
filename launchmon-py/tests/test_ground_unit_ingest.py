"""Reading the ground unit's USB stream, as launchmon-hw/firmware/ground_unit writes it."""

from __future__ import annotations

import json

import numpy as np

from launchmon.ingest.ground_unit import IMU_RECORD, parse_ground_unit_stream


def _raw_block(seq: int, i: np.ndarray, q: np.ndarray, end_us: int) -> bytes:
    payload = np.stack([i, q], axis=1).astype("<i2").tobytes()
    header = {
        "shot_seq": seq,
        "pairs": i.size,
        "fs_hz": 40000,
        "q_lag_samples": 0.5,
        "receding_sign": -1,
        "capture_end_us": end_us,
        "bytes": len(payload),
    }
    # As the firmware writes it: println after the payload adds "\nRAW_END\r\n".
    return b"RAW_BEGIN " + json.dumps(header).encode() + b"\n" + payload + b"\nRAW_END\r\n"


def _imu_block(seq: int, counts: np.ndarray, t_ground: np.ndarray) -> bytes:
    rec = np.zeros(counts.shape[0], dtype=IMU_RECORD)
    rec["counts"], rec["t_ground_us"], rec["t_pod_us"] = counts, t_ground, t_ground + 12345
    payload = rec.tobytes()
    header = {
        "shot_seq": seq,
        "n": int(counts.shape[0]),
        "bytes": len(payload),
        "gyro_dps_per_lsb": 0.07,
        "accel_g_per_lsb": 0.000488,
        "clip_counts": 32700,
    }
    return b"IMU_BEGIN " + json.dumps(header).encode() + b"\n" + payload + b"\nIMU_END\r\n"


def test_a_session_stream_parses_into_shots_captures_and_imu_blocks() -> None:
    rng = np.random.default_rng(0)
    i = rng.integers(0, 4095, 2000)
    q = rng.integers(0, 4095, 2000)
    counts = rng.integers(-32768, 32767, (500, 6))
    t_ground = (np.arange(500) * 600 + 1_000_000).astype(np.uint32)
    # Binary payloads that happen to contain newlines and braces must not confuse it.
    stream = b"".join(
        [
            b'{"type":"boot","fw":"0.1"}\r\n',
            b"noise from a terminal\r\n",
            b'{"type":"shot","shot_seq":1,"impact_ms":1234}\n',
            _raw_block(1, i, q, end_us=1_300_000),
            _imu_block(1, counts, t_ground),
            b'{"type":"event","msg":"raw streaming on"}\n',
        ]
    )
    log = parse_ground_unit_stream(stream)
    assert [m["type"] for m in log.messages] == ["boot", "shot", "event"]
    assert log.unparsed_lines == 1
    cap = log.capture(1)
    assert cap is not None
    assert np.array_equal(cap.i, i) and np.array_equal(cap.q, q)
    assert cap.fmt.receding_sign == -1 and cap.fmt.q_lag_samples == 0.5
    assert cap.capture_start_s == 1.3 - 2000 / 40000
    imu = log.imu(1)
    assert imu is not None
    assert np.array_equal(imu.counts, counts)
    trace = imu.trace(near_s=1.3)
    assert trace.n == 500 and trace.clock == "ground"
    assert abs(trace.t_s[0] - 1.0) < 1e-9


def test_a_block_cut_short_is_counted_not_misread() -> None:
    i = np.arange(1000)
    block = _raw_block(2, i, i, end_us=5)
    log = parse_ground_unit_stream(b'{"type":"shot","shot_seq":2}\n' + block[: len(block) // 2])
    assert log.captures == []
    assert log.truncated_blocks == 1
    assert len(log.shots()) == 1


def test_imu_times_are_put_in_the_same_32_bit_wrap_as_the_radar() -> None:
    counts = np.zeros((10, 6), dtype=np.int64)
    t_ground = (np.arange(10) * 600 + 100).astype(np.uint32)  # just after a wrap
    log = parse_ground_unit_stream(_imu_block(3, counts, t_ground))
    radar_time = 2.0**32 * 1e-6 + 0.0005  # the radar saw the same instant
    trace = log.imu_blocks[0].trace(near_s=radar_time)
    assert abs(trace.t_s[0] - (2.0**32 + 100) * 1e-6) < 1e-6
