# Wiring, pinouts and power paths

Two separate units, wired independently. **They exchange data only over BLE.**
The one electrical link is a pair of charging contacts, DOCK+ and DOCK-, that
are live only while the pod is parked on the ground unit (section 4).

```
   GROUND RADAR UNIT                                       SHAFT MOTION POD
   (on the ground, behind the ball)                        (clipped to the shaft)
  +---------------------------------+                    +---------------------------+
  | BGT24LTR11 -> pre-amp -> ESP32  |  <~~~ BLE 5.0 ~~~> | LSM6DS3TR-C -> ESP32-C3    |
  | 1500 mAh LiPo, TP4056, MT3608   |   pod = peripheral | 100 mAh LiPo, micro charger|
  | BLE central (pod) + peripheral  |   ground = central |                           |
  | (phone), piezo buzzer           |                    |                           |
  | DOCK+ / DOCK- pogo pins  o o ---|-- pod parked: 5 V -|-- o o flat pads           |
  +---------------------------------+                    +---------------------------+
                 |                     ~~~ BLE ~~~> phone (optional, shot summaries)
                 | USB-C (bottom): charging; JSON lines + raw I/Q captures to a laptop
```

"Dock" in this document means the pod's charging contacts. The build
instructions also use "dock" for the stand (`ground_radar_dock_*`); the two are
unrelated.

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
| MT3608 **VOUT+** (5.0 V) | **5 V rail**: SuperMini **5V** pin, radar module **VIN** *(only if the module has a 3.3 V regulator: see 1.3)*, the pod charging switch (4.2) | |
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
| **GPIO3** (ADC1_CH3) | in | DOCK+ sense divider midpoint (4.2) | Read between shots only, like the battery |
| **GPIO4** (ADC1_CH4) | in | Battery divider midpoint | Read between shots only |
| **GPIO6** | out | 2N7002 gate (pod charging switch, 4.2) | High turns DOCK+ on. 10 kΩ to GND holds it off through reset |
| **GPIO7** | out | 470 Ω → piezo disc; disc's other lead → GND (1.6) | LEDC square wave at `BUZZER_HZ` |
| **GPIO10** | out | 330 Ω → 5 mm LED anode; cathode → GND | Status LED in the top face |
| **GPIO5** | out | Radar module enable, **if it has one** | Off by default (`PIN_RADAR_EN = -1`) |
| **GPIO9** | in | On-board BOOT button | Short press toggles raw USB streaming |
| **GPIO20 / GPIO21** | UART0 RX / TX | Auxiliary serial (`Serial1`, 115200 8N1) | Spare: debug, or a radar board with a digital interface |
| **5V / GND / 3V3** | power | as section 1.1 | |
| GPIO2, GPIO8 | - | **leave unconnected** | Strapping pins. GPIO8 also drives the on-board LED. |
| GPIO18 / GPIO19 | - | (USB D- / D+) | Used by USB-C; do not connect |

Only ADC1 is used. On the C3, ADC2 is unreliable and is not used for anything.
The continuous driver owns ADC1 while the radar streams, so GPIO3 and GPIO4 are
read by pausing the stream for a few milliseconds, between shots.

Why these pins for the new parts: GPIO3 is the only free ADC1 pin that is not a
strapping pin (GPIO2 is one). GPIO6 and GPIO7 are free, are not strapping, USB
or flash pins (the SuperMini's flash is in the package, on pins it does not
expose), and sit on the opposite header row from the I/Q inputs. GPIO20/21
stay the auxiliary UART: GPIO21 also carries the ROM's boot log, which would
chirp a buzzer or toggle a switch at every reset.

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
- The piezo's two leads and the DOCK+/DOCK- leads run away from the I/Q leads,
  not alongside them.

### 1.6 Buzzer

A bare piezo disc, no driver: the ESP32's LEDC peripheral makes a square wave
on GPIO7.

```
   GPIO7 ---/\/\/\---+---- piezo disc, silvered ceramic side
             470 R   |
                     |    15 mm brass disc, 0.3 mm, bonded inside the case;
                     |    the case wall is its diaphragm
   GND  -------------+---- brass side, to a SuperMini GND pin directly
                           (not through the pre-amp's ground)
```

