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
| MagSafe magnet ring, if you use the MagSafe-ring head | `ring_od`, `ring_id`, `ring_depth` | ground |
| Spring (pogo) pins for the pod park: barrel, length, stroke | `pod_park_pogo` | ground |
| The pod's brass contact screws: head diameter and height | `pod_park_pad` | pod |
| Piezo disc diameter | `pz_d` | ground |

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
| Shell, lid, dock base and stem, pod park hood, clamp tabs, pod base and lid | Matte black PETG | Textured PEI sheet under the shell, lid, stem and hood |
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
The sight's rear notch blade stands on its top edge.

**Pod park hood (`ground_radar_pod_park_hood.stl`).** Rear face down on the
textured sheet, no supports. The two spring-pin bores lie across the print as
small teardrops; a drop of CA holds the pins.

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
5. **Buzzer.** Wire the piezo disc through 470 Ω to GPIO7, its brass lead
   straight to a SuperMini GND pin. One chirp about a second after boot. Tune
   `BUZZER_HZ` by ear once it is glued in (4, step 7): free discs usually
   resonate a little above the 4 kHz default.
6. **Pod charging.** Build the protection board (wiring doc, section 4) and test
   it before it goes in: GPIO6 low, the + pin reads 0 V; GPIO6 high, about 5 V;
   a 22 Ω load across the pins does not trip the fuse at once. Then run the
   checks in wiring doc 4.8: with `d` on and no pod, `off_mv` under 300; a wet
   paper towel across the pins never switches them on; a parked pod gives three
   chirps and `"state":"charging"`, and lifting it gives `"state":"off"` within a
   few seconds.

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
7. **Buzzer.** Glue the 15 mm piezo disc onto the round seat inside the left end
   wall, **brass face toward the wall, by its rim only**: a thin ring of CA or
   silicone. Glued over its whole face it can barely flex and is nearly silent.
   It sounds through the four lowest grip-rib grooves, which are cut through and
   rise inward, so rain runs out rather than in.
8. **Wire up** per the wiring doc. Keep the radar → pre-amp → ESP32 leads short
   and twisted with ground. Add a dab of hot glue as strain relief at every joint
   on a board pad.
9. **Cell.** 1 mm foam tape on its back, Kapton over the face that will sit
   behind the MT3608. Place it in the lower-left bay, leads out through the gap
   in the right-hand fence.
10. **MT3608 on the lid.** Lay it PCB-down inside the fence on the lid's inner
    face (components toward the cell), with a dab of hot glue. Leave about 8 cm
    of wire so the lid can lie open beside the shell.
11. **Pod park hood.** On the bench first:
    - *Magnets.* Check polarity before any glue: let each of the pod's magnets
      jump onto the hood magnet it will face; the face that touched goes outward
      in the pod. Glue the two hood magnets flush in the socket floor, opposite
      poles facing out, so the pod only parks one way round.
    - *Pins.* Solder a wire to each pin's tail. Press each pin into its bore from
      the socket side, then push it home with the flat shank of a 4 mm drill bit
      until the shank meets the bottom of the well: that sets the pin height. A
      drop of CA at the tail. The pin next to the "+" is +5 V.
    - *Fit.* Feed the two wires through the small holes in the lid, one each side
      of the rib, and fix the hood with two M2 x 6 screws driven from inside the
      lid. Seal the wire holes with silicone.
    - *Protection board.* Wire it per the wiring doc, section 4, and glue it in the
      pocket on the lid's inside face, just below the wire holes, between the
      MT3608's output and the pins.
12. **Close.** Fit the lid (the lip locates it) and drive the four M2 x 6
    screws. Snug them up; do not over-tighten into plastic.
13. **Radome, last.** With the radar module tested (4.5), run a thin bead of
    clear silicone or epoxy round the ledge behind the window pocket and press
    the radome in from the front, ironed face out. It sits flush with the front
    face at its bottom edge and steps back into the pocket toward the top.
    Wipe off any squeeze-out before it cures. Silicone lets it be prised out
    again; epoxy does not.

### 4.1 Dock

The dock is the stand and a phone holder in one: a base with a lip in front of
the unit and two short lips behind it, and a stem rising behind the unit to a
cap with a standard **1/4"-20 tripod stud**.

1. **Stud.** Put a little epoxy in the hex pocket under the cap and push the
   1/4"-20 x 1/2" hex bolt in from below, head first, until it seats. Its
   thread stands 5.5 mm above the cap. Keep epoxy off the thread, and let it cure.
