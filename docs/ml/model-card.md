# Model card: swing event network `e7_s0`

The model that finds the eight swing positions in every Swing Studio build
(desktop, browser, iPhone). Checked by `python -m swingml.model.release_gate`.

| | |
|---|---|
| File | `swingml/swingml/data/swing_event_net.pt` (PyTorch), `swing_event_net.npz` (NumPy copy, matches to 1e-5) |
| SHA-256 (.pt) | `61a05945eb833728663157f4f43f4d5383327dca4699a5eb123b2644a6f5f8ff` |
| SHA-256 (.npz) | `4a508efda5099fff340cc4318797a6c8f099d93696edf21b6c4f92c9880e3f61` |
| Error bands | `swingml/swingml/data/event_calibration.json`, SHA-256 `aeb84ddc…73a`, fingerprint-matched to these weights |
| Shipped in | commit `81fc997` |
| Architecture | Dilated temporal convolutional network, 349,065 parameters, receptive field 253 frames at 60 Hz, 132 pose features per frame |

## Intended use

Placing address, toe-up, mid-backswing, top, mid-downswing, impact,
mid-follow-through and finish in a single-camera video of one golfer making one
full swing, from MediaPipe body landmarks, so that tempo and body-motion metrics
can be measured between them.

**Not intended for:** anything club- or ball-defined (face, path, plane, spin,
speed, launch, distance); clips with several golfers or several swings unless the
app's long-clip search has isolated one; judging a single swing's tempo to better
than its measured band (±27% for 80% of swings).

## Training data

- **Base**: rendered synthetic swings (the corpus is described in `swingml/README.md`;
  the rendered archives were lost with an earlier container and are not reproducible
  byte-for-byte).
- **Fine-tuning**: 281 real swings, manifest `golfdb-train-v1`
  (`swingml/swingml/manifests/golfdb-train-v1.json`): GolfDB (McNally et al. 2019), YouTube
  broadcast and range footage, CC BY-NC 4.0 annotations. Supervised on seven events:
  the finish is not supervised, because GolfDB's finish convention disagrees with the
  hand-verified phone fixture.
- **Selection**: epoch chosen on 85 swings, `golfdb-validation-v1`.
- **Error bands**: measured on 85 swings used for nothing else, `golfdb-calibration-v1`.
- Splits are by golfer and source video (connected components of the player/video
  graph); `python -m swingml.dataset.manifest check` verifies no clip or group is
  shared. No phone footage was used for training: the only labelled phone swing is
  the regression fixture.

## Evaluation

Frozen real test set `golfdb-holdout-v1`: 201 swings in 35 golfer/video groups,
disjoint from every training, selection and calibration clip. 41 face-on, 96
down-the-line, 64 other angles; 82 slow-motion broadcast replays, 119 real time;
23 left-handed. All figures below are on that set; intervals are 95% bootstrap by
clip. Sources: `docs/audit/benchmark-baseline.json`, `docs/audit/error-breakdown.json`,
`docs/audit/baselines.json`, all measured at commit 429fb30, before the slow-motion rule
that ships (`docs/ml/slow-motion-rule.md`). The same weights with that rule were scored
on the same 201 swings by the release gate (`docs/audit/release-gate-slowmo-rule.json`);
its point estimates are given beside the figures they replace, without intervals, which
that report does not record.

| Measure | Value |
|---|---|
| Within 1 frame, 4 core events (address, top, mid-downswing, impact) | 48.9% [44.8, 52.9]; with the shipped slow-motion rule 49.0% |
| Within 1 frame, all 8 events | 41.9% |
| Tempo, median relative error | 15.1% [13.2, 17.5]; with the shipped slow-motion rule 15.3% |
| Tempo band (±27%) coverage | with the shipped slow-motion rule 84.9% (85.4% with the rule before it) |
| Tempo sensitivity (slope of log read on log true tempo) | 0.44 [0.15, 0.70]; with the shipped slow-motion rule 0.32 |
| Median error: address / top / impact / finish (frames at 60 Hz) | 7 / 2 / 1 / 29 |
| Real swings answered through the app's decision (with slow-motion retry) | 199 / 201 |
| No-swing stretches from the same videos accepted | 3 / 424 (0.7%) |

Against simple baselines fitted on the same training swings (`scripts/benchmark_baselines.py`),
within one frame on the core events: hand-speed peak 26.3%, kinematic descent
33.2%, DTW templates 19.0%, one-layer temporal classifier 40.7%. The network is
better than each; a hybrid that snaps its top and impact to kinematic landmarks
was not (46.5%) and is not used.

Real phone fixture (`swingml/tests/fixtures/real_swing_01`, one golfer, 30 fps,
positions verified from the clubhead): address 81 (truth 84), top 106 (105),
impact 114 (115), finish 126 (125), all within tolerance; tempo 3.20 against a
true 2.10.

Synthetic clips (`scripts/evaluate_clips.py`, 15 rendered clips): 12 of 12 swings
read, 3 of 3 no-swing clips refused; tempo within 15% of the generated value on 10
of 12, +17% at a generated 2.18, +41% down the line.

## Known failure modes

1. **Tempo is pulled toward about 3.3.** Slope 0.32 through the shipped decision with
   its slow-motion rule (0.44 measured at 429fb30, when a true 2.35 read 2.95 and a true
   5.12 read 3.65). Differences between golfers, and a golfer's change over time,
   appear at well under their real size. Readings far from 3 are more wrong than
   readings near it (median error 19% below 3.0, 11% between 3 and 4, 17.5% above 4).
2. **Address and top carry most of the tempo error.** Placing address exactly would
   cut the median tempo error from 15.1% to 11.0%; the top, to 10.5%; impact, to 12.7%.
3. **The finish is not measured.** Median error 29 frames (about 0.5 s), within one
   frame 0.5% of the time. No duration ending at the finish is reported.
4. **Slow motion.** Slow-motion replays have 2-4x larger frame errors at playback
   speed and, before the retry added with this card, 71 of 82 were refused as "not a
   swing". The retry reads them; their durations are refused.
5. **Phone footage is barely represented.** Every number above is on broadcast and
   range video; the one labelled phone swing reads tempo 52% high.
6. **Hands at impact.** On the phone fixture the pose estimator loses the hands
   through impact at 30 fps; on the broadcast test set, wrist visibility at impact
   did not predict error (tempo error 17% / 12% / 17% across visibility thirds).

## Rollback

The model, its NumPy copy and its bands ship as three files. To roll back to the
model before this one:

```bash
git checkout a5459ad -- swingml/swingml/data/swing_event_net.pt \
    swingml/swingml/data/event_calibration.json
cd swingml
python scripts/export_numpy_model.py                  # rewrites swingml/data/swing_event_net.npz
python scripts/export_web_model.py                    # browser payload, out/web/model.json
cp out/web/model.json ../ios/SwingCore/Sources/SwingCore/Resources/model.json
python ../ios/SwingCore/Tests/make_golden.py          # Swift reference outputs
pytest -q                                             # must pass, parity included
```

Verify with `sha256sum` against the values recorded in that release's model card,
then run the release gate with the rolled-back model as the candidate. The full
procedure is `docs/runbooks/model-release.md`.
