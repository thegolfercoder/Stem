# Swing analysis

Golf swing analysis from a single phone camera. No sensors, no markers, no
calibration, no setup. Point a phone at a golfer, drop the clip in, and get the
swing back broken into its eight positions with the timings and body movement
measured.

Everything runs locally. No clip leaves the machine.

```bash
pip install -e "swingml[dev]"
swingml
```

![the eight positions, a scrubber, and the metrics](docs/swing-page.png)

## What it measures

**Timing**, from the real frame timestamps — tempo ratio, backswing, downswing,
whole-swing duration, and when the hands reached their fastest relative to impact.
These are the strongest numbers here and the ones worth acting on.

**Rotation at the top**, from how much the shoulder and hip lines foreshorten. A
line of fixed length seen from an angle shortens by the cosine of that angle, which
is the one rotation measurement a single uncalibrated camera can honestly support.
It has no sign — turning towards the camera and away from it look identical — and it
reads low against reality, so use it to compare your own swings from the same
camera position rather than against a published figure.

**Stability** — head movement, pelvis sway and lift, all in units of the golfer's
own body length so no calibration is needed and no conversion to centimetres is
possible without one.

**Kinematic sequence** — the order in which the pelvis, chest and lead arm reached
their fastest. Reported as observed, not scored.

**Consistency and trend** across a session, which is the comparison that means
something when the camera is uncalibrated: your swings against each other.

## What it does not measure, and will not

Ball speed, spin rate, spin axis, launch angle, carry, club path, face angle,
attack angle. These are ball and club measurements. This looks at a body. A camera
pointed at a golfer cannot see the ball leave at 70 metres per second or the face
angle at a 500-microsecond impact, and software claiming otherwise is guessing.

If you want those numbers you want a launch monitor, and this is not one. What this
does that a launch monitor does not is tell you about the swing rather than the
strike.

## When it refuses

A clip that does not contain a measurable swing produces no numbers and a reason,
never a plausible-looking guess. Three independent checks:

- a body must be found in at least half the frames
- the model's mean confidence across the eight events must clear 0.30
- the halves of the swing must last a plausible length of time

Those thresholds are measured rather than chosen. On clips built to contain no
swing — somebody standing at address, a swing cut off at the top, an empty frame —
the model returned confidences of 0.02, 0.27 and 0.15. On clips containing one,
filmed from every angle and frame rate, it returned 0.89 or better on eleven of
twelve. The threshold sits in that gap.

This matters more than it sounds. Before those checks existed, a clip of somebody
standing still produced a tempo ratio of 0.21 and a clip cut off at the top
produced 34.7, both confidently. A wrong number gets acted on; a missing one gets
looked into.

## Measured accuracy

On held-out clips that have been through the real pose estimator, event timings
land **within one frame 77% of the time and within two frames 92%** — two frames
being 33 ms. Top of the backswing and mid-downswing are the sharpest at around half
a frame of mean error; address is the weakest at about two frames, because address
is not a shape but the moment before a shape starts changing.

Across fifteen clips shaped like real footage — face on, down the line, at
forty-five degrees, tilted phone, left handed, near, far, feet cut off, portrait
and landscape, at 30, 60 and 120 frames a second — twelve of twelve real swings
read and all three no-swing clips refused. Tempo came back within a few percent of
what was generated on most, with the extremes of tempo pulled toward the middle.

**Almost all of these figures come from synthetic swings**, rendered and then put
through the real pose estimator. The timings should hold up; the angular
measurements read low and would need reference data to calibrate.

### The one real swing

There is exactly one clip of an actual golfer in this repository — `tests/fixtures/
real_swing_01.mov`, thirty frames a second, at night, on a phone — kept as a
regression fixture. One clip proves nothing about the general case. What it does is
catch a change that looks fine on generated data and breaks the real thing.

On it, the model puts address on the frame the golfer starts moving, impact on the
frame the ball leaves the tee, the top one frame late and the finish about three
early. How each of those was established independently of the model is recorded in
`real_swing_01.json` beside the clip.

### Error bands

Every event is reported with a band — `±33 ms`, `±83 ms` — and none of it is
assumed. The model is run over clips that no part of training touched, the spread
of its errors is recorded against the confidence it reported, and the band quoted
for a new clip is the distance that contained the stated share of those held-out
errors at that confidence. So a doubtful event gets a wider band than a certain
one, and a band appears only where enough held-out clips landed at that confidence
to measure one.

The procedure is cross-validated before any table ships: every held-out event is
checked against a table built without it. Bands claiming 80% contained **87.9%** of
errors — wide rather than narrow, which is the safe direction and is what integer
frame errors do to a quantile. The table lives in its own file rather than inside the checkpoint,
because an error bar quoted for a model that has since been retrained is worse than
no error bar at all; with no table, the analysis reports frames and no band.