**Why 470 Ω.** The disc is a capacitor, about 10 nF for a 15 mm disc (check its
datasheet). Driven straight from the pin, each edge would charge it through the
pin's own few tens of ohms: current peaks near 100 mA, far over the C3's pin
rating, and a sharp kick on the 3.3 V rail the pre-amp shares. Through 470 Ω:

| | |
|---|---|
| Peak edge current | 3.3 V / 470 Ω = 7 mA |
| Charging time constant | 470 Ω x 10 nF = 4.7 µs, 4% of the 125 µs half-period at 4 kHz, so the disc still swings the full 3.3 V each half cycle and loses no loudness |
| Corner | 34 kHz: rounds the edges, trimming the harmonics that would alias into the ADC's band |
| Knocks | A piezo is also a generator. The resistor limits what a knock on the case can push back into the pin |

1 kΩ also works, a little quieter: at resonance the disc's impedance drops to
a few hundred ohms, comparable to the resistor. Below about 220 Ω the rail
kicks grow for no gain in loudness.

**Frequency.** `BUZZER_HZ` is 4000. A free 15 mm disc typically resonates well
above that (check its datasheet); bonded to a case wall, its resonance falls.
Tune `BUZZER_HZ` to the loudest setting by ear on the built unit.

**Keeping it out of the radar's way.** 4 kHz and its harmonics are inside the
200 Hz-15 kHz IF band, so the protection is timing, not filtering:

- LEDC runs from its own timers and clock divider. It shares nothing with the
  ADC's digital controller, its DMA or `esp_timer`, so it cannot change the
  40 kS/s sampling itself.
- No tone starts while a capture is triggered or being analysed. The trigger
  is disarmed before the first edge and stays disarmed until the buzzer has
  been silent for 30 ms (`BUZZER_SETTLE_MS`; the pre-amp's 200 Hz high-pass
  settles in about 1 ms).
- A pod reporting the start of a swing cuts any tone off at once, so the radar
  can arm for the downswing.
- Silence is duty 0: the pin sits low with no edges. The timer is not stopped
  and restarted for every beep.
- Only the "ready" and "shot read" patterns sound straight away. The rest wait
  until the radar has seen nothing move for 1 s, and are dropped after 30 s.

| Event | Pattern | Notes |
|---|---|---|
| Ready | 1 chirp, 60 ms | 1 s after boot (once the trigger has learnt its noise level), and when re-armed with serial `a` |
| Shot read | 2 chirps, 60 ms | After a capture in which an impact was found |
| Pod parked, charging | 3 quick chirps, 40 ms | Section 4 |
| Pod connected | long, short (200, 60 ms) | Not while it is parked |
| Pod disconnected | short, long (60, 200 ms) | Not while it is parked |
| Ground unit battery low | 3 long, 300 ms | First reading under 3.5 V, then every 5 minutes |
| Charging fault | 1 long, 800 ms | Overload, or voltage found on the contacts (4.7) |

There is no "ready" chirp when the radar arms for a pod swing. That happens at
the takeaway, mid-swing, and the radar must not be armed while a tone plays.

Turn it off at build time with `#define STEM_BUZZER 0` (GPIO7 is then left
alone), or at run time with serial `b`. The ground unit has no writable BLE
characteristic, so there is no BLE setting.

---

## 2. Shaft motion pod

### 2.1 Power path

One USB-C port, the SuperMini's own, flashes and charges the pod. It also
charges from the ground unit through two flat pads, DOCK+ and DOCK- (section 4).

```
   USB-C (SuperMini) ---> SuperMini 5V pin --+--------------------> charger VIN
                                ^            |                      (MCP73831 / TP4054,
                                |            |                       R_PROG 10k = 100 mA)
   DOCK+ pad ---+----|>|--------+            |                      charger BAT ---+
                |    D2 Schottky             |                                     |
                |    (anode at the pad)      +----|<|---- Schottky P5 ------+------+---- LiPo +
                |                                (cathode at 5V pin)        |             (100 mAh,
                +--- 220k --- SuperMini 3V3  (beacon, 4.4)                  |              protected)
                |                                       1 M                 |
                +--- 2.2M ---+--> GPIO1      GPIO4 <---+---/\/\/\-----------+
                             +--- 1M --- GND           +---/\/\/\--- GND
                             +--- 100 nF --- GND       |    1 M
                                                       +--- 100 nF --- GND
   DOCK- pad --- GND
   All grounds common: charger GND, LiPo -, SuperMini GND, IMU GND, DOCK- pad.
```

