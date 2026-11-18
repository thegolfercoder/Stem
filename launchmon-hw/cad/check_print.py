#!/usr/bin/env python3
"""Print audit of every STL in cad/stl/: does each part print as exported, with no supports?

    python3 cad/check_print.py                # reads cad/stl/, writes cad/stl/print_report.txt
    python3 cad/check_print.py some/dir       # audit another directory of STLs (nothing written)

Each STL is read in the orientation it is exported in, which is the orientation
it is printed in. A part passes when:

  solid     it is one closed solid (every edge shared by exactly two facets);
  bed       its lowest point is at Z = 0 and it stands on a flat face, not on an
            edge or a point (at least MIN_BED_MM2 of bed contact);
  overhang  every downward face flatter than MAX_SLOPE_DEG from the bed (45 degrees
            is the rule; chamfers and teardrops at exactly 45 pass), flat or
            sloping, is either carried all round and bridges no more than
            MAX_BRIDGE_MM, or reaches no more than MAX_REACH_MM out past the
            wall that carries it (two perimeters print in the air; more droops).
            A round edge on the bed and the underside of a small pin pass this
            way; a ledge, a hook or a floating face do not.

This is geometry, not a slice: a pass says the part has no face that needs a
support, not that it has been printed. Anything it lets through is listed under
KNOWN below with its reason, as the fit report does for gaps under 0.3 mm.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
STL_DIR = HERE / "stl"

MIN_BED_MM2 = 4.0
MAX_BRIDGE_MM = 10.5  # "bridges about 10 mm or less"
MAX_REACH_MM = 1.0  # two perimeters print in the air; more droops
MAX_SLOPE_DEG = 44.0  # a downward face flatter than this (from the bed) is an overhang; 45 passes
MAX_LINES = 6  # failures listed per part; the rest are counted
FLAT_NZ = -0.996  # within 5 degrees of flat
WELD_MM = 1e-3

# Faces the audit would fail that are accepted, each with its reason.
# (file, check) -> reason. Keep this short; an entry is a claim someone has to stand behind.
KNOWN: dict[tuple[str, str], str] = {}


def read_stl(path: Path) -> np.ndarray:
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


def weld(tri: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    v, idx = np.unique(np.round(tri.reshape(-1, 3) / WELD_MM).astype(np.int64), axis=0, return_inverse=True)
    f = idx.reshape(-1, 3)
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    return v * WELD_MM, f


def groups(n: int, pairs: np.ndarray) -> np.ndarray:
    """Connected-component label for each of n items joined by the given index pairs."""
    parent = np.arange(n)

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in pairs:
        ra, rb = find(int(a)), find(int(b))
        if ra != rb:
            parent[rb] = ra
    return np.array([find(i) for i in range(n)])


def seg_dist(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Distance from each point p[i] (2D) to the nearest of the segments a[j]-b[j]."""
    ab = b - a
    t = np.einsum("ijk,jk->ij", p[:, None, :] - a[None], ab) / np.maximum(np.einsum("jk,jk->j", ab, ab), 1e-12)
    c = a[None] + np.clip(t, 0, 1)[..., None] * ab[None]
    return np.linalg.norm(p[:, None, :] - c, axis=2).min(axis=1)


def along(segs: list, step: float = 0.25) -> np.ndarray:
    """Points every `step` along each 2D segment, ends included."""
    out = []
    for p0, p1 in segs:
        n = max(1, int(np.ceil(np.linalg.norm(p1 - p0) / step)))
        t = np.linspace(0, 1, n + 1)[:, None]
        out.append(p0[None] * (1 - t) + p1[None] * t)
    return np.concatenate(out)


def inside(a: np.ndarray, b: np.ndarray, c: np.ndarray, step: float = 0.5) -> np.ndarray:
    """Points spread over each triangle (2D), about `step` apart, corners and centre included."""
    out = []
    for p, q, r in zip(a, b, c):
        n = int(min(60, max(1, np.ceil(max(np.linalg.norm(q - p), np.linalg.norm(r - q), np.linalg.norm(p - r)) / step))))
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = i + j <= n
        u, w = i[keep] / n, j[keep] / n
        out.append(p[None] * (1 - u - w)[:, None] + q[None] * u[:, None] + r[None] * w[:, None])
        out.append(((p + q + r) / 3)[None])
    return np.concatenate(out)


