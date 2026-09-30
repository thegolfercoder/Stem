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
