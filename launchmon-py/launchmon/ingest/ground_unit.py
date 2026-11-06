"""The ground unit's USB stream: shot summaries, raw radar captures, raw IMU samples.

The ground unit (launchmon-hw/firmware/ground_unit) writes one stream over
USB serial. Saved to a file as it arrives, it is the session's raw record:

* JSON objects, one per line: boot, ready, events, and one `"type": "shot"`
  per shot with the unit's on-device readings;
* with raw streaming on, two framed binary blocks per shot, each opened by a
  header line that states its exact length:
    - `RAW_BEGIN {...}` then int16 I,Q pairs, then `RAW_END`;
    - `IMU_BEGIN {...}` then the pod's samples around the shot, then `IMU_END`.

Both blocks carry times on the ground unit's clock, so the radar capture and
the pod's samples arrive already on one clock, to within the Bluetooth
mapping's residual. Fusion removes that residual using the impact shock.

Anything that is not one of these - a partial line, a line from a monitor
program, a block cut short by an unplugged cable - is set aside, not guessed at.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from launchmon.imu.trace import ImuTrace, trace_from_counts
from launchmon.ingest.iq import IqCaptureFormat

IMU_RECORD = np.dtype([("counts", "<i2", (6,)), ("t_ground_us", "<u4"), ("t_pod_us", "<u4")])


@dataclass(frozen=True)
class RadarCapture:
    shot_seq: int
    fmt: IqCaptureFormat
    i: NDArray[np.float64]
    q: NDArray[np.float64]
    capture_end_s: float | None
    header: dict[str, Any]

    @property
    def capture_start_s(self) -> float | None:
        """First pair's time on the ground unit's clock."""
        if self.capture_end_s is None:
            return None
        return self.capture_end_s - self.i.size / self.fmt.sample_rate_hz


@dataclass(frozen=True)
class ImuBlock:
    shot_seq: int
    counts: NDArray[np.int64]
    t_ground_us: NDArray[np.int64]
    t_pod_us: NDArray[np.int64]
    header: dict[str, Any]

    def trace(self, near_s: float | None = None) -> ImuTrace:
        """The samples on the ground unit's clock, ready for fusion.

        The block's times are 32-bit microseconds, which wrap every 71.6 minutes.
        `near_s` - the radar capture's time - puts them in the same wrap as it.
        """
        t = self.t_ground_us.astype(np.float64)
        keep = np.concatenate(([True], (np.diff(t) > 0) | (np.diff(t) < -(2.0**31))))
        trace = trace_from_counts(
            t[keep],
            self.counts[keep],
            clock="ground",
            gyro_dps_per_lsb=float(self.header.get("gyro_dps_per_lsb", 0.070)),
            accel_g_per_lsb=float(self.header.get("accel_g_per_lsb", 0.000488)),
            clip_counts=int(self.header.get("clip_counts", 32_700)),
        )
        if near_s is not None and trace.n:
            wrap = 2.0**32 * 1e-6
            k = round((near_s - float(np.median(trace.t_s))) / wrap)
            trace = trace.shifted(k * wrap, "ground")
        return trace


@dataclass
class GroundUnitLog:
    messages: list[dict[str, Any]] = field(default_factory=list)
    captures: list[RadarCapture] = field(default_factory=list)
    imu_blocks: list[ImuBlock] = field(default_factory=list)
    unparsed_lines: int = 0
    truncated_blocks: int = 0

    def shots(self) -> list[dict[str, Any]]:
        return [m for m in self.messages if m.get("type") == "shot"]

    def capture(self, shot_seq: int) -> RadarCapture | None:
        return next((c for c in self.captures if c.shot_seq == shot_seq), None)

    def imu(self, shot_seq: int) -> ImuBlock | None:
        return next((b for b in self.imu_blocks if b.shot_seq == shot_seq), None)


def parse_ground_unit_stream(data: bytes) -> GroundUnitLog:
    log = GroundUnitLog()
    pos, n = 0, len(data)
    while pos < n:
        eol = data.find(b"\n", pos)
        if eol < 0:
            log.unparsed_lines += 1  # a partial last line
            break
        line = data[pos:eol].rstrip(b"\r")
        pos = eol + 1
        for tag in (b"RAW_BEGIN ", b"IMU_BEGIN "):
            if line.startswith(tag):
                try:
                    header = json.loads(line[len(tag) :])
                    size = int(header["bytes"])
                except (ValueError, KeyError):
                    log.unparsed_lines += 1
                    break
                if pos + size > n:
                    log.truncated_blocks += 1
                    pos = n
                    break
                payload = data[pos : pos + size]
                pos += size
                # Skip the newline and the END marker line.
                end_marker = b"RAW_END" if tag == b"RAW_BEGIN " else b"IMU_END"
                end = data.find(end_marker, pos, pos + 16)
                if end >= 0:
                    nl = data.find(b"\n", end)
                    pos = n if nl < 0 else nl + 1
                if tag == b"RAW_BEGIN ":
                    log.captures.append(_radar_capture(header, payload))
                else:
                    log.imu_blocks.append(_imu_block(header, payload))
                break
        else:
            if line.startswith(b"{"):
                try:
                    log.messages.append(json.loads(line))
                except ValueError:
                    log.unparsed_lines += 1
            elif line.strip():
                log.unparsed_lines += 1
    return log


def read_ground_unit_log(path: Path | str) -> GroundUnitLog:
    return parse_ground_unit_stream(Path(path).read_bytes())


def _radar_capture(header: dict[str, Any], payload: bytes) -> RadarCapture:
    pairs = np.frombuffer(payload, dtype="<i2").reshape(-1, 2).astype(np.float64)
    end_us = header.get("capture_end_us")
    return RadarCapture(
        shot_seq=int(header["shot_seq"]),
        fmt=IqCaptureFormat(
            sample_rate_hz=float(header["fs_hz"]),
            q_lag_samples=float(header.get("q_lag_samples", 0.5)),
            receding_sign=int(header.get("receding_sign", 1)),
        ),
        i=pairs[:, 0].copy(),
        q=pairs[:, 1].copy(),
        capture_end_s=None if end_us is None else float(end_us) * 1e-6,
        header=header,
    )


def _imu_block(header: dict[str, Any], payload: bytes) -> ImuBlock:
    records = np.frombuffer(payload, dtype=IMU_RECORD)
    return ImuBlock(
        shot_seq=int(header["shot_seq"]),
        counts=records["counts"].astype(np.int64),
        t_ground_us=records["t_ground_us"].astype(np.int64),
        t_pod_us=records["t_pod_us"].astype(np.int64),
        header=header,
    )