How it behaves:

- **USB plugged in.** The 5V pin sits at about 5 V and powers the SuperMini.
  The charger charges the cell. The Schottky is reverse-biased (5 V on its
  cathode, at most 4.2 V on its anode), so USB never feeds the cell directly.
- **Parked on the ground unit, contacts live.** The same as USB, through D2:
  the dock's 5 V less the drops on the way (4.3-4.7 V at the 5V pin while
  charging, more as the current tapers) powers the SuperMini and the charger.
- **On battery.** The cell feeds the 5V pin through the Schottky (about 0.3 V
  drop). The SuperMini's regulator makes 3.3 V from that. The charger sees its
  input below the cell voltage and shuts down. D2 is reverse-biased, so the
  DOCK+ pad carries only the 220k beacon: the pads on the shaft are dead.
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
| **GPIO1** | DOCK+ pad divider midpoint (2.2M / 1M, 100 nF) | ADC1_CH1. Tells the pod it is on a live dock (4.7) |
| **3V3** | also the 220k beacon to the DOCK+ pad | see 4.4 |
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
`fw_major` u8, `fw_minor` u8. That is 28 bytes with the header.

Pod firmware 0.2 appends two fields, making the status 31 bytes:

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 28 | u8 | power | bit0 dock power on the DOCK+ pad, bit1 the pod's USB-C is connected to a computer, bit2 charging, bit3 charged. Bits 2 and 3 are estimates from the cell voltage (4.7) |
| 29 | u16 | dock_pad_mv | DOCK+ pad voltage, mV (0 if the contacts are not fitted) |

A reader takes the length as the version: a 28-byte status comes from older
firmware and has no power fields. Nothing else in either packet changed.

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

---

## 4. Dock charging: the pod parked on the ground unit

Two recessed spring-loaded pogo pins on the ground unit, **DOCK+** (+5 V) and
**DOCK-** (GND), touch two flat pads on the pod. Magnets or a clip hold it
there; that side is in the CAD. The ground unit's parts fit on a small board
in the 12 x 10 x 4 mm pocket the CAD reserves.

What it has to do:

- The pins are **dead unless a pod is parked on them**. They are exposed on a
  wet range.
- A short, or water across the pins, damages nothing and does not drain the
  ground unit's cell.
- The **pod's charger sets the current**: 100 mA (R_PROG 10k, as P4 requires).
  The dock supplies it and bounds what a fault can draw. It does not regulate it.
- No back-feed: neither the pod's cell nor its own USB can drive DOCK+, and the
  dock never charges the pod alongside a computer's USB port.
- Two contacts only, so finding a parked pod has to work over the same two wires.

### 4.1 Nets

| Net | Ground unit | Pod |
|---|---|---|
| DOCK+ | Pogo pin. Fed from the 5 V rail through Q1 and F1. Sensed on GPIO3 | Flat pad. To the SuperMini 5V pin through D2. Beacon 220k from 3V3. Sensed on GPIO1 |
| DOCK- | Pogo pin. GND | Flat pad. GND |

### 4.2 Ground unit: switch, fuse and sense (pocket board)

```
   5 V rail (MT3608 VOUT+) ----+---------------+--------------+
                               |               |              |
                               |             R1 100k        C1 47n
                               |               |              |
                               |   Q1 gate ----+--------------+
                          Q1 source            |
                          AO3401A (P-ch)     R2 10k
                          Q1 drain             |
                               |           Q2 drain   2N7002 (N-ch)
                               |           Q2 source --- GND
                               |           Q2 gate ---+------------ GPIO6
                               |                      |
                               |                    R5 10k
                               |                      |
                               |                     GND
                             F1 PTC, 1206, 0.20 A hold
                               |
                               +---------+-----------+-----------------> DOCK+ pogo pin
                                         |           |
                                       R3 470k     D1 ESD diode, 5 V
                                         |           |
                                         +-----------|--------> GPIO3 (ADC1_CH3)
                                         |           |
                                   R4 330k + C2 10n  |
                                         |           |
   GND ----------------------------------+-----------+-----------------> DOCK- pogo pin
```

