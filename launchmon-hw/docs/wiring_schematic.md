# Wiring, pinouts and power paths

Two separate units, wired independently. **They share no wires and exchange
data only over BLE.** Each has its own cell and charges from its own USB-C
port.

```
   GROUND RADAR UNIT                                       SHAFT MOTION POD
   (on the ground, behind the ball)                        (clipped to the shaft)
  +---------------------------------+                    +---------------------------+
  | BGT24LTR11 -> LM358 pre-amp ->  |  <~~~ BLE 5.0 ~~~> | LSM6DS3TR-C -> ESP32-C3    |
  | ESP32-C3 ADC                    |   pod = peripheral | 100-150 mAh LiPo,          |
  | 1500 mAh LiPo, TP4056, switch,  |   ground = central | micro charger              |
  | MT3608 at 5 V, status LED       |                    |                           |
  | BLE central (pod) + peripheral  |                    | USB-C (SuperMini):        |
  | (phone)                         |                    | flashing and charging     |
  +---------------------------------+                    +---------------------------+
          |                  |            ~~~ BLE ~~~> phone (optional, shot summaries)
          |                  +-- SuperMini USB-C (inside, lid off): flashing, JSON lines, raw I/Q
          +-- TP4056 USB-C (bottom): charging
```

The electronics are exactly the owner's parts list (see
[bill_of_materials.md](bill_of_materials.md)). The pod also has one Schottky
diode, P5: section 2.1 explains why its charging path cannot be wired safely
without it.

---

## 1. Ground radar unit

### 1.1 Power path

```
                     +-------------- TP4056 USB-C module (with DW01A/FS8205) --------------+
   USB-C 5 V in ---> | IN                                                                   |
   (bottom cutout)   |   B+  B-                                    OUT+          OUT-       |
                     +---|---|-----------------------------------------|-------------|-------+
                         |   |                                         |             |
              LiPo + ----+   +---- LiPo -                              |             |
              3.7 V 1500 mAh, protected                                |             |
                                                                       |             |
                                     SPST slide switch (right side) ---+             |
                                                 |                                   |
                                                 v                                   |
                                   +--- MT3608 boost, set to 5.0 V ---+              |
                                   | VIN+                       VOUT+ |---+          |
                                   | VIN-                       VOUT- |---|---+      |
                                   +----------------------------------+   |   |      |
                                                                          |   |      |
   5 V rail  <------------------------------------------------------------+   |      |
   GND rail  <----------------------------------------------------------------+------+
```

| From | To | Notes |
|---|---|---|
| LiPo + / - | TP4056 **B+ / B-** | The protection chip sits between B- and OUT-. **Never** connect a load to B+/B-. |
| TP4056 **OUT+** | slide switch, one end | |
| slide switch, common | MT3608 **VIN+** | The switch cuts everything after the TP4056 |
| TP4056 **OUT-** | **GND rail**, MT3608 **VIN-** and **VOUT-** | One ground for everything |
| MT3608 **VOUT+** (5.0 V) | **5 V rail**: SuperMini **5V** pin, and the radar module's 5 V pin (1.3) | |
| SuperMini **3V3** pin | Pre-amp V+ (LM358 pin 8), bias divider (1.4), radar **VCC** if the module is 3.3 V only (1.3) | The SuperMini's regulator makes 3.3 V from its 5V pin and supplies the whole analogue side |

How it behaves:

- **On.** The cell runs the MT3608, which makes 5 V for the SuperMini and the
  radar module. The SuperMini's regulator feeds the pre-amp 3.3 V.
- **Off.** Nothing after the switch has power. The only drain is the TP4056
  module's and the cell's own protection, a few microamps.
- **Charging.** USB-C into the TP4056 charges the cell at 1 A, switch on or
  off. Switch the unit **off** to charge: with the unit running, its load keeps
  the TP4056's current above the end-of-charge threshold, so it holds the cell
  at 4.2 V instead of finishing.

**Set the MT3608 before connecting anything to it.** Power its input from the
cell, turn the trimmer until a multimeter reads 5.0 V at VOUT+, then wire it as
above. A new MT3608 often comes set well above 5 V.

**Flashing.** Switch the unit on. The SuperMini's USB 5 V and the MT3608's 5 V
meet at the SuperMini's 5V pin, and the MT3608's output diode blocks reverse
current into it. Switched off, the laptop's USB powers the SuperMini and the
radar (and, through its 3V3 pin, the pre-amp) through the 5V pin; the cell is
not involved.

