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

This is **soft power**, ground firmware `STEM_SOFT_POWER` 1 (the default). The
slide switch is a logic input and carries microamps. "Off" is deep sleep, with
the boost converter, the radar and the pre-amp unpowered, so a pod parked on a
switched-off unit can still charge (4.6). The switch, the wake line and the
switched rails are in 1.7. The older wiring, with the switch in the power path,
is at the end of this section; build its firmware with `STEM_SOFT_POWER 0`.

```
                     +-------------- TP4056 USB-C module (with DW01A/FS8205) --------------+
   USB-C 5 V in ---> | IN+ ------------------------------------------> VBUS sense (1.7)   |
   (bottom cutout)   |   B+  B-                                    OUT+          OUT-       |
                     +---|---|-----------------------------------------|-------------|-------+
                         |   |                                         |             |
              LiPo + ----+   +---- LiPo -                              |             |
              3.7 V 1500 mAh, protected                                |             |
                                                                       +--- 1M ---+--- 1M --- GND
                                                                       |          +--> GPIO4 (ADC1_CH4)
                                                                       |          +--- 100 nF --- GND
                                                                       v                     |
                                   +--- MT3608 boost, set to 5.0 V ---+                      |
                                   | VIN+                       VOUT+ |-----> 5 V rail       |
                                   | VIN-                       VOUT- |                      |
                                   +----|----------------------|------+                      |
                                        +----------+-----------+   "MGND": the MT3608's own  |
                                                   |                ground, nothing else      |
                                           Q3 AO3400A drain                                   |
                                           Q3 gate <-- SW_ON or GPIO6, soft start (1.7)       |
                                           Q3 source ----------------------------------------+---> GND rail
```

| From | To | Notes |
|---|---|---|
| LiPo + / - | TP4056 **B+ / B-** | The protection chip sits between B- and OUT-. **Never** connect a load to B+/B-. |
| TP4056 **OUT+** | MT3608 **VIN+**, and the top of the battery divider (1 MΩ / 1 MΩ, 100 nF) | No switch in the path. The divider is on the cell all the time, so it is 1 MΩ / 1 MΩ: 1.9 µA at 3.8 V, where 100k/100k would draw 19 µA |
| TP4056 **OUT-** | **GND rail** | One ground for everything except the MT3608 |
| MT3608 **VIN-** and **VOUT-** | joined, to **Q3's drain** only | The module's ground is switched. No other part may use these pads as its ground |
| Q3 source | GND rail | |
| MT3608 **VOUT+** (5.0 V) | **5 V rail**: SuperMini **5V** pin, the pod charging switch (4.2), and a 5 V radar module through Q8 (1.3, 1.7) | |
| SuperMini **3V3** pin | the ESP32, Q4 (radar and pre-amp switch, 1.7), the switch and the wake network's pull-ups (1.7) | The SuperMini's regulator supplies 3.3 V for the whole board |
| TP4056 **IN+** | VBUS sense, R17 (1.7) | The unit's USB 5 V, before the charger |

How it behaves:

- **On.** The switch turns Q3 on through D3, so the MT3608 runs whatever the
  firmware is doing. The firmware then powers the radar and pre-amp (GPIO2 low).
- **Off, asleep.** Q3 is off and the MT3608 has no ground: it cannot switch,
  and its own feedback divider (about 18 kΩ on the common module: a 2.2 kΩ
  bottom and the trimmer at about 16 kΩ for 5.0 V) has no path to draw
  through. The cell still reaches the 5 V rail through the MT3608's inductor
  and output Schottky, at the cell voltage less about 0.15 V (3.15-4.05 V).
  That is the ESP32's supply in deep sleep: the SuperMini's regulator makes
  3.3 V from it. Nothing else on the rail draws: the pod charging switch is off,
  and the radar is switched off (1.7).
- **Off, charging a parked pod.** GPIO6 turns on the contacts and, through D3,
  Q3 with them: the same 5 V as when on, with the radar still off.

**Why the MT3608's ground and not its EN pin.** On the common module EN is tied
to VIN on the board, so using it means lifting a pin of a SOT-23-6. Worse, a
disabled boost converter still passes its input through the inductor and
diode: the 5 V rail would sit at about 3.6 V, and the module's own feedback
divider would draw about 0.2 mA from it (196 µA at 3.6 V), four times the rest
of the off budget (1.7). Switching the module's ground stops both, needs no
rework of the module, and leaves the pass-through as the ESP32's standby supply
for free. With MGND floating, the MT3608 chip draws no more than Q3's off
leakage (under 1 µA).

**Set the MT3608 before connecting anything to it.** Power its input from the
cell with its VIN- on the cell's negative, turn the trimmer until a multimeter
reads 5.0 V at VOUT+, then wire it as above. A new MT3608 often comes set well
above 5 V.

