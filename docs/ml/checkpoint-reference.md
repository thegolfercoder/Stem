# Tour reference ranges: head movement, pelvis sway, shoulder turn (#12)

The practice loop can only suggest a focus when it knows what typical looks like.
Until now only tempo had a reference (`TOUR_TEMPO_READINGS`), so the head, sway
and turn focuses waited for the golfer to pick them. These are the readings the
shipped pipeline gives tour swings for the three measures behind those focuses.
They are stored in `swingml/insights/reference.py` as `TOUR_BODY_READINGS`, and
no priority rule uses them yet.

## How they were measured

```
python scripts/body_reference.py --videos <GolfDB videos_160> --out ../docs/audit/body-reference.json
```

- **Clips:** every face-on clip of `golfdb-validation-v2` (47) and
  `golfdb-calibration-v2` (38), 85 in all. These splits are used to choose and
  calibrate models, never to train them; the holdout was not read.
- **Pipeline:** each clip ran end to end, MediaPipe pose estimation on the clip,
  then the app's decision and metrics, with the shipped weights (fingerprint
  `8c70fac9540d053b6936aca3cb4688fc`).
- **Handedness:** GolfDB's label, so a handedness miss is not in the reference.
- **Intervals:** 95%, resampling the 32 golfer/video groups (2,000 draws).
- **Refusals:** 1 clip of the 85 gave no reading.
- **Reproducibility:** a second run of the same command wrote a file
  byte-identical to `docs/audit/body-reference.json`.

## Results

| Measure | Unit | 10th percentile | Median | 90th percentile |
|---|---|---|---|---|
| Head movement, address to impact | body lengths | 0.030 [0.017, 0.045] | 0.071 [0.055, 0.093] | 0.140 [0.109, 0.158] |
| Pelvis sway, address to impact | body lengths | 0.030 [0.015, 0.041] | 0.058 [0.046, 0.074] | 0.093 [0.081, 0.107] |
| Shoulder turn at the top, as seen face on | degrees | 49.0 [47.3, 51.5] | 58.0 [54.6, 62.0] | 74.6 [70.3, 81.8] |

All three rest on 84 swings from 32 golfer/video groups.

**Re-measured after #40.** The first run read the clips through a `VideoReader`
that stamped frames one frame early partway through each clip, which can move
an event by a frame. With the fix (`43c98b7`) every percentile moved by at most
0.003 body lengths or 0.5°, well inside its interval. The table above is the
re-run.

## What these do not claim

- **Readings, not true values.** Like the tempo reference, these are what this
  pipeline reads, with its biases built in. A golfer's reading should be
  compared with them only through the same pipeline.
  - Shoulder turn here is the turn *as it appears face on*: a 2-D projection
    that understates the true rotation.
  - Head movement and sway are measured in body lengths on the picture, so
    they are not centimetres.
- **Tour players on broadcast footage, face on only.** These clips are
  downsampled to 160 pixels. A phone close up, a different angle, or an amateur
  swing may read differently for reasons that have nothing to do with the swing.
  The phone test set (#13, #20) is where that would be measured.
- **What "typical" means here.** A golfer outside the 10th–90th band differs
  from these tour readings. That does not make it a fault; plenty of good
  golfers move their heads.
- **Not wired into the priority rules.** Turning a range into "work on this"
  needs evidence that moving the measure toward the range helps, and
  thresholds that hold on phone video. That is a separate decision.
- **Splits differ from tempo's.** The tempo reference was measured on the v1
  splits (170 swings, every view). These use the v2 splits, face on only, so
  the two are not directly comparable in n.
