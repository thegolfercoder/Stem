# How much readings move when only the capture changes (#19)

A retest verdict and the "can these swings be compared" check both assume that
two recordings of the same swing would read the same. They don't quite, and part
of the difference is the measurement, not the golfer. This measures that part
on real swings, by re-reading the same clip with only the capture changed.

## How

```
python scripts/capture_sensitivity.py run --videos <GolfDB videos_160> --perturbation <name>   # each of the 7
python scripts/capture_sensitivity.py summarise --out ../docs/audit/capture-sensitivity.json
```

- **Clips:** the 47 face-on clips of `golfdb-validation-v2` (20 golfer/video
  groups; 17 are slow-motion replays). The holdout was not read.
- **Pipeline:** each clip went through the whole pipeline, MediaPipe on the
  decoded frames and then the app's decision and metrics, with the shipped
  weights and GolfDB's handedness. It ran once as recorded (all 47 answered)
  and once per change.
- **Measures:** the change is |changed − as recorded| per swing. Tempo is
  relative; the other measures are in their own units. Intervals are 95% and
  resample golfer/video groups.
- **The changes:**
  - **Half the frame rate.** Every other frame is dropped. *These clips are
    30 fps, so this is 30 → 15 fps*: what halving costs, not what 30 costs
    against 60. No 60 fps source was available.
  - **JPEG quality 20** on every frame, as a stand-in for heavy phone
    compression. On 160-pixel frames this is harsh; it is not an H.264
    re-encode.
  - **Zoom** so the golfer is 80% or 120% as tall. At 120% the feet can leave
    the frame.
  - **Shift** sideways by 10% or 20% of the frame width.

## Results

### How far a reading moves: median per swing [95% CI], and 90th percentile

| Change | Tempo | Head movement (body lengths) | Pelvis sway (body lengths) | Shoulder turn, face on (°) |
|---|---|---|---|---|
| Half frame rate | 6.3% [4.1, 9.9], p90 14.1% | 0.005 [0.003, 0.008], p90 0.014 | 0.005 [0.003, 0.009], p90 0.016 | 1.9 [1.2, 2.5], p90 5.2 |
| JPEG quality 20 | 23.2% [15.5, 30.9], p90 41.9% | 0.067 [0.027, 0.123], p90 0.218 | 0.020 [0.015, 0.036], p90 0.059 | 6.8 [3.7, 12.8], p90 17.6 |
| Golfer 80% as tall | 5.4% [4.2, 7.6], p90 15.8% | 0.011 [0.008, 0.016], p90 0.041 | 0.005 [0.004, 0.010], p90 0.024 | 3.7 [2.3, 5.5], p90 10.2 |
| Golfer 120% as tall | 6.4% [3.4, 10.3], p90 17.9% | 0.007 [0.005, 0.009], p90 0.023 | 0.005 [0.003, 0.006], p90 0.011 | 3.5 [1.6, 4.6], p90 9.9 |
| Shifted 10% | 4.2% [2.6, 6.9], p90 10.9% | 0.003 [0.001, 0.005], p90 0.011 | 0.001 [0.001, 0.002], p90 0.011 | 1.2 [0.7, 1.8], p90 4.7 |
| Shifted 20% | 4.4% [2.2, 5.7], p90 10.4% | 0.003 [0.001, 0.004], p90 0.017 | 0.002 [0.002, 0.004], p90 0.008 | 1.2 [0.8, 1.8], p90 4.4 |

Durations, on the 30 real-time swings: backswing moves a median of 12–34 ms
under every change except JPEG (113 ms), and downswing 2–13 ms (JPEG 21 ms).
The full table is in the JSON.

### Refusals and the comparability check

| Change | Answered (of 47) | `compare.py` calls the pair comparable: tempo | … head movement |
|---|---|---|---|
| Half frame rate | 47 | 46/46 | 46/46 |
| JPEG quality 20 | **32** | 25/26 | 25/26 |
| Golfer 80% / 120% as tall | 47 / 47 | 44/44 / 44/44 | 44/44 / 44/44 |
| Shifted 10% / 20% | 47 / 47 | 46/46 / 46/46 | 46/46 / **23/46** |

### Halving the frame rate against the labels (30 real-time swings)

Tempo error is −3.3 points [−7.4, +6.4] at 15 fps against 30 fps (13.9% →
10.5%). So no loss of tempo accuracy shows, though each swing's reading moves
6% (median).

Within one frame of the labels is **not reported**: in this harness the read
event times sit 1 to 3 grid frames before the labels for the core events
(median offsets +1.5, −1.0, −1.9, −2.1 frames for address, top, mid-downswing,
impact). That suggests the label grid's origin differs from the clip's first
decoded frame. A 1-frame tolerance cannot survive a 1–2 frame misalignment,
so the 18% it gives is not the model's accuracy (about 48% on validation
through the archived features). Tempo, a ratio of durations, does not depend
on that origin.

## What this shows

1. **Heavy compression is the largest effect by far.** It refused 15 of 47
   swings and moved tempo by a median 23%. At 160 pixels, quality-20 JPEG is
   much harsher than a phone's encoder at full resolution, so this bounds the
   effect from above. It still says the app should not be fed re-shared,
   re-compressed clips.
2. **Moving or zooming the phone moves the picture-based measures by a share
   of the tour spread.** A 20% zoom moves shoulder turn a median 3.5–3.7°,
   and 10° at the 90th percentile. The tour 10th–90th range is 49–74°
   (`checkpoint-reference.md`). Yet `compare.py` calls every zoomed pair
   comparable: its 30% body-height tolerance is wider than any zoom tested.
   The 20% shift sits right at its 0.20 centre tolerance, and half the pairs
   are flagged.
3. **Timing is robust to framing.** Tempo moves about 4–6% (median) under any
   framing change. That is consistent with treating tempo as scale-free, as
   `compare.py` does.
4. **Halving the frame rate costs little on tempo.** Readings move about 6%
   per swing with no measurable loss of accuracy against the labels.
   Durations move more (backswing median 28 ms). This is 30 → 15 fps; 60 → 30
   is untested.

## Recommendation (changes are a follow-up item, not made here)

- **Body-height tolerance for picture-based measures** (head, sway, turn):
  tighten it, because 30% lets through changes that move shoulder turn by up
  to 10°. The value should be chosen on finer zooms (90%, 110%, 95%, 105%),
  finding the zoom at which the induced change falls below the smallest
  difference the retest verdict can detect. That needs a run this item did
  not do.
- **Centre tolerance:** keep 0.20 for tempo, which barely moves. For
  picture-based measures, consider 0.10–0.15, since a 10% shift already moves
  turn by up to 4.7° (p90).
- **Low frame rate:** keep it a warning, not a block. No accuracy loss on
  tempo was measured. Durations deserve the warning more than tempo does.
- **Compression:** advise against analysing re-shared or messaged clips
  (capture guidance; see #14).

## What this does not claim

- Broadcast clips at 160 pixels, face on, tour players, with simulated changes
  of the picture. None of this is a golfer filming twice: real swing-to-swing
  variation and real phone encoders are not here.
- One run per condition. The same pipeline reproduced the body references byte
  for byte on a second run (`checkpoint-reference.md`), so these should repeat
  on these clips. A different clip set would give different numbers.
- The capture noise measured here adds to, and does not replace, the
  within-golfer variation the retest verdict already accounts for.