**Remove the SuperMini's red power LED** (or its series resistor), as on the
pod. It is lit from 3V3 whenever the board has power, which with soft power is
always: of the order of a milliamp, against about 50 µA for everything else
while off.

**Flashing.** With the unit switched on, as before: the SuperMini's USB 5 V and
the MT3608's 5 V meet at the SuperMini's 5V pin, and the MT3608's output diode
blocks reverse current into it. **Switched off, the firmware goes back to
sleep within about 0.2 s of starting, and its USB port disappears.** Switch the
unit on to flash it, or hold BOOT and tap RESET. With Q3 off, the SuperMini's
USB 5 V on the rail does no harm: the MT3608 has no ground to run from.

#### Older wiring: switch in the power path (`STEM_SOFT_POWER 0`)

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

The switch sits between TP4056 OUT+ and MT3608 VIN+; the 100k/100k battery
divider is after the switch, so it draws nothing when the unit is off; MT3608
VIN- goes to the GND rail; the radar and pre-amp are fed directly (5 V rail or
SuperMini 3V3, 1.3). Off, nothing after the switch has power: the only drain is
the TP4056 module's and the cell's own protection, about 7.5 µA (1.7), and a
parked pod cannot charge (4.6). GPIO2, GPIO5 and GPIO20 are used as in the
older pin table notes in 1.2.

### 1.2 Signal wiring (SuperMini pins)

| SuperMini pin | Direction | Connects to | Notes |
|---|---|---|---|
| **GPIO0** (ADC1_CH0) | in | Pre-amp channel I output (or radar **IFI** if no pre-amp) | Sampled at 40 kS/s |
| **GPIO1** (ADC1_CH1) | in | Pre-amp channel Q output (or radar **IFQ**) | Sampled 12.5 µs after I; the firmware corrects the skew |
| **GPIO3** (ADC1_CH3) | in | DOCK+ sense divider midpoint (4.2) | Read between shots only, like the battery |
| **GPIO4** (ADC1_CH4) | in | Battery divider midpoint (1 MΩ / 1 MΩ on the cell, 1.1) | Read between shots only |
| **GPIO6** | out | 2N7002 gate (pod charging switch, 4.2), and D3 to the boost switch Q3 (1.7) | High turns DOCK+ on, and the MT3608 with it. 10 kΩ to GND holds both off through reset |
| **GPIO2** | out | Q4 gate, radar and pre-amp power (1.7) | **Low = on.** R11 100 kΩ to 3V3 holds it off through reset and keeps this strapping pin at 1, as SPI boot needs |
| **GPIO5** | in | WAKE (1.7): Q5 drain, R13 1 MΩ to 3V3, D4 | Low while the switch is on; pulsed low by a pod being parked or USB power arriving. The deep-sleep wake pin |
| **GPIO20** | in | VBUS_N (1.7): Q7 drain | Low while USB power is on the TP4056. Read while awake |
| **GPIO7** | out | 470 Ω → piezo disc; disc's other lead → GND (1.6) | LEDC square wave at `BUZZER_HZ` |
| **GPIO10** | out | 330 Ω → 5 mm LED anode; cathode → GND | Status LED in the top face |
| **GPIO9** | in | On-board BOOT button | Short press toggles raw USB streaming |
| **GPIO21** | - | spare | `Serial1` is not started: its RX pin, GPIO20, is VBUS_N |
| **5V / GND / 3V3** | power | as section 1.1 | |
| GPIO8 | - | **leave unconnected** | Strapping pin. It also drives the on-board LED. |
| GPIO18 / GPIO19 | - | (USB D- / D+) | Used by USB-C; do not connect |

Only ADC1 is used. On the C3, ADC2 is unreliable and is not used for anything.
The continuous driver owns ADC1 while the radar streams, so GPIO3 and GPIO4 are
read by pausing the stream for a few milliseconds, between shots.

Why these pins for the new parts: GPIO3 is the only free ADC1 pin that is not a
strapping pin (GPIO2 is one). GPIO6 and GPIO7 are free, are not strapping, USB
or flash pins (the SuperMini's flash is in the package, on pins it does not
expose), and sit on the opposite header row from the I/Q inputs. GPIO21
carries the ROM's boot log, which would chirp a buzzer or toggle a switch at
every reset, so it drives nothing.

