# Firmware

One sketch per unit. Each folder name matches its `.ino`, as the Arduino IDE requires.

| Sketch | Runs on | Role |
|---|---|---|
| `ground_unit/ground_unit.ino` | Ground radar unit's ESP32-C3 | Captures the radar's I/Q signals, triggers on a shot, runs the FFT analysis, links to the pod as BLE central, serves a phone as BLE peripheral, streams JSON and raw captures over USB, sounds the piezo, switches the pod's charging contacts, and with soft power deep-sleeps when switched off and wakes to charge a parked pod |
| `shaft_pod/shaft_pod.ino` | Pod's ESP32-C3 | Samples the IMU at 1.66 kHz, streams swings as raw counts over BLE, deep-sleeps with wake-on-motion, stands down and reports its charge state while parked on the ground unit |

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

Optional parts, each a `#define` near the top of its sketch. Set one to 0 when
that part is not fitted; its GPIOs are then left alone.

| Define | Sketch | Default | Part |
|---|---|---|---|
| `STEM_BUZZER` | ground unit | 1 | Piezo disc on GPIO7 (wiring doc 1.6) |
| `STEM_POD_DOCK` | ground unit | 1 | Pod charging switch on GPIO6, DOCK+ sense on GPIO3 (wiring doc 4) |
| `STEM_SOFT_POWER` | ground unit | 1 | Soft power (wiring doc 1.1, 1.7): the slide switch is a logic input on GPIO5, the radar and pre-amp are switched on GPIO2, USB power is read on GPIO20. **Set it to 0 for a unit wired the older way**, with the switch between the TP4056 and the MT3608: its GPIO5 floats, and a soft-power build would take that for "switched off". A soft-power unit built with 0 never powers its radar |
| `STEM_DOCK` | pod | 1 | DOCK+ pad sense on GPIO1 (wiring doc 4) |
| `STEM_USE_2M_PHY` | pod | 1 | Not a part: set to 0 if NimBLE lacks `updatePhy()` |

## Ground unit power states (`STEM_SOFT_POWER`)

| State | When | What runs |
|---|---|---|
| on | slide switch on | everything in this README |
| off, charging | switch off, a pod parked, and allowed: on USB if the unit's cell is at least 3.55 V; on battery from 3.85 V, stopping under 3.70 V | the contacts' logic (wiring doc 4.7), the BLE link to the pod, a 1 s status advertisement, a 40 ms LED blip every 4 s. No radar, no captures, no sound; CPU at 80 MHz |
| off, asleep | everything else | deep sleep, about 53 µA from the cell (wiring doc 1.7) |

- **Wakes:** the switch going on (GPIO5 held low), a pod being parked or USB
  power arriving (each a short low pulse on GPIO5), and a timer only where one
  is needed: on USB, 10 min after a pod had to wait and every 12 h to top up a
  charged, parked pod for 15 min; after a charging fault, at the end of its
  lockout.
- **A session ends** when the pod has said charged and gone to sleep (or said
  charged for 3 min), is lifted, is on its own USB, faults, or after 2.5 h
  (pods before firmware 0.2 never report their charge). The unit remembers a
  charged, parked pod in RTC memory, so a USB wake does not start a new session
  for it; parking a pod (a new pulse) clears that.
- **Switching** on or off goes through a 1 ms or 10 ms deep sleep, so each state
  starts from a clean boot. A pod charging when the unit is switched off loses
  its contacts for about a second.
- **The switch is read** 120 ms after start-up (any wake pulse is over by
  then) with 50 ms of debounce. Switched off, the sketch never waits for a USB
  host, and goes back to sleep within about 0.2 s: **switch the unit on to
  flash it**, or hold BOOT and tap RESET.
- **Status:** `UnitStatus.unit_flags` bit 7 (`soft_off`) is set in the
  off-charging state. There was one spare bit and no spare field, so USB power
  is not in the characteristic; it is in the USB `power` line.
- **Pins held in deep sleep:** GPIO6 low (contacts and boost off) and GPIO2 high
  (radar off), with `gpio_hold_en` and `gpio_deep_sleep_hold_en`. The resistors
  on those pins hold the same levels on their own; the hold keeps the pads from
  being configured otherwise while asleep.
- **Not started:** `Serial1`. Its RX pin, GPIO20, reads USB power.

## Verification status

