# Wiring, pinouts and power paths

Two separate units, wired independently. **Nothing connects them but BLE.**

```
   GROUND RADAR UNIT                                       SHAFT MOTION POD
   (on the ground, behind the ball)                        (clipped to the shaft)
  +---------------------------------+                    +---------------------------+
  | BGT24LTR11 -> pre-amp -> ESP32  |  <~~~ BLE 5.0 ~~~> | LSM6DS3TR-C -> ESP32-C3    |
  | 1500 mAh LiPo, TP4056, MT3608   |   pod = peripheral | 100 mAh LiPo, micro charger|
  | BLE central (pod) + peripheral  |   ground = central +---------------------------+
  | (phone)                         |
  +---------------------------------+  ~~~ BLE ~~~> phone (optional, shot summaries)
                 | USB-C (bottom): charging; JSON lines + raw I/Q captures to a laptop
```

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
                                                 +---- 100k ---+---- 100k ---- GND   |
                                                 |             |                     |
                                                 |             +--> GPIO4 (ADC1_CH4) |
                                                 |             +--- 100 nF --- GND   |
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
| TP4056 **OUT+** | Switch common | |
| Switch output | MT3608 **VIN+**, and the top of the 100k/100k divider | The divider is after the switch, so it draws nothing when the unit is off. |
| TP4056 **OUT-** | MT3608 **VIN-** and the **GND rail** | One ground for everything. |
| MT3608 **VOUT+** (5.0 V) | **5 V rail**: SuperMini **5V** pin, radar module **VIN** *(only if the module has a 3.3 V regulator: see 1.3)* | |
| SuperMini **3V3** pin | Pre-amp V+, bias divider, radar **VCC** if the module is 3.3 V only | The SuperMini's regulator supplies 3.3 V for the whole analogue side. |

**Set the MT3608 before connecting anything to it.** Power its input from the
cell, turn the trimmer until a multimeter reads 5.0 V at VOUT+, then wire the
loads. A new MT3608 often comes set well above 5 V.

**Flashing with the unit switched on** is fine. The SuperMini's USB 5 V and the
MT3608's 5 V meet at the SuperMini's 5V pin. The MT3608's output diode blocks
reverse current into it, and both sources are about 5 V.

### 1.2 Signal wiring (SuperMini pins)

| SuperMini pin | Direction | Connects to | Notes |
|---|---|---|---|
| **GPIO0** (ADC1_CH0) | in | Pre-amp channel I output (or radar **IFI** if no pre-amp) | Sampled at 40 kS/s |
| **GPIO1** (ADC1_CH1) | in | Pre-amp channel Q output (or radar **IFQ**) | Sampled 12.5 µs after I; the firmware corrects the skew |
| **GPIO4** (ADC1_CH4) | in | Battery divider midpoint | Read between shots only |
| **GPIO10** | out | 330 Ω → 5 mm LED anode; cathode → GND | Status LED in the top face |
| **GPIO5** | out | Radar module enable, **if it has one** | Off by default (`PIN_RADAR_EN = -1`) |
| **GPIO9** | in | On-board BOOT button | Short press toggles raw USB streaming |
| **GPIO20 / GPIO21** | UART0 RX / TX | Auxiliary serial (`Serial1`, 115200 8N1) | Spare: debug, or a radar board with a digital interface |
| **5V / GND / 3V3** | power | as section 1.1 | |
| GPIO2, GPIO8 | - | **leave unconnected** | Strapping pins. GPIO8 also drives the on-board LED. |
| GPIO18 / GPIO19 | - | (USB D- / D+) | Used by USB-C; do not connect |

Only ADC1 is used. On the C3, ADC2 is unreliable and is not used for anything.

### 1.3 Radar module supply: check before connecting

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

### 1.4 Pre-amp (optional): one stage per channel, 3.3 V single supply

Use this when the radar module's IF outputs are not already amplified. It is
drawn for channel I; channel Q is identical, on the LM358's second op-amp.

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

### 1.5 Mechanical placement of wires

- Radar → pre-amp → ESP32 runs left-to-right along the top of the case in that
  order, so the analogue leads are about 3 cm long.
- Cell leads leave the battery bay through the gap in its right-hand fence,
  toward the TP4056.
- The MT3608 sits on the lid, so its four wires need enough slack (about 8 cm)
  for the lid to lie open beside the shell.

---

## 2. Shaft motion pod

### 2.1 Power path

One USB-C port, the SuperMini's own, both flashes and charges the pod.

```
   USB-C (SuperMini) ---> SuperMini 5V pin --+--------------------> charger VIN
                                             |                      (MCP73831 / TP4054,
                                             |                       R_PROG 10k = 100 mA)
                                             |                       charger BAT ---+
                                             |                                      |
                                             +----|<|---- Schottky ---------+-------+---- LiPo +
                                                 (cathode at 5V pin)        |              (100 mAh,
                                                                            |               protected)
                                                       1 M                  |
                                         GPIO4 <---+---/\/\/\---------------+
                                                   +---/\/\/\--- GND
                                                   |    1 M
                                                   +--- 100 nF --- GND
   All grounds common: charger GND, LiPo -, SuperMini GND, IMU GND.
```

How it behaves:

- **USB plugged in.** The 5V pin sits at about 5 V and powers the SuperMini.
  The charger charges the cell. The Schottky is reverse-biased (5 V on its
  cathode, at most 4.2 V on its anode), so USB never feeds the cell directly.
- **On battery.** The cell feeds the 5V pin through the Schottky (about 0.3 V
  drop). The SuperMini's regulator makes 3.3 V from that. The charger sees its
  input below the cell voltage and shuts down.
- **Cell voltage** is measured on the cell side of the diode. The firmware
  sleeps below 3.3 V, before the regulator drops out and well before the
  cell's own protection cuts in.

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
| **GPIO4** | battery divider midpoint | see 2.1 |
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

Connection: 7.5 ms interval, no slave latency, 1 s supervision timeout, MTU
247, 2M PHY requested (BLE 5).

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

Status block, after the header: `battery_mv` u16, `sample_period_ns` u32
(measured from interrupt timestamps), `imu_who_am_i` u8 (0x6A DS3TR-C, 0x6C
DSOX), `accel_fs_g` u8, `gyro_fs_dps` u16, `dropped_samples` u32 (since boot),
`fw_major` u8, `fw_minor` u8.

### 3.3 Ground shot summary (to the phone)

`magic 0x5A`, `version 1`, `shot_seq` u16, `impact_ms` u32, then five readings,
each `{value f32, provenance u8, refusal u8}`: `ball_speed_radial` (m/s),
`club_speed_radial` (m/s), `smash`, `peak_shaft_rate` (deg/s), `tempo_ratio`.
Then `battery_mv_ground` u16 and `battery_mv_pod` u16.

Provenance codes match `launchmon.quantity.Provenance`: 0 none (refused), 1
measured, 2 derived, 3 low_confidence, 4 modelled. A non-zero refusal code means
there is no number and `value` is NaN. The reasons are listed in
`firmware/ground_unit/ground_unit.ino` (`enum class Refusal`) and are spelled
out in the USB JSON.
