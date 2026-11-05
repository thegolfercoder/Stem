# Results screen

A web page for the phone on the ground unit's dock. It connects to the unit
over Web Bluetooth and shows each shot to the golfer, in large type that can be
read from the address position. It is static: `index.html`, three ES modules and
a stylesheet. There is no build step and no framework, and the page makes no
request outside its own folder, so once it has loaded it keeps working on a
range with no signal.

It has not been run against a unit yet. Nothing in `launchmon-hw` has been
built (see the [hardware README](../README.md)). The page has been checked against
packets built byte for byte from the firmware's struct, and against a stand-in
for the Web Bluetooth API in headless Chromium.

## What it shows

Everything comes from the unit's two characteristics: the `ShotSummary`, one
per shot, and the live `UnitStatus` (ground firmware 0.3; layouts below).
Nothing on the screen is computed by the page except unit conversion, the
session means and the dock's retry countdown.

| On screen | From the packet | Notes |
|---|---|---|
| **Ball speed**, large | `ball_speed_radial` | The unit's on-device preview, `low_confidence`. Radial: along the radar's line of sight, with no cosine correction. |
| **Club speed** | `club_speed_radial` | The same. |
| **Smash** | `smash` | `derived`, ball over club, as the unit computed it. |
| Peak shaft rate | `peak_shaft_rate` | From the pod, `measured`, deg/s. |
| Tempo | `tempo_ratio` | Backswing over downswing duration, `derived`. |
| Unit battery | status `battery_mv_ground` (live), else the shot's | In volts. Not a percentage: turning a cell voltage into a percentage is a model, and the unit does not make one. "low" uses the unit's own 3.50 V threshold (`BATT_LOW_MV`). "radar fault" if the status says the ADC stream failed. |
| Pod | status `battery_mv_pod` and `pod_flags` (live) | The pod's cell in volts, then one of: connected (on the club, as far as the unit is concerned), **charging** (amber), charged, parked, on USB, charged and asleep on the dock, parked with no link, not connected. Charging and charged are the pod's own estimates. |
| Dock | status `dock_state`, `dock_reason`, `dock_retry_s` | Shown only when there is something to say: a fault, with the firmware's reason and the seconds until it tries again, or contacts held off because the unit's battery is low. |
| Source | | **LIVE** while status arrives; "N s old" in red once none has come for 75 s (the unit sends one at least every 30 s outside a capture); DEMO in the demo. |

**A unit without the live status** (ground firmware 0.2 or older) still works:
the page finds no status characteristic and shows what each shot carries, as
before. Unit and pod battery come from the latest shot (the pod value is the
last one the pod reported; the unit keeps it after the pod disconnects), "Pod
data" says whether the pod's samples covered that shot (yes, none at impact,
not connected, or unknown), and the row is marked "at shot N". The same
fallback applies while disconnected: what the unit said live is not shown once
the link is gone.

Each number is labelled with its provenance as the packet gives it. The current
shot is titled as the **unit's on-device preview**, which is what the firmware
calls these numbers. The reference values come from running launchmon-py on the
raw capture, not from this page.

Speeds are in mph by default, with m/s and km/h one tap away (1 mph = 0.44704
m/s exactly). The page remembers the choice. The decimals shown (whole mph and
km/h, 0.1 m/s, 0.01 for smash) are a display choice, not an accuracy.

The session panel lists the last 20 shots, newest first, under a pinned row of
means. Each mean says how many shots it is over ("5 of 6"). A shot with no
reading is counted and left out of the mean, never filled in. **Export CSV**
downloads the whole session: one row per shot, the values in the units the
firmware sends (m/s, deg/s), unrounded, with provenance, refusal code and
reason, both battery voltages, and the raw packet in hex. The session is also
kept in this browser's local storage, so a reload does not lose it. **New**
clears it.

While connected, the page asks the browser to keep the screen on (the Screen
Wake Lock API, where the browser has it). "Screen kept awake" appears at the
bottom while the lock is held.

## What it refuses

