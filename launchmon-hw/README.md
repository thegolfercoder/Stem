# launchmon-hw: hardware for a two-part launch monitor

Enclosures, firmware and build documentation for a portable launch monitor
made of **two physically separate units** that talk only over Bluetooth LE:

| Unit | What it is | Measures |
|---|---|---|
| **Ground radar unit** | Infineon BGT24LTR11 24 GHz I/Q Doppler radar module with its own IF amplifiers, ESP32-C3, 1500 mAh LiPo, TP4056 charger, MT3608 boost at 5 V, slide switch, status LED, in a 96 x 64 x 21 mm case shaped like a MagSafe battery pack. Stands behind the ball. | Radial ball and club speed (on-device preview), raw I/Q captures for launchmon-py |
| **Shaft motion pod** | Adafruit LSM6DS3TR-C / LSM6DSOX IMU, ESP32-C3, 100-150 mAh LiPo, micro charger, in a 32 x 26 x 14 mm pod that clips onto a 13 mm shaft | Raw 6-axis motion at 1.66 kHz, streamed per swing |

State: **designed, rendered and syntax-checked; not built.** Nothing here has
been compiled for the target or run on hardware, and no number in this
directory comes from a measurement of a real shot. See "What has been checked".

## Layout

```
launchmon-hw/
  cad/
    script_ground_radar.scad   ground unit: shell, lid, radome, light pipe, ESP32 clamp tabs, dock, folding phone arm
    script_shaft_imu.scad      pod: base with C-clamp, snap lid, TPU strap
    export_stl.sh              regenerates cad/stl/, its fit report and its cost report
    cost_report.py             filament, print time and cost per kit, from the STLs
    stl/                       print-ready STLs, already in print orientation
      fit_report.txt           every clearance the layouts depend on, for these STLs
      cost_report.txt          estimated grams, hours and cost for these STLs
    blender/
      ground_radar_unit.blend  ground unit assembled, with stand-in components and an exploded view
      shaft_pod.blend          pod on a 13 mm shaft, likewise
      make_blends.py           regenerates both .blend files from the OpenSCAD scripts
      build_blend.py           the Blender side of that (run by make_blends.py)
      previews/                renders of each, assembled and exploded
      make_showcase.py         renders the captioned showcase videos (eight shots + reel)
      render_showcase.py       one shot: studio lighting, camera moves, assembly timing
  results/                     the phone results screen: a web page that connects to
                               the ground unit over Web Bluetooth (see its README)
  firmware/
    ground_unit/ground_unit.ino
    shaft_pod/shaft_pod.ino
    README.md                  toolchain, board settings, output format, verification status
  docs/
    bill_of_materials.md
    wiring_schematic.md        pinouts, power paths, radar module requirements, BLE packet format
    build_instructions.md      printing, assembly, weatherproofing, axis rules
    design_language.md         what the units look like and why; print-cost budget
```

## Design

Both units share one design language, set out in
[docs/design_language.md](docs/design_language.md): matte black, one focal
point, details that each do a job, and parts drawn for the printer. On the
ground unit the focal point is the radar window, a separate smoked radome in a
bevelled pocket. The back is one flat lid. The unit stands in a dock whose
slim spine, behind the lid's centre and just under the unit's top edge, holds a
folding phone arm: a slide pulls up 46 mm and a round MagSafe head flips up on
it and tilts back (25° by default), so the phone films the swing from the
unit, with no tripod. Folded, nothing stands above the unit. The club pod
stores in a pocket in the dock's base. The pod has an arrow pointing to the
clubhead, a saddle that makes its clamp one form, and a reusable TPU strap. No
part needs supports.

What sets it apart, for little or no added cost:

- **A gun sight** (front post, rear notch) over the radar's boresight, for
  lining the unit up quickly and the same way every session.
- **A results screen on the phone**: a web page (`results/`) that connects to
  the unit over Bluetooth and shows each shot's ball speed, club speed and smash
  in type readable from the address position, with a session list and CSV
  export. Chrome on Android and desktop; iPhone needs a Web Bluetooth browser
  such as Bluefy, since Safari has none.
- **Self-calibrating club speed from the pod.** Each shot the radar and pod both
  see measures the club's effective radius; once five agree, launchmon-py uses
  it for swings the radar misses (`fuse_shot.py --club 7-iron --calibration`).
- **The radome is the one colour choice:** smoke, ice or amber, on a matte black
  body.

All printed parts for both units come to about 84 g and 4.9 hours, an estimated
$3.84 a kit on your own printer or $9.53 at a print-farm rate, within the
$5-10 budget (`cad/stl/cost_report.txt`).

## Where it departs from the brief, and why

