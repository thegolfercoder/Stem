# Bill of materials

Two separate units. Each has its own microcontroller, battery and charger. They
share no wires and talk only over Bluetooth Low Energy.

| Unit | Where it lives | Enclosure |
|---|---|---|
| **Ground radar unit** | On the ground behind the ball, looking down the target line | `cad/script_ground_radar.scad` |
| **Shaft motion pod** | Clipped to the club shaft | `cad/script_shaft_imu.scad` |

No prices are listed: they move too fast to be worth writing down. Quantities
include the spares worth having. Wiring for every part is in
[wiring_schematic.md](wiring_schematic.md).

---

## 1. Ground radar unit

### Core electronics

Exactly the owner's parts list. Power path: LiPo → TP4056 → slide switch →
MT3608 (5 V to the radar module and the ESP32). The radar's I/Q lines go
through the LM358 pre-amp, run from the SuperMini's 3.3 V, to the ESP32's ADC
pins. The pre-amp was optional in the original list; it is fitted (owner's
decision, 2026-11-09), because no BGT24LTR11 board found both fits this unit
and covers the ball's Doppler band without one ([hardware_review.md](hardware_review.md), Part 1).

Sizes marked **measure** were checked against datasheets and listings in the
hardware review (Part 2) and vary between sellers: measure the part you have
and set the CAD parameter before printing (build instructions, section 0).

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G1 | **Infineon BGT24LTR11** 24 GHz radar module | Dual-channel I/Q CW Doppler, 24.00-24.25 GHz ISM band, IFI and IFQ outputs | 1 | A plain module: its IFI and IFQ outputs go to the LM358 pre-amp (G3), which amplifies and band-limits them (wiring doc 1.4). The enclosure assumes a 25.4 x 25.4 mm board with M2 holes 2.5 mm in from each corner. **Measure yours** and set `radar_pcb` and `radar_holes` in the CAD before printing. The BGT24LTR11 chip runs on 3.3 V. Feed the module's 5 V pin only if it has its own 3.3 V regulator (see the wiring doc). If it has a pin header fitted, remove it unless the CAD's `radar_back_clear` allows for it, and solder the leads to the pads (build 4, step 0). |
| G2 | **ESP32-C3 SuperMini** | ESP32-C3, 4 MB flash, USB-C, 22.5 x 18 mm | 1 (+1 spare) | It has no mounting holes. The enclosure holds it with rails, two fixed lips and two printed M2 clamp tabs. |
| G3 | **LM358** dual op-amp pre-amp | DIP-8 or SOIC-8 on a breakout, run from **3.3 V** | 1 | Fitted (owner's decision, 2026-11-09): the radar module's IF outputs go through it. **MCP6002** is a drop-in rail-to-rail alternative with more headroom at 3.3 V. Passives are listed under G3a. |
| G3a | Pre-amp passives, for both channels | 2x 10 kΩ (R_in), 2x 200 kΩ (R_f), 2x 82 nF film or C0G (C_in), 2x 56 pF C0G (C_f), 2x 1 kΩ + 2x 4.7 nF (output RC), 27 kΩ + 10 kΩ (bias divider), 10 µF + 100 nF (bias and supply decoupling) | 1 set | One gain stage per channel: x20, 200 Hz to 14 kHz. Built on a **23 x 20 mm** piece of perfboard (9 x 8 holes), with M2 holes 2.5 mm in from each corner. |
| G4 | **3.7 V 1500 mAh LiPo** | 803450 class, **with a protection PCB**, JST-PH 2.0 lead. Listed sizes run from 50 x 34 x 8 mm to **52 x 34.5 x 8.3 mm** (EEMB LP803450, the largest listed); the protection PCB is often inside that length | 1 | **Measure yours** (length including the protection PCB, width, thickness) and set `batt` in the ground CAD before printing; plan for 52 x 34.5 x 8.3 mm. The TP4056 has solder pads, not a JST socket, and no mating plug is listed: either **cut the JST-PH plug off** and solder the leads to B+/B- one at a time (build 4, step 9), or add a mating JST-PH 2.0 pigtail (an extra part) and solder that to the pads. |
| G5 | **TP4056 USB-C charging module** | With DW01A + FS8205 protection (B+/B-/OUT+/OUT- pads), 1 A default (R_PROG 1.2 kΩ). **About 29 x 17.3 mm** overall (AZ-Delivery datasheet: 29 x 17.3 x 4.3 mm; listings give 28-29 mm long), **USB-C version only** | 1 (+1 spare) | 1 A is 0.67 C for a 1500 mAh cell, which is fine. Its USB-C port lines up with the bottom cutout; the micro-USB version does not fit that cutout. **Measure** its overall length, including the receptacle where it stands proud of the board edge, and its **board thickness** (likely 1.0 mm, not 1.6), and set `tp_pcb` in the ground CAD. |
| G6 | **MT3608 DC-DC boost module, low-profile** | 2 V-24 V in, adjustable out, **set to 5.0 V**. About 36-37.2 x 17-17.2 mm. **Overall height at most 8 mm** (PCB plus its tallest part, usually the trimmer) | 1 (+1 spare) | **It must be a low-profile module: at most 8 mm overall; most listings are 14 mm and will not fit: measure before buying.** *(Height limit to be confirmed against the CAD's `mt_parts_h` once the CAD is updated; lead to adjust this figure.)* Set it to 5.0 V on the bench **before** connecting anything to its output, and mark the trimmer with a dot of paint so it cannot drift. It mounts inside the lid. |
| G7 | **SPST slide switch** | SS12D00-class (SPDT used as SPST), 2.54 mm pitch, rated 0.5 A 50 V DC. Body about **8.8 x 4.1 x 3.9 mm** (listings give 8 x 4 x 3.8). **Lever about 2 mm long** | 1 (+2 spare) | Between TP4056 OUT+ and MT3608 VIN+ (about 0.26 A, inside the rating). Sits in the right-side wall pocket, with its lever in the recessed slot. **Lever length:** the suffix (G2, G3, G4, G5 ...) is the lever-length class and listings rarely give the length, so **measure**. The lever's tip reaches about (lever length − 1.4 mm) into the 1.0 mm recess round the slot: a 2 mm lever ends inside the recess, below the face, where a fingertip still works it; one over about 2.4 mm stands proud of the face and can be knocked. Measure the body too and set `sw_body` in the ground CAD. |
| G8 | **5 mm status LED**, with its **330 Ω** current-limiting resistor | Any colour, diffused | 1 + 1 resistor | An LED needs its series resistor. 330 Ω suits red, yellow or green (about 4 mA from the 3.3 V pin); use 100 Ω for blue or white (wiring doc 1.5). Sits inside, under the printed light pipe, which shows it as a flush 2.8 mm dot on the top face. |

Nothing on this unit measures the cell: the firmware reports no battery
voltage (wiring doc 1.1).

### Fasteners and consumables

| # | Part | Qty | Used for |
|---|---|---|---|
| G10 | **M2 x 6 mm screws**, pan head, thread-forming for plastics (stainless machine screws also work into the 1.7 mm pilots) | **14** (buy 20) | 4 radar module, 4 LM358 board, 2 ESP32 clamp tabs, 4 lid |
| G11 | Silicone wire, 26-28 AWG, several colours | ~1 m | All internal wiring |
| G12 | Kapton tape | small roll | Insulating the cell where the MT3608 faces it, and the IMU-to-cell contact in the pod |
| G13 | Double-sided foam tape, 1 mm | small piece | Under the cell, so it cannot rattle |
| G14 | Neutral-cure silicone (RTV) | small tube | USB-C receptacle seal, lid seam (optional) |
| G15 | Silicone USB-C dust plug | 1 | Closes the charging port while the unit is on wet grass |
| G16 | Clear silicone or epoxy | small | Seats the radome on its ledge, and the LED against the light pipe |
| G17 | Heat-shrink, 1.5-3 mm | assorted | Solder joints |

### Dock and phone arm

The dock base carries the folding phone arm and a pocket for the club pod; the
arm is three printed parts (section 3) and no screws.

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G39 | **MagSafe-compatible magnet ring**, aftermarket | About 56.5 mm OD x 45.5 mm ID x 1-1.8 mm, ideally with its alignment ("tail") magnet | 1 | Glued into the pocket on the arm's round head. **Measure yours** and set `ring_od`, `ring_id`, `ring_depth` and `orient_slot` in the ground CAD before printing the head. |
| G40 | Grip pad, 0.5 mm, silicone or rubber sheet | Cut to the ring | 1 | Covers the ring, so the phone does not slide on the magnets. Many rings come with one. |
| G41 | Two-part epoxy or CA | small | 1 | Holds the ring and its alignment magnet in the head |
| G21 | Silicone bumper feet | 8 mm, self-adhesive | 4 | Under the dock base: grip on hard floors and hitting mats |

### Filming the swing

| Part | Notes |
|---|---|
| The phone, on the arm | It films from the unit: the head holds it by MagSafe at 25° back by default. Use the phone's **0.5x ultra-wide** lens (most phones since about 2019); with the 1x lens the golfer can sit at the edge of the frame, because the head does not yet swivel toward them. No tripod. |
| A MagSafe-compatible case or a stick-on magnetic ring *(only for a phone without MagSafe)* | A clamp head for non-MagSafe phones is not built yet. |

---

## 2. Shaft motion pod

### Core electronics

The owner's parts list, plus one diode. Power path: micro LiPo → charger →
ESP32; the pod charges through the SuperMini's USB-C. I²C from the ESP32 to
the IMU.

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| P1 | **Adafruit LSM6DS3TR-C** 6-DoF IMU (#4503) **or LSM6DSOX** (#4438) | Gyro up to ±2000 dps, accel up to ±16 g, I²C at 0x6A/0x6B, STEMMA QT, **25.4 x 17.8 mm** | 1 | The firmware detects which one it has. The default enclosure assumes the two **STEMMA QT sockets are removed** and the board is wired on its 0.1" pads, because the sockets add 1.75 mm the 14 mm body does not have. To keep them, set `imu_stemma_fitted = true` and raise `pod` height to the value the fit report gives. |
| P2 | **ESP32-C3 SuperMini** | as G2 | 1 | Its USB-C port is the pod's only port: used for flashing **and** for charging (see the power path in the wiring doc). **Remove its red power LED** (or that LED's resistor): it draws continuously and would flatten a 100 mAh cell in days. Its VBUS-to-5V path varies by revision: check it with the 5.0 V / 4.7 V measurement in wiring doc 2.1. |
| P3 | **3.7 V micro LiPo, 100-150 mAh** | **302020** class (~100 mAh) **with a protection PCB**. The name is the bare cell, 3.0 x 20 x 20 mm; **with its protection PCB it can be up to about 22 mm long** (3.0 x 20 x 22 mm overall) | 1 | **Buy by overall length, including the protection PCB, and measure it**, then set `batt` in the pod CAD: the cell and the charger share the body's length, so the extra 2 mm matters (hardware review, Part 2). A 402020 (4 mm, ~150 mAh) needs `batt = [20,20,4]` and `pod = [32,26,15]`. The protection PCB is the only low-cell cut-off: nothing on the pod reads the cell. |
| P4 | **Micro charging circuit**: a small 2-layer board, about **7 x 10 mm** | **MCP73831** (SOT-23-5) single-cell Li-ion linear charger, **two 4.7 µF** 0603 capacitors (input and output), **R_PROG 10 kΩ** 0603. No USB connector of its own | 1 (make 2) | **No ready-made module of 7.5 x 12 mm or smaller was found** (the one sized listing, an LTC4054 board, is 13.4 x 11 mm), so this is a tiny custom PCB: pads for the three passives, VIN, BAT and GND. A SOT-23-5 at 0.95 mm pitch is fine with flux and a fine tip on a real pad layout; it is not practical on perfboard. **R_PROG 10 kΩ sets 100 mA, 1 C for a 100 mAh cell.** If you do use a bought board, set its charge current to 1 C or less: many ship set to 500 mA, which is too much for this cell. |
| P5 | **Schottky diode**, *required to wire the original charging path safely* | Low forward voltage, ≥ 500 mA, **SOD-123: MBR0520 or 1N5819HW** (about 2.7 x 1.6 x 1.1 mm). **Not SS14**: its SMA package is too big for the space | 1 (+1) | **The SuperMini's 5V pin is fed from its USB-C VBUS (directly on many boards, through a diode on some), so without P5 every USB cable would put 5 V, or about 4.7 V, straight onto the cell, bypassing the charger.** Anode at the cell, cathode at the SuperMini's 5V pin: its anode is soldered onto the charger's BAT pad and it sits above the charger (build 5). A DO-41 1N5817 is easier to solder with wire leads, but measure it against that space first. The one part not on the original list; no listed part can do its job (wiring doc 2.1). |

### Mechanical and consumables

| # | Part | Qty | Notes |
|---|---|---|---|
| P7 | **Anti-slip liner**: silicone or neoprene sheet, 0.8 mm thick, self-adhesive if possible | 2 strips, 8 x 42 mm | One per jaw, laid in the recessed band. It stands 0.2 mm proud of the 13.0 mm bore and does the gripping. |
| P8 | **Printed TPU strap** (`shaft_pod_strap_TPU.stl`, section 3) | 1 (print a spare) | **Mandatory: a strap, or the zip ties below.** It hooks over a post on each side face and runs under the shaft between the jaws, holding the shaft up in the C. Reusable. Its hold on a club has not been pull-tested yet. |
| P8a | Zip ties, 2.5 mm wide *(fallback)* | 2 per session (single use) | The tie tunnels and grooves are still there: one through each jaw, closing the C, if the strap is missing or untested on your club. |
| P9 | Foam sheet, 0.5 mm | small piece | Between the cell and the SuperMini, so the lid preloads the stack |
| P10 | Kapton tape | | Between the IMU board and the cell |
| P11 | Silicone wire, 30 AWG | ~30 cm | Internal wiring; the pod is tight |

Part numbers G9, G18-G20, G22-G38, P6 and P12-P15 belonged to parts that are
no longer fitted (battery-sense dividers, buzzer, soft power, pod charging on
the ground unit, and the dock's 1/4"-20 stud bolt, its epoxy and the tripod
clamp). They are not reused, so the remaining numbers
still match older notes.

---

## 3. Printed parts

All from `cad/stl/` (regenerate with `cad/export_stl.sh`). **PETG, ABS or ASA
only**, except the pod strap, which is TPU 95A: see [build_instructions.md](build_instructions.md) for why not PLA and
for the slicer settings.

| File | Unit | Qty | Print orientation (already set in the STL) |
|---|---|---|---|
| `ground_radar_shell.stl` | Ground | 1 | Front face down on a textured sheet; no supports |
| `ground_radar_lid.stl` | Ground | 1 | Outside face down on a textured sheet |
| `ground_radar_radome.stl` | Ground | 1 | Flat, outer face up, ironing on. **Translucent PETG, not carbon-black**: smoke, ice (natural) or amber. This is the one part that can take a colour |
| `ground_radar_led_pipe.stl` | Ground | 1 | Flange down. Natural PETG |
| `ground_radar_esp32_clamp_tab_x2.stl` | Ground | **2** | Flat |
| `ground_radar_dock_base.stl` | Ground | 1 | As it sits. Carries the arm's spine and the pod pocket |
| `ground_radar_arm_slide.stl` | Ground | 1 | Flat, hinge tab up |
| `ground_radar_arm_head_magsafe.stl` | Ground | 1 | On its plain face, ring pocket up |
| `ground_radar_arm_pin.stl` | Ground | 1 (print a spare) | Flat. The 3 mm hinge pin; a 3 mm steel pin or a length of 3 mm rod works too |
| `shaft_pod_base.stl` | Pod | 1 | Standing on its USB end, clamp bore vertical |
| `shaft_pod_lid.stl` | Pod | 1 | Outside face down |
| `shaft_pod_strap_TPU.stl` | Pod | 1 (print a spare) | Flat, outer face down. **TPU 95A, not PETG**: it has to stretch. Its length comes from `shaft_d` |

About **84 g** of filament and **4.9 hours** of printing for both units, with no
supports anywhere. `cad/cost_report.py` estimates it from the STLs and writes
`cad/stl/cost_report.txt`: about $1.69 of filament, $3.84 a kit on your own
printer and $9.53 at a print-farm machine rate, against a $5-10 budget for the printed
parts. Those are estimates, within about 20% of a slice; slice the STLs with
your printer's profile before quoting a price.

## 4. Tools

Soldering iron with a fine tip, flux, side cutters (flush cutters), tweezers,
a multimeter (needed to set the MT3608 to 5.0 V), calipers (to measure your
cells, radar module, TP4056, MT3608, switch and shaft before printing), a
small Phillips screwdriver, and desoldering braid for the IMU's STEMMA QT
sockets (cut their housings and use the iron: no hot air needed).
