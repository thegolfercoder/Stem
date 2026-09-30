# Evaluation plan

How a model or a pipeline change is judged, and what is still missing to judge it
properly.

## Now

1. **Frozen real test set.** `golfdb-holdout-v1` (201 swings, 35 golfer/video
   groups). Every change is scored on it through the application's own decision
   (`swingml.model.release_gate`), never on a split chosen after seeing results.
   Nothing else can read it: every other loader refuses the holdout's archive,
   its manifest, or its clips in other bytes (`manifest.guard_archive`).
2. **Group bootstrap.** Intervals resample golfer/video groups, not clips.
3. **Metrics.** Within 1 and 2 frames (core four and all eight events); median and
   80th-percentile tempo error; tempo sensitivity (log-log slope); band coverage;
   false-confidence rate; real swings answered; no-swing stretches accepted.
4. **Subgroups.** Face on, down the line, other; slow motion, real time; left, right.
5. **Real fixture.** The phone swing, every labelled event within tolerance.
6. **Simple baselines.** `scripts/benchmark_baselines.py`: a model must beat them.
7. **Synthetic, separately.** `scripts/evaluate_clips.py` on the 15 rendered cases,
   including three that must be refused; never mixed into real figures.

## Gates

A candidate replaces the shipped model only if `python -m swingml.model.release_gate`
exits 0. The gates and their margins are in the module's docstring and
`docs/runbooks/model-release.md`.

## Next, in order of what it would change

1. **A phone test set.** 150+ labelled phone swings from 30+ golfers across several
   sessions each, split by golfer, frozen before any training uses the rest. Until it
   exists the gate's real-footage number describes broadcast video.
2. **Within-golfer repeatability.** Ten swings from each of 20 golfers in one session
   from one camera spot: the spread of each metric within a golfer is the smallest
   change the practice loop can detect, and it is not known.
3. **Camera-position sensitivity.** The same swings filmed from two spots at once, to
   replace the comparability thresholds (currently judgement) with measured ones.
4. **Tempo calibration by reading level.** Coverage of the tempo band is measured
   overall; readings far from 3 are the ones compressed most, and their coverage
   should be measured separately.
5. **Annotator agreement.** Two labellers on 100 phone swings, to know how much of
   the address error is the label.

## What would change the product contract

- If phone-footage accuracy on address and top is not better than GolfDB's, tempo
  stays a within-golfer comparison and is not shown as an absolute number against a
  tour range.
- If within-golfer repeatability of head movement or sway is worse than the changes
  drills produce, those focuses are removed from the practice loop.