2. Push the stem's foot into the socket in the base, front face toward the
   unit's side, and fix it with two **M2 x 6** screws from behind, through the
   buttress.
3. Stick four 8 mm silicone bumpers into the recesses under the base for hard
   floors and hitting mats.

Any smartphone tripod clamp screws onto the stud and holds a phone, whatever
its size or make, as a **results screen** facing the golfer. The phone on the
dock is not the camera that films the swing: see 4.2.

**MagSafe-ring head (optional).** Print `ground_radar_dock_stem_magsafe.stl`
instead. Check the magnet ring's orientation with a phone first (it should pull
the phone in and centre it; if it repels or slides, turn it over), glue it and
the alignment magnet into their pockets, and cover the ring with a 0.5 mm grip
pad. The ring ends up about 6.5 mm from the MT3608 on the inside of the lid:
measure the MT3608's output with and without the phone, and it should not move.

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
easy to knock over. The base reaches behind the unit, the side a phone on the
stud pulls it toward. Charge the unit out of the dock: its USB-C port is on the
bottom edge. Lay it on its back; with the pod parked, it rests on the hood and
the lid's edge, tilted about 20°.

**Beeps.** One chirp: armed and ready. Two: a shot was read. Three quick ones:
the pod is parked and charging. Long-short and short-long: the pod connected
or disconnected over Bluetooth. Three long ones every 5 minutes: the unit's own
battery is low. One very long one: a charging fault. Send `b` over serial to
turn them off.

**The camera.** Film the swing from a tripod, not from the unit. Put the phone
or tablet in an ordinary 1/4"-20 clamp on any tripod about **3 m behind the
ball, at hip height** (about 1 m), on or just beside the target line, so the
whole golfer and the club at the top are in frame. Any phone works, with or
without MagSafe, and so does an iPad in a tablet clamp. Record the distance
from the camera to the ball: fusion uses it to remove the time the sound of
the strike takes to reach the phone (`fuse_shot.py --camera-distance 3.0`).

Why not on the unit: a phone on the dock sits about 15 cm off the ground,
1.4 m behind the ball. With its normal lens the golfer's head is about 46°
above it and their body about 27° to the side, outside the frame in either
orientation. A tablet is also heavy enough to tip the dock over.

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
another. Do this for every new radome colour; a dye that looks translucent can
still be lossy.

### 4.6 Parking and charging the pod

The pod lives on the back of the unit between sessions: one object to carry
and one cable to charge.

- **To park it,** push its arrow end up into the hood, clamp toward the unit.
  The magnets pull it home. **To take it,** pull it down and out. The unit
  still lifts out of the dock with the pod parked.
- **It charges from the unit only while the unit is switched on.** The slide
  switch cuts the 5 V rail, so a switched-off unit cannot charge the pod. To
  charge both at once, plug a charger into the unit's USB-C, switch the unit
  on and park the pod: about 1.5 hours from flat. Switch the unit off when the
  pod reports `"charge":"charged"`. Or charge the pod on its own USB-C.
- A full pod charge costs the unit about 15% of its own battery. Below 3.55 V
  on its cell the unit stops charging the pod.
- A pod with a completely flat cell cannot announce itself to the unit (the
  unit looks for the pod's 3.3 V before it powers the pins). Plug the pod's own
  USB-C in for a minute first.
- The pins stay dead whenever no pod is parked, so wet grass or a coin across
  them does nothing.

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
5. **Charging contacts.** Glue the two 4 x 2 mm magnets into the pockets behind
   the +X end wall from inside, outward faces as found in step 11 of section 4.
   Drive the two M2 x 4 brass cheese-head screws into the pilots in the +X end
   with a drop of epoxy. Solder 30 AWG Kynar wire to each tip inside: the screw
   by the debossed "+" through the Schottky D2 (anode at the screw) to the
   SuperMini's 5V pin, the other to GND. Fit the 220 kΩ beacon resistor from 3V3
   to the + screw, and the 2.2 MΩ / 1 MΩ divider with its 100 nF from the + screw
   to GPIO1 (wiring doc, section 4). D2 lies along X between the two screws,
   above the charger; the resistors go dead-bug above it.
6. **0.5 mm foam** on top of the cell, then the **SuperMini**, USB-C into the port
   in the end wall.
7. **Lid.** Snap it on. Its fences locate the SuperMini, and its pads press the
   whole stack down onto the datum floor. That preload is what couples the IMU
   rigidly to the shell.
8. **Liner.** Stick one 8 x 42 mm strip of 0.8 mm silicone or neoprene into the
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