| Part | Value | Why |
|---|---|---|
| Q1 | AO3401A, SOT-23, P-channel, -30 V, about 50 mΩ at Vgs = -4.5 V | High-side switch. Switching the high side keeps DOCK- a plain ground and leaves DOCK+ at 0 V when off |
| Q2 | 2N7002, SOT-23, N-channel, Vgs(th) 1.0-2.5 V | Level shift. A 3.3 V pin cannot turn a P-FET whose source is at 5 V fully off: its gate needs to go to 5 V |
| R1 | 100 kΩ, Q1 gate to source | Holds Q1 off whenever Q2 is off: at reset, while flashing, with the ESP32 unpowered |
| R2 | 10 kΩ, Q2 drain to Q1 gate | With R1, puts the on-state gate at 0.45 V (Vgs = -4.5 V, fully on). Limits the gate current to 0.5 mA |
| C1 | 47 nF, Q1 gate to source | Soft start. The gate ramps with (R1 ‖ R2) x C1 = 0.43 ms, so the pod's input capacitance (about 20 µF) charges at roughly 0.2 A, not several amps. Without it the 5 V rail feeding the ESP32 and the radar would dip at every switch-on. Turn-off takes about 10 ms (R1 x C1 = 4.7 ms) |
| R5 | 10 kΩ, Q2 gate to GND | Holds Q2 off while GPIO6 floats. Against a 45 kΩ internal pull-up the gate stays near 0.6 V, under the 2N7002's 1.0 V minimum threshold |
| F1 | Resettable PTC, 1206, I_hold 0.20 A, I_trip ≤ 0.5 A, V_max ≥ 6 V (Bourns MF-NSMF020X-2, Littelfuse 1206L020 or similar) | Normal draw is about 0.13 A: the charger's 100 mA plus the pod's ESP32. Hold rating derates in heat; 0.20 A keeps margin at 50 °C. A short or a charger set too high trips it |
| R3, R4 | 470 kΩ / 330 kΩ, 1% | DOCK+ x 0.41 at GPIO3: 5.1 V reads 2.1 V, inside the ADC's 2.5 V range. The 800 kΩ total is also the pull-down the presence test needs (4.4) |
| C2 | 10 nF | A low-impedance source for the ADC's sample capacitor. 1.9 ms time constant |
| D1 | 5 V ESD diode, SOD-323 (PESD5V0S1BA or similar), leakage ≤ 1 µA at 5 V | The pin is touchable. Everything else on DOCK+ is behind F1 or 470 kΩ, but Q1's drain is not |

Notes:

- **Q1's body diode** points from DOCK+ back into the 5 V rail. Anything that
  drives DOCK+ above the rail, or above 0 V while the unit is off, would feed
  the rail through it. That is why the pod has D2 (4.3): no pod can drive DOCK+.
- **Q1's off-state leakage** (≤ 1 µA hot) flows into the 800 kΩ and can lift an
  empty DOCK+ to at most 0.8 V. That is below both presence thresholds.
- **Drops on the way.** At 0.13 A: Q1 under 10 mV, F1 0.1-0.65 V (its cold
  resistance is 1-5 Ω; check the datasheet), pins and wire a few tens of mV. The
  pod's D2 adds about 0.3 V. The pod's 5V pin sees 4.3-4.7 V while the current
  is high and the cell is low, and more as the current tapers near 4.2 V. That
  is enough for an MCP73831 or TP4054 to finish the charge.

### 4.3 Pod: diode, beacon and sense

| Part | Value | Why |
|---|---|---|
| D2 | Schottky, ≥ 0.5 A, 40 V class: B5819WS (SOD-323) or 1N5819HW (SOD-123). Anode at the DOCK+ pad, cathode at the SuperMini 5V pin | Blocks the cell (through P5) and the pod's own USB from the pad. Without it the pad would sit at the cell voltage on the shaft, in the rain, and would feed the ground unit's 5 V rail through Q1's body diode. Prefer a 40 V part to a BAT60A here: low-voltage Schottkys leak more |
| R6 | 220 kΩ, SuperMini 3V3 to the DOCK+ pad | The beacon the ground unit looks for (4.4). It can source at most 15 µA, into a dead short |
| R7, R8 | 2.2 MΩ / 1 MΩ, 1%, DOCK+ pad to GPIO1 to GND | Pad sense: 5.1 V reads 1.6 V. Also loads the beacon by under 1 µA when the pod is off the dock |
| C3 | 100 nF, GPIO1 to GND | As for the battery divider: a low-impedance source for the ADC. 69 ms time constant |

