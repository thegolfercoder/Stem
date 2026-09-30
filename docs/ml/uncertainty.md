# Per-swing tempo uncertainty: what the model's signals can and cannot say

The app states one 80% band on every tempo reading, ±27% (fitted on
`golfdb-calibration-v1`). A per-swing band would be better if something the model
produces says which readings are likely to be wrong. This was tested with
`scripts/tempo_experiments.py bands` (raw output: `docs/audit/w3-bands.json`).

**Method.** Three candidate signals, each computed from the same read the app
makes (thresholds, timing gate, slow-motion retry):

- the core confidence the app shows today;
- `spread`: how spread out the model's probability is around address, the top and
  impact, carried through to the tempo ratio;
- `short_downswing`: one over the downswing's length in frames.

The signal was chosen on `golfdb-calibration-v2` (133 answered swings) by how well
it ranks that split's relative tempo errors, before `golfdb-validation-v2` was
read. Bands were fitted per tercile of the chosen signal (conformal, 80%) on the
calibration split and checked on validation (141 swings, 29 golfer/video groups,
group bootstrap). The holdout was not read.

**Results.**

| On calibration | Rank correlation with tempo error |
|---|---|
| Core confidence | +0.014 |
| Spread | +0.061 |
| Short downswing (chosen) | +0.096 |

Core confidence barely varies: two-thirds of swings sit between 0.820 and 0.835.

| On validation | Single band (±28.8%) | Banded by short downswing |
|---|---|---|
| Coverage (target 80%) | 90.8% [83.8, 96.3] | 89.4% [83.5, 94.4] |
| False confidence | 9.2% [3.7, 16.2] | 10.6% [5.6, 16.5] |
| Rank correlation of the signal with error | — | +0.14 [−0.06, +0.33] |

**Conclusion.** None of the signals the model offers predicts how wrong a tempo
reading will be, so per-swing bands are no better than the single band, and the
app keeps the single band. The model's "confidence" measures whether the clip
looks like a swing, not whether the positions are right, and should not be
presented to golfers as accuracy. A useful per-swing uncertainty needs a new
signal (for example, agreement between independent readers such as the pose and
image models, once an image model exists) and would be re-tested the same way.

## Does the band hold for quick and slow tempos? (#18)

Readings are compressed toward the middle (log-log slope 0.44,
`tempo-experiments.md`). So the swings furthest from typical are the likeliest
to fall outside a band fitted to all swings at once. This checks the shipped
band, ±27.4% (`swingml/data/event_calibration.json`), not refitted, one tempo
level at a time:

```
python scripts/tempo_experiments.py levels \
  --manifest swingml/manifests/golfdb-calibration-v2.json \
  --fit-manifest swingml/manifests/golfdb-calibration-v2.json \
  --report swingml/manifests/golfdb-calibration-v2.json swingml/manifests/golfdb-validation-v2.json \
  --resamples 1000 --out ../docs/audit/w3-bands-by-level.json
```

**How it was measured:**
- Swings are split into terciles of tempo ratio (backswing over downswing), with
  cut points fixed on calibration:
  - by **true** tempo (cuts 3.31 and 4.07), which only an evaluation knows;
  - by **read** tempo (cuts 3.40 and 4.00), which the app could act on.
- Readings go through the app's own decision, with the shipped model.
- Intervals are 95% group bootstraps over golfer/video groups.
- The holdout was not read.

The band was set on calibration, so validation is the out-of-sample check.

**Validation** (141 swings, 29 groups; all answered):

| Tercile | n | Coverage (target 80%) | Median signed error |
|---|---|---|---|
| True tempo, lowest (< 3.31) | 54 | 87.0% [80.0, 94.1] | +12.7% [+7.6, +16.7] |
| True tempo, middle | 51 | 92.2% [83.0, 100] | +1.3% [−2.5, +4.0] |
| True tempo, highest (> 4.07) | 36 | 86.1% [63.0, 100] | −9.2% [−21.5, +0.7] |
| Read tempo, lowest (< 3.40) | 49 | 93.9% [87.5, 100] | −4.5% [−11.2, +3.1] |
| Read tempo, middle | 57 | 91.2% [80.0, 100] | +4.0% [−3.5, +12.7] |
| Read tempo, highest (> 4.00) | 35 | 77.1% [55.0, 91.8] | +7.1% [+5.0, +22.0] |

**Calibration** (133 answered swings, 26 groups; in-sample for the band):

| Tercile | n | Coverage | Median signed error |
|---|---|---|---|
| True, lowest | 44 | 72.7% [56.1, 84.9] | +8.0% [+1.2, +24.0] |
| True, middle | 44 | 81.8% [55.8, 96.2] | −0.5% [−10.7, +5.8] |
| True, highest | 45 | 84.4% [73.8, 96.7] | −9.6% [−13.7, +0.1] |
| Read, lowest | 44 | 79.5% [71.0, 94.1] | −5.9% [−14.7, −2.1] |
| Read, middle | 44 | 77.3% [55.6, 91.3] | +5.1% [−4.7, +10.9] |
| Read, highest | 45 | 82.2% [62.5, 93.9] | +8.0% [−2.6, +19.8] |

In every cell, the false-confidence rate equals 1 − coverage: every answered
swing's core confidence is at least 0.5, so the app claims confidence on all of
them (see above).

**What it shows.**
- **Compression is visible by level.** Swings with the lowest true tempo read
  high: +12.7% on validation, with the interval excluding zero. Swings with the
  highest true tempo read low, by about 9%. So a golfer at either end is shown a
  tempo pulled toward the middle, as the slope said.
- **The band still holds, but not by much at the ends.** No tercile's coverage
  interval lies wholly below 80% on either split. The lowest points are:
  - the lowest true tercile on calibration, 72.7% [56.1, 84.9];
  - the highest read tercile on validation, 77.1% [55.0, 91.8].

  So by the item's rule no band change is warranted.
- **The band holds because it is wide,** not because the reading is unbiased at
  the ends.
- **The evidence is thin:** 35 to 54 swings per cell from 26 to 29 groups, and
  the intervals are 30 to 40 points wide. A real shortfall of 10 points at the
  ends could hide inside them.

**What this does not claim.**
- These are broadcast swings of tour players.
- A golfer filming on a phone could sit outside both ends.
- The only phone swing labelled so far reads 52% high. That is far beyond any
  cell here, and it is phone footage, which these numbers do not describe.

**Consequence.**
- The shipped band stays. No follow-up change to the band is filed, because
  no tercile shows under-coverage.
- The practical risk sits in the bias, not the band: at the ends a reading is
  pulled toward the middle. The de-compression experiment
  (`tempo-experiments.md` §4) and the phone test set (#13, #20) are what would
  change that.
- Re-run this check whenever the model, the band or the calibration split
  changes.