The bands are measured on rendered swings. They are not a claim about footage of a
real golfer on grass, and every band carries the corpus it came from so that nobody
has to take that on trust.

## Things that were tried and did not work

Kept because a negative result nobody wrote down gets re-discovered at full price.

**Refining the address frame** by walking back to where hand speed crossed a
threshold. It made address *worse* — mean error 14.5 frames to 20.5, tempo error
31.7% to 54.8% — because the quiet before a swing is not actually quiet. Deleted.

**Repairing landmark dropouts.** On the real clip MediaPipe loses the left arm for
one to three frames around impact and puts the whole limb back where it was several
frames earlier: elbow and wrist together, bone lengths intact, in the wrong place.
It looked like a failure mode the synthetic data could not contain, so the plan was
to detect it — the two hands are on one grip, so a large wrist separation is a
tracking failure — and either repair it or train against it.

Measuring first killed the idea. In feature units the real clip's worst grip
separation is 0.441; across 860 rendered clips put through the same estimator, the
median clip's worst is 0.425 and the 90th percentile is 0.564. The failure is
already in the training data at the same magnitude, so neither a repair nor a
bespoke augmentation would be adding anything. No code was written.

## How it works

```
video ─► pose estimation ─► resample to 60 Hz ─► features ─► temporal CNN ─► ordered decode ─► metrics
        (MediaPipe, streamed)   (real timestamps)  (scale-free)  (ensemble)      (DP)
```

**Frames are streamed and discarded.** A minute of phone video is tens of gigabytes
of pixels and a few hundred kilobytes of landmarks, so clip length is bounded by
patience rather than memory.

**Everything is resampled to a fixed rate on the real timestamp axis**, so 30, 60
and 240 frames a second are the same swing to the model, and slow motion needs no
special handling.

**Features are scale and position invariant** — landmarks recentred on the pelvis,
divided by a body length taken from the golfer, with camera roll removed. Nothing
needs to know the focal length or the distance, which is why there is no
calibration step.

**The events are decoded under an ordering constraint.** A swing's eight events
occur exactly once each in a fixed order, so the decoder finds the best sequence
satisfying that rather than taking eight independent maxima. An impossible answer
cannot be returned.

**Several models answer together**, each shown the clip at three speeds, averaged
in probability space.

## Training

The model is trained on synthetic swings: an articulated golfer whose hands travel
a circle on an inclined swing plane, with the club extending from them, so the two
events defined by a horizontal shaft have exact ground truth rather than a label.

The important part is what it is fine-tuned on. Training on the generator's own
landmarks and running on the pose estimator's turned out to be the largest error in
the whole pipeline — the two disagree systematically, and no amount of noise
modelling fixes a difference of convention. So swings are rendered to video, the
real estimator is run over them, and *its* output is the training input, with the
exact labels kept.

```bash
python scripts/make_detected_dataset.py --n 300      # render, detect, cache
python scripts/train_ensemble.py --members 5         # fine-tune an ensemble
python scripts/evaluate_clips.py                     # score it on the test corpus
```

## Layout

| Path | What |
|---|---|
| `swingml/analysis.py` | The pipeline: pose in, swing out |
| `swingml/features.py` | Scale-free features, and the channel layout augmentation needs |
| `swingml/metrics/` | Tempo, rotation, stability, kinematic sequence |
| `swingml/model/` | The network, ordered decoding, augmentation, ensembling |
| `swingml/web/` | The local application |
| `swingml/cli.py` | `swingml ui`, `analyse`, `doctor` |
| `synth/` | The articulated golfer and the renderer |
| `scripts/` | Dataset building, training, evaluation |

## A note on provenance

Every number carries how it was obtained — measured, derived, projected, estimated
in 3D — and anything resting on an assumption says what the assumption was. This is
not decoration. A shoulder turn measured in the image plane and one triangulated
from two cameras are different claims, and presenting both as a bare number invites
the reader to trust them equally.

Where a number cannot be obtained honestly it is refused with the reason. During
development the pose estimator's own 3D output was found to have the shoulder line
shrinking from 0.295 m to 0.048 m across a single swing — a bone changing length
sixfold — and every angle derived from it was noise wearing a confident face. Those
are now refused, with that measurement in the reason.

## Legal note

Overlaying motion metrics on swing video sits within claims asserted in Blast
Motion's patent portfolio, including US 9,039,527. This is a university research
prototype, which is fine. Nobody should assume it is safe to sell.
