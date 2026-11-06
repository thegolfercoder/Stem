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

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G1 | **Infineon BGT24LTR11** 24 GHz radar module | Dual-channel I/Q CW Doppler, 24.00-24.25 GHz ISM band, IFI and IFQ outputs | 1 | The enclosure assumes a 25.4 x 25.4 mm board with M2 holes 2.5 mm in from each corner. **Measure yours** and set `radar_pcb` and `radar_holes` in the CAD before printing. The BGT24LTR11 chip runs on 3.3 V. Feed the module's 5 V pin only if it has its own 3.3 V regulator (see the wiring doc). |
| G2 | **ESP32-C3 SuperMini** | ESP32-C3, 4 MB flash, USB-C, 22.5 x 18 mm | 1 (+1 spare) | It has no mounting holes. The enclosure holds it with rails, two fixed lips and two printed M2 clamp tabs. **Remove its red power LED** (or its resistor): with soft power the board is always powered, and the LED draws about 1 mA. |
| G3 | **LM358** dual op-amp pre-amp *(optional)* | DIP-8 or SOIC-8 on a breakout, run from **3.3 V** | 1 | Leave it out if your radar module already has IF amplifiers. **MCP6002** is a drop-in rail-to-rail alternative with more headroom at 3.3 V. Passives are listed under G3a. |
| G3a | Pre-amp passives, for both channels | 2x 10 kΩ (R_in), 2x 200 kΩ (R_f), 2x 82 nF film or C0G (C_in), 2x 56 pF C0G (C_f), 2x 1 kΩ + 2x 4.7 nF (output RC), 27 kΩ + 10 kΩ (bias divider), 10 µF + 100 nF (bias and supply decoupling) | 1 set | One gain stage per channel: x20, 200 Hz to 14 kHz. Built on a **23 x 20 mm** piece of perfboard (9 x 8 holes), with M2 holes 2.5 mm in from each corner. |
| G4 | **3.7 V 1500 mAh LiPo** | 803450 class, about 8 x 34 x 50 mm, **with a protection PCB**, JST-PH 2.0 lead | 1 | The bay fits 50 x 34 x 8 mm with 0.5 mm clearance each side. Cells sold as "1500 mAh" vary; measure before printing. |
| G5 | **TP4056 USB-C charging module** | With DW01A + FS8205 protection (B+/B-/OUT+/OUT- pads), 1 A default (R_PROG 1.2 kΩ) | 1 (+1 spare) | 1 A is 0.67 C for a 1500 mAh cell, which is fine. Its USB-C port lines up with the bottom cutout. |
| G6 | **MT3608 DC-DC boost module** | 2 V-24 V in, adjustable out, **set to 5.0 V** | 1 (+1 spare) | Set it to 5.0 V on the bench **before** connecting anything to its output. It mounts inside the lid. Measure the height of its trimmer and inductor: the CAD assumes 5 mm. |
| G7 | **SPST slide switch** | SS12D00-class (SPDT used as SPST), body about 8.6 x 3.6 x 3.5 mm | 1 (+2 spare) | Sits in the right-side wall pocket, with its lever in the recessed slot. With soft power it is a **logic switch** (microamps), same part and pocket. |
| G8 | **5 mm status LED** | Any colour, diffused; plus a **330 Ω** resistor | 1 | Sits inside, under the printed light pipe, which shows it as a flush 2.8 mm dot on the top face. |
| G9 | Battery-sense divider | 2x **1 MΩ** 1%, 1x 100 nF | 1 set | On the cell all the time (soft power): 1.9 µA. |

### Buzzer

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G29 | **Bare piezo disc** | 15 mm brass, 0.3 mm, about 10 mm ceramic, with leads | 1 (+1 spare) | Glued **by its rim only**, brass face to the wall, on the frame inside the left end wall. Glued over its whole face it can barely flex and is nearly silent. It sounds through four of the grip-rib grooves, which are cut through. |
| G30 | 470 Ω resistor | 0603, 0805 or through-hole | 1 | In series between GPIO7 and the disc (why: wiring doc, section 1.6) |

### Soft power (charging while switched off)