- **A refused reading is a dash with the firmware's reason**, for example "No
  reading: ball track rose after launch". The reasons are the firmware's
  `refusalText()`, word for word. A reading whose fields contradict each other
  (no refusal code but no number, an unknown provenance code, a negative
  value, or a refusal that still carries a number) is also shown as no reading,
  with a message saying what was wrong.
- **A packet that is not a version 1 `ShotSummary` is rejected whole**: wrong
  length, wrong magic byte or unknown version. Nothing in it is shown, and the
  session counts it as rejected.
- **Short notifications.** If the phone does not negotiate a larger BLE MTU, a
  42-byte notification arrives cut to 20 bytes. The page does not try to read
  that. It reads the characteristic instead, since a read is not cut short, and
  shows that shot. The 20-byte status always fits.
- **A status that is not a version 1 `UnitStatus`** (20 bytes, magic `0x5B`)
  is rejected whole, with a message; the last good one stays on screen and goes
  stale. Inside an accepted status, a combination the firmware never sends
  (for example "charging" without "power known", or a pod battery with no pod
  link) is shown as unknown, and a message says what was wrong.
- **Missed shots.** The status carries the unit's last `shot_seq`. If the
  session does not hold that shot (a notification lost, or cut short and the
  read failed), the page reads the shot characteristic once and adds it.
- It does not show spin, face angle, club path, attack angle or swing plane.
  The unit does not send them, and nothing in this repository reports them.

## Packet layout

From `firmware/ground_unit/ground_unit.ino` (`struct WireReading`, `struct
ShotSummary`, `wire()`, `enum class Prov`, `enum class Refusal`): packed,
little-endian, 42 bytes.

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | magic, `0x5A` |
| 1 | u8 | version, `1` |
| 2 | u16 | `shot_seq` |
| 4 | u32 | `impact_ms`, the unit's clock |
| 8 | reading | `ball_speed_radial`, m/s |
| 14 | reading | `club_speed_radial`, m/s |
| 20 | reading | `smash`, ratio |
| 26 | reading | `peak_shaft_rate`, deg/s |
| 32 | reading | `tempo_ratio`, ratio |
| 38 | u16 | `battery_mv_ground` |
| 40 | u16 | `battery_mv_pod` |

A reading is `value` f32, `provenance` u8 (0 none, 1 measured, 2 derived, 3
low_confidence, 4 modelled), `refusal` u8 (0 = a number; 1-12 = the reasons in
`enum class Refusal`). A refused reading carries NaN and provenance 0.

Service `7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10`, characteristic
`7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10` (read, notify), device name
`STEM-RADAR`. On connecting, the page also reads the characteristic once. That
returns the last shot the unit analysed, which may be from before this
connection. It is marked "before connecting" on screen and `read on connect` in
the CSV, and is skipped if it is already in the session.

### Live status

From `struct UnitStatus` (ground firmware 0.3; wiring doc 3.4): packed,
little-endian, 20 bytes, characteristic `7d2a0103-5b1c-4f6e-9c1e-3a6f1f0c2b10`
(read, notify) in the same service.

| Offset | Type | Field |
|---|---|---|
| 0 | u8 | magic, `0x5B` |
| 1 | u8 | version, `1` |
| 2 | u8, u8 | `fw_major`, `fw_minor` |
| 4 | u32 | `uptime_ms`, the clock `impact_ms` is on |
| 8 | u16 | `battery_mv_ground` |
| 10 | u16 | `battery_mv_pod`, 0 with no pod linked |
| 12 | u8 | `pod_flags`: bit0 connected, 1 power_known, 2 dock_power, 3 usb_host, 4 charging, 5 charged, 6 parked, 7 charged_asleep |
| 13 | u8 | `unit_flags`: bit0 dock_fitted, 1 buzzer_fitted, 2 buzzer_on, 3 user_armed, 4 raw_streaming, 5 batt_low, 6 adc_fault |
| 14 | u8 | `dock_state`: 0 off, 1 confirming, 2 charging, 3 fault, 4 low_battery |
| 15 | u8 | `dock_reason`: 0-8, the `pod_dock` USB reasons word for word |
| 16 | u16 | `dock_retry_s`, the fault lockout's seconds left |
| 18 | u16 | `shot_seq` of the last shot |

