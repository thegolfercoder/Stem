"""Fuse radar, club IMU and phone video for the shots in a recorded session.

    # 1. Record the ground unit's USB stream (raw streaming on: press BOOT or send 'r')
    python scripts/record_ground_unit.py /dev/ttyACM0 session.bin

    # 2. Analyse the phone clips with swingml
    swingml analyse swing1.mov swing2.mov --json camera.json

    # 3. Fuse
    PYTHONPATH=. python scripts/fuse_shot.py session.bin --camera camera.json \\
        --video swing1.mov swing2.mov --club driver --camera-distance 3.0 --json fused.json

Shots and clips are paired in order: the first shot with a raw capture goes
with the first clip. Any input can be left out, and fusion uses what is there.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from launchmon.config import load_clubs, load_hardware
from launchmon.dsp.pipeline import analyse_radar_capture
from launchmon.dsp.presets import ground_unit_radar_pipeline
from launchmon.fusion.audio import impact_transient_time, read_audio
from launchmon.fusion.camera import IMPACT, CameraSwing, load_swingml_json
from launchmon.fusion.shot import FusedShot, FusionConfig, fuse_shot
from launchmon.ingest.ground_unit import read_ground_unit_log
from launchmon.ingest.iq import iq_to_receding_real
from launchmon.quantity import NoReading, Reading


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
    for d in shot.disagreements:
        lines.append(
            f"  DISAGREE {d.event}: {d.sensors[1]} is {d.difference_ms:+.1f} ms from "
            f"{d.sensors[0]} (tolerance {d.tolerance_ms:.1f} ms)"
        )
    return "\n".join(lines)


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("log", type=Path, nargs="?", help="ground unit USB stream")
    p.add_argument("--camera", type=Path, help="swingml analyse --json output")
    p.add_argument("--video", type=Path, nargs="*", default=[], help="the clips, for their audio")
    p.add_argument("--club", default="driver")
    p.add_argument("--camera-distance", type=float, default=None, help="phone to ball, m")
    p.add_argument("--hardware", type=Path, default=None, help="hardware.yaml for this session")
    p.add_argument("--json", type=Path, default=None)
    args = p.parse_args()

    club = load_clubs().by_name(args.club)
    geometry = load_hardware(args.hardware).radar_geometry
    config = FusionConfig(camera_to_ball_m=args.camera_distance)
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
        fused = fuse_shot(
            club=club,
            geometry=geometry,
            config=config,
            radar=radar,
            radar_capture_start_s=radar_start,
            imu_trace=imu_trace,
            camera=camera,
            camera_audio_impact_s=audio_impact,
        )
        print(f"\n=== shot {k + 1}" + (f" (ground unit #{seqs[k]})" if k < len(seqs) else ""))
        print(describe(fused))
        results.append(fused.model_dump(mode="json"))
    if args.json:
        args.json.write_text(json.dumps(results, indent=2))
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()
