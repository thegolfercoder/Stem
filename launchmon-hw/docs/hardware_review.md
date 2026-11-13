# Stem launch monitor: hardware review (original parts only)

Reviewer: hardware. Repo state reviewed: CAD 41c82f1, docs 1157392, firmware 52f7458 (ground fw 0.5, pod fw 0.3).
No repository file was edited.

Scope, as narrowed by the owner. Ground unit: BGT24LTR11 module with built-in IF amps, ESP32-C3 SuperMini,
1500 mAh LiPo, TP4056 USB-C, MT3608 at 5 V, SPST slide switch, 5 mm LED + 330 Ω, M2 x 6 screws. Pod: Adafruit
LSM6DS3TR-C / LSM6DSOX, SuperMini, 100-150 mAh LiPo, micro charger, plus the Schottky P5.

Notation. "Verified" means a cited datasheet or listing gives the figure. "Seller range" means listings disagree and the
range is given. "Unverified" means I found no source; the value must be measured. Positions are the CAD's own
coordinates.

---

## 0. Summary: what blocks a build

1. **Radar (Part 1). No BGT24LTR11 board I could find both fits this enclosure and covers 200 Hz-15 kHz out of the box.**
   - The only board that fits the 25.4 mm window is the main board of Infineon's **Sense2GoL**. It is 25 x 25 mm and has a
     two-stage op-amp IF chain. Its stock IF band is **23 Hz-1.8 kHz**, which is too narrow: a 70 m/s ball is 11.3 kHz.
     It also needs 0402-size rework, and Arrow lists the kit as obsolete.
   - The only Infineon board whose stock band covers the ball is the **Distance2GoL BGT24LTR11 shield** (7-15 kHz, 57 dB).
     It is a 66 mm Arduino-style shield and does not fit the enclosure.
   - Seeed's **Grove Doppler Radar** is in stock and puts amplified I/Q on a header. It is 40 x 40 mm, does not fit the
     body, and Seeed publishes no IF bandwidth.
   - So dropping the pre-amp means one of three things: a reworked Sense2GoL (end-of-life part), an enclosure redesign
     around a bigger board, or keeping an amplifier stage.
2. **MT3608 height.** The CAD allows 5.0 mm of parts above its PCB (`mt_parts_h`). Three listings give the module as
   **14 mm** tall overall, and one gives 7 mm. Anything over about 8 mm overall fails the cell + MT3608 depth stack, by up to
   about 3.6 mm.
3. **Pod charger.** I found no off-the-shelf charger board within the CAD's **7.5 x 12 mm** (`chg`). The one sized listing
   (LTC4054) is 13.4 x 11 mm. On top of that, a 302020 cell with its protection PCB is probably about 22 mm long, not 20.
   With both, "cell + charger along X" goes from +0.3 to about -1.7 mm.
4. **TP4056 module length.** Listings give 28-29 mm. The pocket's upper stop is set for 28.0, so a 29 mm module does not
   go in (-0.75 mm).
5. **Pod P5.** **One diode is genuinely unavoidable.** The reasons are in 3.3. P5 has no reserved space in the pod CAD;
   it fits above the charger.

---

## Part 1. A radar module with built-in IF amplification

### 1.1 What the design needs

- Doppler at 24.125 GHz is 160.9 Hz per m/s. That puts a club at 40-55 m/s at 6.4-8.9 kHz, and a ball at 70-85 m/s at
  11.3-13.7 kHz.
