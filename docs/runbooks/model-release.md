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
    --model-card <candidate card> --report out/release/report.json
```

Exit 0: every gate passed. Exit 1: a gate failed; the report says which and by how
much. Exit 2: evidence is missing; nothing was measured. Do not ship on 1 or 2.

The last candidate (`g7_s1`, 619 training swings) failed on the phone fixture and on
false confidence: `docs/audit/release-gate-g7_s1-vs-e7_s0.json`.

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
