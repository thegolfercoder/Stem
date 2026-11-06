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
| MagSafe magnet ring for the arm's head | `ring_od`, `ring_id`, `ring_depth`, `orient_slot` | ground |

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
radar cares about. Print it in **translucent PETG: smoke (dye-tinted), ice
(natural) or amber**. It is also the one part meant to take a colour; the
rest of the unit stays matte black. **Avoid carbon-fibre, metal-filled, glitter/sparkle and carbon-black
filaments for it**: conductive or lossy fillers absorb 24 GHz, and most opaque
black filaments are coloured with carbon black. The radar does not look through
the shell, lid or dock, so those can be any colour; the design's finish is
matte black (see [design_language.md](design_language.md)). If in doubt about
a radome filament, run the bench check in 4.5.

| Part | Filament | Finish |
|---|---|---|
| Shell, lid, dock base, arm slide, head and pin, clamp tabs, pod base and lid | Matte black PETG | Textured PEI sheet under the shell, lid and head |
| Pod strap | **TPU 95A** (flexible), any colour; black matches | Flat, outer face down |
| Radome | Translucent PETG, not carbon-black: smoke, ice (natural) or amber | Outer face up, ironing on |
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
| Build sheet | **Textured PEI** for the shell, lid and arm head: the face on the bed is the face people see, and the texture gives it an even matte grain with no layer lines |
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
The sight's rear notch blade stands on its top edge.

**Clamp tabs (x2).** Flat. Small: print them with the lid.

**Dock base (`ground_radar_dock_base.stl`).** As it sits, no supports. The
arm's spine rises from it behind the lid's centre, with the slide's channel
open at the top and two detent holes in its rear wall; the pod pocket sits
behind the spine. Check the channel is clear of stringing all the way down
before fitting the slide.

**Arm slide (`ground_radar_arm_slide.stl`).** Flat, hinge tab up, no
supports. Check it slides the full length of the spine's channel (0.3 mm
clearance each side) and clicks at both ends. If it is tight, sand its faces
rather than forcing it; if it is loose, the clicks will be weak.

**Arm head (`ground_radar_arm_head_magsafe.stl`).** On its plain face on the
textured sheet, ring pocket up, no supports: the face that shows when the arm
is folded is the one on the bed. Check the magnet ring drops into its pocket
and sits flush or very slightly below the surface.

**Arm pin (`ground_radar_arm_pin.stl`).** Flat. A printed 3 mm pin; print a
spare. A 3 mm steel pin or a length of 3 mm rod cut to 28 mm can replace it.

**Pod base (`shaft_pod_base.stl`).** Prints **standing on its USB end, with
the clamp bore vertical**. Every layer then contains a complete C, so the
jaws flex along the layers. Printed lying down, the layers would run across
the jaws and they would split at the root the first time they snap onto a
shaft. Use a brim. The zip-tie tunnels and the USB port bridge without supports.

**Pod lid.** Flat, outside face down.

**Pod strap (`shaft_pod_strap_TPU.stl`).** **TPU 95A**, flat, outer face down,
no supports: 1.0 mm thick, five 0.20 mm layers. Print slowly (about 20-30
mm/s) as TPU needs. Its length is computed from `shaft_d`, so re-export it if
you change the bore. Print a spare.

## 3. Bench test before anything goes in a box

Wire each unit on the bench first, with the parts loose.

1. **Ground power.** Cell → TP4056 (B+/B-) → OUT+ → slide switch → MT3608
   VIN+, with MT3608 VIN- and VOUT- on TP4056 OUT- (wiring doc 1.1) and nothing
   on its output yet. Switch on and **set the MT3608 to 5.0 V** with a
   multimeter. Switch off: VOUT+ should fall to 0 V. Then charge through the
   TP4056's USB-C with the switch off and confirm its LED goes red, then blue
   or green.
2. **Radar module, before it touches the ESP32.** Check its supply (wiring doc
   1.3) **before** powering it. Power it alone and measure IFI and IFQ to ground
   with a multimeter: each should sit at a steady level between about 0.2 V
   and 2.3 V, and never above 3.3 V. Wave a hand in front of it: on an
   oscilloscope, or a multimeter on AC, both outputs should move. A module
   whose outputs barely move has no IF amplifiers and will not work here
   (wiring doc 1.3).
3. **Ground signal.** Connect the radar's IFI to GPIO0 and IFQ to GPIO1
   directly, and the LED through its 330 Ω resistor to GPIO10. Flash
   `firmware/ground_unit`. The serial monitor should print a `boot` line with
   `"fw":"0.5"`, then `ready`, and the LED should blip every 2 s.
