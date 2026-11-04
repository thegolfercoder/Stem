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

## Regenerating the STLs

```bash
cd launchmon-hw/cad && ./export_stl.sh      # needs openscad on PATH
```
