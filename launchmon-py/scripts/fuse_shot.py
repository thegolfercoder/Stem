"""Fuse radar, club IMU and phone video for the shots in a recorded session.

    # 1. Record the ground unit's USB stream (raw streaming on: press BOOT or send 'r')
    python scripts/record_ground_unit.py /dev/ttyACM0 session.bin

    # 2. Analyse the phone clips with swingml
    swingml analyse swing1.mov swing2.mov --json camera.json

    # 3. Fuse
    PYTHONPATH=. python scripts/fuse_shot.py session.bin --camera camera.json \\
        --video swing1.mov swing2.mov --club driver --json fused.json

Shots and clips are paired in order: the first shot with a raw capture goes
with the first clip. Any input can be left out, and fusion uses what is there.

The phone films from the ground unit's dock stem, so by default the camera is
taken to be the radar's distance from the ball, `radar_geometry.range_from_tee_m`
in the hardware config, and the strike's sound travel over it is removed from
the clip's audio. That is configured geometry, not a measurement of the phone's
distance, and the camera's alignment notes say so. A phone elsewhere (on a
tripod) takes its own distance, `--camera-distance 3.0`; `--camera-distance
none` says the distance is not known, and the travel is left in and said to be.

Per-club radius calibration (optional):

    PYTHONPATH=. python scripts/fuse_shot.py session.bin --club 7-iron \\
        --calibration ~/launchmon/radius.json

Each shot both the radar and the IMU saw offers its effective clubhead radius to
the club's history in that file, which is accepted or refused with the reason
printed. A shot whose clubhead speed the radar missed gets its IMU clubhead
speed from the calibrated radius once the club has enough accepted samples.
--calibration needs --club given explicitly, since it names whose history to
use. Without --calibration nothing is read or written and the output is as before.
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path

from launchmon.config import RadarGeometryConfig, load_clubs, load_hardware
from launchmon.dsp.pipeline import analyse_radar_capture
from launchmon.dsp.presets import ground_unit_radar_pipeline
from launchmon.fusion.audio import impact_transient_time, read_audio
from launchmon.fusion.calibration import (
    CalibrationFileError,
    CalibrationStore,
    RadiusCalibration,
    SampleDecision,
    SampleOutcome,
    load_calibration,
    save_calibration,
)
from launchmon.fusion.camera import IMPACT, CameraSwing, load_swingml_json
from launchmon.fusion.shot import FusedShot, FusionConfig, camera_on_the_unit, fuse_shot
from launchmon.ingest.ground_unit import read_ground_unit_log
from launchmon.ingest.iq import iq_to_receding_real
from launchmon.quantity import NoReading, Reading

UNKNOWN_DISTANCE = "none"


def camera_distance(text: str) -> float | str:
    """`--camera-distance`: metres from the phone to the ball, or "none" for not known."""
    if text.strip().lower() == UNKNOWN_DISTANCE:
        return UNKNOWN_DISTANCE
    try:
        metres = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"{text!r} is not a distance in metres, or 'none' for not known"
        ) from None
    if not math.isfinite(metres) or metres < 0:
        raise argparse.ArgumentTypeError(f"{text!r} is not a distance in metres")
    return metres


def fusion_config(distance: float | str | None, geometry: RadarGeometryConfig) -> FusionConfig:
    """The camera distance fusion uses: on the unit when not given, as given, or none."""
    if distance is None:
        metres, basis = camera_on_the_unit(geometry)
        return FusionConfig(camera_to_ball_m=metres, camera_to_ball_basis=basis)
    if distance == UNKNOWN_DISTANCE:
        return FusionConfig(camera_to_ball_m=None)
    assert isinstance(distance, float)
    return FusionConfig(camera_to_ball_m=distance)


def _fmt(r: Reading) -> str:
    return str(r)


def describe(shot: FusedShot) -> str:
    lines = [f"timeline: t = 0 at impact as seen by the {shot.timeline_reference}"]
    for a in shot.alignment:
        lines.append(f"  {a.sensor:7s} {a.method}")
        lines += [f"          {n}" for n in a.notes]
    lines.append("events (s from impact):")
    for e in shot.events:
        alt = ", ".join(f"{k} {1000 * v:+.1f} ms" for k, v in e.alternatives.items())
        value = f"{e.time_s.value:+.4f}" if not isinstance(e.time_s, NoReading) else str(e.time_s)
        lines.append(
            f"  {e.event:20s} {value:>10s}  [{e.source}]" + (f"  also {alt}" if alt else "")
        )
    for label, r in (
        ("ball speed (radial)", shot.ball_speed_radial),
        ("ball speed", shot.ball_speed),
        ("clubhead (radial)", shot.clubhead_speed_radial),
        ("clubhead from IMU", shot.clubhead_speed_from_imu),
        ("effective radius", shot.effective_clubhead_radius),
        ("smash factor", shot.smash_factor),
        ("peak shaft rate", shot.peak_shaft_rate),
        ("shaft rate @ impact", shot.shaft_rate_at_impact),
        ("backswing", shot.backswing_duration),
        ("downswing", shot.downswing_duration),
        ("tempo", shot.tempo_ratio),
    ):
        lines.append(f"  {label:20s} {_fmt(r)}")
    if shot.camera_tempo_ratio is not None:
        lines.append(f"  {'tempo, camera alone':20s} {shot.camera_tempo_ratio:.2f}")
    if shot.imu_speed_calibration is not None:
        cal = shot.imu_speed_calibration.calibration
        lines.append(
            f"  {'IMU speed spread':20s} +/- {shot.imu_speed_calibration.speed_spread_mps:.2f} m/s "
            f"(calibrated radius {cal.radius_m:.3f} m, spread {cal.spread_m:.3f} m, "
            f"{cal.n_samples} samples for {cal.club!r})"
        )
    for d in shot.disagreements:
        lines.append(
            f"  DISAGREE {d.event}: {d.sensors[1]} is {d.difference_ms:+.1f} ms from "
            f"{d.sensors[0]} (tolerance {d.tolerance_ms:.1f} ms)"
        )
    return "\n".join(lines)


def describe_calibration(
    before: RadiusCalibration | NoReading, decision: SampleDecision, path: Path
) -> str:
    if isinstance(before, NoReading):
        used = f"not used: {before.reason}"
    else:
        used = (
            f"{before.radius_m:.3f} m, spread {before.spread_m:.3f} m, {before.n_samples} samples"
        )
    sample = (
        f"{decision.radius_m:.3f} m {decision.outcome.value}"
        if decision.radius_m is not None
        else "none offered"
    )
    if decision.outcome is not SampleOutcome.ACCEPTED:
        sample += f": {decision.reason}"
    return (
        f"  {'radius calibration':20s} {decision.club!r} in {path}: {used}\n"
        f"  {'radius sample':20s} {sample} ({decision.n_accepted} accepted now)"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("log", type=Path, nargs="?", help="ground unit USB stream")
    p.add_argument("--camera", type=Path, help="swingml analyse --json output")
    p.add_argument("--video", type=Path, nargs="*", default=[], help="the clips, for their audio")
    p.add_argument(
        "--club",
        default=None,
        help="club name in config/clubs.yaml (default driver); also the calibration key",
    )
    p.add_argument(
        "--calibration",
        type=Path,
        default=None,
        metavar="PATH",
        help="per-club radius calibration file (JSON), read and updated; needs --club",
    )
    p.add_argument(
        "--camera-distance",
        type=camera_distance,
        default=None,
        metavar="METRES|none",
        help=(
            "phone to ball, m, for a phone not on the unit; 'none' if not known. "
            "Default: the phone is on the ground unit, at the radar's range_from_tee_m"
        ),
    )
    p.add_argument("--hardware", type=Path, default=None, help="hardware.yaml for this session")
    p.add_argument("--json", type=Path, default=None)
    args = p.parse_args()
    if args.calibration is not None and args.club is None:
        p.error("--calibration needs --club: it names the club whose radius is calibrated")

    club = load_clubs().by_name(args.club or "driver")
    store: CalibrationStore | None = None
    if args.calibration is not None:
        try:
            store = load_calibration(args.calibration)
        except CalibrationFileError as e:
            p.error(str(e))
    geometry = load_hardware(args.hardware).radar_geometry
    config = fusion_config(args.camera_distance, geometry)
    cameras: list[CameraSwing] = load_swingml_json(args.camera) if args.camera else []

    log = read_ground_unit_log(args.log) if args.log else None
    seqs = [c.shot_seq for c in log.captures] if log else []
    n_shots = max(len(seqs), len(cameras))
    results = []
    for k in range(n_shots):
        radar = radar_start = imu_trace = None
        if log and k < len(seqs):
            cap = log.capture(seqs[k])
            assert cap is not None
            radar = analyse_radar_capture(
                iq_to_receding_real(cap.i, cap.q, cap.fmt), ground_unit_radar_pipeline()
            )
            radar_start = cap.capture_start_s
            block = log.imu(seqs[k])
            if block is not None and block.counts.size:
                imu_trace = block.trace(near_s=cap.capture_end_s)
        camera = cameras[k] if k < len(cameras) else None
        audio_impact = None
        if k < len(args.video):
            expected = camera.event_times_s[IMPACT] if camera and camera.event_times_s else None
            audio_impact = impact_transient_time(
                read_audio(args.video[k]), 48_000, expected_s=expected
            )
        calibration = store.calibration(args.club) if store is not None else None
        fused = fuse_shot(
            club=club,
            geometry=geometry,
            config=config,
            radar=radar,
            radar_capture_start_s=radar_start,
            imu_trace=imu_trace,
            camera=camera,
            camera_audio_impact_s=audio_impact,
            radius_calibration=calibration if isinstance(calibration, RadiusCalibration) else None,
        )
        print(f"\n=== shot {k + 1}" + (f" (ground unit #{seqs[k]})" if k < len(seqs) else ""))
        print(describe(fused))
        result = fused.model_dump(mode="json")
        if store is not None and calibration is not None:
            label = f"{args.log.name}#{seqs[k]}" if args.log and k < len(seqs) else f"shot {k + 1}"
            updated, decision = store.offer_shot(
                args.club, fused, recorded_at=datetime.now(UTC), label=label
            )
            if updated is not store:
                save_calibration(updated, args.calibration)
                store = updated
            print(describe_calibration(calibration, decision, args.calibration))
            result["radius_sample"] = decision.model_dump(mode="json")
        results.append(result)
    if args.json:
        args.json.write_text(json.dumps(results, indent=2))
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