**Soft power (1.7) and the pins it took.** Only GPIO0-5 can wake a C3 from deep
sleep. GPIO0/1 are the I/Q inputs and GPIO3/4 the dock and battery ADC inputs,
none of which can move. GPIO2 is a strapping pin that must read 1 at every
reset, deep-sleep wakes included, for the chip to boot from flash: a wake input
cannot promise that, but an output whose pull-up is its off state can, so
GPIO2 switches the radar's power. That leaves **one** wake pin, GPIO5, for
three wake sources (the switch, a pod, USB): the pod and USB arrive on it as
short pulses, so the switch's level is always readable (1.7). GPIO5 was the
optional radar enable; the radar's whole supply is switched now, so a module's
own enable pin is simply tied to its active level. The one cost is the
auxiliary UART: its RX pin, GPIO20, reads USB power, and `Serial1` is not
started. With `STEM_SOFT_POWER 0`, GPIO2 is left unconnected, GPIO5 is the
optional radar enable (`PIN_RADAR_EN`, off by default) and GPIO20/21 are the
auxiliary UART (`Serial1`, 115200 8N1).

### 1.3 Radar module supply: check before connecting

The **BGT24LTR11 chip is a 3.3 V part**. Boards built around it come two ways:

- **With an on-board 3.3 V regulator** and a 5 V or VIN pin: feed it from the
  **5 V rail**. This is what the brief's "5 V to radar" means. With soft power,
  through Q8, which follows the radar switch Q4 (1.7).
- **Bare 3.3 V board**: feed it from the **SuperMini 3V3 pin**; with soft power,
  from **3V3_AN**, Q4's drain (1.7). **Never** from 5 V: that destroys the chip.

With soft power the radar must be fed from a switched rail, one way or the
other. The BGT24LTR11 draws tens of milliamps whenever it has power, and in
deep sleep the 5 V rail still carries the cell's pass-through (1.1). A module's
enable pin, if it has one, is tied to its active level.

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
            (3V3_AN with soft power, 1.7: the divider alone would draw 89 µA off)
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
| Ready | 1 chirp, 60 ms | 1 s after boot (once the trigger has learnt its noise level), and when re-armed with serial `a`. With soft power that is about 1.5 s after the switch goes on. Switched off, the buzzer is silent, charging or not |
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

### 1.7 Soft power: the switch, the wake line and the switched rails

Ground firmware `STEM_SOFT_POWER` 1. Every part here costs a few cents; the
lot is about $0.15-0.25 in small quantities, well under $1 at hobby prices.

**Boost switch.** The slide switch, or the pod charging contacts, start the
MT3608 by switching its ground (1.1).

```
   SuperMini 3V3 ---o slide switch o--- SW_ON ---+--------------+-------------> Q5 gate (wake line, below)
                     (its common pin is SW_ON)   |              |
                                               R12 1M        D3a  BAT54C, common cathode
                                                 |              |
                                                GND             +--- R9 47k ---+--- Q3 gate  (AO3400A, 1.1)
   GPIO6 (DOCK_EN, 4.2) ------------------------- D3b ----------+              +--- C4 100n --- GND
                                                                               +--- R10 470k --- GND
```

**Radar and pre-amp switch.** A P-FET from the SuperMini's 3V3, gated by GPIO2.

```
   SuperMini 3V3 ---+-------------- Q4 AO3401A source
                    |               Q4 drain ---> 3V3_AN: LM358 pin 8, the 27k/10k bias divider (1.4),
                  R11 100k                        and a bare 3.3 V radar module's VCC (1.3)
                    |               Q4 gate
   GPIO2 -----------+---------------+          low = on; R11 holds it off through reset

   5 V radar modules only (1.3): a second P-FET on the 5 V rail that follows Q4.
   5 V rail ---+--------- Q8 AO3401A source;  Q8 drain ---> radar VIN
             R23 100k     Q8 gate
               +----------+------ Q9 2N7002 drain;  Q9 source --- GND
                                  Q9 gate <--- 3V3_AN,  R24 100k gate to GND
```

**Wake line.** One pin, GPIO5, active low. The switch holds it low; a pod being
parked and USB power arriving each pull it low for a few milliseconds.

```
                       3V3                3V3                        3V3          3V3
                        |                  |                          |            |
                      R13 1M             R15 1M                     R16 1M       R20 1M
                        |                  |                          |            |
   GPIO5 (WAKE) --------+--- Q5 drain   POD_N = Q6 drain ---C5 47n----+ node A     + node B
                        |   (Q5 gate = SW_ON)                         |            |
                        +------|>|--------------------------------------+            |
                        |      D4a                                                  |
                        +------|>|---------------------------------------------------+
                               D4b   (BAT54A: common anode at WAKE)                 |
                                                     VBUS_N = Q7 drain ---C6 47n----+
   DOCK+ (4.2) ---- R14 100k ---- Q6 gate             |  R19 1M to 3V3
                                                      +---------------------------> GPIO20
   TP4056 IN+ ---- R17 100k ---+--- Q7 gate
                             R18 100k --- GND         Q5, Q6, Q7 sources --- GND
```