- **The ground unit stands on its long edge.** A 25.4 mm radar window cannot fit
  in a 21 mm face, so the window is in the 96 x 64 face and the unit stands
  upright behind the ball. Standing on a 21 mm edge it tips over easily, so it
  stands in a dock.
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
- **One part on the pod beyond the parts list: the Schottky diode P5.** It is
  required to wire the original charging path (LiPo → charger → ESP32) safely:
  the SuperMini's 5V pin is its USB-C VBUS with no diode, so without P5 every
  USB cable would put 5 V straight onto the cell, bypassing the charger. No
  listed part can do its job ([wiring doc 2.1](docs/wiring_schematic.md)).
- **No battery readings.** The parts list has no battery-sense parts, so
  neither unit reports its cell (0, "not read", in the shot summary). Charge
  both after each session.
- **The radar module must have its own IF amplifiers.** There is no pre-amp:
  the module's I and Q outputs go straight to the ESP32's ADC pins.
- **A retaining strap on the pod clamp.** Not asked for, but a snap clamp alone
  is not something to trust at clubhead speed. A printed TPU 95A strap hooks
  over a post on each side, under the shaft; it is reusable, and zip ties
  still fit as a fallback. Its hold has not been pull-tested.
- **The phone films from the unit, on a folding MagSafe arm** (owner's
  decision). At the default 25° the CAD puts the phone's lower edge 8.5 mm
  clear of the unit, the lens sightline over 100 mm clear of it, and the
  phone's centre over the base. The phone sits low, about 1.4 m behind the
  ball, and the head does not swivel toward the golfer yet, so use the
  phone's 0.5x ultra-wide lens: with the 1x lens the golfer may be at the edge
  of the frame. Untested on a print.
- **MagSafe only, for now.** The head holds a phone by an aftermarket
  MagSafe-compatible magnet ring. A clamp head for other phones is not built
  yet; today a phone without MagSafe needs a MagSafe-compatible case or a
  stick-on ring. The earlier 1/4"-20 tripod stud is gone, with its stem.
- **The radar window is a separate part.** Printed into the shell, the 1.0-1.2
  mm window needed supports, came out rough and varied in thickness, and tied
  the whole shell to an RF-safe filament colour. As a flat-printed radome it is
  exact and smooth, the shell prints with no supports, and the body can be
  matte black.

Each of these is also explained where it happens, in the CAD and the docs.

## What has been checked

| Check | Result |
|---|---|
| Both OpenSCAD scripts render in OpenSCAD 2021.01, every part | Yes; STLs in `cad/stl/` |
| Clearances in the fit report | All `ok`. Tightest: 0.07 mm (window bevel inside the R12 corner), 0.3 mm (radar posts on their pads, the folded phone head clear of the pod pocket's wall, the pod strap's latch) |
| Phone on the open arm, 25° | From the fit report, with a 147.6 mm stand-in phone: lower edge 8.5 mm over the unit, lens sightline over 100 mm clear, centre over the base. Not checked on a print |
| Radar window: 1.0 mm radome, 15° tilt, module parallel behind it | Confirmed on a rendered cutaway |
| Printed-part cost | Estimated from the STLs (`cost_report.py`): 84 g, 4.9 h, $3.84 a kit on your own printer, $9.53 at $1.50/h (within $10). Not yet sliced |
| Firmware: C++ syntax, `-Wall -Wextra` | Clean, against stub headers: ground 0.5, pod 0.3 (see `firmware/README.md` for what that does not prove) |
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
reference pipeline should be run on: `launchmon-py` reads them with
`launchmon.ingest.ground_unit` and fuses them with the pod and the phone
camera (see its README, "Fusion").

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

This renders eight captioned 1080p, 24 fps shots in EEVEE from the generated `.blend`
files, and joins them, with title and end cards, into
`stem_launch_monitor_showcase.mp4` (about 55 s). The shots were made for an
earlier design (a stud stem, a pod parked on the unit's back, a tripod camera)
and need re-rendering for the folding arm and the pod pocket:

- the ground unit turning in its dock, the pod parked on its back
- the ground unit assembling
- its placement behind a ball, with the 15° boresight and the tripod camera
- the pod turning on a shaft
- the pod assembling
- the pod snapping onto the shaft
- the pod parking on the back of the ground unit
- the radome in smoke, ice and amber

It takes a little over two hours on a 4-core machine without a GPU (EEVEE on software OpenGL, about 9 s a frame); a GPU is far faster. Every frame
is the CAD geometry, and the cards say so: "prototype design, CAD renders,
not product footage". Nothing in them shows or implies a speed, an accuracy
or any other result the prototype has not produced. The videos are build
products and are not checked in.
