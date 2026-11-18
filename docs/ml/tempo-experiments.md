# Tempo compression: what was tried and what it showed

When these experiments were run (at 429fb30), the shipped model read tempo at 0.44 of
its real spread on the frozen holdout (slope of log read tempo on log true tempo, 95% CI
0.15–0.70; 0.32 with the slow-motion rule that ships since, `release-gate-slowmo-rule.json`): a quick golfer
reads less quick and a slow one less slow, so a quick tempo can go unflagged.
These experiments each change one thing and score it through the application's
own decision (confidence thresholds, timing gate, slow-motion retry) with
`scripts/tempo_experiments.py`.

**Rules kept.** Choosing happens on `golfdb-validation-v1` (85 swings, 29
golfer/video groups); fitting on `golfdb-train-v1` or `golfdb-calibration-v1`.
The holdout was not read by any of this. Intervals resample whole groups and every
variant is reported as a paired difference from the shipped pipeline on the same
resamples. On validation the shipped pipeline reads a slope of 0.38 [0.16, 0.76],
tempo median relative error 10.4%, false confidence 10.6%.

Raw outputs: `docs/audit/w1-decode.json`, `w1-address.json`, `w1-decompress.json`.

## 1. Sub-frame placement: not the cause

Hypothesis: positions snap to whole frames at 60 Hz, and rounding pulls short
downswings toward a middling ratio. Four other ways of placing a position
between frames, differences from the shipped decoder (centre of mass over ±2
frames, clamped to ±1):

| Variant | Slope | Tempo error | Within 1 frame | False confidence |
|---|---|---|---|---|
| Whole frames | +0.000 [−0.011, +0.022] | −0.5 [−1.6, +1.8] pts | −0.3 [−1.0, 0.0] | 0.0 [−3.3, +3.6] |
| Centre of mass ±4, clamp 2 | −0.008 [−0.041, +0.013] | −0.2 [−3.3, +1.6] | +1.5 [−0.7, +3.6] | −2.4 [−6.4, 0.0] |
| Parabola | +0.014 [−0.025, +0.037] | −0.1 [−2.6, +2.6] | +1.2 [−1.0, +3.4] | **−4.7 [−9.4, −1.0]** |
| Soft-argmax between neighbours (answered −3.5 pts) | +0.033 [−0.267, +0.220] | +2.9 [−1.1, +6.8] | +1.8 [−3.3, +6.7] | +2.8 [−4.3, +10.6] |

**Result:** none moves the slope; whole frames read the same as the shipped
sub-frame placement. Frame rounding is not what compresses tempo.

Parabolic refinement lowered false confidence by 4.7 points on validation. It
was the best of four variants on one split of 85 swings, so this is a lead to
test, not a finding: it would need to be fixed in advance and put through the
release gate.

## 2. A kinematic address rule: worse

Hypothesis: address is placed a median 7 frames off on the holdout; placing it
exactly would cut tempo error from 15.1% to 11.0%. The rule is address where the
hands were last at rest before the takeaway, fitted on train (smoothing 9 frames,
rest speed 0.04, 8 frames at rest, offset 12).

It does not place address well. It agrees with the human label a median 9 frames
off on validation (13 on train), within 5 frames on 25%. Replacing the model's
address with it:

| | Difference from shipped |
|---|---|
| Tempo error | +3.5 [−0.1, +8.2] pts |
| Slope | +0.10 [−0.09, +0.33] |
| False confidence | **+10.1 [+2.1, +20.0] pts** |
| Tempo band coverage | **−10.1 [−20.0, −2.1] pts** |
| Answered | −3.5 [−8.5, 0.0] pts |

**Result: rejected.** Where a golfer's hands come to rest is not where GolfDB's
annotators put address (the club behind the ball), and a rule cannot see the club.
The address gap stays open; the route is labelled phone swings.

## 3. Inverting the compression: worse

Hypothesis: if readings are a steady shrinkage of the truth, undo it. Fitted on
calibration: log read = 0.895 + 0.323 log true. Inverting that:

| | Difference from shipped |
|---|---|
| Slope | +0.79 [+0.33, +1.60] (reads 1.17) |
| Tempo error | **+17.4 [+11.1, +28.9] pts** (reads 27.8%) |
| 80% error band needed | ±66.9% (shipped ±27.4%) |

**Result: rejected.** The slope becomes about right and the error nearly
triples. The compression is mostly regression toward the middle: a single reading
carries little information about where a golfer's true tempo sits in the spread,
and stretching it stretches the noise with it. Any de-compressed reading would
need a band so wide that it says nothing.

## 4. A tempo term in the training loss

The shipped recipe (`e7_s0`) plus an auxiliary loss on the log tempo computed
from soft event positions (`--tempo-weight`), at weights 0.5 and 2.0, seed 0, no
holdout during training. Scored on validation with `tempo_experiments.py model`.

| | weight 0.5 | weight 2.0 |
|---|---|---|
| Slope | −0.10 [−0.20, +0.03] (reads 0.28) | −0.005 [−0.11, +0.15] (reads 0.37) |
| Tempo error | **+4.7 [+0.1, +6.7] pts** | +3.4 [−0.7, +6.4] pts |
| Within 1 frame | −0.3 [−3.6, +2.8] pts | −2.1 [−5.5, +1.3] pts |
| False confidence | +2.4 [−4.4, +9.5] pts | +3.5 [−5.2, +11.8] pts |

**Result: rejected.** Neither weight makes tempo less compressed, and the lower
weight makes tempo error worse. A loss on the ratio computed from soft positions
can be lowered by moving the soft positions without moving the decoded ones, and
with 281 training swings there is not enough spread of real tempos for it to learn
more. One seed each: a second seed could move these numbers, but not from "no
improvement" to a large one given the intervals. Neither candidate goes to the
release gate. Raw outputs: `docs/audit/w1-t05_s0.json`, `w1-t20_s0.json`.

## What this means for the product

Tempo from one camera through this model is a compressed reading. None of the
three post-hoc fixes (placement, address rule, inversion) makes it less
compressed without making it worse, and neither does a tempo term in training. The app already compares golfers against the
same model's readings of tour swings rather than against true tempos, and states
the compression and the 2.1-read-as-3.2 phone example beside every tempo
priority. That stays. What remains is data: more swings with a real spread of tempos
(labelled phone swings, which the app's position editor already collects), and a
phone test set to measure the result on the footage the product is for.