| Part | Value | Why |
|---|---|---|
| Q3 | AO3400A, SOT-23, N-channel, 30 V, ≤ 48 mΩ at Vgs 2.5 V, Vgs(th) 0.65-1.45 V | In the MT3608's ground return (1.1). Its input draws 0.41-0.46 A when on with the pod charging: 22 mV and 10 mW in Q3 |
| D3 | BAT54C, SOT-23, dual Schottky, common cathode | ORs SW_ON and GPIO6 onto Q3's gate. GPIO6 is held low through reset by R5 (4.2): even against a 45 kΩ internal pull-up it sits at 0.6 V, which leaves Q3's gate at 0.45 V, under its 0.65 V minimum threshold |
| R9, C4, R10 | 47 kΩ series, 100 nF and 470 kΩ, gate to ground | Soft start. The gate settles at 2.77 V with τ 4.3 ms and passes the threshold 1-3 ms after the switch, so the MT3608's capacitors charge at tens of milliamps, not the amps an abrupt step would draw from the cell (enough to trip the DW01A's short-circuit detector). Off, τ 47 ms. Draws 5.9 µA while on |
| Q4 | AO3401A, SOT-23, P-channel, ≤ 85 mΩ at Vgs -2.5 V | Radar and pre-amp supply. 46 mA with a 3.3 V radar: 4 mV |
| R11 | 100 kΩ, Q4 gate to 3V3 | Off through reset and while asleep. Also holds GPIO2, a strapping pin, at 1. Gate RC 65 µs |
| Q8, Q9, R23, R24 | AO3401A, 2N7002, 100 kΩ, 100 kΩ | Only for a radar module with its own regulator, fed from 5 V. Q9 turns on with 3V3_AN, so Q8 follows Q4. 50 µA in R23 while on |
| R12 | 1 MΩ, SW_ON to GND | SW_ON is 0 V when the switch is open. 3.3 µA while on |
| Q5 | BSS138, SOT-23, N-channel, Vgs(th) 0.8-1.5 V | Inverts SW_ON onto WAKE |
| R13 | 1 MΩ, WAKE to 3V3 | WAKE's pull-up. 3.3 µA while the switch is on, 0 off |
| Q6 | BSS138 | Pod detector. A parked pod's beacon puts 2.35-2.6 V on DOCK+ (4.4), over the BSS138's 1.5 V maximum threshold. Water across the pins only pulls DOCK+ down, so it cannot turn Q6 on. Gate leakage is nanoamps: the beacon is not loaded |
| R14 | 100 kΩ, DOCK+ to Q6 gate | The pin is touchable: D1 clamps it (4.2), R14 limits what reaches the gate |
| R15 | 1 MΩ, POD_N to 3V3 | 3.3 µA while a pod is parked, 0 otherwise |
| Q7 | BSS138 | VBUS detector |
| R17, R18 | 100 kΩ / 100 kΩ, TP4056 IN+ to Q7 gate to GND | 4.5-5.5 V of USB gives 2.25-2.75 V at the gate. 25 µA, from USB. Unplugged, the TP4056's own reverse leakage (≤ 2 µA) lifts the gate at most 0.2 V |
| R19 | 1 MΩ, VBUS_N to 3V3 | 3.3 µA while USB is present |
| C5, C6 | 47 nF | Turn a falling POD_N or VBUS_N into a pulse on WAKE |
| R16, R20 | 1 MΩ, node A and node B to 3V3 | Recharge C5 and C6 after a pulse |
| D4 | BAT54A, SOT-23, dual Schottky, common anode at WAKE | Isolates the two pulse paths. Without it, whichever detector was already on would ground its capacitor's far end, the two 47 nF would split the step, and WAKE would only fall to 1.65 V, above the 0.83 V a low must reach |
| Battery divider | 1 MΩ / 1 MΩ 1%, 100 nF (replaces 100k/100k) | On the cell all the time (1.1). The 100 nF is the ADC's source; τ 50 ms |

**Where the parts go.** Q4 and R11 on the pre-amp board, where 3V3 comes in,
so 3V3_AN feeds the radar from there. Q8, Q9, R23, R24 (5 V radar only) by the
radar. Everything else (Q3, D3, R9, C4, R10, Q5-Q7, D4, R12-R20, C5, C6) on one
small board on the lid beside the protection board, where SW_ON, GPIO6, DOCK+,
the MT3608's ground and the wires to the SuperMini meet: about 20 x 15 mm on
perfboard with the parts dead-bugged, or 15 x 12 mm as a small two-sided PCB.
The CAD has no pocket for it yet. The battery divider stays inline at GPIO4,
now from the cell side.

