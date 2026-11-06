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
for the Web Bluetooth API in headless Chromium (before firmware 0.5). The
firmware 0.5 version has been loaded in headless Chrome in demo mode only.

## What it shows

Everything comes from the unit's one characteristic, the `ShotSummary`, one
per shot (layout below). Nothing on the screen is computed by the page except
unit conversion and the session means.

| On screen | From the packet | Notes |
|---|---|---|
| **Ball speed**, large | `ball_speed_radial` | The unit's on-device preview, `low_confidence`. Radial: along the radar's line of sight, with no cosine correction. |
| **Club speed** | `club_speed_radial` | The same. |
| **Smash** | `smash` | `derived`, ball over club, as the unit computed it. |
| Peak shaft rate | `peak_shaft_rate` | From the pod, `measured`, deg/s. |
| Tempo | `tempo_ratio` | Backswing over downswing duration, `derived`. |
| Unit, Pod (batteries) | `battery_mv_ground`, `battery_mv_pod` | **"unavailable"**, never 0 V. From ground firmware 0.5 both fields are 0, "not read": neither unit has a battery-sense part. A unit on older firmware (0.2-0.4) sent voltages, and the page still shows those in volts, marked as from that shot. |
| Pod data | `peak_shaft_rate`, `tempo_ratio` refusals | Whether the pod's samples covered the latest shot: yes, none at impact, not connected, or unknown. |

The row under the shot is marked "at shot N": the unit sends nothing between
shots, so everything in it comes from the latest shot.

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
  shows that shot.
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
| 38 | u16 | `battery_mv_ground`, 0 = not read (always 0 from firmware 0.5) |
| 40 | u16 | `battery_mv_pod`, 0 = not read (always 0 from firmware 0.5) |

A reading is `value` f32, `provenance` u8 (0 none, 1 measured, 2 derived, 3
low_confidence, 4 modelled), `refusal` u8 (0 = a number; 1-12 = the reasons in
`enum class Refusal`). A refused reading carries NaN and provenance 0.

Service `7d2a0101-5b1c-4f6e-9c1e-3a6f1f0c2b10`, characteristic
`7d2a0102-5b1c-4f6e-9c1e-3a6f1f0c2b10` (read, notify), device name
`STEM-RADAR`. On connecting, the page also reads the characteristic once. That
returns the last shot the unit analysed, which may be from before this
connection. It is marked "before connecting" on screen and `read on connect` in
the CSV, and is skipped if it is already in the session.

There is no second characteristic. Ground firmware 0.3 and 0.4 had a live
status, `7d2a0103-…` (`UnitStatus`), for the pod's charging and both
batteries; those parts were removed from the hardware, and firmware 0.5 has
no such characteristic. The page does not look for it.

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
synthetic `ShotSummary` packets, packs them exactly as the firmware does and
passes them through the same parser as real notifications, including a few
refusals of the kinds the firmware produces. Their battery fields are 0, as
firmware 0.5 sends. While it runs:

- a striped banner across the top reads **DEMO: synthetic data, not a
  measurement**, and stays there;
- the shot panel has a dashed border and is tagged DEMO, and every row in the
  list carries a DEMO chip;
- **Export CSV is disabled**, and demo shots are never stored. Stopping the
  demo discards them and brings back the real session.

The demo's numbers, spread and refusal rate describe nothing about the unit or
the pod.

## Tests

```bash
cd launchmon-hw/results
node --test        # node 20 or later; no dependencies
```

`test/protocol.test.mjs` builds packets byte by byte from the firmware's
structs, not with the page's own encoders, and checks every field's offset,
endianness and scaling; refused and contradictory readings; short, garbled,
over-long and wrong-version packets (rejected, not misread); the unit
conversions; the session means; and the CSV. It also reads `ground_unit.ino`
itself and checks the `ShotSummary` struct, its 42-byte `static_assert`, the
UUIDs and every `refusalText()` against it, that the sketch is firmware 0.5
with no status characteristic and sends both battery fields as 0, and that the
demo's packets parse cleanly. `package.json` exists only to mark the files as
ES modules for node.

## What it does not do

- **Live state between shots.** The unit sends one value per shot; the pod's
  link shows on the unit's own LED (steady when linked) and its USB serial
  output.
- **Battery levels.** Neither unit measures its cell (firmware 0.5): charge
  both after each session.
- **Reconnect after a reload.** Within a page load it reconnects by itself
  after a dropped link, retrying with a growing delay (up to 30 s) until it gets
  the unit back or you tap Stop. After a reload, tap Connect again.
- **Raw captures.** The I/Q capture and the pod's samples go over USB to
  launchmon-py. This page only shows the unit's preview.
- **Change anything on the unit.** It only reads.
