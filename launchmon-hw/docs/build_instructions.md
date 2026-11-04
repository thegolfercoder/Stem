# Build instructions

Covers printing, assembly, weatherproofing and sensor orientation for both
units. Read [bill_of_materials.md](bill_of_materials.md) and
[wiring_schematic.md](wiring_schematic.md) first.

---

## 0. Before printing: measure, then set the parameters

Every part size in the CAD is a parameter at the top of its script, and every
clearance that depends on one is printed as a **fit report** when the script
renders (`cad/stl/fit_report.txt` holds the one for the shipped STLs). Measure
these with calipers, change the parameter, and re-export with
`cad/export_stl.sh`:

| Measure | Parameter | Script |
|---|---|---|
| Radar module PCB and its hole positions | `radar_pcb`, `radar_holes` | ground |
| LiPo cell (1500 mAh) | `batt` | ground |
| MT3608 tallest part above its PCB | `mt_parts_h` | ground |
| TP4056 module length and width | `tp_pcb` | ground |
| Shaft diameter where the pod will sit | `shaft_d` | pod |
| Micro LiPo | `batt` | pod |
| MagSafe magnet ring (OD, ID, thickness) | `ring_od`, `ring_id`, `ring_depth` | ground |

A line marked `FAIL` in the fit report is a collision: fix it before printing.

---

## 1. Material: PETG, ABS or ASA only

**Do not use PLA.** PLA softens at roughly 55-60 °C. A dark enclosure in
direct sun on a range mat, or left in a car, gets there, and the radar window
and the clamp jaws are the first things to deform. A warped window changes the
radar's beam; a warped clamp lets go of the shaft.

| Material | Use it for | Notes |
|---|---|---|
| **PETG** | Both units (recommended) | Tough, takes the clamp's flexing, easy to print. The default choice. |
| **ASA** | Ground unit outdoors | Best UV resistance. Print in an enclosure. |
| **ABS** | Either | Print in an enclosure; prone to warping on large flat parts like the ground shell. |

**Colour matters for the radome, and only for the radome.** The radar looks
out through one part, the radome, so that is the only part whose filament the
radar cares about. Print it in **translucent smoke (dye-tinted) or natural
PETG**. **Avoid carbon-fibre, metal-filled, glitter/sparkle and carbon-black
filaments for it**: conductive or lossy fillers absorb 24 GHz, and most opaque
black filaments are coloured with carbon black. The radar does not look through
the shell, lid or dock, so those can be any colour; the design's finish is
matte black (see [design_language.md](design_language.md)). If in doubt about
a radome filament, run the bench check in 4.5.

| Part | Filament | Finish |
|---|---|---|
| Shell, lid, dock base and stem, clamp tabs, pod base and lid | Matte black PETG | Textured PEI sheet under the shell, lid and stem |
| Radome | Translucent smoke (or natural) PETG, not carbon-black | Outer face up, ironing on |
| Light pipe | Natural (translucent) PETG | As printed |

## 2. Slicer settings (all parts)

| Setting | Value |
|---|---|
| Nozzle | 0.4 mm |
| Layer height | **0.20 mm** |
| Wall perimeters | **3-4** (1.2-1.6 mm of solid shell; the 2.4 mm walls are filled solid by the rest) |
| Top / bottom layers | 5 / 5 (1.0 mm) |
| Infill | **20 % gyroid** |
| Supports | **None.** No part needs them. If your slicer insists, tree supports touching the build plate only |
| Build sheet | **Textured PEI** for the shell, lid and dock stem: the face on the bed is the face people see, and the texture gives it an even matte grain with no layer lines |
| Brim | 5 mm on the pod base (it stands on a small footprint); none elsewhere |
| PETG temperatures | about 235-245 °C nozzle, 75-85 °C bed, cooling 30-50 % |

Each STL is already in its print orientation.

### Part-specific notes

**Ground shell (`ground_radar_shell.stl`).** Prints front face down on the
textured sheet, open back up, with **no supports**. The window is an open
pocket in the front face; the radome that closes it is a separate part. The
ledge the radome sits on is a 1.2 mm overhang, and the slicer bridges it.

**Radome (`ground_radar_radome.stl`).** Flat, **outer face up**, with
**ironing** on the top surface: the one smooth, slightly glossy face on a
matte unit. It is exactly 1.0 mm, five 0.20 mm layers, which is why the radar
window is no longer printed as part of the shell: there it sat on supports,
came out rough and varied in thickness. Check it is **1.0-1.2 mm** with
calipers, solid with no gaps (hold it to a light), and flat.

