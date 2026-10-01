# Data card

The data every shipped model and every quoted number depends on.

## Real footage: GolfDB

| | |
|---|---|
| Source | GolfDB (McNally, Vats, Wong, McPhee; CVPR Workshops 2019): 1,400 clips of 246 golfers from 580 YouTube videos |
| Licence | annotations CC BY-NC 4.0; the video is YouTube content owned by its uploaders. **Non-commercial.** Nothing derived from frames is committed; only clip ids and hashes. |
| Labels | the eight events, one frame each, by the dataset's annotators; plus view (face-on / down-the-line / other), club, slow-motion flag, player |
| Handedness | not annotated; inferred from which shoulder the hands are nearer at the labelled top (45 of 48 correct on 51 golfers of known handedness; uncallable clips dropped) |
| Extracted | 1,216 of 1,400 clips pass the gates (body in ≥60% of frames, handedness callable, labels inside the clip); 184 refused |
| Landmarks | MediaPipe pose landmarker (heavy, float16), resampled to 60 Hz, 132 features per frame |
| Capture | broadcast and range video, mostly tour professionals; in the holdout, 41% are slow-motion replays and views are 20% face-on, 48% down-the-line, 32% other |

### Splits (frozen, `swingml/swingml/manifests/`)

Split by leakage group: the connected components of the golfer/source-video graph,
so no golfer and no video is on both sides. Assignment is by a hash of the group
name, so adding clips does not move existing groups (`--freeze`).

| Manifest | Clips | Used for |
|---|---|---|
| `golfdb-train-v1` | 281 | fine-tuning the shipped model |
| `golfdb-validation-v1` | 85 | choosing its epoch |
| `golfdb-calibration-v1` | 85 | measuring its error bands |
| `golfdb-holdout-v1` | 201 (35 groups) | the frozen test set; reported once per model |
| `golfdb-*-v2` | 619 / 141 / 136 / 320 | the grown corpus; v1 groups frozen inside it |

Rory McIlroy's 23 swings were forced into the holdout before training, as a blind
test on a named golfer; his group has 86 clips in v1 because some videos show other
golfers.

## Real footage: phone

| | |
|---|---|
| Labelled | **one swing** (`swingml/tests/fixtures/real_swing_01`): one golfer, iPhone, 30 fps, range, face on; address, top, impact and finish verified from the clubhead and ball |
| Unlabelled | the user's IMG_1519 (HEVC HDR, rotated): analyses, no truth |
| Collection path | desktop app position editor → `scripts/make_labelled_dataset.py` (see `annotation-guide.md`) |

This is the most important gap in the data. It is why every accuracy number is
qualified "on broadcast and range footage".

## Synthetic

Rendered swings from `swingml/synth/`: a kinematic swing model with randomised tempo
(2.1-4.0), body proportions, plane, camera azimuth, distance, roll, frame rate and
noise; rendered and put through the same pose estimator. Used for pre-training and
for controlled tests (tempo, camera angle, frame rate, no-swing clips). The 2,162-clip
rendered corpus behind the base model was lost with an earlier container and is not
reproducible byte for byte. Synthetic results are always reported apart from real ones.

## Known biases

- Tour professionals: tempo distribution median 3.38 across all 1,216 labelled
  swings (10th-90th percentile 2.71-4.71); club golfers are under-represented or absent.
- Right-handed: 89% of the holdout.
- Broadcast camera work: often long lenses, often slow motion, rarely a phone on a stand.
- The metadata records no sex, age or skill level, so the corpus's balance on those
  cannot be stated.