The switch becomes a logic input; "off" is deep sleep, about 53 µA in all
(estimated). Circuits and reasons: wiring doc, section 1.7.

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G33 | AO3400A N-MOSFET | SOT-23 | 1 (+1) | MT3608 ground switch (Q3) |
| G34 | AO3401A P-MOSFET | SOT-23 | 1 (+1) | Radar and pre-amp supply switch (Q4); a second one (Q8) for a radar module fed from 5 V |
| G35 | BSS138 N-MOSFET | SOT-23 | 3 (+1) | Switch inverter, pod detector, USB detector (Q5-Q7) |
| G36 | BAT54C and BAT54A | SOT-23 dual Schottky | 1 each | OR onto Q3's gate (D3); keeps the two wake pulses apart (D4) |
| G37 | Soft-power passives | 47k, 470k, 3x 100k, 7x 1M, 100 nF, 2x 47 nF (0603). For a 5 V radar module add a 2N7002 and 2x 100k | 1 set | Values and roles: wiring doc 1.7 |
| G38 | Perfboard about 20 x 15 mm, or a 15 x 12 mm two-sided PCB | | 1 | The power/wake board, on the lid beside the protection board |

### Pod park and charging

The pod hangs in a socket under a small hood on the unit's lid, held by
magnets, and charges through two spring pins. The parts on the unit's side are
below. The pod's side is P12-P15.

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G22 | AO3401A P-MOSFET | SOT-23 | 1 (+1) | High-side switch for the pins |
| G23 | 2N7002 N-MOSFET | SOT-23 | 1 (+1) | Gate driver. Not a BSS138: its threshold is too low for the margin against the boot pull-up |
| G24 | PTC resettable fuse | 1206, 0.20 A hold, trips at 0.5 A or less, 6 V or more (Bourns MF-NSMF020X-2, Littelfuse 1206L020 or similar) | 1 (+1) | Bounds a fault. The pod's charger sets the normal current (about 0.1 A) |
| G25 | 5 V ESD diode | SOD-323, PESD5V0S1BA or similar | 1 | On the +5 V pin, which can be touched |
| G26 | Protection passives | 100 kΩ, 2x 10 kΩ, 470 kΩ 1%, 330 kΩ 1%, 47 nF, 10 nF (0603/0805) | 1 set | Values and roles: wiring doc, section 4 |
| G27 | Perfboard or a small PCB | about **15 x 12 mm** | 1 | Glued in the pocket on the lid's inside face (15.4 x 12.4 mm, 4 mm deep) |
| G28 | **Spring (pogo) pins**, solder tail | about 2.0 mm barrel, 6 mm long, 1 mm stroke | 2 | Pressed into the hood, 6 mm apart. **Measure the pins you buy** and set `pod_park_pogo` in the CAD before printing |
| G31 | **N52 disc magnets, 4 x 2 mm** | | 2 | In the hood's socket floor. The pod has the other two (P13) |
| G32 | M2 x 6 mm screws | as G10 | 2 | Hood to lid, driven from inside the lid (counted in G10) |

### Fasteners and consumables

| # | Part | Qty | Used for |
|---|---|---|---|
| G10 | **M2 x 6 mm screws**, pan head, thread-forming for plastics (stainless machine screws also work into the 1.7 mm pilots) | **18** (buy 25) | 4 radar module, 4 LM358 board, 2 ESP32 clamp tabs, 4 lid, 2 dock stem into its base, 2 pod park hood |
| G11 | Silicone wire, 26-28 AWG, several colours | ~1 m | All internal wiring |
| G12 | Kapton tape | small roll | Insulating the cell where the MT3608 faces it, and the IMU-to-cell contact in the pod |
| G13 | Double-sided foam tape, 1 mm | small piece | Under the cell, so it cannot rattle |
| G14 | Neutral-cure silicone (RTV) | small tube | USB-C receptacle seal, lid seam (optional) |
| G15 | Silicone USB-C dust plug | 1 | Closes the charging port while the unit is on wet grass |
| G16 | Clear silicone or epoxy | small | Seats the radome on its ledge, and the LED against the light pipe |
| G17 | Heat-shrink, 1.5-3 mm | assorted | Solder joints |

