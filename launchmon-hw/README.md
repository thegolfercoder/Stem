# launchmon-hw: hardware for a two-part launch monitor

Enclosures, firmware and build documentation for a portable launch monitor
made of **two physically separate units** that talk only over Bluetooth LE:

| Unit | What it is | Measures |
|---|---|---|
| **Ground radar unit** | Infineon BGT24LTR11 24 GHz I/Q Doppler radar, LM358 pre-amp, ESP32-C3, 1500 mAh LiPo, in a 96 x 64 x 21 mm case shaped like a MagSafe battery pack. Stands behind the ball. | Radial ball and club speed (on-device preview), raw I/Q captures for launchmon-py |
| **Shaft motion pod** | Adafruit LSM6DS3TR-C / LSM6DSOX IMU, ESP32-C3, 100 mAh LiPo, in a 32 x 26 x 14 mm pod that clips onto a 13 mm shaft | Raw 6-axis motion at 1.66 kHz, streamed per swing |

State: **designed, rendered and syntax-checked; not built.** Nothing here has
been compiled for the target or run on hardware, and no number in this
directory comes from a measurement of a real shot. See "What has been checked".

## Layout

```
launchmon-hw/
  cad/
    script_ground_radar.scad   ground unit: shell, lid, ESP32 clamp tabs, optional stand
    script_shaft_imu.scad      pod: base with C-clamp, snap lid
    export_stl.sh              regenerates cad/stl/ and its fit report
    stl/                       print-ready STLs, already in print orientation
      fit_report.txt           every clearance the layouts depend on, for these STLs
    blender/
      ground_radar_unit.blend  ground unit assembled, with stand-in components and an exploded view
      shaft_pod.blend          pod on a 13 mm shaft, likewise
      make_blends.py           regenerates both .blend files from the OpenSCAD scripts
      build_blend.py           the Blender side of that (run by make_blends.py)
      previews/                renders of each, assembled and exploded
      make_showcase.py         renders the captioned showcase videos (six shots + reel)
      render_showcase.py       one shot: studio lighting, camera moves, assembly timing
  firmware/
    ground_unit/ground_unit.ino
    shaft_pod/shaft_pod.ino
    README.md                  toolchain, board settings, output format, verification status
  docs/
    bill_of_materials.md
    wiring_schematic.md        pinouts, power paths, pre-amp, BLE packet format
    build_instructions.md      printing, assembly, weatherproofing, axis rules
```

## Where it departs from the brief, and why

- **The ground unit stands on its long edge.** A 25.4 mm radar window cannot fit
  in a 21 mm face, so the window is in the 96 x 64 face and the unit stands
  upright behind the ball. Standing on a 21 mm edge it tips over easily, so an
  optional stand is included.
- **The MT3608 sits on the lid, behind the cell.** The cell, the TP4056 and the
  MT3608 do not fit side by side in a 91 mm interior with R9.6 corners while
  leaving room for the radar. All three are still in the lower cavity; the
  MT3608 is in the layer behind the cell.
- **The ESP32-C3 SuperMini has no mounting holes.** Its "M2 standoffs" take two
  printed clamp tabs, and the USB end hooks under two fixed lips.
- **The IMU pocket is 25.4 x 17.8 mm, not 18 x 18.** That is the size of the
  Adafruit boards named in the brief. An 18 x 18 pocket would not take them.
- **The pod needs the IMU's STEMMA QT sockets removed** to keep the 14 mm
  height with a 100 mAh cell. The fit report gives the height needed to keep
  them (about 15 mm), and one parameter switches to that.
- **Zip-tie retention on the pod clamp.** Not asked for, but a snap clamp alone
  is not something to trust at clubhead speed.

Each of these is also explained where it happens, in the CAD and the docs.

## What has been checked

| Check | Result |
|---|---|
| Both OpenSCAD scripts render in OpenSCAD 2021.01, every part | Yes; STLs in `cad/stl/` |
| Clearances in the fit report | All `ok`. Tightest: 0.3 mm (pod cell + charger) and 0.4 mm (ground boards) |
| Radar window: 1.1 mm skin, 15° tilt, module parallel behind it | Confirmed on a rendered cross-section (`part = "section"`) |
| Firmware: C++ syntax, `-Wall -Wextra` | Clean, against stub headers (see `firmware/README.md` for what that does not prove) |
| I/Q skew-correction arithmetic | Checked on synthetic tones: about 62 dB image rejection |
| Compiled for the ESP32-C3 | **No** |
| Printed, assembled, run | **No** |
| Any speed, rate or tempo measured | **No** |

## How it relates to the rest of the repository

`launchmon-py` was written for a different front end: a single-channel 24 GHz
module read by the phone as 48 kHz USB audio. This hardware digitises an I/Q
radar on an ESP32-C3 at 40 kHz per channel instead. I/Q separates targets
moving away from the radar from targets moving toward it, which a single
channel cannot do. The on-device analysis reuses launchmon-py's calibration
values (`min_snr_db`, `edge_drop_db`, `n_frames_before_impact`, the smash
bounds) and its passband. The raw captures it streams are what the
reference pipeline should be run on, once that pipeline accepts a complex
40 kHz input; it does not yet.

The repository's principles apply here as they do there. Every reported value
carries its provenance. A value that cannot be measured is refused with a
reason. Raw data leaves the device unmodified. **Spin, face angle, club
path, attack angle and swing plane are not outputs.**

## Regenerating the STLs and Blender scenes

```bash
cd launchmon-hw/cad && ./export_stl.sh      # needs openscad on PATH
python3 launchmon-hw/cad/blender/make_blends.py   # needs openscad and blender (4.x) on PATH
```

The `.blend` files are generated from the OpenSCAD scripts, not modelled by
hand. Each object is exported by OpenSCAD in its assembled position
(`part = "in_place:..."` or `"ghost:..."`) and imported into a scene with
materials and collections:

- **Printed parts:** the printable pieces, each tagged with the STL it is
  printed from (`print_file` custom property).
- **Components (stand-ins):** boxes at the real size and position of every
  board, cell and switch. They are not detailed models.
- **Reference:** the radar's 15° boresight cone, the IMU axis markers and
  the shaft.

Units are millimetres, in the same coordinates as the OpenSCAD. Frame 1 is
assembled and frame 60 exploded, so scrubbing the timeline takes the unit
apart. Edit the OpenSCAD and regenerate: changes made in Blender are not
carried back to the CAD or the STLs.

## Showcase videos

```bash
xvfb-run -a python3 launchmon-hw/cad/blender/make_showcase.py OUT_DIR   # blender, ffmpeg, Pillow
```

This renders six captioned 1080p shots in EEVEE from the generated `.blend`
files, and joins them, with title and end cards, into
`stem_launch_monitor_showcase.mp4`:

- the ground unit turning in its stand
- the ground unit assembling
- its placement behind a ball, with the 15° boresight
- the pod turning on a shaft
- the pod assembling
- the pod snapping onto the shaft

It takes about 80–90 minutes on a 4-core machine without a GPU. Every frame
is the CAD geometry, and the cards say so: "prototype design, CAD renders,
not product footage". Nothing in them shows or implies a speed, an accuracy
or any other result the prototype has not produced. The videos are build
products and are not checked in.