def audit(path: Path) -> tuple[list[str], list[str]]:
    """(failures, notes) for one STL."""
    fails: list[str] = []
    notes: list[str] = []
    v, f = weld(read_stl(path))
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    nrm = np.cross(b - a, c - a)
    area = np.linalg.norm(nrm, axis=1) / 2
    nz = nrm[:, 2] / np.maximum(2 * area, 1e-12)
    size = v.max(0) - v.min(0)
    volume = abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)
    notes.append(f"{size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f} mm, {volume / 1000:.2f} cm3")

    # solid: closed, and one piece
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    eu, einv, ecnt = np.unique(np.sort(e, axis=1), axis=0, return_inverse=True, return_counts=True)
    odd = int((ecnt != 2).sum())
    if odd:
        fails.append(f"solid: {odd} edges are not shared by exactly two facets (not a closed solid)")
    n_solids = len(np.unique(groups(len(v), eu)[f[:, 0]]))
    if n_solids != 1:
        fails.append(f"solid: {n_solids} separate solids in one part")

    # bed
    zmin = v[:, 2].min()
    zc = np.maximum(np.maximum(a[:, 2], b[:, 2]), c[:, 2])
    on_bed = (zc < zmin + 0.02) & (nz < FLAT_NZ)
    bed = float(area[on_bed].sum())
    if abs(zmin) > 0.02:
        fails.append(f"bed: lowest point is at Z = {zmin:.2f}, not 0")
    if bed < MIN_BED_MM2:
        fails.append(f"bed: only {bed:.1f} mm2 of flat face on the bed")
    notes.append(f"bed contact {bed:.0f} mm2")

    # overhangs: every downward face flatter than the limit, flat or sloping, grouped
    # into connected regions. A region's rim is carried where the face across the
    # edge goes down from it (a wall under it) or lies on the bed, and free elsewhere.
    lim = -np.cos(np.radians(MAX_SLOPE_DEG))
    edge_of = einv.reshape(3, -1).T  # facet -> its three edge ids
    over = (nz < lim) & ~on_bed & (area > 1e-9)
    worst_bridge = worst_reach = 0.0
    if over.any():
        ef: dict[int, list[int]] = {}
        for i in range(len(f)):
            for ed in edge_of[i]:
                ef.setdefault(int(ed), []).append(i)
        oidx = np.flatnonzero(over)
        local = {int(i): k for k, i in enumerate(oidx)}
        pairs = [
            [local[i], local[j]]
            for i in oidx
            for ed in edge_of[i]
            for j in ef[int(ed)]
            if j > i and over[j]
        ]
        lab = groups(len(oidx), np.array(pairs or np.zeros((0, 2), int)))
        found = []
        for region in np.unique(lab):
            faces = oidx[lab == region]
            reg_area = float(area[faces].sum())
            if reg_area < 0.3:
                continue  # facet noise
            carried, free = [], []
            for i in faces:
                for ed in edge_of[i]:
                    for j in ef[int(ed)]:
                        if j == i or over[j]:
                            continue
                        p0, p1 = v[eu[ed][0]], v[eu[ed][1]]
                        down = on_bed[j] or v[f[j], 2].min() < min(p0[2], p1[2]) - 0.02
                        (carried if down else free).append((p0[:2], p1[:2]))
            tri_pts = np.concatenate([a[faces], b[faces], c[faces], (a[faces] + b[faces] + c[faces]) / 3])
            flat = bool((nz[faces] < FLAT_NZ).all())
            steep = float(np.degrees(np.arccos(np.clip(-nz[faces].min(), -1, 1))))
            kind = "flat" if flat else f"sloping (down to {steep:.0f} deg from the bed)"
            where = (
                f"{reg_area:.0f} mm2, {kind}, print Z {tri_pts[:, 2].min():.1f}"
                + (f"-{tri_pts[:, 2].max():.1f}" if not flat else "")
                + f", near X {tri_pts[:, 0].mean():.1f} Y {tri_pts[:, 1].mean():.1f}"
            )
            if not carried:
                found.append((reg_area, f"overhang: a face with nothing under it and no wall carrying it ({where})"))
                continue
            ca = np.array([s[0] for s in carried])
            cb = np.array([s[1] for s in carried])
            if free:
                reach = float(seg_dist(along(free), ca, cb).max())
                worst_reach = max(worst_reach, reach)
                if reach > MAX_REACH_MM:
                    found.append((reg_area, f"overhang: reaches {reach:.1f} mm out past the wall that carries it ({where})"))
            else:
                span = 2 * float(seg_dist(inside(a[faces, :2], b[faces, :2], c[faces, :2]), ca, cb).max())
                worst_bridge = max(worst_bridge, span)
                if span > MAX_BRIDGE_MM:
                    found.append((reg_area, f"overhang: a {span:.1f} mm bridge ({where})"))
        found.sort(key=lambda t: -t[0])
        fails += [msg for _, msg in found[:MAX_LINES]]
        if len(found) > MAX_LINES:
            rest = found[MAX_LINES:]
            fails.append(f"overhang: and {len(rest)} smaller ones, {sum(r[0] for r in rest):.0f} mm2 together")
    notes.append(f"widest bridge {worst_bridge:.1f} mm, longest unsupported reach {worst_reach:.1f} mm")
    return fails, notes


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    stl_dir = Path(args[0]) if args else STL_DIR
    write = not args and "--no-write" not in sys.argv
    lines = [
        "Print audit: each STL as exported (its print orientation), no supports",
        f"limits: overhang {MAX_SLOPE_DEG:.0f} deg from the bed, bridge {MAX_BRIDGE_MM} mm, unsupported reach {MAX_REACH_MM} mm, "
        f"bed contact {MIN_BED_MM2} mm2. Geometry only: not a slice, not a print.",
        "",
    ]
    bad = 0
    for path in sorted(stl_dir.glob("*.stl")):
        fails, notes = audit(path)
        real = []
        for msg in fails:
            check = msg.split(":", 1)[0]
            reason = KNOWN.get((path.name, check))
            if reason:
                notes.append(f"accepted ({check}): {reason}. Was: {msg}")
            else:
                real.append(msg)
        bad += bool(real)
        lines.append(f"  {'FAIL' if real else 'ok  '} {path.name}: " + "; ".join(notes))
        lines += [f"         {msg}" for msg in real]
    lines += ["", f"{bad} part(s) FAIL" if bad else "every part passes"]
    text = "\n".join(lines) + "\n"
    print(text, end="")
    if write:
        (STL_DIR / "print_report.txt").write_text(text)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