### Dock

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G18 | **1/4"-20 x 1/2" hex bolt**, steel | 7/16" hex head, about 4 mm tall | 1 | Glued head-down in the hex pocket under the stem's cap with epoxy. Its thread stands 5.5 mm proud, the standard for a tripod screw. |
| G19 | Two-part epoxy | small | 1 | Holds the bolt |
| G20 | Smartphone tripod clamp with a 1/4"-20 socket *(optional)* | Any spring clamp for phones about 55-95 mm wide | 1 | Screws onto the stud and holds a phone of any size as a results screen facing the golfer. Not for filming: see below. |
| G21 | Silicone bumper feet, 8 mm, self-adhesive | 4 | Under the dock base: grip on hard floors and hitting mats |

**MagSafe-ring head instead of the stud** *(optional)*: print
`ground_radar_dock_stem_magsafe.stl` in place of `ground_radar_dock_stem.stl`
and add an aftermarket MagSafe-compatible magnet ring (about 56 mm OD x 45-46 mm
ID x 1-1.8 mm, ideally with its alignment magnet; **measure it** and set
`ring_od`, `ring_id`, `ring_depth`, `orient_slot`), a 0.5 mm grip pad cut to the
ring, and epoxy. It holds iPhones and phones in MagSafe cases with nothing
else to buy.

### Filming the swing (not part of the kit)

| Part | Notes |
|---|---|
| Any tripod or light stand reaching about 1 m | The camera goes about 3 m behind the ball at hip height, not on the unit. |
| A 1/4"-20 phone clamp, or a tablet clamp for an iPad | Standard clamps fit every phone and tablet, with or without MagSafe. |

---

## 2. Shaft motion pod

### Core electronics

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| P1 | **Adafruit LSM6DS3TR-C** 6-DoF IMU (#4503) **or LSM6DSOX** (#4438) | Gyro up to ±2000 dps, accel up to ±16 g, I²C at 0x6A/0x6B, STEMMA QT, **25.4 x 17.8 mm** | 1 | The firmware detects which one it has. The default enclosure assumes the two **STEMMA QT sockets are removed** and the board is wired on its 0.1" pads, because the sockets add 1.75 mm the 14 mm body does not have. To keep them, set `imu_stemma_fitted = true` and raise `pod` height to the value the fit report gives. |
| P2 | **ESP32-C3 SuperMini** | as G2 | 1 | Its USB-C port is the pod's only port: used for flashing **and** for charging (see the power path in the wiring doc). **Remove its red power LED** (or that LED's resistor): it draws continuously and would flatten a 100 mAh cell in days. |
| P3 | **3.7 V micro LiPo, 100-150 mAh** | **302020** class (3.0 x 20 x 20 mm, ~100 mAh) **with a protection PCB** | 1 | This is what the 14 mm body fits. A 402020 (4 mm, ~150 mAh) needs `batt = [20,20,4]` and `pod = [32,26,15]`. |
| P4 | **Micro charging circuit** | Single-cell Li-ion linear charger, MCP73831 or TP4054 class, on a board no bigger than 7.5 x 12 mm, no USB connector of its own | 1 | **Set the charge current to 1 C or less: 100 mA for a 100 mAh cell, which is R_PROG = 10 kΩ for both chips.** Many small boards ship set to 500 mA, which is too much for this cell. |
| P5 | Schottky diode | Low forward voltage, ≥ 500 mA: SS14, MBR0520, BAT60A or similar | 1 | Battery → SuperMini 5 V pin, so USB power can never back-feed the cell. |
| P6 | Battery-sense divider | 2x **1 MΩ** 1%, 1x 100 nF | 1 set | High value so it draws about 2 µA from the cell in deep sleep. The 100 nF gives the ADC a low-impedance source. |

