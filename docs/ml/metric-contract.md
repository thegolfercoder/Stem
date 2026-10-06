# Metric contract

What every output of the analysis promises, in code as well as in words. The types
are in `swingml/swingml/quantity.py`, `analysis.py` and `metrics/swing.py`; the
promises below are enforced by tests named in brackets.

## Every number is a `Quantity` or a `NoReading`

A `Quantity` carries `value`, `unit`, `provenance`, `source` and `assumptions`. It has
no uncertainty field on purpose: an optional error bar invites a guessed one.
Measured uncertainty travels separately (`event_uncertainty`, `tempo_uncertainty`)
and exists only where it was measured on held-out real swings through the same
weights (`ModelCalibration.matches` checks the fingerprint). A `NoReading` carries
the reason and the layer that refused (`pose`, `events`, `metrics`, `timestamps`,
`calibration`, `capture`).

| Provenance | Means | Examples |
|---|---|---|
| `measured` | read from frames and timestamps by operations that only reduce data | backswing and downswing duration, peak-hand-speed timing |
| `derived` | a closed-form function of measured values | tempo ratio |
| `projected` | geometric, but in the image plane, so it depends on where the camera stood | shoulder/hip turn from foreshortening, line tilt, head movement, sway, lift |
| `estimated_3d` | from the pose network's own depth output, refused when it does not hold the body rigid | 3D shoulder and hip turn, separation |
| `modelled` | produced by a model rather than observed; must list assumptions | (none shipped) |

## Event outputs

Per event: the frame in the source clip (`event_source_frames`), its time
(`event_times_s`), the model's probability at that frame (`events.confidence`, a
diagnostic, not an error bar), a sub-frame position, and a measured error band where
one exists. Positions set by the golfer are marked `positions_set_by="golfer"` and
carry no model bands [`test_golfer_positions.py`]. A clip read as slow motion carries
`playback_slowed_by` and no millisecond bands [`test_measured_failures.py`], and
`playback_retimed` says whether it was measured on the slowed-down timeline (true) or as
recorded (false, "may be slow motion"). Positions the golfer moves on such a clip are
measured the same way and its durations stay withheld, on the desktop as in the browser
(#74) [`test_golfer_positions.py`, `test_browser_slow_motion.py`].

## Metrics shipped

| Metric | Unit | Provenance | Definition | Refused when |
|---|---|---|---|---|
| Tempo ratio | - | derived | (top − address) / (impact − top), in time | downswing has no duration |
| Backswing | ms | measured | top − address | clip read as slow motion |
| Downswing | ms | measured | impact − top | clip read as slow motion |
| Whole swing | ms | - | **always refused**: the finish is not placed reliably (median error 29 frames) | always |
| Peak hand speed timing | ms | measured | time of fastest hands between top and impact, relative to impact | slow motion |
| Shoulder / hip turn | deg | projected | arccos(line width at the top ÷ 95th-percentile width over the swing); magnitude only | line never seen clearly |
| Shoulder / hip line tilt, separation | deg | projected | change in the line's angle in the image, address to top | - |
| 3D shoulder / hip turn, separation | deg | estimated_3d | rotation about vertical of the network's world landmarks, address to top | depth output not rigid (length varies >25%) |
| Head movement | body lengths | projected | ear midpoint, address to impact, relative to the ankles | feet not seen |
| Pelvis sway / lift | body lengths | projected | hip midpoint horizontal / vertical change, address to impact, relative to the ankles | feet not seen |
| Kinematic sequence | order | estimated_3d or projected | order of peak angular speed of pelvis, chest, lead arm in the downswing | reported as observed, not scored |

The whole analysis is refused (every metric a `NoReading`) when a body is found in
under 50% of frames, the core events' geometric-mean confidence is below 0.30 or all
eight below 0.20, or the backswing, downswing or tempo is implausible at every
playback speed tried (1x, then 2x, 4x, 8x faster).

## Never output

Club face angle, club path, swing plane, attack angle, club-head speed, ball speed,
spin rate or axis, launch angle, carry or total distance. One uncalibrated camera and a
body tracker cannot measure any of them. The coach guard drops any sentence asserting
one [`test_coach.py`]; no metric field exists for them; the swing page lists them
under "What this analysis cannot tell you".

## Uncertainty the product states

- Tempo: ±27% for 80% of held-out real swings (85.4% coverage measured on the test set).
- Tempo compression: readings move at about 0.44 of the real change (95% CI 0.15-0.70).
- Event bands: per event, frames at 60 Hz, 80% coverage on the calibration split.

## Versioning

`SwingAnalysis` is a pydantic model stored as JSON; fields are only added with
defaults, so every stored analysis still loads [`test_store_and_web.py`]. The store
schema has a version in its `meta` table (2 since the practice tables were added).
