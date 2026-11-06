# Firmware

One sketch per unit. Each folder name matches its `.ino`, as the Arduino IDE requires.

| Sketch | Runs on | Role |
|---|---|---|
| `ground_unit/ground_unit.ino` | Ground radar unit's ESP32-C3 | Captures the radar's I/Q signals, triggers on a shot, runs the FFT analysis, links to the pod as BLE central, serves a phone as BLE peripheral, streams JSON and raw captures over USB |
| `shaft_pod/shaft_pod.ino` | Pod's ESP32-C3 | Samples the IMU at 1.66 kHz, streams swings as raw counts over BLE, deep-sleeps with wake-on-motion |

The two share only the BLE packet format, which is specified in
[`../docs/wiring_schematic.md`](../docs/wiring_schematic.md#3-ble-link) and
pinned on both sides with `static_assert`s on the struct sizes.

**Versions.** Ground unit **0.5**, pod **0.3**: the build for the original
parts list only. Ground 0.2-0.4 and pod 0.2 drove parts that are no longer
fitted (a piezo buzzer, the pod's charging contacts, soft power, battery-sense
dividers) and had a second BLE characteristic, `UnitStatus`. A phone or log
that sees ground `0.5` knows it has none of those. The ground unit prints its
version in the `boot` line; the pod sends its own in every status packet.

## Toolchain

- **Arduino IDE 2.x** or **arduino-cli**
- **Arduino-ESP32 core 3.x** (ESP-IDF 5.x). Board manager URL:
  `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
  Both sketches refuse to build on core 2.x: the ground unit uses the IDF 5 ADC
  drivers (`esp_adc/adc_continuous.h`).
- **NimBLE-Arduino 2.x** by h2zero (Library Manager). The 2.x callback
  signatures (`NimBLEConnInfo&`, `NimBLEScanCallbacks`) are used throughout.
  1.x will not build.
- No other libraries. The IMU is driven at register level, so the Adafruit
  library is not needed, and the FFT is in the sketch.

Board settings, both units:

| Setting | Value |
|---|---|
| Board | ESP32C3 Dev Module |
| USB CDC On Boot | **Enabled** (so `Serial` is the USB-C port) |
| CPU frequency | 160 MHz |
| Flash size | 4 MB |
| Partition scheme | Default 4MB with spiffs, or Huge APP |

```bash
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc firmware/shaft_pod
arduino-cli upload  --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc -p /dev/ttyACM0 firmware/shaft_pod
```

If a SuperMini will not enter the bootloader, hold BOOT (GPIO9), tap RESET,
release BOOT, then upload. Flash the ground unit with its slide switch on: the
SuperMini's USB 5 V and the MT3608's 5 V meet at its 5V pin, and the MT3608's
output diode blocks reverse current into it.

Build options, each a `#define` or constant near the top of its sketch:

| Option | Sketch | Default | What |
|---|---|---|---|
| `PIN_RADAR_EN` | ground unit | -1 (none) | Set to 5 if your radar module has an enable pin |
| `RECEDING_SIGN` | ground unit | +1 | Set with the bench check in the build instructions (4.3) |
| `STEM_USE_2M_PHY` | pod | 1 | Set to 0 if NimBLE lacks `updatePhy()` |

## Verification status

**Neither sketch has been compiled for the ESP32-C3 or run on hardware yet.**
They have been checked with a host compiler (`g++ -std=gnu++2a -x c++ -c
-Wall -Wextra`) against stub headers, with no warnings. That catches C++ errors
in the sketches, and the full `-c` compile also reports unused functions. It
cannot catch a mismatch with the real NimBLE-Arduino or ESP-IDF APIs, because
the stubs were written to match the APIs as the sketches use them. The first
real compile is the next check. The likeliest failure point is
`NimBLEServer::updatePhy()` in the pod: if your NimBLE-Arduino version lacks
it, set `STEM_USE_2M_PHY` to 0.

The ground unit's I/Q skew correction was checked numerically: a Python port of
`spectrumFrame()` on synthetic tones with Q sampled half a sample late gives
about 62 dB of image rejection, against 4-34 dB without the correction (worst
near 15 kHz). That checks the arithmetic, not the radar.

## Ground unit output (USB serial)

One JSON object per line:

`impact_ms` is on the `millis()` clock, worked out from the 64-bit microsecond
count, so it wraps only after 49.7 days (firmware before 0.4 divided a 32-bit
microsecond count and wrapped every 71.6 minutes).

```json
{"type":"shot","shot_seq":3,"impact_ms":81234,"analysis_ms":910,
 "ball_speed_radial":{"value":61.2,"unit":"m/s","provenance":"low_confidence","source":"radar-fw-preview"},
 "club_speed_radial":{"value":43.9,"unit":"m/s","provenance":"low_confidence","source":"radar-fw-preview"},
 "smash_factor":{"value":1.394,"unit":"ratio","provenance":"derived","source":"radar-fw-preview"},
 "peak_shaft_rate":{"no_reading":"gyro at full scale (2000 dps) during the downswing","source":"imu"},
 "tempo_ratio":{"value":3.02,"unit":"ratio","provenance":"derived","source":"imu+radar"},
 "battery_mv":{"ground":0,"pod":0},"pod_dropped_samples":0,"adc_desync":0}
```

(The numbers above show the format. They are not results.)

- Every value carries its provenance, using the same words as
  `launchmon.quantity.Provenance`. A value that could not be measured is a
  `no_reading` with the reason, never a guess.
- On-device ball and club speeds are `low_confidence`: a single-frame method
  without the drag-decay fit and cross-checks of launchmon-py. The raw capture
  is what the reference pipeline should be run on.
- All speeds are **radial**, along the radar's line of sight. No cosine
  correction is applied.
- `battery_mv` is always `{"ground":0,"pod":0}`: 0 means "not read". Neither
  unit has a battery-sense part. The field stays so the line's format is
  unchanged.
- Spin, face angle, club path, attack angle and swing plane are not outputs.

Other lines, each a JSON object with a `type` (launchmon-py's reader keeps
them in `messages` and reads only `"type":"shot"`): `boot` (firmware version
and sampling settings), `ready`, `event` (pod connected or disconnected, raw
streaming on or off), `error`, and `trigger_debug` with serial `d` on.

## Ground unit output (BLE, to a phone)

The unit advertises as `STEM-RADAR` with one service, `7d2a0101-…`, and one
characteristic:

- **Shot summary** (`7d2a0102-…`, read and notify, 42 bytes, wiring doc 3.3):
  one notification per shot, sent with the capture ring frozen. The same
  readings as the `shot` line. Its two battery fields are 0 ("not read").

`launchmon-hw/results/` is a phone page that reads it. There is no live-status
characteristic in this build: `7d2a0103-…` (`UnitStatus`, ground firmware
0.3-0.4) reported the pod's charging and the batteries, and those parts are
gone.

Serial commands: `r` toggles raw capture streaming, `d` toggles the trigger
debug print, `a` arms or disarms.

With raw streaming on, each shot is followed by two framed binary blocks, each
opened by a header line that states its exact length in bytes:

- `RAW_BEGIN {...}` then the 0.7 s radar capture as int16 I,Q pairs, then
  `RAW_END`. The header carries `capture_end_us`, the ground clock when the
  last pair was stored.
- `IMU_BEGIN {...}` then the pod's last ~2.5 s of samples, 20 bytes each: six
  int16 raw counts (gx gy gz ax ay az), the sample's time on the ground clock
  and on the pod's own clock (uint32 microseconds), then `IMU_END`.

`launchmon-py/scripts/record_ground_unit.py` saves the stream to a file, and
`launchmon-py/scripts/fuse_shot.py` fuses it with the phone clip (see the
launchmon-py README, "Fusion").

## Ground unit status LED

| Pattern | Meaning |
|---|---|
| 60 ms blip every 2 s | Armed, no pod linked (radar only) |
| Steady | Pod linked |
| Fast blink (5 Hz) | A capture triggered or being analysed |
| 2.5 Hz blink | Fault: no RAM for the capture buffers, or the ADC stream failed to start |

There is no low-battery pattern: nothing reads the cell. The TP4056 module's
DW01A protection cuts the cell off when it is flat, and the unit simply stops.

## Pod output

Nothing derived: raw IMU counts in BLE notifications, flagged where the sensor
clipped, dropped samples or showed a timing gap. The serial port prints
start-up diagnostics only.

The status packet is 28 bytes again (pod firmware 0.2 appended three bytes of
charging state; 0.3 drops them). Its `battery_mv` is 0, "not read". The ground
unit accepts either length. See the wiring doc, 3.2.

The pod's LED (the SuperMini's blue LED on GPIO8): a short flash every 0.5 s
while advertising, every 2 s while linked, solid during a swing. The pod
cannot read its cell, so it has no cell-low sleep: it runs until the ESP32's
brownout detector or the cell's own protection stops it. Charge it after each
session.