### Charging on the ground unit

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| P12 | Schottky diode (D2) | B5819WS (SOD-323) or 1N5819HW (SOD-123), 40 V | 1 | From the + contact (anode) to the SuperMini's 5V pin. It keeps the cell and the pod's own USB off the contact. A 40 V part leaks less than the low-voltage ones |
| P13 | **N52 disc magnets, 4 x 2 mm** | | 2 | Behind the +X end wall, under a 0.4 mm skin. They face the hood's magnets with opposite poles, so the pod only parks one way round |
| P14 | **M2 x 4 brass cheese-head screws** (DIN 84) | | 2 | The pod's contacts, in the +X end. The one by the debossed "+" is +5 V. **Measure the heads** and set `pod_park_pad` in the CAD |
| P15 | Beacon and sense parts | 220 kΩ, 2.2 MΩ 1%, 1 MΩ 1%, 100 nF | 1 set | The 220 kΩ lets the ground unit see a parked pod before it powers the pins; the divider lets the pod see dock power (wiring doc, section 4) |

The pod's IMU (P1) has no magnetometer, so the magnets do not disturb it. Do
not swap in a 9-axis IMU with a magnetometer.

### Mechanical and consumables

| # | Part | Qty | Notes |
|---|---|---|---|
| P7 | **Anti-slip liner**: silicone or neoprene sheet, 0.8 mm thick, self-adhesive if possible | 2 strips, 8 x 42 mm | One per jaw, laid in the recessed band. It stands 0.2 mm proud of the 13.0 mm bore and does the gripping. |
| P8 | **Zip ties, 2.5 mm wide** | 2 per session (they are single use) | **Mandatory.** One through each jaw's tunnel and groove, closing the C around the shaft. |
| P9 | Foam sheet, 0.5 mm | small piece | Between the cell and the SuperMini, so the lid preloads the stack |
| P10 | Kapton tape | | Between the IMU board and the cell |
| P11 | Silicone wire, 30 AWG (Kynar wire-wrap wire for the contact leads) | ~40 cm | Internal wiring; the pod is tight |

---

## 3. Printed parts

All from `cad/stl/` (regenerate with `cad/export_stl.sh`). **PETG, ABS or ASA
only**: see [build_instructions.md](build_instructions.md) for why not PLA and
for the slicer settings.

| File | Unit | Qty | Print orientation (already set in the STL) |
|---|---|---|---|
| `ground_radar_shell.stl` | Ground | 1 | Front face down on a textured sheet; no supports |
| `ground_radar_lid.stl` | Ground | 1 | Outside face down on a textured sheet |
| `ground_radar_radome.stl` | Ground | 1 | Flat, outer face up, ironing on. **Translucent PETG, not carbon-black**: smoke, ice (natural) or amber. This is the one part that can take a colour |
| `ground_radar_led_pipe.stl` | Ground | 1 | Flange down. Natural PETG |
| `ground_radar_esp32_clamp_tab_x2.stl` | Ground | **2** | Flat |
| `ground_radar_dock_base.stl` | Ground | 1 | As it sits |
| `ground_radar_dock_stem.stl` | Ground | 1 | Flat, front face down on a textured sheet, stud cap up. Or `ground_radar_dock_stem_magsafe.stl` for the MagSafe-ring head |
| `ground_radar_pod_park_hood.stl` | Ground | 1 | Rear face down on a textured sheet; no supports |
| `fit_test_coupon.stl` | Test | 1, once per printer; not part of a kit | Flat as exported, no supports. **Print it first** (build instructions, section 2). Keep its loose key for setting the hood's pins |
| `shaft_pod_base.stl` | Pod | 1 | Standing on its USB end, clamp bore vertical |
| `shaft_pod_lid.stl` | Pod | 1 | Outside face down |

About **71 g** of filament and **4.2 hours** of printing for both units, with no
supports anywhere. `cad/cost_report.py` estimates it from the STLs and writes
`cad/stl/cost_report.txt`: about $1.45 of PETG, $3.30 a kit on your own printer
and $8.10 at a print-farm machine rate, against a $5-10 budget for the printed
parts. Those are estimates, within about 20% of a slice; slice the STLs with
your printer's profile before quoting a price.

## 4. Tools

Soldering iron with a fine tip, flux, side cutters, tweezers, a multimeter
(needed to set the MT3608 to 5.0 V), calipers (to measure your cell, radar
module and shaft before printing), a small Phillips screwdriver, and a hot-air
station or desoldering braid if you are removing the IMU's STEMMA QT sockets.