The unit notifies it on any change (at most four a second; a battery has to
move 25 mV), every 30 s, and when a phone connects, but never during a capture
or a pod swing. On connecting, the page reads the shot first, then the status.

## Browsers

| Browser | Works? |
|---|---|
| Chrome on Android | Yes |
| Chrome or Edge on Windows, macOS, ChromeOS | Yes |
| Safari on iPhone or iPad | **No.** Safari has no Web Bluetooth, and Chrome and Firefox on iOS use Safari's engine. Use a browser that adds it, such as Bluefy. |
| Firefox (any platform) | No |
| Chrome on Linux | Support varies |

The page detects a browser without Web Bluetooth and explains this on screen,
with the demo one tap away.

## Serving it

Web Bluetooth only runs on a secure page: `https://`, or `http://localhost` on
the same machine. Opening `index.html` from the file system does not work
either way, because browsers block ES modules on `file://`; the page says so if
that happens.

- **GitHub Pages**: publish the repository's branch (Settings, Pages, deploy
  from a branch, root folder). The page is then at
  `https://<user>.github.io/Stem/launchmon-hw/results/`. Open it once with a
  signal; after that it loads offline too (below).
- **On a computer**, for testing with a desktop browser:

  ```bash
  cd launchmon-hw/results
  python3 -m http.server 8000
  # open http://localhost:8000
  ```

  An Android phone on USB can reach that server as its own `localhost` with
  Chrome's port forwarding (`chrome://inspect`, Port forwarding, 8000 to
  `localhost:8000`). Over the local network the address is plain `http://`, and
  Web Bluetooth is not available there.

A small service worker (`sw.js`) caches the page's files on the first visit
over https or localhost. Later visits load from that cache straight away,
signal or not, and refresh it in the background, so an update appears one
visit later.

## Demo mode

**Demo** (or `index.html?demo=1`) runs the page without a unit. It generates
synthetic `ShotSummary` and `UnitStatus` packets, packs them exactly as the
firmware does and passes them through the same parsers as real notifications,
including a few refusals of the kinds the firmware produces. The status runs
through a repeating story of about 90 s: the pod on the club, parked and
charging, charged, asleep on the dock, then lifted, and a dock fault that locks
the contacts out for 30 s. Shots taken while the pod is parked carry no pod
data, as on the unit. While it runs:

- a striped banner across the top reads **DEMO: synthetic data, not a
  measurement**, and stays there;
- the shot panel has a dashed border and is tagged DEMO, every row in the
  list carries a DEMO chip, and so does the status row;
- **Export CSV is disabled**, and demo shots are never stored. Stopping the
  demo discards them and brings back the real session.

The demo's numbers, spread, refusal rate and charging times describe nothing
about the unit or the pod.

## Tests

```bash
cd launchmon-hw/results
node --test        # node 20 or later; no dependencies
```

`test/protocol.test.mjs` builds packets byte by byte from the firmware's
structs, not with the page's own encoders, and checks every field's offset,
endianness and scaling; refused and contradictory readings; short, garbled,
over-long and wrong-version packets (rejected, not misread); the unit
conversions; the session means; and the CSV. For the status it also reads
`ground_unit.ino` itself and checks the UUID, magic, size, flag bits, dock
states and every dock reason against it, every pod state the firmware can
send, the contradictions it never sends, and two cycles of the demo. `package.json` exists only to mark
the files as ES modules for node.

## What it does not do

- **Live state from an older unit.** Ground firmware 0.2 and earlier send only
  the shot summary: battery voltages arrive with a shot, and the pod's link,
  dock and charge state are only on the unit's USB serial output. Flash 0.3 or
  later for the live row.
- **Store the status.** The CSV and the saved session hold shots only.
- **Reconnect after a reload.** Within a page load it reconnects by itself
  after a dropped link, retrying with a growing delay (up to 30 s) until it gets
  the unit back or you tap Stop. After a reload, tap Connect again.
- **Raw captures.** The I/Q capture and the pod's samples go over USB to
  launchmon-py. This page only shows the unit's preview.
- **Change anything on the unit.** It only reads.