**Light pipe (`ground_radar_led_pipe.stl`).** Flange down, in natural PETG. It
is tiny: print it on the same plate as the radome.

**Ground lid.** Flat, outside face down on the textured sheet, no supports.

**Clamp tabs (x2).** Flat. Small: print them with the lid.

**Dock base (`ground_radar_dock_base.stl`).** As it sits, no supports.

**Dock stem (`ground_radar_dock_stem.stl`).** Flat, front face down on the
textured sheet, ring pocket facing up, no supports. Printed flat, both faces
are smooth and the ring's opening is a clean vertical hole; printed upright it
would be 600 layers of a thin wall. Check the magnet ring drops into its
pocket and sits flush or very slightly below the surface.

**Pod base (`shaft_pod_base.stl`).** Prints **standing on its USB end, with
the clamp bore vertical**. Every layer then contains a complete C, so the
jaws flex along the layers. Printed lying down, the layers would run across
the jaws and they would split at the root the first time they snap onto a
shaft. Use a brim. The zip-tie tunnels and the USB port bridge without supports.

**Pod lid.** Flat, outside face down.

## 3. Bench test before anything goes in a box

Wire each unit on the bench first, with the parts loose.

1. **Ground power.** Cell → TP4056 → switch → MT3608, with nothing on the MT3608
   output. Switch on and **set the MT3608 to 5.0 V** with a multimeter. Then
   charge through the TP4056's USB-C and confirm its LED goes red, then blue/green.
2. **Ground signal.** Connect the SuperMini, the pre-amp and the radar per the
   wiring doc. Check the radar's supply (section 1.3 of the wiring doc)
   **before** powering it. Flash `firmware/ground_unit`. The serial monitor
   should print a `boot` line, then `ready` with a battery voltage.
3. **Pod.** Flash `firmware/shaft_pod` over the SuperMini's USB-C. The serial
   monitor should name the IMU it found (`LSM6DS3TR-C` or `LSM6DSOX`). Remove the
   SuperMini's red power LED once it works.
4. **Link.** Power both. The ground unit prints `pod connected`, and its LED goes
   from a brief blip every 2 s to steady.

## 4. Ground unit assembly

Front view, as used: the window is upper right, the battery lower left.

1. **TP4056.** Lay it in its pocket at the lower right, components up, and slide
   it down until the USB-C receptacle sits in the **bottom cutout**. Plug a
   cable in from outside to check alignment. Put a thin bead of neutral-cure
   silicone where the receptacle meets the inside of the wall (**not** in the
   receptacle). Let it cure. The rib on the lid holds the module down once
   the lid is on.
2. **Radar module.** Antenna side **toward the window**. Screw it to the four
   posts on the inside of the window with M2 x 6. The posts hold it parallel to
   the window at 6.2 mm, half a free-space wavelength at 24.125 GHz, so
   reflections from the window skin return in a known phase rather than an
   arbitrary one. Do not shim it closer.
3. **Pre-amp board.** Four M2 x 6 into the standoffs left of the radar.
4. **ESP32-C3 SuperMini.** USB end first: hook it under the two lips at the left
   of its bay, lower the far end onto the rails, and fit the two printed clamp
   tabs with M2 x 6. Its USB-C stays reachable with the lid off, for flashing.
5. **Status light.** Push the printed light pipe into the top-face hole **from
   inside** until its flange seats; its end sits flush with the top face. Hold
   the 5 mm LED's dome against the flange and fix it with a drop of hot glue or
   clear silicone. The light then shows as a small soft dot.
6. **Switch.** Press it into the pocket on the inside of the right wall, lever
   through the slot. A drop of CA on the body.
7. **Wire up** per the wiring doc. Keep the radar → pre-amp → ESP32 leads short
   and twisted with ground. Add a dab of hot glue as strain relief at every joint
   on a board pad.
8. **Cell.** 1 mm foam tape on its back, Kapton over the face that will sit
   behind the MT3608. Place it in the lower-left bay, leads out through the gap
   in the right-hand fence.
9. **MT3608 on the lid.** Lay it PCB-down inside the fence on the lid's inner
   face (components toward the cell), with a dab of hot glue. Leave about 8 cm
   of wire so the lid can lie open beside the shell.