**No battery reading.** No part on the list measures the cell, so the firmware
reports none (0, "not read"). The TP4056 module's DW01A cuts the cell off when
it is flat, about 2.4 V, and the unit stops. Charge it after each session; the
module's LED shows red while charging and blue or green when done.

### 1.2 Signal wiring (SuperMini pins)

| SuperMini pin | Direction | Connects to | Notes |
|---|---|---|---|
| **GPIO0** (ADC1_CH0) | in | Pre-amp channel I output (radar **IFI** through the LM358, 1.4) | Sampled at 40 kS/s |
| **GPIO1** (ADC1_CH1) | in | Pre-amp channel Q output (radar **IFQ** through the LM358) | Sampled 12.5 µs after I; the firmware corrects the skew |
| **GPIO10** | out | **330 Ω** → 5 mm LED anode; cathode → GND | Status LED in the top face. The resistor sets the LED's current (1.5) |
| **GPIO5** | out | Radar module enable, **if it has one** | Off by default (`PIN_RADAR_EN = -1`) |
| **GPIO9** | in | On-board BOOT button | Short press toggles raw USB streaming |
| **GPIO20 / GPIO21** | UART0 RX / TX | Auxiliary serial (`Serial1`, 115200 8N1) | Spare: debug, or a radar board with a digital interface |
| **5V / GND** | power | as 1.1 | |
| **3V3** | power out | Pre-amp V+ and bias divider (1.4); a bare 3.3 V radar board (1.3) | |
| GPIO2, GPIO8 | - | **leave unconnected** | Strapping pins. GPIO8 also drives the on-board LED |
| GPIO3, GPIO4, GPIO6, GPIO7 | - | unused | |
| GPIO18 / GPIO19 | - | (USB D- / D+) | Used by USB-C; do not connect |

Only ADC1 is used. On the C3, ADC2 is unreliable and is not used for anything.
Run the radar → pre-amp → ESP32 leads short (about 3 cm), twisted with a
ground wire, and away from the MT3608 and its leads.

### 1.3 Radar module supply: check before connecting

