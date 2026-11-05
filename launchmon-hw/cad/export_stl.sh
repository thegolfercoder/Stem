#!/usr/bin/env bash
# Regenerate every printable STL in cad/stl/ from the two OpenSCAD scripts.
#
#   ./export_stl.sh              # all parts
#   OPENSCAD=/path/to/openscad ./export_stl.sh
#
# Each part is exported in the orientation it should be printed in. The fit
# report each script prints is saved next to the STLs, so the clearances that
# went into a given export are on record with it.
#
# OpenSCAD 2021.01 only writes ASCII STL. If python3 is present the files are
# converted to binary STL, about a fifth of the size and read by every slicer.
set -euo pipefail
cd "$(dirname "$0")"
OPENSCAD="${OPENSCAD:-openscad}"
mkdir -p stl

export_part() {  # script part outfile [extra -D assignment]
  echo "  $3"
  "$OPENSCAD" -o "stl/$3" -D "part=\"$2\"" ${4:+-D "$4"} "$1" 2>>"stl/fit_report.txt"
}

: > stl/fit_report.txt
echo "ground radar unit"
export_part script_ground_radar.scad shell           ground_radar_shell.stl
export_part script_ground_radar.scad lid             ground_radar_lid.stl
export_part script_ground_radar.scad radome          ground_radar_radome.stl
export_part script_ground_radar.scad led_pipe        ground_radar_led_pipe.stl
export_part script_ground_radar.scad esp32_clamp_tab ground_radar_esp32_clamp_tab_x2.stl
export_part script_ground_radar.scad dock_base       ground_radar_dock_base.stl
export_part script_ground_radar.scad dock_stem       ground_radar_dock_stem.stl
export_part script_ground_radar.scad dock_stem       ground_radar_dock_stem_magsafe.stl 'holder="magsafe"'
export_part script_ground_radar.scad pod_park_hood   ground_radar_pod_park_hood.stl
echo "shaft motion pod"
export_part script_shaft_imu.scad    base            shaft_pod_base.stl
export_part script_shaft_imu.scad    lid             shaft_pod_lid.stl

# Keep one copy of each script's fit report rather than one per part.
awk '!seen[$0]++' stl/fit_report.txt | sed -n 's/^ECHO: "\(.*\)"$/\1/p' > stl/fit_report.tmp
mv stl/fit_report.tmp stl/fit_report.txt

if command -v python3 >/dev/null 2>&1; then
  python3 - stl/*.stl <<'PY'
import struct, sys
for path in sys.argv[1:]:
    with open(path, "rb") as f:
        head = f.read(5)
    if head != b"solid":
        continue  # already binary
    facets, normal, verts = [], None, []
    for line in open(path, encoding="ascii", errors="replace"):
        w = line.split()
        if not w:
            continue
        if w[0] == "facet":
            normal, verts = tuple(map(float, w[2:5])), []
        elif w[0] == "vertex":
            verts.append(tuple(map(float, w[1:4])))
        elif w[0] == "endfacet":
            facets.append((normal, verts))
    with open(path, "wb") as f:
        f.write(b"binary STL exported from OpenSCAD".ljust(80, b" "))
        f.write(struct.pack("<I", len(facets)))
        for n, v in facets:
            f.write(struct.pack("<12fH", *n, *v[0], *v[1], *v[2], 0))
PY
fi
ls -l stl
if command -v python3 >/dev/null 2>&1; then python3 cost_report.py; fi