- The firmware analyses 200 Hz-15 kHz at 40 kS/s per channel (wiring doc 1.3). Its Nyquist frequency is 20 kHz.
- The ESP32-C3 ADC reads 0-2500 mV at 12 dB attenuation ([ESP-IDF, C3 ADC](https://docs.espressif.com/projects/esp-idf/en/v4.4.5/esp32c3/api-reference/peripherals/adc.html)).
  The pin may never exceed 3.3 V.
- The bare chip's mixer outputs are biased at 1.6-2.0 V with a µV-mV signal on top
  ([AN615, p.13-14](https://www.infineon.com/assets/row/public/documents/30/42/infineon-an615-bgt24ltr11-demo-distance2gol-applicationnotes-en.pdf)).
  The chip's own conversion gain is about 20 dB ([UG133248](https://www.infineon.com/assets/row/public/documents/30/44/infineon-ug133248-user-guide-to-bgt24ltr11n16-usermanual-en.pdf)).
  A bare board straight into the ADC therefore resolves nothing useful.

### 1.2 Purchasable BGT24LTR11 boards with IF amplifiers

| Board | IF chain (stock) | Output level / bias | Supply | Size, holes, antenna side, connector | Availability | Fits the enclosure? |
|---|---|---|---|---|---|---|
| **Sense2GoL** main board (DEMOSENSE2GOLTOBO1). Break off the SEGGER debugger section | 2 x OPA2376. Stage 1: x10 (100k/10k), Cf 150 pF. Stage 2: x39 (390k/10k), Cf 220 pF. Total **52 dB, -3 dB at 23 Hz-1.8 kHz** ([AN597 Table 1, Fig. 14-15](https://www.macnica.com/content/dam/macnicagwi/apac/macnicacytech/public/en/downloads/downloads/Infineon-S2GL-Application-Note-AN597-ApplicationNotes-v01-02-EN.pdf)). My recomputation from the schematic gives 1.80 kHz, which agrees | Referenced to 1.65 V. Op-amps on 3.3 V, rail-to-rail, 10 Ω output resistors (R13/R21). So **0-3.3 V, safe for the pin** | 3.3-5.5 V (5 V typ) into a dual LDO (TLV7113333) on VCC_5V_EXT, J3 pin 3. 140 mA with all blocks and the debugger. Without the debugger: BGT 45 mA + op-amps 5 mA + XMC1302 9.6 mA ≈ 60 mA (AN597 Table 6 and note) | **25 x 25 mm** (AN597 Fig. 4). Thickness unverified. **One plated hole is visible in the render, not dimensioned; no four corner holes.** Patch antennas on the side away from the components. 9-pin 2.54 mm header J3 along one 25 mm edge: 1 DIV_OUT, 2 GND, 3 VCC_5V_EXT, 4 VTUNE (NC by default), 5 IFQ_HG, 6 IFI_HG, 7-9 GPIO. Passives look 0402 in the render (unverified) | Arrow: **obsolete**. RS: no longer stocked. Some DigiKey regions list a 97-week lead time | Yes: 25 mm suits the 25.4 mm window, if the header is removed |
| **Distance2GoL BGT24LTR11 shield**, sold only in DEMO DISTANCE2GOL (DEMODISTANCE2GOLTOBO1) | Two stages. Low-gain 30 dB, high-gain **57 dB, -3 dB 7-15 kHz**. Falls about 40 dB/decade below 7 kHz, so 3 kHz is about 15 dB down ([AN615 Table 1, Fig. 11](https://www.infineon.com/assets/row/public/documents/30/42/infineon-an615-bgt24ltr11-demo-distance2gol-applicationnotes-en.pdf)) | HG AC-coupled at 1.65 V. LG at the mixer bias (1.6-2.0 V). 3.3 V op-amps | 3.3-5.5 V into an on-board LDO. 50 mA | **66 mm** wide Arduino-shield outline; the other dimension is not given. Antennas on the underside. Needs logic lines driven: VCC_BGT_EN, TX_EN, BB1_EN, IF_S&H_EN, VCC_DIV_EN. VTUNE comes from the baseboard's DAC | DigiKey shows stock in some regions. RS: temporarily out | **No** |
| **Sense2GoL Pulse** shield (same PCB family) | 59 dB, **16-420 Hz** ([AN598](https://www.infineon.com/assets/row/public/documents/30/42/infineon-an598-bgt24ltr11-demo-sense2gol-pulse-applicationnotes-en.pdf)) | 1.65 V | 3.3-5.5 V | 66 mm shield | Kit only | No, on both size and band |
| **Seeed Grove Doppler Radar** (109020021). XMC1302 + BGT24LTR11 | "Second gain stage" I/Q on header pins 5/6, with the same pin names as Sense2GoL ([Seeed wiki](https://wiki.seeedstudio.com/Grove-Doppler-Radar/)). **Gain and bandwidth not published.** It is probably derived from Sense2GoL, which is an inference only | Unverified | 3.3-5 V. Pin 3 external 5 V, max 5.5 V | **40 x 40 mm** (retailer, [Botland](https://botland.store/grove-distance-sensors/17023-grove-doppler-radar-bgt24ltr11-24ghz-transceiver-10m-seeedstudio-109020021-5903351247030.html)). Holes unverified | In stock at several retailers | **No**: see 1.5 |

I found no third-party (for example AliExpress) BGT24LTR11 board with documented amplified I/Q.

### 1.3 Recommendation

**First choice, the only one that fits the current CAD: the Sense2GoL main board, reworked for golf.** Stock, its 1.8 kHz
low-pass would attenuate the ball band by tens of dB. Rework per channel (designators from AN597 Fig. 14):

| Part (I / Q) | Stock | Change to | Effect |
|---|---|---|---|
| C36 / C37 (stage 2 feedback) | 220 pF | **82 pF** (with R24/R33 at 100k) | Stage-2 pole 1.85 → 19.4 kHz |
| R24 / R33 (stage 2 feedback) | 390 kΩ | **100 kΩ** | Stage-2 gain x39 → x10. Total x400 → **x100 (40 dB)**. The stock 52 dB would likely clip on the golfer at 1.4 m. Start here and tune from captures |
| C35 / C34 (stage 1 feedback) | 150 pF | **47 pF** | Stage-1 pole 10.6 → 33.9 kHz |
| C18 / C23 (stage 2 input) | 1 µF | **82 nF** (optional) | High-pass 16 → 194 Hz, matching `BAND_LOW_HZ` 200. Keeps body motion from using up headroom |

- Result: -3 dB at about **15.6 kHz** (-2.5 dB at 14 kHz) and -6.5 dB at 26 kHz. Anti-aliasing stays modest, as in the old
  design.
- Minimal alternative that keeps the stock gain: C36/C37 → 27 pF and C35/C34 → 56 pF. That gives -3 dB at 12.4 kHz, so
  a 85 m/s ball is about 3.6 dB down.
- The OPA2376's 5.5 MHz GBW is ample at x10-x39 and 15 kHz.
- Caveats: these are 0402-class parts (from the render, unverified), so this is skilled rework. The kit is end-of-life.

**Alternative: Distance2GoL shield.** Its stock band (7-15 kHz, 57 dB) suits the ball and club with no rework. However:

- It needs an enclosure redesign around a 66 mm board.
- Its control lines must be tied to their active levels.
- VTUNE must be held so the carrier stays in band. Infineon drives it from the baseboard DAC; with no baseboard, VTUNE
  must be tied to V_PTAT as in [UG133248 4.1](https://www.infineon.com/assets/row/public/documents/30/44/infineon-ug133248-user-guide-to-bgt24ltr11n16-usermanual-en.pdf).
- Its strong high-pass shape suppresses slow targets below about 5 kHz. That is fine for the ball and probably for the
  club, but check `club_speed` on real swings.

**If neither is acceptable,** the honest answer is that "no pre-amp" does not hold. Keep a small 3.3 V dual op-amp stage
(the old LM358/MCP6002 design) or design a custom BGT24LTR11 board.

### 1.4 Wiring with the Sense2GoL main board (original parts only)

| Sense2GoL J3 | To | Notes |
|---|---|---|
| 3 VCC_5V_EXT | **5 V rail** (MT3608 VOUT+, via the SuperMini 5V pad) | On-board LDO. Never above 5.5 V. Set the MT3608 to 5.0 V before connecting |
| 2 GND | SuperMini GND | Twist with the IF pair |
| 6 IFI_HG | **GPIO0** directly | 1.65 V bias. Rail-to-rail from 3.3 V, so it cannot exceed the pin rating |
| 5 IFQ_HG | **GPIO1** directly | as above |
| 1, 4, 7, 8, 9 | not connected | VTUNE is NC at J3 unless R38 is fitted (AN597 4.9) |

- **Bias and level.** The swing above the 1.65 V bias is only 0.85 V before the ADC clips at 2.5 V, against 1.65 V below.
  Clipping is safe but asymmetric.
  - With original parts only: keep the gain at x100 (above) and let the firmware flag clipped captures.
  - Optional, needs owner approval because it adds parts: 10 kΩ series + 33 kΩ to GND + 680 pF C0G at each ADC pin.
    This maps 0-3.3 V onto 0-2.53 V, moves the bias to 1.27 V and adds a third pole at about 30 kHz.
- **RC anti-alias.** Not needed for pin safety. The reworked module has two poles, at about 19 and 34 kHz. The RC above
  is the only cheap way to add a third.
- **BGT power on the Sense2GoL.** The XMC1302 switches the BGT through PMOS Q1 from P0.6, which is active low with a
  pull-down. Fitting R109 (0 Ω) bypasses Q1 (AN597 4.7). The demo firmware may duty-cycle the BGT, and the debugger is
  broken off, so it cannot be reflashed easily. **Fit R109 (0 Ω)**, or check on a scope that IFI_HG is continuous.
- **Supply.** The 5 V rail feeds it directly whenever the switch is on: original wiring, no enable. GPIO5 stays unused
  (`PIN_RADAR_EN = -1`). It draws about 60 mA at 5 V, about 0.1 A extra from the cell through the MT3608.

### 1.5 CAD implications

**Sense2GoL main board, in `cad/script_ground_radar.scad`:**

- `radar_pcb = [25.4, 25.4, 1.6]` → `[25.0, 25.0, <measured t>]`. The 25.0 is verified; the thickness is unverified.
- `radar_holes`: the four-corner M2 pattern does not exist on this board. Replace `radar_posts()` with a frame:
  - Keep the four post stubs as rests on the `ledge_pad` corners.
  - Add two printed clips, or a screwed retaining bar, that bear on the board's rear corners.
  - Verify the one plated hole first; if it lands on a post pad, one M2 screw can be used.
- `radar_back_clear = 3.0`: keep it only with **J3's header removed**. A fitted header (2.5 mm housing + about 6 mm pins
  on the component side) needs about 8.5 mm. That makes `radar_back_y` about 23.3 against `y_back` 18.6: "depth behind
  radar module" goes from +0.63 to about **-4.7 FAIL**.
- **Orient J3 at the top edge (high Z).** There the leads run straight to the SuperMini (about 4 cm), away from the TP4056
  and MT3608, and the joints face the open lid side.
- Window alignment: centre the 25.0 board on `win_cx = 76.1` and the window's mid-height. The 1x4 TX and RX patch arrays
  then sit inside the 25.4 aperture.
- `radar_gap = 6.2` stays: it is measured to the antenna face.
- BOM G10's "4 radar module" screws become 0-1.

**Grove, for the record.** With `radar_pcb` 40 x 40 and the same 15° tilt:

- `radar_back_y` = (1 + 6.2 + 1.6 + 3)·cos15 + 40·sin15 ≈ 21.75 against `y_back` 18.6: **-3.2 FAIL**.
- The board's top edge would reach Z ≈ 71.6 against `body_h` 64.
- It needs a deeper and taller body.

---

## Part 2. Component size audit (original parts)

### Ground unit

| Part | Real size (source) | CAD parameter, value | Mismatch → correction | Fit-report consequence |
|---|---|---|---|---|
| Radar module | Sense2GoL 25 x 25 mm, one hole, header on one edge (1.2-1.5) | `radar_pcb = [25.4, 25.4, 1.6]`, `radar_holes = [[±10.2, 2.5], [±10.2, 22.9]]`, `radar_back_clear = 3.0` | `[25.0, 25.0, t]`. Holes do not exist: change the mount. Header removed | "radar posts on their corner pads" and "radar post pilot" need rewriting for a clip mount. "depth behind radar module" 0.63 holds only with the header removed |
| ESP32-C3 SuperMini | 22.52 x 18 mm, 16 pins at 2.54 mm in two rows of 8 ([espboards](https://www.espboards.dev/esp32/esp32-c3-super-mini/)). Rows reported about 15.24 mm apart. Pin order from the USB end: 5V, GND, 3V3, 4, 3, 2, 1, 0 and 5, 6, 7, 8, 9, 10, 20, 21 ([studiopieters](https://www.studiopieters.nl/esp32-c3-super-mini-pinout/)). **PCB thickness and the first pin's distance from the USB edge: unverified.** One source gives 4.5 mm overall, which may imply a 1.2 mm PCB with a 3.26 mm receptacle | `esp_pcb = [22.52, 18.0, 1.0]`, `esp_usb = [8.94, 3.26]` | Plan and pitch OK. Measure the thickness. Add `esp_pin1_x` (first pin centre from the USB edge) so rails and tabs can be checked (Part 3) | A 1.2 mm PCB adds 0.2 mm to the clamp-tab stack. The pod stack margin 0.74 → 0.54 |
| SuperMini clones | Seeed XIAO ESP32C3 (21 x 17.8, different pinout), Waveshare ESP32-C3-Zero, "SuperMini Plus" with IPEX: not drop-in. Some SuperMini revisions route VBUS through a diode (PD1) to the 5V pin, others do not ([Arduino forum](https://forum.arduino.cc/t/use-usb-type-c-from-esp32-c3-super-mini-to-power-tp4056/1278810)) | | **Specify** "ESP32-C3 SuperMini, ceramic antenna, 22.5 x 18 mm, 16 pins". Measure the 5V pin with USB only: about 5.0 V means no diode, about 4.7 V means a diode | none |
| TP4056 USB-C + DW01A/FS8205 | 28-29 x 17-17.4 x 4.1-4.9 mm (seller range). AZ-Delivery datasheet: **29 x 17.3 x 4.3 mm** ([PDF](https://cdn.shopify.com/s/files/1/1509/1638/files/TP4056-TypeC_datasheet.pdf)). Addicore micro-USB version: 28 x 17 mm ([listing](https://www.addicore.com/TP4056-Charger-and-Protection-Module-p/ad310.htm)). The photo shows the receptacle at the edge, slightly proud. A 4.3 mm overall height with a 3.2-3.3 mm top-mount receptacle suggests a **1.0 mm PCB** (inference) | `tp_pcb = [17.5, 28.0, 1.6]`, `tp_usb_h = 3.3`, upper stop at `z_floor + tp_pcb[1] + fit_clear` | Overall length **28 → 29.0**. Add `tp_usb_overhang` (measure) and put the stop at `z_floor + overall + fit_clear`. Measure the thickness: 1.6 → likely 1.0 | A 29 mm module **does not go in: -0.75 mm against the stop** (no fit line checks this). "radar module above TP4056" 1.34 → 0.34. With a 1.0 mm PCB the lid presser rib (`tp4056_presser`) ends 0.8 mm off the receptacle instead of 0.2: the module is not held. The USB cutout centre `tp_usb_y` drops 0.3 mm |
| TP4056 micro-USB variant | 28 x 17 (Addicore) | | Do not use: the bottom cutout is shaped for USB-C | |
| MT3608 boost | **36 x 17 x 14 mm** ([Mantech/EIE](https://mantech.co.za/datasheets/products/mt3608-180219a.pdf), Sigmanortec). **37.2 x 17.2 x 14.0** ([Components101](https://components101.com/modules/mt3608-2a-dc-dc-step-up-power-module)). **37 x 17 x 7** ([ProtoSupplies](https://protosupplies.com/?p=7451)). Multi-turn trimmer, about 15 turns (Mantech). Its height is not given separately. The photo shows a standing block trimmer. I found no verified 30 x 17 variant | `mt_pcb = [36.0, 17.0, 1.6]`, `mt_parts_h = 5.0` | Plan: **`mt_pcb` → [37.5, 17.5, 1.6]** to take 36-37.2. Height: **must measure**. Parts above the PCB allowed = 16.2 − (8.0 + 0.2 + 1.6) = **6.4 mm** (overall ≤ 8.0 mm) | A 37.2 board hits the fence's corner returns (-0.7). At 14 mm overall, "cell + MT3608 depth stack" 1.4 → about **-4.6 FAIL**. At 7 mm overall it is about +0.4. See Part 4 for fixes |
| 1500 mAh LiPo, 803450 | Sellers: 8 x 34 x 50 ([ampul](https://www.ampul.eu/en/battery/4157-li-pol-battery-1500mah-37v-803450), [ormix](https://ormix.lv/en/product/32856)). EEMB LP803450 bare cell **8.3 x 34.5 x 52.0** ([EEMB](https://www.eemb.com/product-215)). The protection PCB is often inside the 50 or 52 | `batt = [50.0, 34.0, 8.0]`, `batt_clear = 0.5`, `batt_pos = [10.4, 2.4]` | **`batt` → [52.0, 34.5, 8.3]** (worst listed). The bay cannot move left: the lid boss at (8, 8) sits 0.1 mm from the cell. **`tp_x` 64.25 → 65.9** (the room is there now the buzzer is gone; check the TP4056's lower-right corner against the R9.6 inner corner) | "battery bay to TP4056 guide" 0.4 → **-1.6 FAIL** unless `tp_x` moves. "cell + MT3608 depth stack" -0.3. "divider to ESP32 board" 2.4 → 1.9 |
| LiPo lead | BOM: JST-PH 2.0. The TP4056 has solder pads only | none | The BOM has no mating JST-PH pigtail. Either cut the plug and solder the leads (state it), or add a pigtail (extra part) | none |
| SS12D00 slide switch | Seller: body 8 x 4 x 3.8 mm, 2.54 mm pitch, 3 mm terminals, 0.5 A 50 V DC ([listing](https://elektronicavoorjou.nl/en/?p=39142941)). The suffix G2/G3/G4/G5 is the lever length class; lever length is unverified | `sw_body = [8.7, 3.7, 3.7]` (Y-long, Z, X-depth), `sw_slot = [4.6, 2.2]` | **`sw_body` → [8.8, 4.1, 3.9]**. Specify the lever: the tip protrudes (lever length − 1.4 mm) into the 1.0 mm outer recess, so a 2 mm lever sits 0.6 below the face. Measure | No fit line covers the switch. The pocket is 0.3 mm tight in Z as drawn |
| Switch current | About 0.26 A at the MT3608 input (radar 60 mA + ESP32 about 100 mA at 5 V, through about 85% efficiency, from 3.7 V). BLE peaks higher | | Within the 0.5 A seller rating | |
| 5 mm LED + 330 Ω | Standard T-1¾: 5.0 mm dome, about 5.8 mm flange, about 8.6 mm to the flange. Not sourced here; check the LED's own drawing. 1/4 W axial resistor about 6 x 2.3 mm | ghost `d = 5, h = 8.6`, `pipe_flange = [6.0, 0.8]`, seat d 6.3 | None | "light pipe flange to ESP32 board" 2.6 unchanged |
| M2 x 6 pan head | ISO 7045 / DIN 7985 M2: **dk 4.0, k 1.6** ([Westfield](https://www.westfieldfasteners.co.uk/A2_ScrewBolt_PhilRaPan_M2.html)) | `m2_head_d = 4.4`, `m2_head_h = 1.2`, lid 2.4 | **`m2_head_h` → 1.6.** As drawn, the lid screw heads stand 0.4 mm proud of the flat lid. That leaves 0.8 mm of lid under the head; acceptable for PETG, but do not over-tighten | none (no fit line) |
| USB-C plug at the bottom cutout | The receptacle face sits at the inner wall face, 2.4 mm behind the outside. A plug's overmold must enter the 11.5 x 6.0 cutout to seat fully. Overmold sizes vary by cable (unverified) | `usb_cut = [11.5, 6.0]`, `wall = 2.4` | Add a 0.6-1.0 mm outer recess like the pod's `usb_port()`, or test with the cables the owner uses | Add a fit line: "plug engagement" |

### Pod

| Part | Real size (source) | CAD parameter, value | Mismatch → correction | Fit-report consequence |
|---|---|---|---|---|
| Adafruit LSM6DS3TR-C #4503 | **25.3 x 17.8 x 4.6 mm** ([Adafruit 4503](https://www.adafruit.com/product/4503)). 4.6 includes the STEMMA QT sockets (4.6 − 1.6 = 3.0, against `imu_stemma_fitted` 2.95) | `imu_pcb = [25.4, 17.8, 1.6]` | OK | |
| Adafruit LSM6DSOX #4438 | **25.6 x 17.8 x 4.6 mm** ([Adafruit 4438](https://www.adafruit.com/product/4438)) | same | **`imu_pcb[0]` → 25.6.** At 25.4, the end crush ribs (0.25 mm each) squeeze a 25.6 board by 0.4 mm | "IMU board inside the walls (X)" 1.1 → 0.9 |
| IMU tallest part, sockets removed | Unverified (regulator and level-shifter FETs) | `imu_parts_h = 1.2` | Measure; it must include the solder joints on the pads (Part 3) | stack margin 0.74 |
| SuperMini | as above | `esp_pcb [22.52, 18, 1.0]`, `esp_usb_overhang = 0.5` (unverified) | Measure the thickness and the overhang | A 1.2 mm PCB: stack 0.74 → 0.54 |
| 302020 LiPo, about 100 mAh | Name = bare cell 3.0 x 20 x 20. By the supplier convention, the protection PCB adds about 2 mm in length, e.g. 402025 → 27 x 20 x 4 with PCM ([probots](https://probots.co.in/3-7v-150mah-lipo-battery-402025-open-ended.html)). **So about 3.0 x 20 x 22 mm, unverified** | `batt = [20.0, 20.0, 3.0]` | Measure, and buy by overall length including the PCM | "cell + charger along X" +0.3 → about **-1.7 FAIL** at 22 mm |
| Micro charger | No listing ≤ 7.5 x 12 mm found. The one sized listing is LTC4054, 13.4 x 11 x 3.3 mm ([Electrokit](https://www.electrokit.com/lipo-laddare-1-cell-ltc4054)). The chips themselves are SOT-23-5 (MCP73831, TP4054) | `chg = [7.5, 12.0, 3.0]` | The spec may not be buyable. See Part 4: a tiny custom board, or more body length | 13.4 x 11 → -3.2 mm along X |
| P5 Schottky | The BOM allows SS14, MBR0520 or BAT60A. SOD-123 bodies are about 2.7 x 1.6 x 1.1 mm; SMA is much larger (package sizes not sourced here) | none: no ghost, no space, no fit line | Reserve the space above the charger (Part 3.3) and add a fit line | new |

### Dock and arm: not electronics

The magnet ring (`ring_od` 56.5, `ring_id` 45.5, `ring_depth` 1.8) is marked "measure" in the BOM. It is not audited here.
The 1/4"-20 bolt is gone.

---

## Part 3. Solderability: original joints, current CAD and assembly order

### 3.1 Ground unit

**Current order** (build 4): TP4056 sealed in → radar screwed → SuperMini clamped → LED glued → switch glued → step 6
"wire up" in place → cell → MT3608 on the lid. Every joint is made in the box. Most can be reached with the lid off, but
several are better made on the bench.

| Joint | Problem in the current layout | Fix (most important first) |
|---|---|---|
| TP4056 B+, B-, OUT+, OUT- | Once seated, these pads sit at Z ≈ 29-31, directly under the radar module's lower edge, which is 1.34 mm above (less with a 29 mm module). The receptacle end is siliconed in step 1, so heat later can lift the RTV seal | **Pre-wire all four pads on the bench before step 1**, with 8-10 cm leads, heat-shrink and a dab of hot glue. Pads with 26 AWG are easy |
| Cell → TP4056 B+/B- | The JST-PH lead has no mate in the BOM | Cut and solder **one lead at a time**: tin, solder, heat-shrink, then the next, so the cut ends never touch. Use 1-2 s at about 330 °C. Do not heat the cell's PCM. Do it last, after everything else is wired. Or add a JST-PH pigtail (BOM) |
| Slide switch | Small legs, low-temperature body. In the pocket the legs face inward, toward the TP4056 lead bundle | **Solder both wires before pressing it into the pocket**: common and one end, and clip the third leg. Max 3 s per leg, 1.5 mm heat-shrink on each. CA only after the joints are cool |
| MT3608 (4 pads, lid) | Fine on the bench | Set 5.0 V first (bench test 1), then solder its four 8 cm leads before step 8. Mark the trimmer with paint so it cannot drift |
| Radar module (J3: 5V, GND, IFI, IFQ) | A fitted header breaks the depth stack (1.5). The joints face the lid | **Remove the header** (cut the pins, desolder one by one, wick). Pre-wire the 4 leads on the bench, IF pair twisted with GND. Mount with J3 at the top. Joint + wire must stay within `radar_back_clear` 3.0 |
| SuperMini pads (5V ×2 wires, GND ×2, GPIO0, GPIO1, GPIO10) | (a) The **rails** (`esp32_mount`, 2 mm wide at x0+1..3 and x0+L−3..L−1, across the full width) run under the short ends. If pin 1 sits about 2.4 mm from the USB edge (unverified), pins 1 and 8 sit right over the rails, and a PTH joint's underside bump would rock the board. (b) The **clamp tabs** overlap the board's far 1.5 mm at Z = z0+1.5 and z0+16.5, i.e. over the pin rows. **GPIO0 (IFI) is pin 8, at the far end**, so its joint and wire are likely under a tab. (c) The 5 mm LED body (X 19.9-25.7, Y 10-16) hangs over pins 4-5 of the upper row. Those pins are unused, but it blocks the iron | CAD: shorten both rails in Z to between the pin rows (z0+3 to z0+W−3), and move the tabs inboard to z0+4.5 / z0+W−4.5, clear of pin 8. Add fit lines "rail clear of pin rows" and "tab clear of pin 8" using a new `esp_pin1_x`. Order: **pre-wire the SuperMini on the bench**, top-side joints, wires bent inward along the board, then mount. Glue the LED last. At most two wires per pad: splice the LED cathode onto the radar GND lead under heat-shrink |
| LED + 330 Ω | Fine on the bench | Resistor inline on the anode lead, heat-shrink. Solder before gluing to the light pipe |

**Test points.**

- Switch: TP4056 OUT+ at its input. Expect 3.0-4.2 V.
- 5 V rail: the SuperMini 5V pad. Expect 5.0 V.
- IF: GPIO0 and GPIO1. Expect a steady 1.65 V; it moves when you wave a hand (bench test 2 already says this).

### 3.2 Pod

**Current order** (build 5): IMU wired → IMU in its pocket → Kapton, cell, charger → P5 inline → foam → SuperMini → lid.

| Joint | Problem | Fix |
|---|---|---|
| STEMMA QT removal | Hot air near the IMU chip is risky for a hobbyist | Cut the plastic housings with flush cutters, then lift each pin and the two mechanical lugs with the iron and wick. No hot air |
| IMU pads (VIN, GND, SCL, SDA, INT1), 30 AWG | They are plated through-holes, so solder wicks to the underside, which is the datum. The pad row runs along a long edge, under the cell, and the joints share the 1.2 + 0.1 mm budget (`imu_parts_h` + Kapton). The pocket's finger gaps are on the short ends, not on the pad side | Lap-solder on top without pushing the wire into the hole. Check the underside; flush-cut and file any bump. Keep each joint ≤ 1.0 mm high (calipers). CAD: **add a 6-8 mm wire notch in the IMU fence on the pad-row side**. The wires then go up the 1.35 mm side gap between fence and wall, outside the cell's footprint |
| SuperMini (5V ×2, GND ×2, 3V3, GPIO3, GPIO6, GPIO7) | The lid's side fences (`esp32_retainer`) start at x0+6 and stand 0.2 mm off the board edges up to the lid, so wires from pins 3 onward cannot leave sideways. The lid's corner pads at x0+9.5 and x0+L−2.2 sit on the pin rows (pins 4 and 8: unused now) | Pre-solder all six on the bench, top side. Route the wires flat across the board top to the USB-end corners, avoiding the four pad footprints. CAD: add **1.5 mm wire notches in the side fences** at pins 3 and 5, or start the fences at x0+14. Move the corner pads inboard (y0+3..5) so a future GPIO4 or GPIO0 wire is not crushed |
| Charger | No ≤ 7.5 x 12 board found. A bare SOT-23-5 on perfboard is not practical | Use a tiny 2-layer PCB, about 7 x 10 mm: MCP73831 + 2 x 4.7 µF 0603 + 10 kΩ R_PROG 0603. A SOT-23-5 at 0.95 mm pitch is fine with flux and a fine tip on a real pad layout. Or see Part 4 for more room |
| **P5, inline in the cell's + lead** | No reserved space or ghost. A 30 AWG splice to a SOD-123's flat tabs is fiddly. SMA (SS14) is too big | Solder **P5's anode onto the charger's BAT pad**, next to the cell's + lead, before the cell is connected. Run 30 AWG from the cathode to the SuperMini 5V pad. Heat-shrink over P5. **Place it above the charger**, X about 25.3-30.4, Z 7.1-11.3 under the lid lip. That is the old D2 space; the old fit lines gave about 1.4 mm along X and 1.8 mm in height to spare for a SOD-123. Prefer **MBR0520 or 1N5819HW (SOD-123)**. A DO-41 1N5817 (about 2.7 mm diameter) is easier to solder with wire leads, but measure it against that space first |
| Cell leads | The PCM sits beside the charger | Solder the cell **last**, one lead at a time. Then run bench test 4: with USB in, cell + ≤ 4.2 V |
| Stack | 0.74 mm margin under the lid. It drops to 0.54 with a 1.2 mm SuperMini PCB, and to about 0.4 with a 3.3 mm cell | Measure before printing. The 0.5 mm foam absorbs some |

### 3.3 The pod power path: is P5 unavoidable? **Yes. One diode is the minimum.**

- **Where the cell must connect.** The ESP32 can be fed only at the 5V pin, which is the LDO input, or at 3V3.
  - 3V3 is out: a 4.2 V cell exceeds the C3's 3.0-3.6 V supply range ([ESP32-C3-MINI-1 datasheet](https://staars.github.io/docs/_media/datasheets/esp32-c3-mini-1_datasheet_en.pdf)),
    and it would back-drive the SuperMini's LDO.
  - So the cell must reach the 5V pin.
- **What happens without a diode.**
  - On a SuperMini whose 5V pin is VBUS: every USB cable puts 5 V straight onto the cell. The current is limited only by
    the host, and the cell's protection IC is left as the charge regulator.
  - On a revision with PD1 between VBUS and the 5V pin: about 4.7 V reaches the cell the same way.
  - In both cases the charger's input and output are tied together, so it cannot regulate. **Unsafe either way.**
- **Load-sharing charger.** It does not remove the diode. Its system output has to drive the 5V pin, which is VBUS: with
  USB in, that node is driven from outside; on battery, it puts the full cell voltage on VBUS. Such boards are also
  larger than 7.5 x 12 mm.
- **Charger with its own USB-C.** It does not remove the diode either. The SuperMini's USB-C remains as the flashing port,
  and plugging it in still meets the cell. It would also need a second port in the case.
- **Why P5 is correct.** With P5, the ESP32 load sits on VBUS while USB is in, so the charger sees only the cell and
  terminates properly.
- **What P5 leaves.**
  - On boards without PD1, the USB-C VBUS contact sits at the cell voltage less 0.3 V on battery. This is harmless to a
    powered host; the cell drains into one that is switched off. The docs already warn about this.
  - Brownout below a cell of about 3.4-3.7 V, because P5 drops 0.3 V and the LDO has some dropout. There is no cell
    reading, so the protection PCB is the only floor.

---

## Part 4. Prioritised change list

### P0: blocking

| # | Change | File(s) |
|---|---|---|
| 1 | Decide the radar module. **Option A:** Sense2GoL main board, rework per 1.3, fit R109, J3 header removed; write it into G1 with the rework table and an "end-of-life, source second-hand" note. **Option B:** redesign the enclosure for the Distance2GoL shield. **Option C:** reinstate an amplifier stage | `docs/bill_of_materials.md` (G1), `docs/wiring_schematic.md` 1.2-1.3, `docs/build_instructions.md` 3.2 |
| 2 | MT3608 height. Add to G6: "overall ≤ 8.0 mm (parts ≤ 6.4 mm above the PCB), or replace the trimmer". Set `mt_pcb = [37.5, 17.5, 1.6]` and `mt_parts_h` to the measured value. If too tall, either buy a low-profile module, or set 5.0 V and replace the trimmer with a fixed resistor of the measured value (adds a part: owner approval needed) | `cad/script_ground_radar.scad`, BOM G6, build 0 |
| 3 | TP4056: `tp_pcb[1]` 28.0 → 29.0, new `tp_usb_overhang`, stop at overall length. Measure `tp_pcb[2]` (likely 1.0). Add fit lines "TP4056 fits under its stop" and "presser rib to receptacle" | `cad/script_ground_radar.scad` (`tp4056_pocket`, `tp4056_presser`, `fit_report`) |
| 4 | Cell: `batt = [52.0, 34.5, 8.3]` (or measured), `tp_x` 64.25 → 65.9. Add a fit line "TP4056 corner inside the R9.6 corner" | `cad/script_ground_radar.scad`, BOM G4 |
| 5 | Pod charger and cell. Respecify P4 as a buildable part (a custom 7 x 10 mm MCP73831 board, or whatever is actually sold ≤ 7.5 x 12). Specify P3 by **overall length with PCM ≤ 20.4 mm**, or make room for 22 mm: `pod[0]` 32 → 34 (re-run the strap and jaw fit lines), or stand the charger on edge at the +X end, now free of park parts | BOM P3/P4, `cad/script_shaft_imu.scad` (`batt`, `chg`, `pod`) |

### P1: buildability

| # | Change | File(s) |
|---|---|---|
| 6 | Add `esp_pin1_x` (measured). Shorten the rails to between the pin rows, move the clamp tabs inboard to z0+4.5 / z0+W−4.5, and add fit lines for rails, tabs and pin 8 | `cad/script_ground_radar.scad` (`esp32_mount`, `esp32_tab_z`, `fit_report`) |
| 7 | Pod lid: wire notches in the side fences (or start them at x0+14); corner pads off the pin rows | `cad/script_shaft_imu.scad` (`esp32_retainer`) |
| 8 | Pod IMU fence: wire notch on the pad-row side | `cad/script_shaft_imu.scad` (`imu_pocket`) |
| 9 | Reserve P5: ghost "p5" above the charger, and fit lines "P5 along X" and "P5 under the lid lip" | `cad/script_shaft_imu.scad` |
| 10 | Radar mount: replace the four-hole posts with corner rests and clips for a hole-less 25 x 25 board; `radar_pcb = [25.0, 25.0, t]` | `cad/script_ground_radar.scad` (`radar_posts`, parameters) |
| 11 | `sw_body = [8.8, 4.1, 3.9]`. Specify the lever length in G7 | scad, BOM G7 |
| 12 | `imu_pcb[0]` 25.4 → 25.6 | `cad/script_shaft_imu.scad` |
| 13 | `m2_head_h` 1.2 → 1.6 | `cad/script_ground_radar.scad` |
| 14 | Ground USB-C: add an outer overmold recess (0.6-1.0 mm), or a "plug engagement" fit line | `cad/script_ground_radar.scad` (`usb_c_cutout`) |

### P2: documents and BOM

| # | Change | File(s) |
|---|---|---|
| 15 | Ground build order: new step 0 "bench harness". Pre-wire the TP4056 (4 leads), switch, MT3608, radar (header off), SuperMini and LED + resistor. Then mount. Cell joints last, one lead at a time. Drop "wire up in place" | `docs/build_instructions.md` 4 |
| 16 | Pod build order: IMU (lap joints, underside checked flat) → SuperMini pre-wired → charger with P5's anode on BAT → cell last → bench test 4 → assemble | `docs/build_instructions.md` 5 |
| 17 | BOM P5: name the packages that fit (MBR0520 or 1N5819HW SOD-123; DO-41 1N5817 only if it fits) and drop SS14 (SMA) | BOM P5 |
| 18 | G4/G5: say "cut the JST-PH plug and solder to B+/B-", or add a mating pigtail | BOM, build 4 |
| 19 | Wiring 2.1: SuperMini VBUS→5V is revision-dependent (PD1 on some boards). Add the 5.0 V / 4.7 V measurement. P5 is needed either way | `docs/wiring_schematic.md` 2.1 |
| 20 | Wiring 1.3/1.4: Sense2GoL pinout table (1.4 above), 1.65 V bias, the clip headroom (0.85 V above the bias), and the optional 10k/33k/680 pF network marked as needing owner approval | `docs/wiring_schematic.md` |
| 21 | Firmware: no size-driven change. Check `RECEDING_SIGN` (build 4.3) and that captures flag ADC clipping at about 2.5 V | `firmware/ground_unit/ground_unit.ino` (check only) |

---

## Sources

- Infineon AN615, Distance2GoL / BGT24LTR11 shield: https://www.infineon.com/assets/row/public/documents/30/42/infineon-an615-bgt24ltr11-demo-distance2gol-applicationnotes-en.pdf
- Infineon AN598, Sense2GoL Pulse shield: https://www.infineon.com/assets/row/public/documents/30/42/infineon-an598-bgt24ltr11-demo-sense2gol-pulse-applicationnotes-en.pdf
- Infineon AN597, Sense2GoL (Macnica mirror): https://www.macnica.com/content/dam/macnicagwi/apac/macnicacytech/public/en/downloads/downloads/Infineon-S2GL-Application-Note-AN597-ApplicationNotes-v01-02-EN.pdf
- Infineon UG133248, BGT24LTR11N16 user guide: https://www.infineon.com/assets/row/public/documents/30/44/infineon-ug133248-user-guide-to-bgt24ltr11n16-usermanual-en.pdf
- Availability: https://www.arrow.com/en/products/demosense2goltobo1/infineon-technologies-ag , https://uk.rs-online.com/web/p/communication-wireless-development-tools/1462591 , https://www.digikey.co.uk/en/products/detail/infineon-technologies/DEMODISTANCE2GOLTOBO1/14321762
- Seeed Grove Doppler Radar: https://wiki.seeedstudio.com/Grove-Doppler-Radar/ ; size: https://botland.store/grove-distance-sensors/17023-grove-doppler-radar-bgt24ltr11-24ghz-transceiver-10m-seeedstudio-109020021-5903351247030.html
- ESP32-C3 ADC range: https://docs.espressif.com/projects/esp-idf/en/v4.4.5/esp32c3/api-reference/peripherals/adc.html
- ESP32-C3 supply range: https://staars.github.io/docs/_media/datasheets/esp32-c3-mini-1_datasheet_en.pdf
- SuperMini: https://www.espboards.dev/esp32/esp32-c3-super-mini/ , https://www.studiopieters.nl/esp32-c3-super-mini-pinout/ , https://forum.arduino.cc/t/use-usb-type-c-from-esp32-c3-super-mini-to-power-tp4056/1278810 , https://components101.com/development-boards/esp32c3-mini-development-board-datasheet-pinout
- TP4056: https://cdn.shopify.com/s/files/1/1509/1638/files/TP4056-TypeC_datasheet.pdf , https://www.addicore.com/TP4056-Charger-and-Protection-Module-p/ad310.htm
- MT3608: https://mantech.co.za/datasheets/products/mt3608-180219a.pdf , https://components101.com/modules/mt3608-2a-dc-dc-step-up-power-module , https://protosupplies.com/?p=7451
- 803450 cell: https://www.eemb.com/product-215 , https://www.ampul.eu/en/battery/4157-li-pol-battery-1500mah-37v-803450 , https://ormix.lv/en/product/32856
- 302020 PCM convention: https://probots.co.in/3-7v-150mah-lipo-battery-402025-open-ended.html
- Charger module size: https://www.electrokit.com/lipo-laddare-1-cell-ltc4054
- Adafruit IMUs: https://www.adafruit.com/product/4503 , https://www.adafruit.com/product/4438
- SS12D00: https://elektronicavoorjou.nl/en/?p=39142941
- M2 pan head (ISO 7045 / DIN 7985): https://www.westfieldfasteners.co.uk/A2_ScrewBolt_PhilRaPan_M2.html
