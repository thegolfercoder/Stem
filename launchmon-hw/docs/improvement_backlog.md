# Improvement backlog

The queue for the continuous improvement loop. Each round takes the first item
marked `todo`, builds it with worker agents, checks it, commits and pushes it,
then marks it `done` here with the commit. When the queue is empty the loop
adds the next most valuable improvement it can justify, with the reason, and
carries on. Edit this file to reorder, add or drop items; mark one `skip` to
leave it out.

Rules every round follows:

- **Budgets hold.** Printed parts at most $10 a kit at the print-farm rate
  (`cad/stl/cost_report.txt`); retail target $80-100, so added parts stay cheap.
- **Checks pass before a push.** Fit report with no `FAIL`; launchmon-py
  `ruff check`, `ruff format --check`, `mypy -p launchmon`, `pytest`; firmware
  `g++ -Wall -Wextra` against the stub headers with every feature flag on and
  off; Blender scripts compile. Unchanged STLs are restored, not re-triangulated.
- **Honesty.** No measured number without a measurement; anything unbuilt is
  said to be unbuilt. Spin, face angle, club path, attack angle and swing plane
  are never outputs.
- **Design language** in `design_language.md`: matte black, one focal point,
  every detail has a job, no supports.

| # | Item | Why | Status |
|---|---|---|---|
| 0 | **The phone films from the unit; no tripod** (owner's decision, 2026-11-06, replacing the tripod camera). The phone mounts behind the radar on the dock stem by MagSafe or a clamp (lock), on an adjustable head: tilt back about 25 deg and turn about 20 deg toward the golfer, either hand, in detents, lens clear of the unit. The dock stays stable with a phone up to about 240 g; an iPad is not mounted on the unit. Docs: camera on the unit; fusion takes the camera distance from the unit's own distance to the ball. | Owner wants one object and no tripod. Geometry: lens about 0.2 m up, 1.45 m behind the ball; framing the ball, golfer and club at the top needs about 61 deg vertical and 41 deg horizontal. The 1x lens in portrait (about 69 x 42 deg) only fits when tilted and turned; the 0.5x lens fits easily. Pose accuracy from this low view is unmeasured until validated on clips from it. | todo |
| 1 | **Results screen on the phone.** A web page that connects to the ground unit over Web Bluetooth and shows each shot's club speed, ball speed and smash factor, readable from the address position. Note iOS Safari lacks Web Bluetooth (Bluefy works). | The unit already sends a shot summary over BLE; nothing reads it, so the phone on the dock has nothing to show. | done: `launchmon-hw/results/` (57583ef) |
| 2 | **Fit test piece**, and widen gaps under 0.3 mm where there is room. A small print with the pin bores, magnet pockets, contact pilots and a pod-in-hood socket slice. | Several fits are 0.1-0.25 mm, below what most printers hold. Ten minutes of printing protects a four-hour print. | done: `fit_test_coupon.stl`; every fit at 0.3 mm or more except three explained in the CAD |
| 2a | **Swing Studio reads the launch monitor: one app.** The iPhone app (`ios/`) connects to the ground unit over CoreBluetooth, shows each shot's speeds beside the camera's swing analysis, and lines the clip up with the radar by the strike, the way `launchmon-py` fusion does. Keep swingml's rule: speeds only from the radar, never the camera. | The two halves are now on one branch; this makes them one product. It also gives iPhones a results screen, which Safari's lack of Web Bluetooth denies the web page. | done: SwingCore `LaunchMonitor` and `ShotPairing` (73 tests), app `RadarLink`; CI builds the app. **Open owner decision:** `agents/CHARTER.md` and `docs/product/metric-definitions.md` still say ball and club speed are never shown; the app shows the radar's, never the camera's. The owner chose to settle this before merging. |
| 3 | **Charge while "off" (soft power).** The slide switch becomes an input; off means deep sleep, so a plugged-in unit charges a parked pod. | The pod can only charge from a switched-on unit today. | todo |
| 4 | **Reusable pod strap.** A printed TPU strap with a latch replaces the single-use zip ties, still a positive lock. | Zip ties every session are a chore and a cost. | todo |
| 5 | **Knocks and rain.** A catch on the pod park hood, and a printed TPU gasket in the lid seam. | The hood sticks out 30 mm and the magnets hold about 7 N; the seam relies on optional silicone. | todo |
| 6 | **A live status characteristic** on the ground unit (e.g. `7d2a0103-…`, read + notify, on change and every 30 s): firmware version, unit battery, pod connected, pod parked and charging or charged, dock state, pod battery. Then show it on the results screen. | Found while building the results screen: battery only updates when a shot arrives, and pod state exists only on USB serial, so the page cannot show whether the pod is connected or charging. | done: `7d2a0103`, 20 bytes, firmware 0.3; the results screen shows it live |