10. **Close.** Fit the lid (the lip locates it) and drive the four M2 x 6
    screws. Snug them up; do not over-tighten into plastic.
11. **Radome, last.** With the radar module tested (4.5), run a thin bead of
    clear silicone or epoxy round the ledge behind the window pocket and press
    the radome in from the front, ironed face out. It sits flush with the front
    face at its bottom edge and steps back into the pocket toward the top.
    Wipe off any squeeze-out before it cures. Silicone lets it be prised out
    again; epoxy does not.

### 4.1 Dock and MagSafe ring

The dock is the stand and the phone holder in one: a base with a lip in front
of the unit and two short lips behind it, and a stem rising behind the unit
that carries the MagSafe ring.

1. **Check the ring's orientation with a phone first.** Lay it in the stem's
   pocket, offer the phone's back to it, and confirm it pulls the phone in and
   centres it. If it repels or slides off-centre, turn the ring over. Do the
   same with the alignment magnet in the slot below: it should pull the phone's
   bottom edge straight down into line.
2. Glue the ring and the alignment magnet into their pockets with epoxy or CA.
3. Cut the 0.5 mm grip pad to the ring's shape and stick it over the phone side.
4. Push the stem's foot into the socket in the base, front face toward the
   unit's side, and fix it with two **M2 x 6** screws from behind, through the
   buttress.
5. Stick four 8 mm silicone bumpers into the recesses under the base for hard
   floors and hitting mats.
6. **Check the 5 V rail with the phone attached.** The ring ends up about
   6.5 mm from the MT3608 boost converter on the inside of the lid. Measure the
   MT3608's output with and without the phone: it should not move.

The phone's screen faces back, toward you. Its rear camera is about 70 mm
above the unit's top edge, looking down the target line over the radar. The
dock suits phones up to 186 mm tall (the fit report recomputes this for other
ring positions). The unit lifts straight out of the dock, so it can be carried
and charged on its own.

### 4.2 Placing it

Stand the unit on its bottom edge **behind the ball, on the target line**, window
facing the target. The window's boresight points **15° up**. The groove on the
top face sits directly over the radar's boresight: sight along it to line the
unit up with the target. The geometry launchmon-py's config assumes is about
1.4 m behind the tee. **Measure** the distance and the window height each
session and record them; launchmon-py's `hardware.yaml` explains why the
height matters for the cosine correction.

Use the **dock** on grass or a mat: a 21 mm deep box standing on its edge is
easy to knock over. The base reaches behind the unit, the side the phone pulls
it toward. Charge the unit out of the dock: its USB-C port is on the bottom edge.

### 4.3 Set the Doppler sign (one-time bench check)

Which sign of Doppler means "moving away" depends on which IF output went to
which pin. With the unit running and a serial monitor open, send `d` to print
the trigger metric ten times a second. Move a hand **away** from the window,
quickly. The `ratio` should jump strongly **positive**. If it goes negative,
change `RECEDING_SIGN` to `-1` in `ground_unit.ino` and re-flash. If nothing
moves, check the radar supply and the pre-amp.

### 4.4 Raw captures

Send `r` (or short-press the BOOT button) to toggle raw streaming. Each shot
then also sends a `RAW_BEGIN {...}` header line, exactly the stated number of
bytes of int16 I/Q pairs, and `RAW_END`. Save them. Raw data is kept forever:
the on-device speeds are a preview, and launchmon-py can be run on exactly the
samples the unit saw. `launchmon-py/scripts/record_ground_unit.py` saves the
stream and `launchmon-py/scripts/fuse_shot.py` runs the 40 kHz pipeline on it.

### 4.5 Window check

Before fitting the radome, compare the trigger metric for the same hand
movement with the module bare and with the radome held in its pocket. A large
drop means the radome's filament is lossy (see section 1): reprint it in
another.

## 5. Shaft pod assembly

1. **IMU.** Remove the two STEMMA QT sockets (hot air, or cut the plastic and
   desolder the pins), unless you have raised the body height. Solder four 30 AWG
   wires to VIN, GND, SCL, SDA and one to INT1, on the **top** side of the pads.
   The underside must stay flat, because it is the datum.
2. Press the breakout into the pocket on the floor, **silkscreen X arrow toward
   the clubhead end** (the end away from the USB port), component side up. The
   crush ribs centre it and stop it rotating. It must sit flat on the floor:
   no wire, flux blob or solder spike underneath.
