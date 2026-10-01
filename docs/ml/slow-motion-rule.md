# Catching a clip slowed two or three times (#32)

The slow-motion retry used to run only on a clip refused at recorded speed. A
clip slowed 2–3× passes every gate at recorded speed, because a doubled
backswing still fits the 0.30–2.50 s bound. Its durations were then shown two or
three times too long, as plain measurements. QA reproduced it on the real phone
fixture (#32). The retry now also checks an *answered* clip whose backswing is
long, in all three engines and in the release gate's `decide`.

## The rule

A clip answered at recorded speed whose backswing is longer than **1.1 s** is
also read at 2, 4 and 8 times speed. The backswing is measured in whole frames on
the model's grid, address to top. The clip is read as slow motion when the most
confident slowed read beats the recorded-speed core confidence by more than
**0.01**. Core confidence is the geometric mean over address, top, mid-downswing
and impact, as the retry already used. Then, as for any slow-motion read, the
durations are withheld, the tempo is kept with its slow-motion assumption, and
the bands are withheld.

Settings: `AnalysisConfig.slow_motion_check_backswing_s` and
`slow_motion_margin`, carried in the web and iPhone payload as
`slow_motion_check_backswing_s` and `slow_motion_margin`.

## How it was chosen

```
python scripts/slow_motion_rule.py poses --videos <GolfDB videos_160>
python scripts/slow_motion_rule.py probe
python scripts/slow_motion_rule.py summarise --out ../docs/audit/slow-motion-rule.json
```

- **Clips:** all 141 clips of `golfdb-validation-v2`, in 29 golfer/video groups
  for the real-time clips. The holdout was not read to choose anything.
  - 81 clips are real time. Each was read as recorded, and again re-timed as if
    slowed 1.5, 2, 2.5 and 3 times: timestamps multiplied, the same frames.
  - 60 are GolfDB's own slow-motion replays, read as recorded.
- **Pipeline:** MediaPipe on the decoded clip, then the shipped model.
- **Each read records** whether the events decode, the core confidence, the
  durations, and whether every gate passes. Reads were taken at recorded speed
  and at 1.5, 2, 2.5, 3, 4 and 8 times faster.
- **Rules compared:** factor sets {2, 4, 8} and {2, 3, 4, 8}, backswing bounds
  from 0 to 1.5 s, and margins from 0 to 0.05.
- **Criterion, fixed in the script before the full run:** at most 2% of
  answered real-time swings read as slow motion. Among the rules that meet it,
  the one that reads the most 2× and 3× clips as slow motion. Ties go to the
  larger backswing bound (fewer extra passes), then to the larger margin.

## Results

| | Before: retry refused clips only | Now: 1.1 s, margin 0.01 |
|---|---|---|
| Real-time swings read as slow motion | 0 of 81 | **0 of 81** |
| 2× clips with durations shown as measured | 96.3% (78 of 81) | **0%** |
| 2.5× clips with durations shown as measured | 82.7% | **0%** |
| 3× clips with durations shown as measured | 54.3% [38.9, 70.7] | **0%** |
| 1.5× clips read as slow motion | 0% | 35.8% |
| GolfDB slow-motion replays read as slow motion | 59 of 60 | 59 of 60 |

- **Zero false slows is not proof of none.** The one-sided 95% upper bound for
  0 of 81 is 3.7% if swings are treated as independent, and 10.3% treating the
  29 golfer/video groups as the units.
- **Why it separates.** Best slowed core confidence minus recorded-speed core
  confidence:

  | Clip | n | min | median | max |
  |---|---|---|---|---|
  | Real time | 74 | −0.515 | −0.167 | **−0.061** |
  | Slowed 1.5× | 81 | −0.059 | +0.002 | +0.077 |
  | Slowed 2× | 78 | **+0.016** | +0.075 | +0.186 |
  | Slowed 3× | 44 | +0.034 | +0.107 | +0.202 |

  The model is most confident at the speed it was trained on. No real-time
  swing came within 0.061 of being read slowed. The narrowest 2× clip cleared
  the 0.01 margin by only 0.006, so the margin has less headroom on that side.
- **The backswing bound decides which clips are checked**, not how they are
  read. Every bound up to 1.1 s caught all 2× clips. At 1.2 s one 2× clip
  slipped through: its recorded-speed backswing was 1.18 s. At 1.5 s, 15% slip
  through. 9 of the 81 real-time swings have a backswing over 1.1 s, and none
  was read slowed.
- **1.5× is not resolved.** The core confidences of real time and 1.5× overlap,
  and about a third of 1.5× clips are read as slow motion (at 2×). Either way
  the result is honest about what it knows: read as slow motion, durations are
  withheld. Read as real time, durations are 1.5× too long, which this rule does
  not catch.

## The holdout, through the release gate

The shipped model went through `release_gate` against itself twice: under the new
rule (`docs/audit/release-gate-slowmo-rule.json`) and with the check off
(`docs/audit/release-gate-slowmo-rule-before.json`). The check-off run reproduces
the previously published figures exactly. Both runs only report; the rule was
fixed on validation before either ran, and nothing was changed after.

| Holdout, 201 swings | Check off | Check on |
|---|---|---|
| Answered | 99.0% | 99.0% |
| Core four within one frame | 48.7% | 49.0% |
| Tempo median error | 15.2% | 15.3% |
| Tempo band coverage (80% claimed) | 85.4% | 84.9% |
| Event band coverage | 96.5% | 98.2% |
| Confidently wrong | 14.6% | 15.1% |

Each change is about one swing in 201, and most of them are in the slow-motion
replay subgroup (82 clips). There, clips that had answered at recorded speed are
now read as slow motion. The per-clip changes are not in the report.

Every absolute gate passes under both rules:
- evidence and no leakage;
- the real fixture;
- band coverage and false confidence;
- refusals, subgroups and tempo sensitivity.

`beats_baseline_on_frozen_real_test` fails in both runs, by construction. It
asks a candidate model to beat a baseline model, and here the two are the same
model, so every difference is exactly zero. The gate has no way to compare two
decision rules for one model. That is filed as its own item.

## What this does not claim

- **Re-timing is a proxy.** Multiplying timestamps keeps the frame count, so a
  30 fps clip slowed 2× becomes 15 fps. A real 2× slow-motion clip is shot at
  60 fps and played at 30, with twice the frames. GolfDB's own replays, which
  are real slow motion, are read the same as before (59 of 60).
- **Tour swings.** Club golfers with backswings over 1.1 s are more common than
  in GolfDB. They are checked by the confidence comparison, which did not
  misfire on any real-time swing here, but the 9 long real-time backswings are
  little evidence for that population.
- **The true slow-down is not measured.** A slowed read keeps tempo and
  withholds durations, as before. The factor it reports (2, 4 or 8) is the
  most confident read, not the clip's real speed.
