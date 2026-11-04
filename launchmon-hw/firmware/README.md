# Firmware

One sketch per unit. Each folder name matches its `.ino`, as the Arduino IDE requires.

| Sketch | Runs on | Role |
|---|---|---|
| `ground_unit/ground_unit.ino` | Ground radar unit's ESP32-C3 | Captures the radar's I/Q signals, triggers on a shot, runs the FFT analysis, links to the pod as BLE central, serves a phone as BLE peripheral, streams JSON and raw captures over USB |
| `shaft_pod/shaft_pod.ino` | Pod's ESP32-C3 | Samples the IMU at 1.66 kHz, streams swings as raw counts over BLE, deep-sleeps with wake-on-motion |

The two share only the BLE packet format, which is specified in
[`../docs/wiring_schematic.md`](../docs/wiring_schematic.md#3-ble-link) and
pinned on both sides with `static_assert`s on the struct sizes.

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
release BOOT, then upload.

## Verification status

**Neither sketch has been compiled for the ESP32-C3 or run on hardware yet.**
They have been checked with a host compiler (`g++ -std=gnu++2a -fsyntax-only
-Wall -Wextra`) against stub headers. That catches C++ errors in the sketches.
It cannot catch a mismatch with the real NimBLE-Arduino or ESP-IDF APIs,
because the stubs were written to match the APIs as the sketches use them.
The first real compile is the next check. The likeliest failure point is
`NimBLEServer::updatePhy()` in the pod: if your NimBLE-Arduino version lacks
it, set `STEM_USE_2M_PHY` to 0.

The ground unit's I/Q skew correction was checked numerically: a Python port of
`spectrumFrame()` on synthetic tones with Q sampled half a sample late gives
about 62 dB of image rejection, against 4-34 dB without the correction (worst
near 15 kHz). That checks the arithmetic, not the radar.

## Ground unit output (USB serial)

One JSON object per line:

```json
{"type":"shot","shot_seq":3,"impact_ms":81234,"analysis_ms":910,
 "ball_speed_radial":{"value":61.2,"unit":"m/s","provenance":"low_confidence","source":"radar-fw-preview"},
 "club_speed_radial":{"value":43.9,"unit":"m/s","provenance":"low_confidence","source":"radar-fw-preview"},
 "smash_factor":{"value":1.394,"unit":"ratio","provenance":"derived","source":"radar-fw-preview"},
 "peak_shaft_rate":{"no_reading":"gyro at full scale (2000 dps) during the downswing","source":"imu"},
 "tempo_ratio":{"value":3.02,"unit":"ratio","provenance":"derived","source":"imu+radar"},
 "battery_mv":{"ground":3987,"pod":4011},"pod_dropped_samples":0,"adc_desync":0}
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
- Spin, face angle, club path, attack angle and swing plane are not outputs.

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

## Pod output

Nothing derived: raw IMU counts in BLE notifications, flagged where the sensor
clipped, dropped samples or showed a timing gap. The serial port prints
start-up diagnostics only.
