#!/usr/bin/env python3
"""Estimate the filament, print time and cost of every printed part.

    python3 cad/cost_report.py                 # reads cad/stl/, writes cad/stl/cost_report.txt
    python3 cad/cost_report.py --filament=25 --machine=0.4

Each STL is read in the orientation it is printed in. Material is estimated
from the part's surface area and volume, as a slicer lays it down: a solid
skin (perimeters plus top and bottom layers) over the whole surface and
sparse infill inside it. Time comes from that volume at a sustained flow rate,
with a floor per layer for small parts that the printer has to slow down for.

This is an estimate, not a slice. It lands within about 20% of a slicer for
thin-walled parts like these. Slice the STLs with your own printer profile
for a firm number before quoting a price.

The budget the design is held to: all printed parts for one ground unit and
one pod together cost no more than BUDGET_USD to make.
"""

from __future__ import annotations

import struct
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
STL_DIR = HERE / "stl"

BUDGET_USD = (5.0, 10.0)  # target range for all printed parts of both units

# Process assumptions (PETG, 0.4 mm nozzle, 0.20 mm layers, 4 perimeters, 20% gyroid).
DENSITY_G_CM3 = 1.27
SKIN_MM = 1.4  # average solid skin: 4 x 0.45 mm perimeters on walls, 5 x 0.2 mm on faces
INFILL = 0.20
LAYER_MM = 0.20
FLOW_MM3_S = 4.0  # sustained flow at quality settings on a mid-range printer, travel included
MIN_LAYER_S = 6.0  # minimum layer time; small layers are slowed down to cool
JOB_OVERHEAD_MIN = 4.0  # heat-up, probing, purge per plate (shared by the parts on it)
FAILURE_ALLOWANCE = 1.05  # 5% of prints scrapped


@dataclass(frozen=True)
class Part:
    file: str
    unit: str
    qty: int = 1
    support_fraction: float = 0.0  # extra material for supports, as a fraction of the part
    note: str = ""
    kit: bool = True  # False: printed once by the builder, not part of every kit's cost


PARTS = [
    Part("ground_radar_shell.stl", "ground"),
    Part("ground_radar_lid.stl", "ground"),
    Part("ground_radar_radome.stl", "ground", note="translucent smoke PETG"),
    Part("ground_radar_led_pipe.stl", "ground", note="natural PETG"),
    Part("ground_radar_esp32_clamp_tab_x2.stl", "ground", qty=2),
    Part("ground_radar_dock_base.stl", "ground"),
    Part("ground_radar_dock_stem.stl", "ground", note="1/4-20 stud head (the MagSafe head is an alternative)"),
    Part("ground_radar_pod_park_hood.stl", "ground", note="pod park: the pod hangs and charges here"),
    Part("shaft_pod_base.stl", "pod"),
    Part("shaft_pod_lid.stl", "pod"),
    Part("fit_test_coupon.stl", "test", kit=False, note="print first: every tight fit, once per printer"),
]


def read_stl(path: Path) -> np.ndarray:
    """Triangles as an (n, 3, 3) array, from binary or ASCII STL."""
    data = path.read_bytes()
    if data[:5] == b"solid" and b"facet" in data[:400]:
        verts = [
            list(map(float, line.split()[1:4]))
            for line in data.decode("ascii", "replace").splitlines()
            if line.strip().startswith("vertex")
        ]
        return np.asarray(verts, dtype=np.float64).reshape(-1, 3, 3)
    (n,) = struct.unpack_from("<I", data, 80)
    rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]), count=n, offset=84)
    return rec["v"].astype(np.float64)


def volume_area_height(tri: np.ndarray) -> tuple[float, float, float]:
    a, b, c = tri[:, 0], tri[:, 1], tri[:, 2]
    volume = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)
    area = float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum() / 2.0)
    height = float(tri[:, :, 2].max() - tri[:, :, 2].min())
    return abs(volume), area, height


@dataclass
class Estimate:
    part: Part
    grams: float
    minutes: float
    height_mm: float


