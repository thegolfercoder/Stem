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

On a freshly generated holdout of 160 clips that no model has trained on, event
timings land **within one frame 83% of the time and within two frames 93%** — two
frames being 33 ms. The previous model scored 76% and 89% on the same clips.

That is the five-member ensemble, which is what a machine with a trained `out/`
runs. A fresh install and the browser page carry one checkpoint, because five is
too heavy to bundle: on the same clips that single model is **81.1% and 92.0%**,
with a median tempo error of 6.7%. Which of the five gets bundled is decided by
`scripts/choose_bundled_model.py`, and the real clip below is a gate in that
decision rather than a tiebreak.

Where the error is has been measured rather than assumed. The four interior
events — top, mid-downswing, impact, mid-follow-through — land within one frame
94 to 98 percent of the time. Everything else is address, toe-up, mid-backswing
and the finish, and those four fail for two different reasons that want opposite
treatments. Address and mid-backswing score seventeen and twenty-one points
better on training clips than held-out ones, which is a generalisation gap and
answers to more data. The finish scores 61 percent on clips the model trained on,
so it cannot fit it at all: hand speed decays smoothly through the labelled frame
with no feature there, because the finish is defined by the swing's timing rather
than by any geometry. It is intrinsically imprecise, and it is the one event
tempo does not depend on.

The corpus behind all of this is 1,610 rendered swings put through the real pose
estimator, of which 1,262 are used for training. Adding the most recent 450 —
which also widened the tempo range from 2.1-4.0 to 1.5-5.2, where the corpus had
never gone although the plausibility gate accepts 1.2-6.0 — is what produced the
improvement above. On the fresh holdout the previous model's tempo error is 10.5%
on swings outside the range it was trained on against 7.1% inside; the current one
is 7.9% and 6.4%.

Across fifteen clips shaped like real footage — face on, down the line, at
forty-five degrees, tilted phone, left handed, near, far, feet cut off, portrait
and landscape, at 30, 60 and 120 frames a second — eleven of twelve real swings
read and all three no-swing clips refused. Tempo came back within a few percent of
what was generated on most, with the extremes of tempo pulled toward the middle.

The twelfth is worth describing rather than rounding away. On one down-the-line
render the pose estimator finds a body in only 76% of frames, and on those
landmarks the model puts address far too early and reads a tempo near 6 when the
clip was generated at 3. The plausibility gate catches it and the clip is refused.
An earlier single model *read* that clip — and reported 6.05, wrong by a factor of
two, having landed just inside the gate. Counting that as a success made the
figure twelve of twelve; it should always have been eleven.

**Almost all of these figures come from synthetic swings**, rendered and then put
through the real pose estimator. The timings should hold up; the angular
measurements read low and would need reference data to calibrate.

### The one real swing

There is exactly one clip of an actual golfer in this repository — `tests/fixtures/
real_swing_01.mov`, thirty frames a second, at night, on a phone — kept as a
regression fixture. One clip proves nothing about the general case. What it does is
catch a change that looks fine on generated data and breaks the real thing.

On it the bundled model puts address exactly on the frame the golfer starts
moving, the top two frames late, impact one frame early, and the finish one frame
late. How each of those was established independently of the model is recorded in
`real_swing_01.json` beside the clip, along with the tolerance each is held to.

**Those four small errors produce one large one, and that is the honest headline
for this clip.** Tempo is a ratio of two short intervals: two frames late at the
top and one frame early at impact turn a ten-frame downswing into a seven-frame
one, and tempo reads **3.26** where the clip's own evidence says about 2.1 to 2.4.
The ensemble is no better — 3.08, from the same compressed downswing. At thirty
frames a second one frame is ten percent of a downswing, so nothing here needs a
gross failure to go this wrong; two frames in opposite directions is enough.
±12% does not reach 2.44, so on this clip the band does not cover the truth
either.

One clip against a hundred and sixty is not close as evidence, and the models
ship. It is recorded because it is the clearest single sign that the synthetic
corpus is not the same thing as real footage, and because a result like this is
the kind that quietly disappears.

**What the clip does decide is which model ships.** `scripts/choose_bundled_model.py`
treats it as a gate rather than a tiebreak: a checkpoint that misses any of the
four events by more than the fixture's own tolerance is not eligible, whatever it
scores on generated swings. That rule exists because it was not there. The member
bundled before this one had been picked purely on the best score over generated
clips, and it put the finish **thirty-eight frames late** on this swing. Three of
the five ensemble members fail the gate. Of the two that pass, the one that ships
also happens to be the better of them on generated clips — 81.1% within one frame
against 79.9, and 6.7% median tempo error against 8.0 — so the gate cost 0.7
points against the excluded best and bought a model that is not wrong about the
only person in this repository.

