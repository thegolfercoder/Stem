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
| G2 | **ESP32-C3 SuperMini** | ESP32-C3, 4 MB flash, USB-C, 22.5 x 18 mm | 1 (+1 spare) | It has no mounting holes. The enclosure holds it with rails, two fixed lips and two printed M2 clamp tabs. |
| G3 | **LM358** dual op-amp pre-amp *(optional)* | DIP-8 or SOIC-8 on a breakout, run from **3.3 V** | 1 | Leave it out if your radar module already has IF amplifiers. **MCP6002** is a drop-in rail-to-rail alternative with more headroom at 3.3 V. Passives are listed under G3a. |
| G3a | Pre-amp passives, for both channels | 2x 10 kΩ (R_in), 2x 200 kΩ (R_f), 2x 82 nF film or C0G (C_in), 2x 56 pF C0G (C_f), 2x 1 kΩ + 2x 4.7 nF (output RC), 27 kΩ + 10 kΩ (bias divider), 10 µF + 100 nF (bias and supply decoupling) | 1 set | One gain stage per channel: x20, 200 Hz to 14 kHz. Built on a **23 x 20 mm** piece of perfboard (9 x 8 holes), with M2 holes 2.5 mm in from each corner. |
| G4 | **3.7 V 1500 mAh LiPo** | 803450 class, about 8 x 34 x 50 mm, **with a protection PCB**, JST-PH 2.0 lead | 1 | The bay fits 50 x 34 x 8 mm with 0.5 mm clearance each side. Cells sold as "1500 mAh" vary; measure before printing. |
| G5 | **TP4056 USB-C charging module** | With DW01A + FS8205 protection (B+/B-/OUT+/OUT- pads), 1 A default (R_PROG 1.2 kΩ) | 1 (+1 spare) | 1 A is 0.67 C for a 1500 mAh cell, which is fine. Its USB-C port lines up with the bottom cutout. |
| G6 | **MT3608 DC-DC boost module** | 2 V-24 V in, adjustable out, **set to 5.0 V** | 1 (+1 spare) | Set it to 5.0 V on the bench **before** connecting anything to its output. It mounts inside the lid. Measure the height of its trimmer and inductor: the CAD assumes 5 mm. |
| G7 | **SPST slide switch** | SS12D00-class (SPDT used as SPST), body about 8.6 x 3.6 x 3.5 mm | 1 (+2 spare) | Sits in the right-side wall pocket, with its lever in the recessed slot. |
| G8 | **5 mm status LED** | Any colour, diffused; plus a **330 Ω** resistor | 1 | Pushed in from inside the top face; its rim sits on the seat. |
| G9 | Battery-sense divider | 2x **100 kΩ** 1%, 1x 100 nF | 1 set | Wired after the switch, so it draws nothing when the unit is off. |

### Fasteners and consumables

| # | Part | Qty | Used for |
|---|---|---|---|
| G10 | **M2 x 6 mm screws**, pan head, thread-forming for plastics (stainless machine screws also work into the 1.7 mm pilots) | **10** (buy 20) | 4 radar module, 4 LM358 board, 2 ESP32 clamp tabs; also the 4 lid screws if no phone mount is fitted |
| G10a | **M2 x 10 mm screws**, pan head | **4** | Phone mount + lid into the lid bosses (they replace the lid's M2 x 6) |
| G11 | Silicone wire, 26-28 AWG, several colours | ~1 m | All internal wiring |
| G12 | Kapton tape | small roll | Insulating the cell where the MT3608 faces it, and the IMU-to-cell contact in the pod |
| G13 | Double-sided foam tape, 1 mm | small piece | Under the cell, so it cannot rattle |
| G14 | Neutral-cure silicone (RTV) | small tube | USB-C receptacle seal, lid seam (optional) |
| G15 | Silicone USB-C dust plug | 1 | Closes the charging port while the unit is on wet grass |
| G16 | **Right-angle USB-C cable** *(optional)* | 1 | Charging while the unit stands in the stand |
| G17 | Heat-shrink, 1.5-3 mm | assorted | Solder joints |

### MagSafe phone mount

| # | Part | Specification | Qty | Notes |
|---|---|---|---|---|
| G18 | **MagSafe-compatible magnet ring** | Aftermarket ring for MagSafe mounts and cases, about 56 mm OD x 45-46 mm ID x 1-1.8 mm, ideally with the separate alignment ("tail") magnet | 1 | Sits in the pocket on the mount plate. **Measure it** and set `ring_od`, `ring_id`, `ring_depth`, `orient_slot` before printing. Rings sold for *phone cases* are made to stick to MagSafe chargers and mounts; one made for a *mount* holds harder. |
| G19 | Thin grip pad | 0.5 mm self-adhesive silicone, rubber or microfibre sheet, cut to the plate | 1 | Covers the ring, stops the phone sliding and protects its back |
| G20 | Two-part epoxy or CA | small | 1 | Holds the ring in its pocket |

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

### Mechanical and consumables

| # | Part | Qty | Notes |
|---|---|---|---|
| P7 | **Anti-slip liner**: silicone or neoprene sheet, 0.8 mm thick, self-adhesive if possible | 2 strips, 8 x 42 mm | One per jaw, laid in the recessed band. It stands 0.2 mm proud of the 13.0 mm bore and does the gripping. |
| P8 | **Zip ties, 2.5 mm wide** | 2 per session (they are single use) | **Mandatory.** One through each jaw's tunnel and groove, closing the C around the shaft. |
| P9 | Foam sheet, 0.5 mm | small piece | Between the cell and the SuperMini, so the lid preloads the stack |
| P10 | Kapton tape | | Between the IMU board and the cell |
| P11 | Silicone wire, 30 AWG | ~30 cm | Internal wiring; the pod is tight |

---

## 3. Printed parts

All from `cad/stl/` (regenerate with `cad/export_stl.sh`). **PETG, ABS or ASA
only**: see [build_instructions.md](build_instructions.md) for why not PLA and
for the slicer settings.

| File | Unit | Qty | Print orientation (already set in the STL) |
|---|---|---|---|
| `ground_radar_shell.stl` | Ground | 1 | Front face down; tree supports under the radar window |
| `ground_radar_lid.stl` | Ground | 1 | Outside face down |
| `ground_radar_esp32_clamp_tab_x2.stl` | Ground | **2** | Flat |
| `ground_radar_stand.stl` | Ground | 1 | Flat. **Required with a phone fitted**, recommended outdoors in any case |
| `ground_radar_magsafe_phone_mount.stl` | Ground | 1 | Flat, lid side down, ring pocket facing up |
| `shaft_pod_base.stl` | Pod | 1 | Standing on its USB end, clamp bore vertical |
| `shaft_pod_lid.stl` | Pod | 1 | Outside face down |

About 60 g of filament for everything, including supports.

## 4. Tools

Soldering iron with a fine tip, flux, side cutters, tweezers, a multimeter
(needed to set the MT3608 to 5.0 V), calipers (to measure your cell, radar
module and shaft before printing), a small Phillips screwdriver, and a hot-air
station or desoldering braid if you are removing the IMU's STEMMA QT sockets.
