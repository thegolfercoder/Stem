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
| Half frame rate | 6.6% [4.4, 8.0], p90 15.9% | 0.006 [0.004, 0.008], p90 0.015 | 0.005 [0.003, 0.008], p90 0.014 | 1.9 [1.6, 2.6], p90 5.3 |
| JPEG quality 20 | 22.3% [14.0, 27.0], p90 42.0% | 0.080 [0.021, 0.131], p90 0.226 | 0.019 [0.015, 0.030], p90 0.059 | 7.5 [5.1, 13.5], p90 18.5 |
| Golfer 80% as tall | 5.3% [3.9, 7.1], p90 15.8% | 0.010 [0.005, 0.013], p90 0.041 | 0.007 [0.004, 0.011], p90 0.022 | 4.1 [2.6, 5.2], p90 8.3 |
| Golfer 120% as tall | 6.8% [5.1, 10.0], p90 18.8% | 0.008 [0.007, 0.010], p90 0.026 | 0.006 [0.005, 0.008], p90 0.015 | 4.1 [1.9, 5.3], p90 9.7 |
| Shifted 10% | 3.7% [1.7, 6.0], p90 10.9% | 0.004 [0.001, 0.005], p90 0.015 | 0.001 [0.001, 0.002], p90 0.014 | 1.2 [0.9, 2.1], p90 4.6 |
| Shifted 20% | 4.1% [1.4, 7.3], p90 10.4% | 0.003 [0.002, 0.004], p90 0.017 | 0.002 [0.002, 0.003], p90 0.010 | 1.2 [0.7, 2.0], p90 4.1 |

Durations, on the 30 real-time swings: backswing moves a median of 7–34 ms
under every change except JPEG (98 ms), and downswing 2–14 ms (JPEG 22 ms).
The full table is in the JSON.

### Refusals and the comparability check

| Change | Answered (of 47) | `compare.py` calls the pair comparable: tempo | … head movement |
|---|---|---|---|
| Half frame rate | 47 | 46/46 | 46/46 |
| JPEG quality 20 | **32** | 25/25 | 24/25 |
| Golfer 80% / 120% as tall | 47 / 47 | 44/44 / 44/44 | 44/44 / 44/44 |
| Shifted 10% / 20% | 47 / 47 | 46/46 / 46/46 | 46/46 / **24/46** |

### Halving the frame rate against the labels (30 real-time swings)

Scored as the release gate scores (read positions rounded to the 60 Hz grid):

| | 30 fps | 15 fps | Difference |
|---|---|---|---|
| Core four within 1 frame | 66.7% | 64.2% | −2.5 points [−11.3, +5.6] |
| Tempo median error | 14.4% | 10.5% | −3.9 points [−7.9, +4.4] |

Unrounded, the within-one-frame figures are 54.2% and 55.0%. Halving the frame
rate costs no measurable accuracy against the labels; each swing's own reading
still moves 6.6% (median).

**Corrected (#40).** The first version of this section reported 18% within one
frame and put it down to the label grid's origin. That explanation was wrong
and untested. The app's `VideoReader` stamped frames one frame early from frame
37 or 69 of each clip, which put the read top, mid-downswing and impact about
two grid frames before the labels. The 18% was also unrounded. Fixed in
`43c98b7`, the read events now sit where the archive's do. Median offsets, read
minus label, in grid frames:

| address | top | mid-downswing | impact |
|---|---|---|---|
| +2.5 | +1.0 | +0.1 | −0.1 |

`scripts/video_path_check.py` shows the app path giving the archive's reads
exactly (`docs/audit/video-path-check.json`). Every number on this page is
from the re-run with the fixed reader.

## What this shows

1. **Heavy compression is the largest effect by far.** It refused 15 of 47
   swings and moved tempo by a median 22%. At 160 pixels, quality-20 JPEG is
   much harsher than a phone's encoder at full resolution, so this bounds the
   effect from above. It still says the app should not be fed re-shared,
   re-compressed clips.
2. **Moving or zooming the phone moves the picture-based measures by a share
   of the tour spread.** A 20% zoom moves shoulder turn a median 4.1°, and
   8–10° at the 90th percentile. The tour 10th–90th range is 49–75°
   (`checkpoint-reference.md`). Yet `compare.py` calls every zoomed pair
   comparable: its 30% body-height tolerance is wider than any zoom tested.
   The 20% shift sits right at its 0.20 centre tolerance, and about half the pairs
   are flagged.
3. **Timing is robust to framing.** Tempo moves about 4–7% (median) under any
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
  turn by up to 4.6° (p90).
- **Low frame rate:** keep it a warning, not a block. No accuracy loss on
  tempo was measured. Durations deserve the warning more than tempo does.
- **Compression:** advise against analysing re-shared or messaged clips
  (capture guidance; see #14).

## What this does not claim

- Broadcast clips at 160 pixels, face on, tour players, with simulated changes
  of the picture. None of this is a golfer filming twice: real swing-to-swing
  variation and real phone encoders are not here.
- One run per condition (after the #40 fix). The same pipeline reproduced the
  body references byte for byte on a second run (`checkpoint-reference.md`), so these should repeat
  on these clips. A different clip set would give different numbers.
- The capture noise measured here adds to, and does not replace, the
  within-golfer variation the retest verdict already accounts for.
