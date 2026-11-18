#!/usr/bin/env python3
"""Interference check of the ground unit's folding arm: does any part cut into another, in any pose?

    python3 cad/check_clash.py             # every pose; writes cad/stl/clash_report.txt
    python3 cad/check_clash.py --quick     # stored, open at the defaults, and half-way through folding
    python3 cad/check_clash.py head        # only the checks whose part under test is the head
    OPENSCAD=/path/to/openscad python3 cad/check_clash.py

The fit report's chk() lines test the clearances someone thought to write down.
This tests the solids: each moving part is intersected with everything it must
not touch (check_clash.scad, CGAL), in each pose the arm is used or passes
through:

  stored    slide down, head hanging behind the spine, swivel at 0
  travel    the slide part-way up, head still hanging
  folding   slide up, the head swung through 180, 150, 120, 90 and 60 degrees
  open      slide up, head at each tilt in TILTS and each swivel angle in YAWS,
            with the stand-in phone on it
  clamp     the same stored, folding and open poses with the clamp head and its jaw

A pass is an empty intersection. Any overlap over VOL_EPS is a FAIL, reported
with its volume and where it is. Parts that touch on a face (zero volume) pass.
It does not measure clearance: a 0.01 mm gap passes. The fit report does that.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OPENSCAD = os.environ.get("OPENSCAD", "openscad")
VOL_EPS = 1e-3  # mm3

TILTS = [0, 10, 20, 25, 30, 35]  # the head's detents (tilt_steps)
YAWS = [-25, 0, 20, 25]  # the swivel's ends, straight, and its default
STATIC = ["base", "unit"]


def poses(quick: bool) -> list[dict]:
    """Each check: the part under test, what it must clear, and the pose."""
    out: list[dict] = []

    def add(label: str, a: str, b: list[str], **pose) -> None:
        out.append(dict(label=label, a=a, b=[x for x in b if x != a], **pose))

    for kind in ("magsafe", "clamp"):
        movers = ["slide", "swivel", "head"] + (["jaw"] if kind == "clamp" else [])
        tag = "" if kind == "magsafe" else "clamp head, "
        # Stored.
        for m in movers:
            add(f"{tag}stored", m, STATIC + movers, open=False, tilt=0, yaw=0, head_kind=kind)
        # The slide's travel with the head hanging (lower = 1 is the stored height again).
        for lower in [0.5] if quick else [0.25, 0.5, 0.75]:
            for m in movers:
                add(f"{tag}slide {round((1 - lower) * 100)}% up, head hanging", m, STATIC, open=True, tilt=180, yaw=0,
                    lower=lower, head_kind=kind)
        # Folding: slide up, head swinging between hanging and open.
        for t in [90] if quick else [180, 150, 120, 90, 60]:
            for m in ["head"] + (["jaw"] if kind == "clamp" else []):
                add(f"{tag}folding, head at {t} deg", m, STATIC + movers, open=True, tilt=t, yaw=0, head_kind=kind)
        # Open.
        tilts = [25] if quick else (TILTS if kind == "magsafe" else [0, 25, 35])
        yaws = [20] if quick else (YAWS if kind == "magsafe" else [-25, 20])
        for y in yaws:
            for m in ["slide", "swivel"]:
                add(f"{tag}open, swivel {y} deg", m, STATIC + ["slide", "swivel"], open=True, tilt=25, yaw=y, head_kind=kind)
            for t in tilts:
                for m in ["head", "phone"] + (["jaw"] if kind == "clamp" else []):
                    add(f"{tag}open, tilt {t} deg, swivel {y} deg", m, STATIC + movers + ["phone"],
                        open=True, tilt=t, yaw=y, head_kind=kind)
    # With the clamp head the phone sits between the jaws, held by them: it is not tested against them.
    for c in out:
        if c["head_kind"] == "clamp":
            if c["a"] == "phone":
                c["b"] = [x for x in c["b"] if x not in ("head", "jaw")]
            if c["a"] in ("head", "jaw"):
                c["b"] = [x for x in c["b"] if x != "phone"]
    return out


def overlap(check: dict, b: list[str], tmp: Path) -> tuple[float, str]:
    """(volume mm3, where) of the part's intersection with the union of b in this pose."""
    out = tmp / f"{abs(hash((check['label'], check['a'], tuple(b))))}.stl"
    defs = {
        "a": f'"{check["a"]}"',
        "b": "[" + ",".join(f'"{x}"' for x in b) + "]",
        "open": "true" if check["open"] else "false",
        "tilt": check["tilt"],
        "yaw": check["yaw"],
        "lower": check.get("lower", 0),
        "head_kind": f'"{check["head_kind"]}"',
    }
    cmd = [OPENSCAD, "-o", str(out)]
    for k, val in defs.items():
        cmd += ["-D", f"{k}={val}"]
    run = subprocess.run(cmd + [str(HERE / "check_clash.scad")], capture_output=True, text=True)
    if "top level object is empty" in run.stderr:
        return 0.0, ""  # no overlap: OpenSCAD writes no file
    if run.returncode != 0 or not out.exists():
        raise RuntimeError(f"openscad failed on {check['label']} ({check['a']}): {run.stderr.strip()[-600:]}")
    verts = [list(map(float, ln.split()[1:4])) for ln in out.read_text().splitlines() if ln.strip().startswith("vertex")]
    out.unlink()
    if not verts:
        return 0.0, ""
    t = np.asarray(verts).reshape(-1, 3, 3)
    vol = abs(float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6))
    lo, hi = t.reshape(-1, 3).min(0), t.reshape(-1, 3).max(0)
    return vol, f"X {lo[0]:.1f}..{hi[0]:.1f} Y {lo[1]:.1f}..{hi[1]:.1f} Z {lo[2]:.1f}..{hi[2]:.1f}"


def run_check(check: dict, tmp: Path) -> list[str]:
    name = f"{check['a']:6s} {check['label']}"
    vol, _ = overlap(check, check["b"], tmp)
    if vol <= VOL_EPS:
        return [f"  ok   {name}: clear of {', '.join(check['b'])}"]
    lines = []
    for other in check["b"]:  # name the pairs
        v1, where = overlap(check, [other], tmp)
        if v1 > VOL_EPS:
            lines.append(f"  FAIL {name}: cuts {v1:.2f} mm3 into the {other}, {where}")
    return lines or [f"  FAIL {name}: cuts {vol:.2f} mm3 into {', '.join(check['b'])}"]


def main() -> int:
    quick = "--quick" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    checks = [c for c in poses(quick) if not only or c["a"] in only]
    with tempfile.TemporaryDirectory() as d, ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as pool:
        results = list(pool.map(lambda c: run_check(c, Path(d)), checks))
    lines = [ln for r in results for ln in r]
    bad = sum(ln.startswith("  FAIL") for ln in lines)
    head = [
        "Arm interference check: every moving part against everything it must not touch, in every pose",
        f"({len(checks)} checks{', quick set' if quick else ''}{', only ' + ' '.join(only) if only else ''}; "
        "a pass is an empty CGAL intersection; it does not measure clearance)",
        "",
    ]
    text = "\n".join(head + lines + ["", f"{bad} FAIL" if bad else "no part cuts into another"]) + "\n"
    print(text, end="")
    if not quick and not only and "--no-write" not in sys.argv:
        (HERE / "stl" / "clash_report.txt").write_text(text)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
