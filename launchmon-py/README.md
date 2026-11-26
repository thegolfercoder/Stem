# launchmon-py — Stage 1

The research and validation environment. Stage 1 covers the synthetic radar
generator and the radar DSP core: STFT, ridge extraction, impact segmentation,
and the decay fit that recovers launch speed before drag.

## What Stage 1 produces

| Output | How | Provenance |
|---|---|---|
| Ball launch speed, radial | Ridge over the ball segment, drag decay fit extrapolated to impact | measured |
| Clubhead speed | Upper edge of the club's return band before impact | measured |
| Smash factor | Ball speed over clubhead speed | derived |
| Impact time | Spectral flux for the frame, ball-band envelope onset for the instant | measured |

The radar reports speed **along its own line of sight**. Correcting that to the
ball's true speed needs a launch angle and belongs to fusion, where either a
per-club prior or a camera-measured angle can supply it. The DSP does not apply a
cosine factor of its own.

## Results from the synthetic study

All figures below are the behaviour of this pipeline on this synthetic signal
model. They are not accuracy claims about the instrument, and they will move when
the signal model is replaced by measurements from real hardware.

**Acceptance.** Launch speed is recovered from 15 m/s to 74.66 m/s within the
0.5% target at 20 dB in-band SNR, across five noise realisations per speed
(`tests/test_speed.py`). "High SNR" is pinned to a number there, because it is not
otherwise testable and because the analogue front end has to be specified against
something.

**What the front end must deliver.** Sweeping SNR, speed and transform length
(`scripts/snr_sweep.py`), the lowest in-band ball SNR at which every speed meets
0.5% RMS error with no refusals is **+6 dB with a 1024-point window** and
**+10 dB with 2048**.

**Transform length is not a free choice.** A driven ball's tone sweeps downward
while a single frame is being collected — about 156 Hz within a 42.7 ms window at
driver speeds, against 23.4 Hz bins — so a longer window buys frequency
resolution and spends it again smearing the peak it is trying to resolve. Across
the sweep the 1024-point window beats 2048 at every speed and every SNR, and 4096
fails outright above 25 m/s: an 85 ms window cannot resolve the club's band
either, so the clubhead estimate collapses and the smash-factor cross-check
correctly refuses the shot.

**Sub-bin interpolation is doing the work, not the transform.** At 23.4 Hz bins a
15 m/s chip's tone is about 2.4 kHz, and half a percent of that is roughly half a
bin. Parabolic interpolation on log magnitude locates a stationary tone to under
0.4 Hz, so the accuracy target is a statement about the interpolator.

**Impact timing.** Frame resolution alone puts impact about 4.7 ms from truth,
which at driver speeds is a meaningful part of the error budget. The band-limited
envelope onset brings that under 0.7 ms across the whole speed range and down to
3 dB SNR.

**Range loss decides how long the ball is visible, and processing gain decides
how long it is usable.** Received power falls as the fourth power of range, so a
driven ball's return is 20 dB down within about 38 ms of impact. That is not the
usable window: a 2048-point transform concentrates the tone against spread noise
for roughly 30 dB of processing gain, measured, so the ball stays trackable far
beyond it. The usable window is set by SNR, which is what the sweep measures.

**The validity threshold has a floor that is not a matter of taste.** The largest
of N independent noise bins stands about `10*log10(ln(N)/ln(2))` dB above their
median simply because it is the largest of N — measured at 10.1 dB mean and
13.7 dB maximum for the ~840 bins of a 48 kHz capture, against 9.87 dB predicted.
Any peak-to-floor threshold at or below that admits pure noise as signal, and the
tracker then reports a confident frequency for a frame containing nothing. This
was the source of every catastrophic low-SNR failure during development.

## Failure modes that are handled, and one that is not

The dangerous failure in this pipeline is not a missing reading. It is the club
being followed as though it were the ball, which returns a clubhead speed
presented as a ball speed — a plausible number and a wrong one. Three things
guard against it:

- The ball is identified as the strongest tone above the **upper edge of the
  club's band**, not above the club's peak. The club is an extended rotating body
  and its band is wide; searching above its peak leaves much of its own return in
  scope.
- Ball speed and clubhead speed are estimated from different parts of the capture
  by different methods, so their ratio is a real cross-check. A ratio outside what
  a struck ball can produce refuses the ball speed.
- A tone found outside the passband the analogue chain is configured for is
  refused, because it has been attenuated by an unknown amount.

**The one that is not handled**, and cannot be: if the hardware band-limits the
ball away while the configuration still describes the intended passband, both
speeds are drawn from the same distorted club band, both are wrong, and they agree
with each other. No cross-check between them can catch it, because the information
that would settle it was destroyed before the converter. This needs the analogue
chain verified at capture time — an injected tone, or the shape of the noise floor
— which belongs to the capture layer. The limitation is pinned by a test
(`test_a_front_end_that_does_not_match_its_configuration_is_not_detectable`) so it
cannot be quietly forgotten.

## Values that are calibrations, not measurements

Flagged here because they look like constants and are not:

- `edge_drop_db` — how far below its peak the club's band is followed to find its
  upper edge. Fitted against reference clubhead speeds, which do not exist yet.
  It is insensitive to the shaft's scatterer distribution across everything the
  generator can produce, which is reassuring but says nothing about a real club,
  hands and body.
