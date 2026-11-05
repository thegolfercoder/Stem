# ADR 0002: Frozen manifests and an automated release gate

**Status:** accepted · 2026-09-28

## Context
Models had shipped on a benchmark plus a hand-run fixture test. "The holdout" had
meant two different sets. Intervals resampled clips although 201 clips are 35
golfer/video groups. A retrained model better on the benchmark was worse on the one
phone swing, and nothing automated would have stopped it.

## Decision
Splits are frozen as manifests (archive SHA-256, clip ids, leakage groups) and checked
for shared clips and groups. `python -m swingml.model.release_gate` decides whether a
candidate may replace the shipped model, through the application's own decision,
with a group bootstrap and nine gates, exiting 2 when evidence is missing.

## Consequences
A model cannot ship without a model card, matching error bands, and a frozen test set
it was not trained near. The gate's margins (2 points, 1 point, 5 points, slope 0.05)
are policy, stated in the module, and can be argued with in a later ADR.