def estimate(part: Part) -> Estimate:
    vol, area, height = volume_area_height(read_stl(STL_DIR / part.file))
    skin = min(vol, area * SKIN_MM / 2.0)  # half the area: the skin lies inside it, shared by both faces of thin walls
    extruded = (skin + INFILL * (vol - skin)) * (1.0 + part.support_fraction)  # mm^3
    layers = height / LAYER_MM
    seconds = max(extruded / FLOW_MM3_S, layers * MIN_LAYER_S)
    return Estimate(part, extruded * DENSITY_G_CM3 / 1000.0, seconds / 60.0, height)


def opt(name: str, default: float) -> float:
    for a in sys.argv[1:]:
        if a.startswith(f"--{name}="):
            return float(a.split("=", 1)[1])
    return default


def main() -> None:
    filament_usd_kg = opt("filament", 20.0)  # PETG, retail spool
    own_usd_h = opt("machine", 0.40)  # own printer: power + wear + depreciation
    farm_usd_h = opt("farm", 1.50)  # typical print-farm machine rate
    lines = [
        "Printed-part cost estimate (not a slice: within about 20% of one)",
        (
            f"PETG {filament_usd_kg:.0f} $/kg, {LAYER_MM} mm layers, {INFILL:.0%} infill, "
            f"{FLOW_MM3_S} mm3/s sustained, {FAILURE_ALLOWANCE - 1:.0%} scrap allowance"
        ),
        "",
        f"{'part':40s} {'qty':>3s} {'grams':>7s} {'minutes':>8s}",
    ]
    totals = {"ground": [0.0, 0.0], "pod": [0.0, 0.0]}
    missing = []
    extras = []
    for p in PARTS:
        if not (STL_DIR / p.file).exists():
            missing.append(p.file)
            continue
        e = estimate(p)
        if not p.kit:
            extras.append((p, e))
            continue
        g, m = e.grams * p.qty, e.minutes * p.qty
        totals[p.unit][0] += g
        totals[p.unit][1] += m
        lines.append(f"{p.file:40s} {p.qty:3d} {g:7.1f} {m:8.0f}  {p.note}")
    lines.append("")
    grand_g = grand_min = 0.0
    for unit, (g, m) in totals.items():
        m += JOB_OVERHEAD_MIN * 2  # two plates per unit at most
        grand_g += g
        grand_min += m
        lines.append(f"{unit:8s} {g:6.1f} g  {m / 60:5.2f} h")
    material = grand_g / 1000.0 * filament_usd_kg
    own = (material + grand_min / 60.0 * own_usd_h) * FAILURE_ALLOWANCE
    farm = (material + grand_min / 60.0 * farm_usd_h) * FAILURE_ALLOWANCE
    lines += [
        f"{'both':8s} {grand_g:6.1f} g  {grand_min / 60:5.2f} h",
        "",
        f"material                         ${material:5.2f}",
        f"own printer   (${own_usd_h:.2f}/h machine) ${own:5.2f}  per kit",
        f"print farm    (${farm_usd_h:.2f}/h machine) ${farm:5.2f}  per kit",
        f"budget                           ${BUDGET_USD[0]:.0f}-{BUDGET_USD[1]:.0f}: "
        + ("WITHIN" if farm <= BUDGET_USD[1] else "OVER")
        + " at the print-farm rate",
        "",
        "Labour (support removal, inserts, assembly) is not included.",
    ]
    if extras:
        lines += ["", "Not in the kit total (printed once, before the first kit):"]
        for p, e in extras:
            g, m = e.grams * p.qty, e.minutes * p.qty
            usd = (g / 1000.0 * filament_usd_kg + (m + JOB_OVERHEAD_MIN) / 60.0 * farm_usd_h) * FAILURE_ALLOWANCE
            lines.append(
                f"{p.file:40s} {p.qty:3d} {g:7.1f} {m:8.0f}  ${usd:4.2f} at the farm rate, own plate. {p.note}"
            )
    if missing:
        lines.append("Not exported yet: " + ", ".join(missing))
    text = "\n".join(lines) + "\n"
    print(text, end="")
    if "--no-write" not in sys.argv:
        (STL_DIR / "cost_report.txt").write_text(text)


if __name__ == "__main__":
    main()