4. **Pod power.** Wire the cell, P5 and the charger as in wiring doc 2.1 and
   check before connecting the SuperMini: with no USB, the 5V pin reads the
   cell voltage less about 0.3 V. With USB in, the cell's + reads at most
   4.2 V, never 5 V; if it reads 5 V, P5 is in backwards or bypassed.
5. **Pod.** Flash `firmware/shaft_pod` over the SuperMini's USB-C. The serial
   monitor should print `fw 0.3` and name the IMU it found (`LSM6DS3TR-C` or
   `LSM6DSOX`). Remove the SuperMini's red power LED once it works.
6. **Link.** Power both. The ground unit prints `pod connected`, and its LED goes
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
3. **ESP32-C3 SuperMini.** USB end first: hook it under the two lips at the left
   of its bay, lower the far end onto the rails, and fit the two printed clamp
   tabs with M2 x 6. Its USB-C stays reachable with the lid off, for flashing.
4. **Status light.** Push the printed light pipe into the top-face hole **from
   inside** until its flange seats; its end sits flush with the top face. Hold
   the 5 mm LED's dome against the flange and fix it with a drop of hot glue or
   clear silicone. The light then shows as a small soft dot. Its 330 Ω
   resistor goes inline in one LED lead, under heat-shrink.
5. **Switch.** Press it into the pocket on the inside of the right wall, lever
   through the slot. A drop of CA on the body.
6. **Wire up** per the wiring doc. Keep the radar → ESP32 IF leads short
   and twisted with ground. Add a dab of hot glue as strain relief at every joint
   on a board pad.
7. **Cell.** 1 mm foam tape on its back, Kapton over the face that will sit
   behind the MT3608. Place it in the lower-left bay, leads out through the gap
   in the right-hand fence.
8. **MT3608 on the lid.** Lay it PCB-down inside the fence on the lid's inner
    face (components toward the cell), with a dab of hot glue. Leave about 8 cm
    of wire so the lid can lie open beside the shell.
9. **Close.** Fit the lid (the lip locates it) and drive the four M2 x 6
    screws. Snug them up; do not over-tighten into plastic.
10. **Radome, last.** With the radar module tested (4.5), run a thin bead of
    clear silicone or epoxy round the ledge behind the window pocket and press
    the radome in from the front, ironed face out. It sits flush with the front
    face at its bottom edge and steps back into the pocket toward the top.
    Wipe off any squeeze-out before it cures. Silicone lets it be prised out
    again; epoxy does not.

### 4.1 Dock and phone arm

