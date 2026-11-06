#!/usr/bin/env python3
"""Regenerate the Blender scenes for both units from the OpenSCAD scripts.

    python3 cad/blender/make_blends.py            # both units, with preview renders
    python3 cad/blender/make_blends.py --no-render
    OPENSCAD=/path/to/openscad BLENDER=/path/to/blender python3 cad/blender/make_blends.py

For each object below, OpenSCAD exports one STL in its assembled position
(part = "in_place:..." or "ghost:..."). Blender then imports them into a
scene with collections, materials, a camera and an exploded-view animation
(build_blend.py). Change the CAD, rerun this, and the .blend follows.

Writes:
    cad/blender/ground_radar_unit.blend
    cad/blender/shaft_pod.blend
    cad/blender/previews/*.png
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CAD = HERE.parent
OPENSCAD = os.environ.get("OPENSCAD", "openscad")
BLENDER = os.environ.get("BLENDER", "blender")

PRINTED = "Printed parts"
COMPONENTS = "Components (stand-ins)"
REFERENCE = "Reference"

# Materials: every printed part in solid matte black; boards and cells keep their colours.
PETG = dict(material="Matte black", color=[0.018, 0.018, 0.02, 1.0], roughness=0.8)
PETG_LID = PETG
PETG_TAB = PETG
PCB = lambda name, rgb: dict(material=name, color=[*rgb, 1.0], roughness=0.6)  # noqa: E731
# The radome is translucent smoke PETG with an ironed (smooth) outer face, the one
# glossy surface on the unit; the light pipe is natural PETG.
RADOME = dict(material="Smoked radome", color=[0.02, 0.022, 0.026, 0.8], roughness=0.12)
PIPE = dict(material="Natural PETG", color=[0.85, 0.86, 0.84, 0.85], roughness=0.35)
BRASS = dict(material="Brass", color=[0.60, 0.38, 0.10, 1.0], roughness=0.35, metallic=1.0)
GOLD_PINS = dict(material="Gold-plated pins", color=[0.76, 0.52, 0.12, 1.0], roughness=0.3, metallic=1.0)
NICKEL = dict(material="Nickel", color=[0.68, 0.68, 0.70, 1.0], roughness=0.25, metallic=1.0)

# The pod, parked on the ground unit, built from the pod's own parts. Its
# script maps pod (x, y, z) to unit (y, z, x) (script_ground_radar.scad,
# pod_park_place): this rotation. The offset is not written here: build()
# measures it from the ground script's "ghost:parked_pod", so the parked pod
# follows any change to pod_park_cx, pod_park_z0 or the pod's clamp.
PARKED_POD = "Parked pod"
PARKED = dict(scad="script_shaft_imu.scad", rotation=[0, -90, -90], align="ghost:parked_pod", collection=PARKED_POD)

GROUND = {
    "scad": "script_ground_radar.scad",
    "out": "ground_radar_unit.blend",
    "view": {"camera_dir": [0.6, 1.6, 1.0], "distance": 2.7},   # from behind: lid off shows the inside
    "objects": [
        dict(part="in_place:shell", name="Shell", collection=PRINTED, **PETG,
             props={"print_file": "ground_radar_shell.stl"}),
        dict(part="in_place:lid", name="Lid", collection=PRINTED, **PETG_LID, explode=[85, 55, 0],
             props={"print_file": "ground_radar_lid.stl"}),
        dict(part="in_place:radome", name="Radome", collection=PRINTED, **RADOME, explode=[0, -60, 10],
             props={"print_file": "ground_radar_radome.stl"}),
        dict(part="in_place:led_pipe", name="Light pipe", collection=PRINTED, **PIPE, explode=[0, 0, 22],
             props={"print_file": "ground_radar_led_pipe.stl"}),
        dict(part="in_place:tab0", name="ESP32 clamp tab 1", collection=PRINTED, **PETG_TAB, explode=[0, 28, 0],
             props={"print_file": "ground_radar_esp32_clamp_tab_x2.stl"}),
        dict(part="in_place:tab1", name="ESP32 clamp tab 2", collection=PRINTED, **PETG_TAB, explode=[0, 28, 0],
             props={"print_file": "ground_radar_esp32_clamp_tab_x2.stl"}),
        dict(part="in_place:dock_base", name="Dock base", collection=PRINTED, **PETG_TAB,
             explode=[0, 0, -25], props={"print_file": "ground_radar_dock_base.stl"}),
        dict(part="in_place:arm_slide", name="Phone arm slide", collection=PRINTED, **PETG_LID,
             explode=[0, 60, 30], props={"print_file": "ground_radar_arm_slide.stl"}),
        dict(part="in_place:arm_head", name="Phone arm MagSafe head", collection=PRINTED, **PETG_LID,
             explode=[0, 80, 50], props={"print_file": "ground_radar_arm_head_magsafe.stl"}),
        dict(part="ghost:battery", name="LiPo 1500 mAh", collection=COMPONENTS,
             **PCB("Cell", [0.15, 0.35, 0.65]), explode=[0, 32, 0]),
        dict(part="ghost:tp4056", name="TP4056 USB-C charger", collection=COMPONENTS,
             **PCB("PCB blue", [0.10, 0.20, 0.60]), explode=[0, 20, 0]),
        dict(part="ghost:mt3608", name="MT3608 boost (on lid)", collection=COMPONENTS,
             **PCB("PCB purple", [0.35, 0.20, 0.55]), explode=[85, 55, 0]),
        dict(part="ghost:esp32", name="ESP32-C3 SuperMini", collection=COMPONENTS,
             **PCB("PCB black", [0.03, 0.03, 0.03]), explode=[0, 22, 0]),
        dict(part="ghost:radar", name="BGT24LTR11 radar module", collection=COMPONENTS,
             **PCB("PCB gold", [0.80, 0.60, 0.15]), explode=[0, 26, 0]),
        dict(part="ghost:switch", name="Slide switch", collection=COMPONENTS,
             material="Metal", color=[0.75, 0.75, 0.78, 1.0], roughness=0.3, metallic=1.0, explode=[12, 0, 0]),
        dict(part="ghost:led", name="Status LED 5 mm", collection=COMPONENTS,
             material="LED red", color=[0.9, 0.05, 0.05, 1.0], roughness=0.2, explode=[0, 0, 14]),
        dict(part="ghost:boresight", name="Radar boresight (15 deg)", collection=REFERENCE,
             material="Boresight", color=[1.0, 0.45, 0.0, 0.25], roughness=0.5, hide_render=True),
    ],
    "readme": """Stem launch monitor - ground radar unit