### Error bands

Every event is reported with a band — `±33 ms`, `±83 ms` — and none of it is
assumed. The model is run over clips that no part of training touched, the spread
of its errors is recorded against the confidence it reported, and the band quoted
for a new clip is the distance that contained the stated share of those held-out
errors at that confidence. So a doubtful event gets a wider band than a certain
one, and a band appears only where enough held-out clips landed at that confidence
to measure one.

The procedure is cross-validated before any table ships: every held-out event is
checked against a table built without it. Bands claiming 80% contained **92%** of
errors — wide rather than narrow, which is the safe direction and is what integer
frame errors do to a quantile.

**Tempo carries a band too, and it is the one worth reading.** Tempo is a quotient
of two durations, one of them short: at thirty frames a second a downswing is nine
or ten frames, so an event landing one frame out moves the ratio by ten percent. The
measured spread is **±12% at 80% coverage**, with a median error of 6%. That is not
propagated from the event bands — the errors on the top and on impact are correlated
and propagation would assume they are not — it is measured directly on held-out
swings, where it comes out at 79.9% against the 80% claimed. A reader comparing two
sessions needs it: a 5% change in tempo is smaller than the measurement.

**Bands are tied to the weights they were measured through.** The table records a
digest of the model, and a model that does not match gets no bands rather than
someone else's. This is not hypothetical — during development the bundled single
model silently picked up bands measured through the ensemble, which is exactly the
mistake keeping the table in its own file was supposed to prevent and did not. The table lives in its own file rather than inside the checkpoint,
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

**Cheap synthetic landmarks.** Clips can be generated straight from the swing
model in thirteen milliseconds each, against eighteen seconds for one that is
rendered and put through the pose estimator — so twelve thousand of them cost a
few minutes. They are nearly useless. A model trained on 12,000 of them scores
87.5% within one frame on clips of the same kind and **28%** on clips that went
through MediaPipe. Mixing 6,000 of them into the 812 real-domain clips made
things *worse* than using the 812 alone, because the cheap clips outnumber the
real ones nine to one and the model drifts to their conventions. The generator's
landmarks and the estimator's landmarks are near-disjoint domains.

Worth knowing before someone spends a night generating more of them, and worth
separating from a related result that points the other way: the *task* is equally
hard in both domains. Trained and scored on the generator's own noise-free
landmarks the model gets 78.4/93.3; on MediaPipe's, 78.1/92.2. Pose noise is not
the bottleneck, which the README used to assume it was.

**Four ways of regularising, none of which helped.** A moving average of the
weights, dropout raised from 0.1 to 0.25, label smoothing, and a third more
channels were each tried against an identical baseline on identical splits. All
four landed between 82.5 and 83.3 against the baseline's 84.1. Data is the lever
here; tuning is not.

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
# 1. Build clips. Expensive - a clip is seconds, not milliseconds - so cached.
python scripts/make_detected_dataset.py --n 300 --wide-tempo --out out/detected/more.npz

# 2. Check nothing appears twice. Every figure below rests on this.
python scripts/audit_corpus.py

# 3. Train. The splits come from a fixed list of archives; new footage is added
#    to training only, so validation and test stay what every earlier number was
#    measured on.
python scripts/experiment.py --name m0 --seed 0 --extra-train out/detected/more.npz \
    --out out/exp/m0

# 4. Ask whether the difference is real, rather than which number is bigger.
python scripts/compare.py --a out/ensemble --b out/exp --clips out/holdout/*.npz

# 5. Choose what ships. The real clip is a gate here, not a tiebreak.
python scripts/choose_bundled_model.py --members out/exp/*/swing_event_net.pt \
    --holdout out/holdout/*.npz --install swingml/data/swing_event_net.pt

# 6. Measure error bands for those exact weights, then build the page.
python scripts/calibrate_events.py --data out/detected/*.npz \
    --checkpoint swingml/data/swing_event_net.pt --out swingml/data/event_calibration.json
python scripts/export_web_model.py && python scripts/build_web_app.py
```

Steps 4 and 5 are the ones worth insisting on. Every improvement here has been a
few points on a few hundred clips, which is the regime where a difference can be
entirely which clips were drawn; and a model chosen on generated footage alone
picked, once, a checkpoint that put the finish thirty-eight frames late on the
only real swing in the repository.

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

## Licence and legal note

MIT, in the [LICENSE](../LICENSE) at the root of the repository. That is a
copyright licence and nothing more, which is the distinction that matters here:
overlaying motion metrics on swing video sits within claims asserted in Blast
Motion's patent portfolio, including US 9,039,527, and no copyright licence
grants patent rights - least of all rights nobody here holds. This is a
university research prototype, which is fine. Nobody should assume it is safe to
sell.