There is no ESD diode on the pod: every path from its pads goes through
≥ 220 kΩ, or through D2 into the 5V pin's capacitors.

**The SuperMini's 5V pin.** On the common ESP32-C3 SuperMini, USB VBUS goes
straight to the 5V pin with no diode; section 1.1's note on flashing the
ground unit relies on the same fact. Check yours: with only USB connected, the
5V pin should read the USB voltage (about 5.0 V), not 0.3 V less. The design
does not depend on the answer: D2 is needed for the cell path through P5
either way. What it changes is the case below.

**Pod's own USB-C plugged in while parked.** Its 5V pin is at the USB voltage
and D2 is reverse-biased, so the dock supplies nothing unless the USB sags
below the dock. With no diode at VBUS, a dock left on could then push current
up the cable into the computer's port. So the pod reports a connected computer
(power bit1) and the ground unit turns the contacts off while it does. A USB
wall charger is not reported; its 5.0-5.2 V sits above what the dock delivers
through D2, so the dock simply supplies nothing.

### 4.4 Finding a parked pod with two contacts

With Q1 off, the ground unit reads DOCK+ against its own 800 kΩ to ground. A
parked pod drives DOCK+ from its 3.3 V rail through its 220 kΩ: its beacon.
The pod's 3.3 V regulator runs even in deep sleep, so a sleeping pod is found
too.