Generated by launchmon-hw/cad/blender/make_blends.py from script_ground_radar.scad.
Edit the OpenSCAD, then regenerate; edits made here are not carried back.

Units: millimetres (1 Blender unit = 1 mm), same coordinates as the OpenSCAD:
  X 0-96 left to right seen from the target side, Z 0-64 ground up,
  Y 0-21 front face (radar window) to back (lid).
Timeline: frame 1 assembled, frame 60 exploded.
Collections: Printed parts (print from cad/stl/, see each object's print_file
property), Components (stand-in boxes at real size and position), Reference
(the radar's 15 degree boresight cone, hidden in renders).
The unit stands on the dock base's top face (Z = 0). Behind it, a slim spine
on the dock holds a slide that pulls up 46 mm; a round MagSafe head flips up on
the slide and tilts back. Shown folded: the slide is down in the spine and the head lies
flat behind it, plain face out (arm_open = true in the OpenSCAD shows it up). The
club pod stores in the pocket in the dock base behind the spine.
""",
}

POD = {
    "scad": "script_shaft_imu.scad",
    "out": "shaft_pod.blend",
    "view": {"camera_dir": [1.0, -1.4, 0.9], "distance": 2.6},
    "objects": [
        dict(part="in_place:base", name="Pod base with C-clamp", collection=PRINTED, **PETG,
             props={"print_file": "shaft_pod_base.stl"}),
        dict(part="in_place:lid", name="Pod lid", collection=PRINTED, **PETG_LID, explode=[0, 0, 34],
             props={"print_file": "shaft_pod_lid.stl"}),
        dict(part="ghost:imu", name="LSM6DS3TR-C IMU breakout", collection=COMPONENTS,
             **PCB("PCB purple", [0.30, 0.10, 0.45]), explode=[0, 0, 5]),
        dict(part="ghost:imu_axes", name="IMU axes (X red, Y green, Z blue)", collection=REFERENCE,
             material="Axes", color=[0.9, 0.2, 0.2, 1.0], roughness=0.5, explode=[0, 0, 5]),
        dict(part="ghost:battery", name="LiPo 100 mAh", collection=COMPONENTS,
             **PCB("Cell", [0.15, 0.35, 0.65]), explode=[0, 0, 12]),
        dict(part="ghost:charger", name="Micro charger", collection=COMPONENTS,
             **PCB("PCB teal", [0.05, 0.45, 0.45]), explode=[0, 0, 12]),
        dict(part="ghost:esp32", name="ESP32-C3 SuperMini", collection=COMPONENTS,
             **PCB("PCB black", [0.03, 0.03, 0.03]), explode=[0, 0, 22]),
        dict(part="ghost:strap", name="Reusable strap (TPU)", collection=COMPONENTS,
             material="TPU black", color=[0.03, 0.03, 0.03, 1.0], roughness=0.7, explode=[0, 0, -14]),
        dict(part="ghost:liner", name="Anti-slip liner strips", collection=COMPONENTS,
             material="Silicone", color=[0.12, 0.12, 0.12, 1.0], roughness=0.9),
        dict(part="ghost:shaft", name="Golf shaft 13 mm (reference)", collection=REFERENCE,
             material="Shaft steel", color=[0.7, 0.7, 0.72, 1.0], roughness=0.25, metallic=1.0),
    ],
    "readme": """Stem launch monitor - shaft motion pod

Generated by launchmon-hw/cad/blender/make_blends.py from script_shaft_imu.scad.
Edit the OpenSCAD, then regenerate; edits made here are not carried back.

Units: millimetres (1 Blender unit = 1 mm), same coordinates as the OpenSCAD.
These are the pod's reference axes: +X along the shaft toward the clubhead
(the USB port faces -X, toward the grip), +Y across the shaft, +Z out of the lid.
Timeline: frame 1 assembled, frame 60 exploded.
Collections: Printed parts (print from cad/stl/, see each object's print_file
property), Components (stand-ins at real size and position), Reference (shaft,
IMU axis markers). The reusable TPU strap closes the clamp on the shaft
(zip ties through the tunnels still work as a fallback). The pod charges on
its own USB-C.
""",
}


def stl_vertices(path: Path) -> list[tuple[float, float, float]]:
    """Vertices of an ASCII STL, as OpenSCAD writes them."""
    return [tuple(map(float, ln.split()[1:4])) for ln in path.read_text().splitlines()
            if ln.lstrip().startswith("vertex")]


def euler_xyz(deg: list[float]):
    """Rotation matrix of a Blender XYZ Euler rotation (Rz @ Ry @ Rx), in degrees."""
    cx, cy, cz = (math.cos(math.radians(a)) for a in deg)
    sx, sy, sz = (math.sin(math.radians(a)) for a in deg)
    return [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
            [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
            [-sy, cy * sx, cy * cx]]


def align_offset(scad: Path, obj: dict, tmp: Path) -> list[float]:
    """Offset that puts a part exported from another script, rotated by
    obj["rotation"], where obj["align"] (exported from this unit's script) is:
    the two bounding boxes' minimum corners meet. Used for the parked pod, whose
    base sets its bounding box on every axis."""
    ref, own = tmp / "align_ref.stl", tmp / "align_own.stl"
    subprocess.run([OPENSCAD, "-q", "-o", str(ref), "-D", f'part="{obj["align"]}"', str(scad)], check=True)
    subprocess.run([OPENSCAD, "-q", "-o", str(own), "-D", 'part="in_place:base"', str(CAD / obj["scad"])],
                   check=True)
    m = euler_xyz(obj["rotation"])
    rot = [[sum(m[r][c] * v[c] for c in range(3)) for r in range(3)] for v in stl_vertices(own)]
    ref_v = stl_vertices(ref)
    return [round(min(v[k] for v in ref_v) - min(v[k] for v in rot), 3) for k in range(3)]


def build(unit: dict, render: bool, tmp: Path) -> None:
    scad = CAD / unit["scad"]
    entries = []
    offsets: dict[str, list[float]] = {}
    for i, obj in enumerate(unit["objects"]):
        stl = tmp / f"{Path(unit['out']).stem}_{i:02d}.stl"
        src = CAD / obj["scad"] if "scad" in obj else scad
        subprocess.run([OPENSCAD, "-q", "-o", str(stl), "-D", f'part="{obj["part"]}"', str(src)], check=True)
        entry = {k: v for k, v in obj.items() if k not in ("part", "scad", "align")}
        entry["file"] = str(stl)
        entry["props"] = dict(obj.get("props", {}), openscad_part=obj["part"])
        if "scad" in obj:
            entry["props"]["openscad_script"] = obj["scad"]
        if "align" in obj:
            if obj["align"] not in offsets:
                offsets[obj["align"]] = align_offset(scad, obj, tmp)
                print(f"  {obj['align']}: offset {offsets[obj['align']]}")
            entry["offset"] = offsets[obj["align"]]
        entries.append(entry)
        print(f"  exported {obj['part']}")
    manifest = tmp / f"{Path(unit['out']).stem}.json"
    manifest.write_text(json.dumps({"objects": entries, "view": unit["view"], "readme": unit["readme"]}))
    cmd = [BLENDER, "-b", "--factory-startup", "-P", str(HERE / "build_blend.py"), "--",
           str(manifest), str(HERE / unit["out"])]
    if render:
        (HERE / "previews").mkdir(exist_ok=True)
        cmd.append(str(HERE / "previews" / f"{Path(unit['out']).stem}.png"))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not (HERE / unit["out"]).exists():
        sys.stderr.write(result.stdout[-3000:] + result.stderr[-3000:])
        raise SystemExit(f"blender failed for {unit['out']}")
    (HERE / (unit["out"] + "1")).unlink(missing_ok=True)   # Blender's backup of the previous save
    print(f"  wrote {unit['out']}")


def main() -> None:
    render = "--no-render" not in sys.argv
    with tempfile.TemporaryDirectory() as d:
        for unit in (GROUND, POD):
            print(unit["out"])
            build(unit, render, Path(d))


if __name__ == "__main__":
    main()