3. **Kapton** over the IMU. **Cell** on top of it, leads toward the charger end.
   **Charger** board beside the cell at the clubhead end. The two posts on the
   side walls separate them.
4. **Schottky and divider** soldered inline in the leads and covered with
   heat-shrink.
5. **0.5 mm foam** on top of the cell, then the **SuperMini**, USB-C into the port
   in the end wall.
6. **Lid.** Snap it on. Its fences locate the SuperMini, and its pads press the
   whole stack down onto the datum floor. That preload is what couples the IMU
   rigidly to the shell.
7. **Liner.** Stick one 8 x 42 mm strip of 0.8 mm silicone or neoprene into the
   recessed band of each jaw. Trim it flush with the jaw tips.

### 5.1 Mounting on the club

1. **Measure the shaft** where the pod will sit. The default bore suits 13.0 mm.
   Shafts taper, so slide the pod to where it is snug, usually a few
   centimetres below the grip, not in contact with either hand.
2. Push it on until both jaws snap round the shaft.
3. **Fit a zip tie through each jaw**: in through the tunnel at the top of the
   jaw, down round the outside groove, across the mouth under the shaft, and
   back. Pull tight and trim. **Do not swing without them.** The clamp keeps the
   pod in place for handling. The ties are what keep it on the club at
   clubhead speed.
4. Orientation rule: **USB port toward the grip**, and **lid facing the target**
   at address (+Z along the face normal). Mount it the same way every session so
   recordings stay comparable.
5. Check before the first swing: hold the club still, **head down, shaft
   vertical**. The pod's +X then points down, so its accelerometer X axis should
   read about −1 g (−2049 counts at ±16 g). If a different axis or sign reads it,
   the board is rotated in its pocket; correct it, or record the mapping.

## 6. Weatherproofing and strain relief

Neither unit is waterproof. Both are built to survive dew, a damp mat and a
passing shower if you then dry them. Do not leave them in rain.

**USB-C ports**

- Ground unit: the charging port **faces the ground** while the unit stands, so
  rain does not run into it. Put the **silicone dust plug** in it whenever it
  is not charging, and before setting the unit on wet grass.
- Pod: the port faces the grip, away from turf and the clubhead.
- Seal the inside of each receptacle to its wall with a thin bead of neutral-cure
  silicone (step 4.1). Keep silicone out of the receptacle itself.
- **Never charge a wet unit.** Dry it with the plug out first.

**Strain relief**

- Do not let a cable hang from a port. Charge the ground unit lying on its
  back, out of the dock, so the cable leaves the bottom edge straight.
- Inside: a dab of hot glue over every wire where it meets a board pad.
- Leave service loops: the MT3608's leads (lid to shell) and the cell's leads.

**Seams**

- The ground lid's lip gives a labyrinth seam. For more protection run a thin
  bead of neutral-cure silicone round the lip before closing. It peels off
  cleanly when you need to open the case.
- The pod's snap lid can take a ring of thin PTFE tape round the lip, or a smear
  of silicone grease.

**Batteries**

- Do not leave either unit in a hot car: LiPo cells degrade fast and can swell.
  A swollen cell is replaced, never squeezed back in.
- Store both at about half charge if they will sit unused for weeks.

## 7. Sensor axis orientation rules (summary)

| Rule | Why |
|---|---|
| The IMU breakout sits **flat on the pod's floor**, nothing underneath | The floor is the datum plane, parallel to the pod's X/Y reference axes and to the clamp bore |
| The breakout's edges are **square to the pocket walls** (crush ribs) | Keeps the sensor axes parallel to the pod axes; rotation in the pocket mixes axes |
| **Silkscreen X arrow → clubhead**, Z out of the lid | Matches the pod frame the firmware and docs use |
| The lid preloads the stack | A loose IMU adds its own rattle to the swing data |
| Pod: **USB toward the grip, lid toward the target** at address, same every session | Comparable recordings |
| Radar: **window toward the target**, boresight 15° up, top groove on the target line | The radar measures speed along its own line of sight; aiming off-line reads low |
| Raw axes are streamed unchanged | Any mounting correction is applied downstream, so a recording can be re-processed if the mapping turns out wrong |

The board-to-chip alignment on any breakout has some tolerance of its own,
which nothing here measures. If per-axis numbers ever matter, calibrate the
mounting with a static multi-orientation test rather than trusting the
silkscreen.