**The slide switch** is now a logic switch: its common pin to SW_ON, the end
for "on" to the SuperMini's 3V3, the other end unconnected. The same SS12D00 in
the same wall pocket.

#### Wake sources

| Event | How it reaches GPIO5 | Notes |
|---|---|---|
| Switch on | Q5 holds WAKE low for as long as the switch is on | A level. The firmware reads the switch position as WAKE's level once any pulse has passed: 120 ms after it starts, then 50 ms of debounce |
| Pod parked | Q6 turns on, POD_N falls, C5 pulls WAKE low through D4a | A pulse. Below 0.83 V for 4.5 ms; back above 2.48 V after 26 ms (τ 23.5 ms). Lifting the pod gives no wake: POD_N rises slowly through R15, so C5 couples at most 3.3 µA |
| USB power arrives | Q7 turns on, VBUS_N falls, C6 pulses WAKE through D4b | A pulse, as above. Unplugging gives no wake |
| Timer | Only where needed: on USB, 10 min after a pod had to wait, and every 12 h to top up a charged pod; after a charging fault, at the end of its lockout | None on battery with nothing to do |

The pulses are why one pin is enough. A level from a parked pod or a USB cable
would hold WAKE low for hours: the chip could not sleep with it low, and could
not see the switch behind it. Nothing but the switch ever holds WAKE low, so
the unit never wakes over and over. To tell a pod from USB after a wake, the
firmware reads VBUS_N on GPIO20 and remembers in RTC memory whether USB was
present when it went to sleep; the pod is then confirmed with the ADC on GPIO3,
as in 4.4.

#### States

| | On | Off, charging the pod | Off, asleep |
|---|---|---|---|
| When | Switch on | Switch off and a pod parked, and allowed (4.6) | Everything else |
| MT3608 | On (switch, through D3) | On while the contacts are (GPIO6, through D3) | Off; the cell passes through to the ESP32 |
| Radar, pre-amp | On (GPIO2 low) | Off | Off |
| ESP32 | Everything | The dock logic of 4.7, at 80 MHz | Deep sleep |
| BLE | As in 3 | Central to the pod (to hear it say charged), and a 1 s advertisement so a phone can read the status (3.4, `soft_off`) | None |
| LED | As now | A 40 ms blip every 4 s | Dark |
| Sound | As in 1.6; one chirp about 1.5 s after switching on | None | None |
| Draw from the cell | As now | About 0.24-0.25 A on battery: the pod's 0.13 A at 5 V and the ESP32 | About 53 µA (below) |

The 1 s advertisement costs about 0.1 mA, under 0.1% of the pod's charging
current, and lets a phone see the pod charging on a switched-off unit. Asleep,
nothing is sent: there is nothing to say until something wakes the unit.

Switching between on and off goes through a short deep sleep (10 ms off, 1 ms
on), so each state starts from a clean boot. Switched off while a pod charges,
the contacts drop for about a second and come back in the off state if 4.6
allows.

#### Off current budget

Cell at 3.8 V, 25 °C, typical values. The SuperMini figure is the one reported
for this board in deep sleep with its power LED removed; most of it is its
regulator's quiescent current, and boards vary. **Measure yours** (bench
check below).

| What | µA | Note |
|---|---:|---|
| SuperMini: ESP32-C3 deep sleep (about 5 µA) and its 3.3 V regulator's quiescent current | 43 | Reported figure, power LED removed. A board whose regulator draws 100 µA makes this about 105 |
| Battery divider, 1 MΩ / 1 MΩ | 1.9 | 3.8 V / 2 MΩ |
| Leakage: Q3, Q4 and Q1 off, D1, Q5-Q7 off | ~1 | Each is specified at under 1 µA at its full rated voltage; here they see 4 V or less |
| MT3608 chip | ~0 | Its ground floats; bounded by Q3's leakage |
| TP4056 battery pin, no USB | 1.5 | |
| DW01A on the TP4056 module | 3 | |
| The cell's own protection board | 3 | |
| **Total** | **53** | 1.28 mAh a day, under 0.1% of the cell |
| With a charged pod parked | 57 | adds R15's 3.3 µA |

The last three lines, 7.5 µA, were there with the old hard switch too. Soft
power adds about 46 µA, almost all of it the SuperMini's regulator.

**Shelf life**, on that drain alone: 1500 mAh lasts about 1170 days (38 months)
from full, 585 days (19 months) from half charge. With a 100 µA regulator it is
about 18 months from full, 9 from half. A LiPo's own self-discharge, a few
percent a month, is of the same order, so the unit can sit switched off for a
season. Each wake costs about 2 µAh (about 0.3 s at 25 mA), so the wakes
themselves do not change this.