The radar module is a plain BGT24LTR11 board: its IFI and IFQ outputs go to
the LM358 pre-amp (1.4), not straight to the ESP32. A bare BGT24LTR11 puts out
IF signals of microvolts to millivolts, too small for the ESP32's 12-bit ADC;
the pre-amp brings them up and band-limits them. (The hardware review,
[hardware_review.md](hardware_review.md) Part 1, found no BGT24LTR11 board that
fits this unit and covers the ball's Doppler band without an amplifier stage,
so the pre-amp stays: owner's decision, 2026-11-09.)

The **BGT24LTR11 chip is a 3.3 V part**. Boards built around it come two ways:

- **With an on-board 3.3 V regulator** and a 5 V or VIN pin: feed it from the
  **5 V rail**. This is what the brief's "5 V to radar" means.
- **Bare 3.3 V board**: feed it from the **SuperMini 3V3 pin**. **Never** from
  5 V: that destroys the chip.

Check the board's schematic or measure: a regulator is usually a SOT-23-5 or
SOT-89 part next to the power pin. Some boards also expose **VTUNE** (the VCO
tuning input) and a divided-down frequency output. The carrier has to stay
inside the 24.00-24.25 GHz ISM band. Follow the module vendor's guidance for
VTUNE. The firmware assumes 24.125 GHz, and a carrier offset scales every
speed by the same ratio: 120 MHz off is 0.5%.

### 1.4 Pre-amp: one stage per channel, 3.3 V single supply

Fitted (owner's decision, 2026-11-09; 1.3 says why). It is drawn for channel
I; channel Q is identical, on the LM358's second op-amp. **MCP6002** is a
drop-in rail-to-rail alternative with more headroom at 3.3 V (BOM G3).

```
                         C_f 56p
                     +----||-----+
                     |           |
                     +--/\/\/\---+          R_f 200k
                     |   200k    |
   radar IFI         |           |
   ---||-----/\/\/\--+---|-\     |
      82n     10k        |  >----+----/\/\/\----+------> GPIO0 (ADC1_CH0)
     C_in    R_in    +---|+/  LM358A    1k      |
                     |                         === 4.7n
          V_bias ----+                          |
          0.9 V                                GND

   V_bias:  3V3 ---/\/\/\---+---/\/\/\--- GND        LM358 pin 8 -> 3V3, pin 4 -> GND
                    27k     |     10k                100 nF from pin 8 to GND, close to the chip
                            +--- 10 uF --- GND
                            +--> to both op-amps' (+) inputs
```

| Quantity | Value | From |
|---|---|---|
| Gain | -20 (26 dB) | R_f / R_in |
| High-pass corner | 194 Hz | 1 / (2π · 10k · 82n). Matches `passband_low_hz: 200` in launchmon-py's `hardware.yaml` |
| Low-pass corner | 14.2 kHz | 1 / (2π · 200k · 56p). Matches `passband_high_hz: 15000` |
| Output RC pole | 34 kHz | 1k / 4.7 nF. A second, gentle anti-alias pole before the ADC |
| Output range | 0.9 V ± 0.9 V | The LM358's output reaches about V+ − 1.5 V. At 3.3 V supply that is 1.8 V, inside the ADC's ~2.5 V range at 12 dB attenuation |

Notes:

- **Why 3.3 V and not 5 V:** an LM358 on 5 V can swing to about 3.5 V, above
  the C3's absolute maximum input. At 3.3 V it cannot exceed the ADC pin's
  rating, whatever the radar does.
- **Gain:** if the signal is too small, a second identical stage (on a second
  LM358, or use an LM324) gives x400. If strong returns clip, lower R_f.
  launchmon-py's SNR sweep found the pipeline needs about +6 dB of in-band ball
  SNR with a 1024-point window. That is the target, not a promise.
- **Anti-aliasing is modest.** The ADC samples each channel at 40 kS/s
  (Nyquist 20 kHz), and two gentle poles do not stop everything above 25 kHz
  folding back into the band. Keep IF leads short and twisted with ground.
  That is why the pre-amp sits between the radar and the ESP32.

### 1.5 Status LED

The 5 mm LED needs its series resistor: a GPIO driving an LED directly would
push as much current as the pin can source, over the LED's rating and the
pin's. With 330 Ω from a 3.3 V pin:

| LED colour | Forward voltage, about | Current |
|---|---|---|
| Red, yellow, green (standard) | 1.8-2.2 V | 3.3-4.5 mA: bright enough behind the light pipe |
| Blue, white | 2.8-3.2 V | 0.3-1.5 mA: dim. Use 100 Ω instead for 1-5 mA |

The patterns are in the firmware README ("Ground unit status LED").

### 1.6 Mechanical placement of wires

- Radar → pre-amp → ESP32 runs left-to-right along the top of the case in that
  order, so the analogue leads are about 3 cm long.
- Cell leads leave the battery bay through the gap in its right-hand fence,
  toward the TP4056.
- The MT3608 sits on the lid, so its four wires need enough slack (about 8 cm)
  for the lid to lie open beside the shell.
- The switch's two wires run from the TP4056 to the right-side wall pocket and
  back to the MT3608's lead on the lid.

---

## 2. Shaft motion pod

### 2.1 Power path

The original path is micro LiPo → charger → ESP32. One USB-C port, the
SuperMini's own, flashes and charges the pod.

```
   USB-C (SuperMini) ---> SuperMini 5V pin --+--------------------> charger VIN
   (VBUS; through a diode                    |                      (MCP73831 / TP4054,
    on some revisions)                       |                       R_PROG 10k = 100 mA)
                                             |                       charger BAT ---+
                                             |                                      |
                                             +----|<|---- Schottky P5 ---------------+---- LiPo +
                                                 (cathode at 5V pin,                       (100-150 mAh,
                                                  anode at the cell)                        protected)
   All grounds common: charger GND, LiPo -, SuperMini GND, IMU GND.
```

| From | To | Notes |
|---|---|---|
| SuperMini **5V** pin | charger **VIN** (VDD), and P5's **cathode** | The 5V pin is the USB-C VBUS, directly or through a diode depending on the board revision (below) |
| charger **BAT** | LiPo + and P5's **anode** | |
| LiPo - | charger GND, SuperMini GND | |
| SuperMini **3V3** | IMU **VIN** (2.2) | |

How it behaves:

- **USB plugged in.** The 5V pin sits at about 5 V (about 4.7 V on a board
  with a VBUS diode, below) and powers the SuperMini.
  The charger charges the cell at 100 mA. P5 is reverse-biased (5 V on its
  cathode, at most 4.2 V on its anode), so USB reaches the cell only through
  the charger.
- **On battery.** The cell feeds the 5V pin through P5 (about 0.3 V drop). The
  SuperMini's regulator makes 3.3 V from that. The charger sees its input below
  the cell voltage and shuts down; its BAT pin draws only microamps of reverse
  leakage.

**P5 is required to wire the original charging path safely: the SuperMini's
5V pin is fed from its USB-C VBUS, so without P5 every USB cable would put
5 V straight onto the cell, bypassing the charger.**

**The SuperMini's VBUS-to-5V path varies by revision.** On many boards the 5V
pin is VBUS directly; others put a diode (PD1) between them. Check yours before
wiring: with only a USB cable plugged in (nothing else on the board), measure
the 5V pin to GND. **About 5.0 V** means no diode; **about 4.7 V** means a
diode. P5 is needed either way: with the diode, about 4.7 V would still reach
the cell without P5, and the charger's input and output would still be tied
together. The reading also tells you what the USB-C port does on battery
("What P5 does not do", below): with no diode its VBUS contact sits at the
cell voltage less P5's drop; with one, the board's own diode blocks that path.

Why no listed part can do P5's job:

- The ESP32 can only be fed through the 5V pin (which is VBUS) or the 3V3 pin.
  A LiPo is 3.0-4.2 V, over the ESP32-C3's 3.6 V maximum on 3V3, so the cell
  has to reach the 5V pin. Something between the two must block USB's 5 V from
  the cell, and the charger's BAT pin is only a charge output: MCP73831 and
  TP4054 boards have no load output to take power from.
- A **load-sharing (power-path) charger** does not remove it. Its system output
  would still have to feed the 5V pin. With USB in, that output is driven from
  outside by VBUS, and on battery it puts the cell on VBUS, which is what P5
  does anyway. Fitting one also means a different, larger board in a pocket
  sized for 7.5 x 12 mm.
- A **charger with its own USB-C** does not remove it either. The SuperMini's
  USB-C is still the flashing port, and plugging it in would still put 5 V on
  the cell. It would also need a second port in the pod's case.

What P5 does not do: it does not keep the cell off the USB-C connector. On a
board with no VBUS diode (5.0 V above), on battery, the VBUS contact of the pod's USB-C sits at the cell voltage less
about 0.3 V. Plugged into a powered charger or computer, that port's 5 V is
higher and nothing flows. **Plug the pod only into something powered.**
Plugged into a switched-off device, the cell can drain into it through P5.
Closing that direction too would need a part on the VBUS side of the SuperMini
(and rework of the board), which the list does not have. If a USB-C-to-C
charger does not start charging the pod, try a USB-A charger with an A-to-C
cable: a C source may wait for VBUS to read 0 V before it switches on.

**No battery reading.** The pod has no battery-sense divider. Its status
packet's `battery_mv` is 0 ("not read"), and it has no cell-low sleep. As the
cell runs down the 3.3 V rail sags once the 5V pin falls below about 3.4 V
(cell about 3.7 V). The ESP32-C3 keeps running to about 3.0 V on its rail,
then its brownout detector resets it, and the cell's own protection PCB is the
floor. **Charge the pod after each session.** About 1-1.5 hours from flat at
100 mA.

**Remove the SuperMini's red power LED** (or its series resistor). It is lit
whenever the board has power and would flatten the cell in a few days.

### 2.2 Signal wiring

| SuperMini pin | Connects to (Adafruit breakout pad) | Notes |
|---|---|---|
| **3V3** | **VIN** | The breakout's own regulator and level shifters accept 3.3 V |
| **GND** | **GND** | |
| **GPIO6** | **SDA** | I²C, 400 kHz. The breakout has 10 kΩ pull-ups. |
| **GPIO7** | **SCL** | |
| **GPIO3** | **INT1** | Data-ready while running, wake-up while asleep. **Must** be GPIO0-5: only those can wake a C3 from deep sleep. |
| GPIO8 | (on-board blue LED, active low) | Status; also a strapping pin, so nothing else connects to it |
| SDO/DO pad | leave open (address 0x6A) or tie to 3V3 (0x6B) | The firmware tries both |

### 2.3 Sensor axes

The pod's reference axes are defined in `cad/script_shaft_imu.scad`:

- **+X** along the shaft, toward the clubhead. The USB port faces −X, toward the grip.
- **+Y** across the shaft.
- **+Z** out of the lid, away from the shaft.

Fit the breakout so the **X arrow printed on its silkscreen points to +X**
(toward the clubhead) and Z points out of the lid. If your board's arrows
differ, note how they map. The firmware streams raw axes unchanged, so the
mapping can be applied downstream without re-recording anything.

---

## 3. BLE link

Two things only: the pod link (pod → ground unit) and the shot summary
(ground unit → phone).

### 3.1 Roles and UUIDs

| Link | Central | Peripheral | Service UUID |
|---|---|---|---|
| Pod → ground | ground unit | pod (`STEMPOD`) | `7d2a0001-5b1c-4f6e-9c1e-3a6f1f0c2b10` |
| Ground → phone | phone | ground unit (`STEM-RADAR`) | `7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10` |

| Characteristic | UUID | Properties | Content |
|---|---|---|---|
| Pod data | `7d2a0002-…` | notify | IMU and status packets (3.2) |
| Pod control | `7d2a0003-…` | write | `'A'` stream continuously, `'G'` swing-gated (default), `'Z'` sleep now |
| Ground shot | `7d2a0102-…` | read, notify | `ShotSummary` (3.3) |

Pod link: 7.5 ms interval, no slave latency, 1 s supervision timeout, MTU
247, 2M PHY requested (BLE 5).

Ground firmware 0.3 and 0.4 also had a live-status characteristic,
`7d2a0103-…` (`UnitStatus`), for the pod's charging and both batteries. Those
parts are gone, and so is the characteristic from firmware 0.5. A phone must
not expect it.

### 3.2 Pod packets (little-endian, packed)

Header, 12 bytes:

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | u8 | magic | `0xA7` |
| 1 | u8 | type | 1 = IMU block, 2 = status |
| 2 | u16 | seq | per packet, wraps. A gap means a lost notification. |
| 4 | u16 | swing_id | increments per detected swing |
| 6 | u8 | flags | bit0 swing active, bit1 accel clipped, bit2 gyro clipped, bit3 samples dropped before this packet, bit4 timing gap inside this packet, bit5 last packet of the swing |
| 7 | u8 | n | IMU samples that follow |
| 8 | u32 | t0_us | pod clock at the first sample's data-ready interrupt |

IMU block: then `n` samples (up to 19), 12 bytes each, as raw signed counts in
the chip's register order: `gx gy gz ax ay az` (int16). Scale: 70 mdps/LSB and
0.488 mg/LSB at the configured ±2000 dps / ±16 g. Sample *i* is at
`t0_us + i * period`, with the period taken from the latest status packet.

Status block, after the header: `battery_mv` u16 (**0 = not read**: the pod
has no battery sense), `sample_period_ns` u32 (measured from interrupt
timestamps), `imu_who_am_i` u8 (0x6A DS3TR-C, 0x6C DSOX), `accel_fs_g` u8,
`gyro_fs_dps` u16, `dropped_samples` u32 (since boot), `fw_major` u8,
`fw_minor` u8. That is **28 bytes** with the header, pinned by a
`static_assert` on both sides. Pod firmware 0.2 appended three bytes of
charging state (31 bytes); the ground unit reads the first 28 of either.

### 3.3 Ground shot summary (to the phone)

`magic 0x5A`, `version 1`, `shot_seq` u16, `impact_ms` u32, then five readings,
each `{value f32, provenance u8, refusal u8}`: `ball_speed_radial` (m/s),
`club_speed_radial` (m/s), `smash`, `peak_shaft_rate` (deg/s), `tempo_ratio`.
Then `battery_mv_ground` u16 and `battery_mv_pod` u16. **From ground firmware
0.5 both battery fields are always 0, meaning "not read"**: neither unit
measures its cell. The layout is unchanged, so readers of earlier firmware
still decode it.

`impact_ms` is on the ground unit's `millis()` clock and wraps with it after
49.7 days: from ground firmware 0.4 it is worked out from the 64-bit
microsecond count. Earlier firmware divided a 32-bit microsecond count by
1000, so its `impact_ms` wrapped every 71.6 minutes. Packed and little-endian,
**42 bytes**; a `static_assert` in the firmware pins the size. A 42-byte
notification needs an ATT MTU of at least 45: where a phone negotiates less,
the notification is cut to 20 bytes, and the results screen
(`launchmon-hw/results/`) reads the characteristic instead.

Provenance codes match `launchmon.quantity.Provenance`: 0 none (refused), 1
measured, 2 derived, 3 low_confidence, 4 modelled. A non-zero refusal code means
there is no number and `value` is NaN. The reasons are listed in
`firmware/ground_unit/ground_unit.ino` (`enum class Refusal`) and are spelled
out in the USB JSON.
