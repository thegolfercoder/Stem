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
   exists the gate's real-footage number describes broadcast video. The path is
   built (#13):
   - Each golfer confirms positions in the app and exports them with
     `scripts/make_labelled_dataset.py`.
   - `scripts/make_phone_test_set.py` combines the exports, renumbers the swings,
     groups them by golfer, and freezes a `phone-holdout` manifest.
   - The release gate reads it with `--phone-manifest` and reports it apart from
     GolfDB. It gates only at 150 swings from 30 golfers; below that it reports
     without gating, and without the manifest it says "no phone evidence".

   How the swings are collected, and under what consent, is the owner's decision
   (#20). Label agreement between two people is a follow-up item.
2. **Within-golfer repeatability.** Ten swings from each of 20 golfers in one session
   from one camera spot: the spread of each metric within a golfer is the smallest
   change the practice loop can detect, and it is not known.
3. **Camera-position sensitivity.** The same swings filmed from two spots at once, to
   replace the comparability thresholds (currently judgement) with measured ones.
4. **Tempo calibration by reading level.** Measured on broadcast swings (#18,
   `uncertainty.md`): no tempo tercile's coverage interval lies below 80%, but
   readings at both ends are pulled toward the middle, by about 9 to 13%, and cells
   of 35 to 54 swings are too small to rule out a 10-point shortfall. Repeat on the
   phone test set.
5. **Annotator agreement.** Two labellers on 100 phone swings, to know how much of
   the address error is the label.

## What would change the product contract

- If phone-footage accuracy on address and top is not better than GolfDB's, tempo
  stays a within-golfer comparison and is not shown as an absolute number against a
  tour range.
- If within-golfer repeatability of head movement or sway is worse than the changes
  drills produce, those focuses are removed from the practice loop.