**Hard off, for shipping or storage beyond a year:** unplug the cell's JST-PH
connector (lid off, four screws). That is a true zero, and it needs no part.
Nothing cheaper does better: a firmware "ship mode" cannot switch off the
SuperMini's regulator, which is most of the 53 µA, and a three-position slide
switch would put a power contact back in the path and need a new wall pocket.

#### Bench checks (soft power)

1. With the unit switched off and asleep, measure the current out of the cell
   (meter in series with the cell's lead). **Expect about 50 µA; investigate anything
   over 150 µA.** About a milliamp means the red power LED is still fitted.
2. Switch on: `boot` and `ready` as before, and the chirp. Switch off: a
   `power` line `"state":"off","reason":"switch off"`, then
   `"state":"off_sleeping"`, and the cell current falls back to item 1.
3. Asleep, park the pod: within a second `"state":"off_charging"`, then
   `pod_dock` `"state":"charging"`, and the LED blips every 4 s. Lift it:
   `"state":"off_sleeping"`, `"reason":"no pod on the contacts"`.
4. Asleep with no pod, plug USB into the unit: the unit wakes, prints
   `"usb":true` and sleeps again (`no pod on the contacts`).
5. With the cell under 3.85 V and no USB, park the pod: the unit wakes and
   sleeps again, `unit battery under 3.85 V: pod waits for USB`. Plug USB in:
   it starts charging the pod.
6. Measure Q3's gate while switching on: it should ramp to about 2.8 V over
   a few milliseconds, and the 5 V rail should come up without the unit
   resetting.

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
| Ground status | `7d2a0103-…` | read, notify | `UnitStatus` (3.4), ground firmware 0.3 and later |

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
Then `battery_mv_ground` u16 and `battery_mv_pod` u16 (0 when no pod is
connected). `impact_ms` is on the `millis()` clock, the one `uptime_ms` is on
(3.4), and wraps with it after 49.7 days: from ground firmware 0.4 it is worked
out from the 64-bit microsecond count. Earlier firmware divided a 32-bit
microsecond count by 1000, so its `impact_ms` wrapped every 71.6 minutes. Packed and little-endian, **42 bytes**; a `static_assert` in the
firmware pins the size. A 42-byte notification needs an ATT MTU of at least 45:
where a phone negotiates less, the notification is cut to 20 bytes, and the
results screen (`launchmon-hw/results/`) reads the characteristic instead.

Provenance codes match `launchmon.quantity.Provenance`: 0 none (refused), 1
measured, 2 derived, 3 low_confidence, 4 modelled. A non-zero refusal code means
there is no number and `value` is NaN. The reasons are listed in
`firmware/ground_unit/ground_unit.ino` (`enum class Refusal`) and are spelled
out in the USB JSON.

### 3.4 Ground live status (to the phone)

A second characteristic in the same service carries what the unit knows
between shots: its own battery, the pod's link, battery and charge state, and
the dock's state machine (4.7). Packed and little-endian, **20 bytes**, pinned
by a `static_assert` (`struct UnitStatus` in `ground_unit.ino`). 20 bytes is
what a notification carries at the default ATT MTU of 23, so it is never cut
short, unlike the 42-byte shot summary.

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | u8 | magic | `0x5B` (the shot summary is `0x5A`, pod packets `0xA7`) |
| 1 | u8 | version | `1` |
| 2 | u8 | fw_major | ground firmware version: `0` |
| 3 | u8 | fw_minor | `4` (0.3 added this characteristic; 0.4 added soft power and `unit_flags` bit 7) |
| 4 | u32 | uptime_ms | `millis()`: the clock `impact_ms` is on (3.3). Going backwards means the unit restarted. Wraps after 49.7 days |
| 8 | u16 | battery_mv_ground | as in 3.3: read every 30 s between shots; ≤ 1000 = no usable reading |
| 10 | u16 | battery_mv_pod | the pod's cell, from its status (1 s). **0 when no pod is connected**, or before its first status on this link |
| 12 | u8 | pod_flags | below |
| 13 | u8 | unit_flags | below |
| 14 | u8 | dock_state | below |
| 15 | u8 | dock_reason | below |
| 16 | u16 | dock_retry_s | in a fault lockout (state 3), seconds until the contacts are tried again; else 0 |
| 18 | u16 | shot_seq | the last shot summary's `shot_seq`; 0 = no shot since boot. A phone that holds an older one missed a shot and can read 3.3 |

`pod_flags`:

| Bit | Name | Set when |
|---|---|---|
| 0 | connected | the BLE link to the pod is up |
| 1 | power_known | the pod has sent its power fields (pod firmware 0.2, 3.2) in the last 5 s. Bits 2-5 are its report and are 0 without this bit: with it clear, "not charging" is unknown, not no |
| 2 | dock_power | the pod sees the dock's 5 V on its DOCK+ pad |
| 3 | usb_host | the pod's own USB-C is on a computer (the contacts are then held off, 4.3) |
| 4 | charging | the pod's estimate: on dock power and not yet full (4.7) |
| 5 | charged | the pod's estimate: held at 4.2 V long enough to call full |
| 6 | parked | the unit treats the pod as parked, not on a club: the contacts are charging it, or it reported dock power in the last 5 s. The radar then arms without waiting for pod swings |
| 7 | charged_asleep | the link is down, but the pod reported charged before it dropped and the contacts have stayed on since: it is asleep on the dock (4.7). Cleared when the pod reconnects or the contacts change state |

`unit_flags`:

| Bit | Name | Set when |
|---|---|---|
| 0 | dock_fitted | built with `STEM_POD_DOCK` 1. Clear: `dock_state` stays 0 and means nothing |
| 1 | buzzer_fitted | built with `STEM_BUZZER` 1 |
| 2 | buzzer_on | fitted, and not turned off with serial `b` |
| 3 | user_armed | not disarmed with serial `a` |
| 4 | raw_streaming | raw captures go to USB after each shot (serial `r`, BOOT button) |
| 5 | batt_low | the unit's cell is under 3.50 V (`BATT_LOW_MV`) |
| 6 | adc_fault | the radar's ADC stream failed to start or restart: no shots will be captured |
| 7 | soft_off | built with `STEM_SOFT_POWER` and switched off: the unit is awake only to charge a parked pod (1.7, 4.6). No shots will come. Asleep it sends nothing at all, so a phone sees the link drop. Always 0 in a build without soft power |

`dock_state` (`enum class DockState`; the USB `pod_dock` line's word in brackets):

| Code | State | Meaning |
|---|---|---|
| 0 | off (`off`) | contacts dead, looking for a beacon every 3 s |
| 1 | confirming (`off`) | a beacon was seen; the second look 0.3 s later decides |
| 2 | charging (`charging`) | contacts live, a pod parked on them |
| 3 | fault (`fault`) | locked out after an overload or a foreign voltage; `dock_retry_s` counts down |
| 4 | low_battery (`low_battery`) | the unit's cell is under 3.55 V: the contacts stay off until it is above 3.7 V |

`dock_reason` (`enum class DockReason`): the reason given with the latest
`pod_dock` USB line, word for word, or 0 if there has been none since boot.
1 `pod parked`; 2 `no pod on the contacts (lifted, or contacts wet)`; 3
`overload: DOCK+ sagged with the switch on`; 4 `voltage on the contacts with
the switch off`; 5 `ground unit battery low`; 6 `ground unit battery
recovered`; 7 `pod is on its own USB power`; 8 `fault lockout over: looking for
a pod again`. New codes are only ever appended.

**When it is sent.**

- It is readable from boot. The value is refreshed at most every 250 ms, so a
  read returns the state of a quarter of a second ago at most, except during a
  capture (below).
- A notification goes out when anything in it changes, except `uptime_ms` and
  the `dock_retry_s` countdown, which the phone can count itself. A battery
  voltage counts as changed once it has moved 25 mV from the last notified
  value, or to or from 0; smaller drift rides on the periodic notification, so
  cell noise cannot drive the link. Changes are coalesced: at most one
  notification per 250 ms, four a second.
- One goes out every 30 s regardless, and one within 250 ms of a phone
  connecting.
- **Never during a capture.** Nothing is built, stored or notified while the
  trigger has fired, while a capture is being analysed, or while the pod
  reports a swing: the gate the dock checks and the buzzer use (4.7). A change
  in that time is sent as soon as it ends. The shot summary is notified with
  the capture ring frozen, as before. Building the status reads only values
  the unit already holds: it never pauses the radar stream or takes the ADC.

A unit with ground firmware 0.2 or earlier has only `7d2a0102`. A phone
should treat a missing `7d2a0103` as "no live status" and fall back to the
battery values in each shot summary. A reader rejects a value whose length,
magic or version is not exactly as above, whole.

---

## 4. Dock charging: the pod parked on the ground unit

Two recessed spring-loaded pogo pins on the ground unit, **DOCK+** (+5 V) and
**DOCK-** (GND), touch two flat pads on the pod. Magnets or a clip hold it
there; that side is in the CAD. The ground unit's parts fit on a small board
in the 15 x 12 x 4.3 mm pocket the CAD reserves on the lid.

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
| DOCK+ | Pogo pin. Fed from the 5 V rail through Q1 and F1. Sensed on GPIO3, and by Q6 for the wake line (1.7) | Flat pad. To the SuperMini 5V pin through D2. Beacon 220k from 3V3. Sensed on GPIO1 |
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
divider). Parked on a switched-off ground unit with soft power (1.1), 3.2 µA:
the beacon into the 800 kΩ. The unit's 5 V rail then sits at its cell voltage
less about 0.15 V, above the beacon, so Q1's body diode is reverse-biased. That
is 0.08 mAh a day, about 0.5% of the pod's cell a week. On the older wiring
(`STEM_SOFT_POWER 0`), or a unit whose own cell is cut off by its protection,
the rail is unpowered and the drain is about 13 µA, through the divider and
Q1's body diode: 0.3 mAh a day, under 3% a week.

### 4.5 Shorts and wet contacts

- **Contacts dead (the normal state).** Nothing on the pins can draw from the
  ground unit's cell. The only things connected to DOCK+ are the 800 kΩ to
  ground, D1, and (soft power) Q6's gate through R14, which draws nothing.
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

**With soft power (1.1, 1.7), a parked pod charges while the unit is switched
off.** The slide switch only tells the firmware; the contacts are powered by
the same MT3608, started by the contacts' own switch (GPIO6, through D3), and
checked exactly as in 4.4 and 4.7. Whether it charges depends on where the
power comes from:

- **On USB** (a charger in the unit's USB-C): yes, as long as the unit's own
  cell reads at least 3.55 V, the same rule as when the unit is on. The pod
  charges at 100 mA, about 1.5 hours from flat. While it does, the dock's load
  sits on the cell, so the TP4056 holds the cell at 4.2 V rather than finishing;
  once the pod is done the unit goes back to sleep and the TP4056 finishes
  normally. Nobody has to switch anything off.
- **On the unit's own battery:** only if the unit's cell reads at least
  3.85 V (about 60% charged) when the pod is parked or the unit is switched
  off, and it stops when the cell falls below 3.70 V under the dock's load
  (about 45%). A full pod charge costs the unit about 15% of its cell, so a
  switched-off unit gives away at most about one pod charge and keeps the rest
  for its next session. Under 3.85 V the pod waits; plugging USB into the unit
  then starts it.

Why not always: the unit's own run time is what a session depends on, and a
pod that empties a forgotten unit is the worse surprise. Why not only on USB:
the usual end of a session is to park the pod and switch off, and with a
reasonably charged unit the pod is then full for the next one without anyone
remembering a cable.

A session ends, the contacts go dead and the unit sleeps, when the pod has
reported charged and gone to sleep on the contacts (or has said charged for 3
minutes), when it is lifted, when its own USB-C is on a computer, after a fault
(the unit wakes to try again when the lockout ends), or after 2.5 hours (a pod
with firmware before 0.2 never reports its charge). A charged pod left parked
is topped up for 15 minutes every 12 hours while the unit is on USB, and not on
battery, where each top-up would keep the ESP32 awake for about 12 mAh.

**With the older wiring (`STEM_SOFT_POWER 0`) the pod does not charge from a
switched-off unit.** The switch sits between the TP4056 and the MT3608 (1.1):
off, there is no 5 V rail and no ESP32 to look for a pod, and a charger in the
unit's USB-C only charges the unit. To charge both at once, plug a charger into
the unit, switch it on and park the pod. While the unit is on, its own load
keeps the TP4056's current above its 100 mA end-of-charge threshold, so it
holds the cell at 4.2 V instead of finishing: switch the unit off once the pod
reports `"charge":"charged"`.

When the unit is on, with either wiring, a full pod charge costs the unit about
15% of its cell. The dock stops charging the pod when the ground unit's cell
drops below 3.55 V, and resumes above 3.7 V.

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
  (the end of a fault's lockout is reported too, as `off` with reason
  `fault lockout over: looking for a pod again`)
  and, from the pod's status, `{"type":"pod_power","dock_power":true,"usb_host":false,"charge":"charging|charged|not_charging","battery_mv":3950,"dock_pad_mv":4790}`.
  With trigger debug on (serial `d`), every check prints a `dock_debug` line
  with its readings.
- The same state, the pod's power report and both batteries go to the phone
  live, in the status characteristic (3.4).
- **Switched off, with soft power** (1.7, 4.6), the same checks and thresholds
  run in the off-charging state. With no radar, every check counts as quiet;
  switching the contacts on waits 50 ms rather than 20, because the MT3608
  starts with them. No sound. A USB line reports each power change:
  `{"type":"power","state":"on|off|off_charging|off_sleeping","reason":"...","battery_mv":3912,"usb":false,"wake_timer_s":0}`.

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
6. With soft power, the checks in 1.7, and then: switch the unit off with the
   pod parked and charging, on USB. The contacts drop for about a second and
   come back (`"state":"off_charging"`); the pod keeps charging.
