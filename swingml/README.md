# swingml — machine-learning golf swing analysis from one iPhone camera

Point a phone at a golfer, get their swing back as numbers. No calibration, no
markers, no second camera, no measurement of where the phone was standing.

```
video ──► pose estimation ──► resample to a canonical rate ──► scale-free features
                                                                      │
                            events ◄── ordered decoding ◄── temporal convolutional net
                               │
                               └──► tempo, rotation, movement, kinematic sequence
```

## What it produces

Per swing, the eight canonical swing events — **address, toe-up, mid-backswing,
top, mid-downswing, impact, mid-follow-through, finish** — located in the source
clip's own frame numbers and times, plus:

| Metric | How | Standing |
|---|---|---|
| Tempo ratio (backswing ÷ downswing) | From the event times | derived |
| Backswing, downswing, total duration | From real frame timestamps | measured |
| Time of peak hand speed vs impact | Pose | measured |
| Shoulder turn, hip turn, separation | Image plane | **projected** |
| Shoulder turn, hip turn, separation | Estimator's inferred depth | **estimated 3D** |
| Head movement, pelvis sway, pelvis lift | Pose, in body lengths | projected |
| Kinematic sequence (pelvis → thorax → arm) | Peak angular speeds | observed order |

Per session: mean, median, spread and coefficient of variation of every metric,
the count of swings that produced no reading, and how often each kinematic
ordering was observed.

## The three ideas it is built on

**No calibration, by construction.** Every metric is a ratio, an angle, or a
length in units of the golfer's own body. Landmarks are recentred on the pelvis,
divided by a body length measured from the golfer, and de-rolled using the median
body axis so a phone propped at an angle stops mattering. The invariance is
tested, not asserted: `tests/test_features_invariance.py` renders the same swing
from different distances, positions and tilts and checks the features agree.

**One model for 30, 60 and 240 fps.** A temporal convolution's receptive field is
counted in frames, so the same swing at three capture rates would otherwise be
three different problems. Every clip is resampled onto a canonical 60 Hz grid on
its *real timestamp axis* before the model sees it, and predictions are mapped
back afterwards. iPhone slow-motion clips, which are commonly captured at 240 and
written to play at 30, are handled without being told what they are.

**The events happen in order, and the decoder knows it.** Taking the highest
scoring frame for each event independently can put impact before the top of the
backswing, and does so exactly when the model is least certain — on the hardest
footage, where a plausible wrong answer does most damage. Because the ordering is
a hard constraint, the best sequence *subject to it* can be found exactly by
dynamic programming in time linear in the clip length. No beam, no threshold, no
possibility of an invalid result.

## What it will not tell you

Nothing about the club. A body-pose estimator does not see one, so there is no
clubhead speed, no face angle, no club path, no attack angle and no swing plane
here, and there will not be. Two of the eight events — toe-up and
mid-follow-through — are *defined* by the shaft being horizontal, so the model
places them from where they fall relative to the body rather than from anything
it observed. They are flagged as such in every result.

Rotation in degrees is reported twice and neither figure is a body angle. The
projected one is a real measurement of the image and changes if the phone moves.
The 3D one comes from the pose estimator's inferred depth, which is a network's
opinion about a single view rather than anything triangulated. Comparing a
golfer against themselves from the same camera position is what the projected
figure is good for; comparing two golfers filmed differently is not.

Anything the pipeline cannot measure returns a refusal carrying its reason, never
a substituted guess. Film in portrait and cut the golfer's feet off, and pelvis
sway comes back as *"the feet are not in shot, so there is no fixed reference to
measure body movement against; the hips cannot serve as one because they move"*
— while tempo, which does not need the feet, still reports.

## Training data

There are no labelled golf videos here, and hand-labelling the frame of impact is
slow, subjective at the boundaries, and yields a few hundred examples at best. So
the training data is generated: an articulated golfer whose hands travel a circle
on an inclined swing plane, with the club extending from them, arms and legs
solved by inverse kinematics, projected through a virtual camera and degraded the
way a real pose estimator degrades.

Because the generator knows where the club is, all eight events have exact ground
truth — including the two that no pose estimator can see. Because it knows the
timing, the tempo ratio is correct by construction.

What is randomised: body proportions, handedness, swing plane, spine tilt, wrist
hinge and lag, turn amplitudes, tempo, camera azimuth from face-on through down
the line and past it, elevation, distance, roll, field of view, portrait and
landscape, capture rate, and a noise model with time-correlated landmark error
that scales with each landmark's own image-plane speed — because the hands blur
worst exactly at impact, which is where accuracy matters most.

What it cannot contain is anything nobody thought to model. This is an argument
for training on generated swings **and then measuring on real footage**, never for
skipping the second part.

## Running it

```bash
python -m venv .venv && .venv/bin/pip install -e "swingml[dev]"
curl -L -o models/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task

cd swingml
PYTHONPATH=. ../.venv/bin/python scripts/train_events.py            # train the event model
PYTHONPATH=. ../.venv/bin/python scripts/analyse.py my_swing.mov    # analyse a clip
PYTHONPATH=. ../.venv/bin/python scripts/analyse.py swings/         # a whole session
PYTHONPATH=. ../.venv/bin/python scripts/demo_end_to_end.py         # full stack on rendered video
PYTHONPATH=. ../.venv/bin/python -m pytest tests/ -q
```

MediaPipe needs `libEGL` and `libGLESv2` present (`apt install libegl1 libgles2`).

## Layout

```
swingml/
  swingml/
    events.py      the eight events; an out-of-order sequence cannot be constructed
    quantity.py    provenance carried by the number itself
    skeleton.py    landmark topology, handedness
    features.py    resampling, normalisation, the feature matrix
    analysis.py    video in, swing out
    session.py     spread across a session
    video/         iPhone-aware reading: rotation, real timestamps, variable rate
    pose/          the estimator seam, and a MediaPipe implementation behind it
    model/         the network, the ordered decoder, batching, evaluation
    metrics/       tempo, rotation, movement, kinematic sequence
  synth/           the generator: rig, swing, camera, dataset, renderer
  tests/
  scripts/
```

## Honest limitations

- **The kinematic sequence is the least reliable output.** From projected 2D
  angles the ordering of the segment peaks is close to random when the camera is
  down the line, because the shoulder line is then edge-on. Using the estimator's
  3D output recovers the generated ordering about 79% of the time on synthetic
  data. It is reported with its source attached, and should be treated as
  indicative.
- **Velocities cannot be reconstructed from 30 fps.** Positions resample cleanly
  from any capture rate; velocity is a derivative and a 30 fps clip does not carry
  the detail. Pinned by a test so it is not mistaken for invariance. Film at 60 or
  above where it matters.
- **The no-swing gate is uncalibrated.** A clip containing no swing still has a
  best-scoring ordered sequence. The confidence floor that would reject it needs
  measuring on real negatives, which has not been done, so it defaults to off
  rather than to a guess.
- **Accuracy figures here are on generated swings only.** The pose estimator has
  been exercised end to end on rendered video, which validates the wiring, not
  the accuracy. No number in this repository is a claim about real golfers until
  it has been measured on real footage.
