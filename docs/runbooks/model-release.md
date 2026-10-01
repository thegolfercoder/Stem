# Model release runbook

How a new event model replaces the shipped one, and how to roll back.

## 1. Train against frozen splits

Train only on a training manifest whose groups are disjoint from the test and
calibration manifests (`python -m swingml.dataset.manifest check <all of them>` must
print no `LEAK`). Choose epochs on the validation split, never on the test split.

## 2. Measure its error bands

```bash
python scripts/calibrate_events.py --data out/golfdb/split/calibration.npz --holdout 1.0 \
    --bins 1 --checkpoint <candidate.pt> --out out/release/candidate_bands.json \
    --measured-on "real swings from broadcast footage it was never trained or chosen on"
```

## 3. Write the candidate's model card

Copy `docs/ml/model-card.md` and fill every section; the gate refuses a card missing
*Intended use*, *Training data*, *Evaluation*, *Known failure modes* or *Rollback*.

## 4. Run the gate

```bash
python -m swingml.model.release_gate \
    --candidate <candidate.pt> --candidate-calibration out/release/candidate_bands.json \
    --baseline swingml/data/swing_event_net.pt \
    --baseline-calibration swingml/data/event_calibration.json \
    --test-manifest swingml/manifests/golfdb-holdout-v1.json \
    --calibration-manifest swingml/manifests/golfdb-calibration-v1.json \
    --train-manifest <the candidate's training manifest> \
    --model-card <candidate card> --report out/release/report.json \
    [--phone-manifest <a frozen phone-holdout manifest>]
```

With `--phone-manifest`, the report gains a `phone` section scored apart from
GolfDB, with intervals that resample golfers. It gates (`phone_not_worse`) only
from 150 swings by 30 golfers. Without it the report says "no phone evidence":
that is an absence of evidence, not a pass.

Exit 0: every gate passed. Exit 1: a gate failed; the report says which and by how
much. Exit 2: evidence is missing; nothing was measured. Do not ship on 1 or 2.

The last candidate (`g7_s1`, 619 training swings) failed on the phone fixture and on
false confidence: `docs/audit/release-gate-g7_s1-vs-e7_s0.json`.

## 4a. A decision-rule change on the same weights

A change to what the app decides changes what ships, even when the model does
not. That covers `AnalysisConfig` thresholds, the timing gate, the slow-motion
retry and similar. It needs the gate too (#41). Write the rule each side uses as
a JSON object of `AnalysisConfig` fields (unknown keys are refused) and pass the
same weights on both sides:

```bash
python -m swingml.model.release_gate \
    --candidate swingml/data/swing_event_net.pt --baseline swingml/data/swing_event_net.pt \
    --candidate-calibration swingml/data/event_calibration.json \
    --baseline-calibration swingml/data/event_calibration.json \
    --baseline-config <the rule shipped now>.json --candidate-config <the new rule>.json \
    --test-manifest swingml/manifests/golfdb-holdout-v1.json \
    --calibration-manifest swingml/manifests/golfdb-calibration-v1.json \
    --train-manifest swingml/manifests/golfdb-train-v1.json \
    --model-card ../docs/ml/model-card.md --report out/release/rule.json
```

With the same weights on both sides, gate 3 is `not_worse_than_baseline_on_frozen_real_test`:
- within one frame must not drop by 2 points or more;
- tempo error must not rise by 1 point or more;
- both judged at the 95% interval's worst end.

A rule need not improve accuracy to ship, but it must pass. The report lists
every clip's decision on both sides and the clips the rule moved. Omit a
`--*-config` to use the app's default rule. The rule is chosen on validation
first, as for a model; the gate is run once on the rule as chosen.

## 5. Ship

```bash
cd swingml                                   # every path below is relative to swingml/
cp <candidate.pt> swingml/data/swing_event_net.pt
cp out/release/candidate_bands.json swingml/data/event_calibration.json
python scripts/export_numpy_model.py         # rewrites swingml/data/swing_event_net.npz
python scripts/export_web_model.py           # writes out/web/model.json
cp out/web/model.json ../ios/SwingCore/Sources/SwingCore/Resources/model.json
python ../ios/SwingCore/Tests/make_golden.py
pytest -q && (cd ../ios/SwingCore && swift test)
sha256sum swingml/data/swing_event_net.pt swingml/data/swing_event_net.npz
```

Record the checksums and the gate report in the new model card, and update
`swingml/swingml/insights/reference.py` (tour tempo readings through the new model,
from the validation and calibration splits) in the same commit.

## Roll back

Check out the previous release's three data files (`.pt`, `.npz`, `event_calibration.json`)
and `ios/.../model.json` from the commit named in the previous model card, re-run the
exports and golden generation, run the tests, and verify the checksums against that
card. `docs/ml/model-card.md` has the exact commands for the current model.