**Neither sketch has been compiled for the ESP32-C3 or run on hardware yet.**
They have been checked with a host compiler (`g++ -std=gnu++2a -fsyntax-only
-Wall -Wextra`) against stub headers. That catches C++ errors in the sketches.
It cannot catch a mismatch with the real NimBLE-Arduino or ESP-IDF APIs,
because the stubs were written to match the APIs as the sketches use them.
The first real compile is the next check. The likeliest failure point is
`NimBLEServer::updatePhy()` in the pod: if your NimBLE-Arduino version lacks
it, set `STEM_USE_2M_PHY` to 0. The buzzer uses the core 3.x LEDC calls
`ledcAttach(pin, freq, bits)` and `ledcWrite(pin, duty)`; core 2.x's
channel-based `ledcSetup` is not used. Both sketches were also checked with
every optional part switched off, and with a full `-c` compile, which reports
unused functions that `-fsyntax-only` does not. The ground unit compiles with
no warnings for all eight combinations of `STEM_BUZZER`, `STEM_POD_DOCK` and
`STEM_SOFT_POWER`. The soft-power code uses `esp_sleep.h`
(`esp_deep_sleep_enable_gpio_wakeup`, `esp_sleep_enable_timer_wakeup`,
`esp_sleep_get_wakeup_cause`), `driver/gpio.h` (`gpio_hold_en`,
`gpio_deep_sleep_hold_en`), `RTC_DATA_ATTR` and `setCpuFrequencyMhz`, and
NimBLE's `setMinInterval`/`setMaxInterval`; those are stubbed, so check them
first on the real compile. Its off current has not been measured.

The ground unit's I/Q skew correction was checked numerically: a Python port of
`spectrumFrame()` on synthetic tones with Q sampled half a sample late gives
about 62 dB of image rejection, against 4-34 dB without the correction (worst
near 15 kHz). That checks the arithmetic, not the radar.

## Ground unit output (USB serial)

One JSON object per line:

`impact_ms` is on the `millis()` clock, the same as the live status's
`uptime_ms` (from firmware 0.4; it used to wrap every 71.6 minutes).

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

Other lines, each a JSON object with a `type` (additive; launchmon-py's
reader keeps them in `messages` and reads only `"type":"shot"`):

- `boot` carries `"buzzer"`, `"pod_dock"` and `"soft_power"`: whether those were built in.
- `power` (soft power), on each change of power state:
  `{"type":"power","state":"off_sleeping","reason":"no pod on the contacts","battery_mv":3912,"usb":false,"wake_timer_s":0}`.
  `state` is `on` or `off` (the switch moved), `off_charging` or
  `off_sleeping`; `wake_timer_s` is the sleep's timer wake, 0 for none.
- `pod_dock`, when the charging contacts change state:
  `{"type":"pod_dock","state":"charging","reason":"pod parked","off_mv":2470,"on_mv":4810}`.
  `state` is `charging`, `off`, `fault` or `low_battery`; the reason says why.
  `off_mv` and `on_mv` are DOCK+ with the switch off and on (0 = not read).
- `pod_power`, when the pod's reported power state changes:
  `{"type":"pod_power","dock_power":true,"usb_host":false,"charge":"charging","battery_mv":3950,"dock_pad_mv":4790}`.
  `charge` is `charging`, `charged` or `not_charging`, an estimate (wiring doc 4.7).
- `dock_debug`, with trigger debug on: the readings from every contact check.

The end of a fault's lockout is a `pod_dock` line too (`"state":"off"`,
reason `fault lockout over: looking for a pod again`), from firmware 0.3.

## Ground unit output (BLE, to a phone)

The unit advertises as `STEM-RADAR` with one service, `7d2a0101-…`, and two
characteristics, both read and notify. Layouts are in the wiring doc, section 3.

- **Shot summary** (`7d2a0102-…`, 42 bytes, 3.3): one notification per shot,
  sent with the capture ring frozen. The same readings as the `shot` line.
- **Live status** (`7d2a0103-…`, 20 bytes, 3.4; firmware 0.3 and later; bit 7
  of `unit_flags`, `soft_off`, from 0.4): the
  unit's battery, whether the pod is connected, parked, charging or charged
  and its battery, the dock state machine's state, reason and lockout
  countdown, the last `shot_seq`, and a few build and mode flags. Notified on a
  change (at most four a second; a voltage must move 25 mV), every 30 s, and
  when a phone connects; readable at any time. Never built or sent while a
  capture is triggered or analysed or the pod reports a swing, and it never
  pauses the radar stream. It fits a default-MTU notification whole.

`launchmon-hw/results/` is a phone page that reads both.

Serial commands: `r` toggles raw capture streaming, `d` toggles the trigger
debug print (and the `dock_debug` lines), `a` arms or disarms, `b` turns the
buzzer on or off.

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
start-up diagnostics and dock changes only.

From firmware 0.2 the status packet carries three more bytes: power flags (on
dock power, USB connected to a computer, charging, charged) and the DOCK+ pad
voltage. The ground unit reads them only when the packet is long enough, so
either unit can be updated first. See the wiring doc, 3.2.