The dock is the stand, the phone holder and the pod's storage in one: a base
with a lip in front of the unit, a slim spine rising from it behind the lid's
centre (30 x 5 mm, its top 1 mm under the unit's top edge), and a pocket for
the club pod behind the spine. The arm is a slide that pulls up out of the
spine and a round 60 mm MagSafe head hinged to the top of the slide. Folded,
the slide is in the spine and the head hangs flat over it, plain face out:
nothing stands above the unit. There are no screws in the dock.

1. **Magnet ring.** Check its orientation with a phone first: it should pull
   the phone in and centre it; if it repels or slides, turn it over. Glue it
   and its alignment magnet into their pockets in the head with epoxy or CA,
   and let it cure. Cover the ring with the 0.5 mm grip pad. Folded, the ring
   sits a few millimetres behind the lid, near the MT3608: measure the
   MT3608's output with the arm folded and open, and it should not move.
2. **Hinge.** Set the slide's middle knuckle between the head's two outer
   knuckles and push the 3 mm pin through all three. The head should hold at
   each detent (0, 10, 20, 25, 30, 35°); how firmly has not been tested on a
   print yet. If the pin works loose, a drop of CA in one outer knuckle holds
   it; keep CA off the middle knuckle, which has to turn.
3. **Slide into the spine.** Push the slide down into the spine's channel from
   the top, bump toward the rear, until it clicks into the lower (stored)
   detent. Fold the head down over the back of the spine.
4. **Feet.** Stick four 8 mm silicone bumpers into the recesses under the base
   for hard floors and hitting mats.

**The pod.** Between sessions the club pod lies on a side face in the pocket
behind the spine; the finger notch in the rear wall lifts it out. It charges
out of the pocket, on its own USB-C.

**Phones without MagSafe.** A clamp head for those is not built yet. Today
such a phone needs a MagSafe-compatible case or a stick-on magnetic ring.

### 4.2 Placing it

Stand the unit on its bottom edge **behind the ball, on the target line**, window
facing the target. The window's boresight points **15° up**. A front post and a
rear notch on the top face, joined by a groove, sit directly over the radar's
boresight: from behind, centre the post in the notch on the target, as with a
gun sight. That gets the unit lined up quickly and the same way each session.
It is not about precision: a Doppler speed reads low by 1 - cos(aim error),
which is 0.01% at 1° and still only 1.5% at 10°. The sight keeps you well
inside that and the ball well inside the beam. The geometry launchmon-py's config assumes is about
1.4 m behind the tee. **Measure** the distance and the window height each
session and record them; launchmon-py's `hardware.yaml` explains why the
height matters for the cosine correction.

Use the **dock** on grass or a mat: a 21 mm deep box standing on its edge is
easy to knock over. The base reaches behind the unit, under the phone. Charge
the unit out of the dock: its USB-C port is on the bottom edge. Lay it on its
back, switched off.

**The camera is the phone, on the unit.** No tripod. To open the arm:

1. Swing the head up off the back of the spine.
2. Pull the slide straight up until it clicks at the open detent, 46 mm up.
   About 12 mm of it stays in the spine.
3. Tilt the head back to the **25° detent** (the default; 0-35° are there).
4. Put the phone on the head, back to the ring, in portrait, camera at the
   top, screen toward you.

At 25° the phone's lower edge clears the unit by 8.5 mm, the lens's sightline
clears its top by over 100 mm, and the phone's centre is over the base, so it
cannot tip the dock backwards. Those numbers are from the CAD's fit report for
a 147.6 mm stand-in phone; they have not been checked with a printed arm yet.

**Use the 0.5x ultra-wide lens** (most phones since about 2019). The head
does not swivel toward the golfer yet, so with the 1x lens the golfer may sit
at the edge of the frame. Check the framing before the first shot: the whole
golfer and the club at the top should be in it. A more upright detent aims
the lens lower, with more of the ground and the ball; a further one aims it
higher, with more of the club at the top.

Fusion removes the time the sound of the strike takes to reach the phone, so
give it the phone-to-ball distance: with the phone on the unit that is the
unit's distance you measured, about 1.4 m by default (`fuse_shot.py
--camera-distance 1.4`). Fold the arm before picking
the unit up: head up, slide down to its stored click, head flat over the spine.

### 4.3 Set the Doppler sign (one-time bench check)

Which sign of Doppler means "moving away" depends on which IF output went to
which pin. With the unit running and a serial monitor open, send `d` to print
the trigger metric ten times a second. Move a hand **away** from the window,
quickly. The `ratio` should jump strongly **positive**. If it goes negative,
change `RECEDING_SIGN` to `-1` in `ground_unit.ino` and re-flash. If nothing
moves, check the radar supply and that the module's IF outputs move (bench
test 2).

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
another. Do this for every new radome colour; a dye that looks translucent can
still be lossy.

### 4.6 Charging

Each unit charges from its own USB-C port. Neither reads its battery, so
**charge both after each session**.

- **Ground unit:** through the TP4056's USB-C on the bottom edge, **switched
  off**. With it switched on, its own load keeps the charger from finishing.
  The module's LED is red while charging and blue or green when full, about 2
  hours from flat at 1 A. Switched off, nothing after the switch draws: the
  unit can sit for months, losing only the cell's own self-discharge and a few
  microamps of protection circuits.
- **Pod:** through the SuperMini's USB-C, the same port used for flashing,
  from a powered charger or computer. About 1-1.5 hours from flat at 100 mA.
  Unplug it when done; do not leave it plugged into a device that is switched
  off (wiring doc 2.1).

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
4. **Schottky P5** soldered inline between the cell's + lead and the
   SuperMini's 5V pin, anode at the cell (wiring doc 2.1), and covered with
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
3. **Fit the TPU strap.** Hook one end's slot over the post on one side face,
   take the strap round the body's lower edge, under the shaft between the
   jaws and up to the post on the other side, and hook that end on: the lower
   lip clicks it home. The lift ridge at each tip takes it off again. **Do not
   swing without the strap or the zip ties.** The clamp keeps the pod in place for
   handling; the strap is what keeps it on the club at clubhead speed. Its
   hold has not been pull-tested yet: until it has, check it is still hooked
   after every few swings. **Fallback:** a zip tie through each jaw, in through
   the tunnel at the top of the jaw, round the outside groove, across the
   mouth under the shaft and back, pulled tight and trimmed.
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
  silicone (section 4, step 1). Keep silicone out of the receptacle itself.
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