| On the contacts (Q1 off) | DOCK+ | Decision |
|---|---|---|
| Nothing, dry | 0 V (≤ 0.8 V with Q1's worst hot leakage) | Stays off |
| Water or wet grass across the pins, no pod | 0 V | Stays off: water can only pull DOCK+ down |
| Pod parked, its 3V3 at 3.3 V | 2.5 V | On, after a second look 0.3 s later |
| Pod parked, cell low (3V3 sagging to 3.0 V) | 2.2 V | On |
| Pod parked, 1 MΩ water film across the pins | 2.1 V | On; the film then takes 5 µA |
| Pod parked, 100 kΩ water film across the pins | 0.9 V | Stays off until dry: it fails safe |
| Pod with a flat cell, protection open | 0 V | Not found. Plug the pod's USB-C in for a minute, then park it |
| Something powered (≥ 4.3 V) | — | Fault: stays off, reports it |

Thresholds: 1.6 V to switch on, 1.2 V to stay on, 4.3 V "foreign". The decisive
property is that **water is passive**: a wet film is a resistance, it cannot
source current, so across a pull-down it reads as nothing. Plated pins and
pads in rain water make at most a weak cell of a few hundred millivolts,
through a high resistance: far below 1.6 V across 800 kΩ.

Two alternatives were set aside. A weak pull-up on DOCK+, looking for a load,
cannot tell a pod's input from water across the pins. Sensing only over BLE
(the pod reports seeing 5 V) needs the contacts live before the pod can see
anything, and a pod that is asleep or flat cannot report. BLE is still used,
for one thing: when a charging pod reports it has lost dock power, the ground
unit checks the contacts at once instead of at the next scheduled look (4.7).

Drain on the pod: under 1 µA off the dock (the beacon into its own pad
divider). Parked on a ground unit that is switched off, about 13 µA, through
the ground unit's divider and Q1's body diode into its unpowered 5 V rail:
about 0.3 mAh a day, under 3% of the cell a week.

### 4.5 Shorts and wet contacts

- **Contacts dead (the normal state).** Nothing on the pins can draw from the
  ground unit's cell. The only thing connected to DOCK+ is the 800 kΩ to
  ground, plus D1.
- **A short is never switched into.** A shorted pair reads 0 V, so it never
  passes the presence test. After switch-on, DOCK+ must read at least 4.0 V
  within 20 ms or the switch goes straight back off.
- **A short that appears while charging** (a metal object across the pins with
  the pod there, or in the seconds after the pod is lifted): F1 limits it, and
  the next check, at most a minute later (usually 5 s), finds DOCK+ below 4.0 V
  with the switch on and turns it off. A hard short may first pull the 5 V rail
  down far enough to reset the ESP32, which also turns the switch off (R5, R1)
  and leaves it off, since a short shows no beacon. Worst case, a few mAh.
- **After a fault**, the contacts stay off for 30 s, doubling on each repeat up
  to 10 minutes, and the buzzer gives one long tone.
- **A pod charger left at 500 mA** trips F1. The next check reports an overload.
  Fit R_PROG = 10 kΩ (P4).
- **Wet contacts with a pod charging** pass a few µA through the water.
  Harmless to the electronics; dry the pins before storing the units, as for
  any exposed metal.

### 4.6 With the ground unit switched off

**The pod does not charge from a ground unit that is switched off.** The slide
switch sits between the TP4056 and the MT3608 (1.1). Off, there is no 5 V
rail, no ESP32 to look for a pod, and nothing at Q1's source. Plugging a charger
into the ground unit's USB-C does not change that: the TP4056 charges the
ground unit's cell, and the switch still isolates everything after it. Feeding
the contacts from the charger input instead would bypass the presence check,
so it is not done.

To charge both at once: plug a charger into the ground unit's USB-C, **switch
it on**, and park the pod. The pod charges at 100 mA, roughly 1.5 hours from
flat. The ground unit's cell charges at the TP4056's 1 A, less the 0.3 A or so
the running unit draws with the dock on. One caution: while the unit is on,
its own load keeps the TP4056's current above its 100 mA end-of-charge
threshold, so it holds the cell at 4.2 V instead of finishing. Switch the
ground unit off once the pod reports charged (its LED goes dark, and the
ground unit prints `"charge":"charged"`); the TP4056 then finishes normally.
Or charge the pod on its own USB-C.

On battery, a full pod charge costs the ground unit about 15% of its cell. The
dock stops charging the pod when the ground unit's cell drops below 3.55 V, and
resumes above 3.7 V.

### 4.7 Firmware

**Ground unit** (`STEM_POD_DOCK`, default 1):

- Every check pauses the radar stream once, as the battery reading does, and
  never runs while a capture is triggered or analysed, a tone is playing, or the
  pod reports a swing. With the contacts off it looks for a beacon every 3 s.
  With them on, every 5 s it reads DOCK+ with the switch on (overload?), turns
  it off for 30 ms, and reads the beacon again (still parked?). Both schedules
  wait for quiet, nothing moving in the beam for 1 s, which a swing does not
  give in the 0.2 s before its trigger. They fall back to once a minute if it is
  never quiet.
- After the switch changes, the trigger stays disarmed for 100 ms: the step in
  the 5 V load reaches the radar's supply.
- A pod parked and charging is not on a club: the radar arms as it does
  radar-only, without waiting for pod swings, and the pod's connect and
  disconnect beeps are not sounded.
- USB JSON lines, on each change (additive; the shot line is unchanged):
  `{"type":"pod_dock","state":"charging|off|fault|low_battery","reason":"...","off_mv":2470,"on_mv":4810}`
  and, from the pod's status, `{"type":"pod_power","dock_power":true,"usb_host":false,"charge":"charging|charged|not_charging","battery_mv":3950,"dock_pad_mv":4790}`.
  With trigger debug on (serial `d`), every check prints a `dock_debug` line
  with its readings.

**Pod** (`STEM_DOCK`, default 1):

- It reads the pad every 250 ms. It is "on the dock" when the pad is above
  4.0 V **and** 150 mV above the cell. On battery its own 5V pin is below the
  cell, so diode leakage can never put the pad there; only an outside supply
  can.
- On the dock: no new swings are detected or streamed. The cell-low sleep is
  skipped (the dock powers it). It asks for a 50-100 ms connection interval in
  place of 7.5 ms, and sends a status at once on every change.
- Charge state is an estimate: "charged" once the cell has read at least
  4.15 V for 20 minutes, the charger's constant-voltage phase. A pod woken on
  the dock with the cell already at 4.15 V counts as charged at once.
- Once charged it reports for a minute, then deep-sleeps on the dock. Lifting
  it off wakes it, as picking up the club does. Off the dock, everything is as
  before.

### 4.8 Bench check, before closing the case

1. Ground unit on, no pod, serial `d` on: `dock_debug` lines show `off_mv`
   under 300. Lay a wet paper towel across the pins: still under 300, and the
   contacts never switch on.
2. Park the pod: within a few seconds of standing back, three quick chirps and
   `"state":"charging"` with `on_mv` 4400-5000. The pod prints `on the dock`.
3. Measure the pod's 5V pin while it charges: at least 4.3 V.
4. Lift the pod: `"state":"off"` within a few seconds.
5. Plug the pod's USB-C into a computer while it is parked: the ground unit
   turns the contacts off (`pod is on its own USB power`).
