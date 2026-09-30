# Image features beside the pose: can the model see the club? (#10)

**Result: no detectable improvement.** A pose+image model was trained with the
same recipe and seed as a pose-only control, and scored through the app's own
decision on `golfdb-validation-v2`. It is not distinguishable from the control
or from the shipped model on any measure. Address, the club-defined position
that motivated this, did not move. The candidate does not go to the release
gate, and the holdout was not read.

## Why try it

The event model sees 33 body landmarks. GolfDB's positions are defined partly by
the club (address, toe-up, impact), which the landmarks do not show. The largest
single error is address: median 7 frames off on validation. The pixels show the
club.

## What was done

**Features.** Per frame, `scripts/extract_frame_embeddings.py` computes:
- ImageNet MobileNetV3-small features (torchvision, BSD-3-Clause), pooled 2×2
  to 2,304 values;
- a projection to 64 dimensions, with a basis fitted on `golfdb-train-v2` only
  (checked by `swingml.model.rgb.check_basis`);
- the same 60 Hz grid as the poses, mirrored for left-handers.

`swingml.model.rgb.fuse_archive` appends these 64 columns after the 132 pose
columns.

**Training.** Two runs, identical but for the image columns, both
initialised from `out/baseline/swing_event_net.pt`:
- the `e7_s0` fine-tuning recipe on `golfdb-train-v2` (619 swings), seed 0;
- the epoch chosen on `golfdb-validation-v2`;
- the new inputs start at zero weight (`widen_inputs`), so the candidate
  begins from exactly the control's answers.

```
python scripts/experiment.py --name rgb_candidate_s0 --seed 0 --epochs 16 --validate-every 2 \
  --batch-size 8 --max-frames 512 --learning-rate 1e-3 --ema-decay 0.99 \
  --init-from out/baseline/swing_event_net.pt --extra-only --data out/none.npz \
  --real-train out/golfdb/rgb/fused_train.npz --extra-events $E7 \
  --extra-validation out/golfdb/rgb/fused_validation.npz --selection-events $E7
```

The control is the same command with `out/golfdb/split2/{train,validation}.npz`.
`$E7` is the seven events the shipped recipe supervises (all but the finish).

**Scoring.** Both through the app's decision, with the shipped ±27.4% tempo
band for every model, and 95% intervals from 2,000 resamples of golfer/video
groups (141 swings, 29 groups):

```
python scripts/tempo_experiments.py model --manifest swingml/manifests/golfdb-validation-v2.json \
  --rgb out/golfdb/rgb/validation.npz \
  --candidate out/exp/rgb_control_s0/swing_event_net.pt out/exp/rgb_candidate_s0/swing_event_net.pt \
  --resamples 2000 --out ../docs/audit/rgb-vs-shipped.json
```

Pose-only models read only their own columns of the fused clips. The paired
comparison with the control is `docs/audit/rgb-vs-control.json`; in it the
variant labelled `shipped` is the control, as passed with `--model`.

## Results (validation, 141 swings)

| | Shipped | Control (pose) | Candidate (pose + image) |
|---|---|---|---|
| Within 1 frame, core 4 | 48.1% [43.9, 52.1] | 48.8% [44.5, 53.2] | 49.5% [45.6, 53.4] |
| Tempo median error | 11.7% [8.6, 14.7] | 13.2% [9.0, 16.7] | 11.9% [9.2, 15.0] |
| Tempo slope | 0.34 [0.17, 0.68] | 0.28 [0.10, 0.62] | 0.33 [0.13, 0.70] |
| False confidence | 11.3% [5.7, 18.8] | 12.1% [5.5, 20.6] | 9.9% [3.5, 18.1] |
| Address median error (frames) | 6.98 [4.99, 9.34] | 7.44 [5.01, 10.96] | 6.97 [5.00, 9.97] |

**Paired differences, candidate minus control:**
- within 1 frame: +0.7 points [−2.1, +3.3];
- tempo error: −1.3 points [−3.7, +2.9];
- false confidence: −2.1 points [−7.8, +3.1];
- address: −0.47 frames [−2.68, +1.02].

**Candidate minus shipped:**
- within 1 frame: +1.4 [−2.1, +4.9];
- tempo error: +0.2 [−2.3, +3.3];
- address: −0.01 frames [−1.73, +1.56].

The #10 rule was to run the release gate only if the candidate beat the control
on within-1 and tempo error with intervals excluding zero, and false confidence
did not rise. No interval excludes zero, so the gate was not run.

## What this does and does not show

- **Shown:** these features, added this way, to this recipe, on 619 training
  swings, do not measurably help. They do not fix address, which is the error
  they were meant to fix.
- **Not shown:** that pixels cannot help.
  - The features are generic ImageNet descriptors of the whole frame, pooled
    to 2×2. A club is a thin object covering a few percent of a 160-pixel
    frame, and most of what 64 projected dimensions keep is the background and
    the golfer's silhouette.
  - One seed each, so a second seed could shift these numbers. But the
    intervals are narrow enough to rule out a large gain.
- **Optimism is symmetric.** The epoch was selected on the same validation
  split for both models, which flatters both equally.
- **Broadcast footage only,** like every figure here.

## If this is picked up again

Better candidates than more of the same features:
- features from a crop around the hands, where the club is;
- a club or clubhead keypoint detector, if one with a usable licence exists
  (not yet checked; the public data survey is #16);
- supervision from GolfDB's own club-defined events on image crops.

Each is a new item with its own control, measured the same way.