- `onset_threshold_fraction` — trades impact-timing bias against noise immunity.
- `ball_drag_coefficient_provisional` — replaced by the Stage 2 trajectory fit.
- `clubhead_radius_m` in `config/clubs.yaml` — not a club length and not measured.
- `implied_smash_bounds` — plausibility bounds, not an accuracy claim.

## Two deviations from the layout in the brief

`launchmon/dsp/pipeline.py` and `launchmon/dsp/interference.py` are not in the
brief's file list. The first is the unit the Swift port reproduces and the golden
vectors pin, and folding it into `speed.py` would have made that unit implicit.
The second suppresses stationary narrowband interferers, which turned out to be
necessary rather than optional: hum harmonics are tones, and every stage after the
transform is looking for tones, so hum can be picked as the club, as the ball, or
as both. What separates hum from a golf shot is not amplitude but motion — every
real component here sweeps, and an interferer locked to the mains does not.

## Fusion: radar, club IMU and phone camera on one timeline

The ground unit in `launchmon-hw/` reads a two-channel (I/Q) radar on its own
ESP32-C3 and receives the club pod's IMU over Bluetooth. A phone films the
swing, and swingml analyses the clip. `launchmon.ingest`, `launchmon.imu` and
`launchmon.fusion` turn the three into one shot.

```bash
python scripts/record_ground_unit.py /dev/ttyACM0 session.bin   # raw USB stream (pyserial)
swingml analyse swing1.mov --json camera.json                   # the phone clip
PYTHONPATH=. python scripts/fuse_shot.py session.bin --camera camera.json \
    --video swing1.mov --club driver --camera-distance 3.0 --json fused.json
```

**Radar.** `ingest.iq` keeps only the half of the I/Q spectrum that holds
targets moving away from the radar (the downswing and the ball), after removing
each channel's DC and the half-sample lag between I and Q conversions on the
C3's single ADC. What comes out is the real signal a single-channel radar would
have recorded with nothing approaching it in the beam, so the Stage 1 pipeline
and its cross-checks run unchanged. `presets.ground_unit_radar_pipeline()` uses
1024-point frames at 40 kHz; 2048 points there is a 51 ms window, which on
synthetic driver shots read the clubhead about 5 percent low.

**IMU.** `imu.swing` finds the takeaway, the top and the impact shock in the
pod's raw samples, and the shaft's rotation rate, refused wherever the gyro
was at full scale. The top is where the backswing's rotation, on its own axis,
crosses zero, not merely the slowest point, which noise moves around by several
milliseconds because the downswing starts gently.

**One timeline.** Every sensor finds the strike on its own clock and that
becomes zero: the radar from its capture, the IMU from the shock (searched for
near the radar's impact as mapped over Bluetooth, so the mapping's residual is
measured and removed), the camera from the strike in the clip's audio, corrected
for sound travel when the distance is recorded, otherwise from swingml's impact
event. Each event comes from the sensor that measures it best: impact from the
radar, top and takeaway from the IMU, the other five from the camera. Where two
sensors place the same event, the difference is compared with the camera's
frame time (or swingml's measured band) and reported if it is larger.

**What stays modelled.** True ball speed needs a launch angle; until the
camera measures one it is the club's prior, and the result is MODELLED with
that assumption. Clubhead speed from the IMU needs a radius to the clubhead,
which is a calibration; `effective_clubhead_radius` measures it shot by shot
from the radar's clubhead speed so it can be fitted. Spin, face angle, club
path, attack angle and swing plane are not outputs here either.

**Per-club radius calibration.** `fusion.calibration` keeps those measured
radii per club in a JSON file you name, and `fuse_shot.py` uses it when given
`--calibration`:

```bash
PYTHONPATH=. python scripts/fuse_shot.py session.bin --club 7-iron \
    --calibration ~/launchmon/radius.json
```

`--club` (a name from `config/clubs.yaml`) is required with `--calibration`,
because it is the key the samples are filed under. Each shot that both the
radar and the IMU measured offers its radius. It is refused, and the refusal
is printed and kept in the file with its reason, if either input is not
MEASURED, if it is outside 0.6 to 1.8 m (two thirds of a wedge's length up to
the longest legal driver plus a straight arm, swung as one lever about the
shoulder), or, once the club has 5 accepted samples, if it is more than 3.5
robust deviations (1.4826 x MAD, floored at 2 cm) from their median. The same
capture fused twice is counted once. The last 50 accepted and 50 refused
samples are kept; the file is replaced atomically, and a file that cannot be
read stops the script rather than being overwritten.

The calibration is the median of the accepted samples, with their robust
spread and count, and is used once there are 5. Then, and only for a shot whose
clubhead speed the radar did not measure, `clubhead_speed_from_imu` is the
IMU's rate times the calibrated radius: DERIVED, source `imu+calibration`,
rather than MODELLED from the assumed radius. The shot also carries
`imu_speed_calibration`: the calibration used and a speed spread, the rate
times the radius spread widened by the median's own uncertainty
(`sqrt(1 + pi/2n)`). That spread is the scatter of this golfer's samples with
this club, not an accuracy figure for the instrument. When the radar measured
the clubhead nothing changes, and without `--calibration` the script reads
and writes no file and its output is exactly as before.

**What has been checked.** All of it against synthetic shots with known
truth (`tests/test_iq.py`, `test_imu_swing.py`, `test_fusion.py`,
`test_ground_unit_ingest.py`, `test_radius_calibration.py`), including a USB
stream built the way the firmware writes it. None of it has seen real hardware yet.
