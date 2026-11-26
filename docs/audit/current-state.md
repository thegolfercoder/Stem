# Current state

An audit of `429fb30`, run from a clean clone on 2026-09-28. The commands and
their output are in `benchmark-baseline.json`; the failures, with evidence and
status, in `failure-inventory.md`; the component map in `architecture-map.md`.

## Since the audit (updated 2026-09-30)

The audit below describes `429fb30` and is left as written. These statements in it
no longer hold:

| Audit statement | Now | Evidence |
|---|---|---|
| The browser and iPhone engines refuse slow-motion replays | All three engines read them (retry at 2, 4, 8 times speed; tempo kept, durations withheld) | `b4f86e0` (desktop), `64463a1` (browser, iPhone); `tests/test_browser_slow_motion.py`, `ParityTests.testASlowMotionClipIsReadAsSlowMotionWithNoDurations` |
| There is no improvement loop | One priority from fixed rules, a drill, a retest and a Welch verdict, on all three apps | `f983356` (desktop), `881462a` (browser, iPhone); `tests/test_browser_practice.py`, `PracticeTests.swift`, `tests/test_ios_practice_golden.py` |

Also since the audit:

- **Tempo compression: four fixes tried, none works.** Sub-frame placement, a
  kinematic address rule, inverting the compression, and a tempo term in training,
  all on validation: none reduces the compression without making tempo worse
  (`f4fcd21`, `7de0548`; `docs/ml/tempo-experiments.md`).
- **Per-swing uncertainty: the model's confidence does not predict tempo error.**
  Rank correlation +0.14 [−0.06, +0.33] for the best signal; the single band stays
  (`40896af`; `docs/ml/uncertainty.md`).
- **Image features beside the pose: no detectable gain.** A pose+image model and a
  pose-only control, same recipe and seed on 619 swings, differ by +0.7 points
  [−2.1, +3.3] within 1 frame and −1.3 [−3.7, +2.9] in tempo error on
  validation, and address does not move. Not sent to the release gate
  (`docs/ml/image-features.md`, #10).
- **The holdout is guarded in code,** and a phone test set path exists: phone
  swings are frozen, and the gate scores them apart, gating from 150 swings by
  30 golfers. No phone set has been collected yet (#23, #13, #20).
- **The desktop app's frame times slipped a frame partway through a clip.**
  The cause was in `VideoReader`, fixed in `43c98b7` (#40). The app's video path
  scored 29% within one frame on validation against 67% through the archive;
  it now reads exactly what the archive reads. Every accuracy figure was
  measured through the archive, so none of the quoted figures changes.
  Measurements that read video through the app's reader were re-run:
  capture sensitivity (#19), the tour body reference (#12) and the slow-motion
  rule (#32).
- **The release gate can judge a rule change** on the same weights
  (`--baseline-config`/`--candidate-config`, non-inferiority; #41). Its first
  verdict, on #32's check for clips slowed 2-3x, was a fail on tempo error, so
  re-reading such a clip stays off. What ships instead (#49) keeps the
  recorded-speed read and withholds only durations and millisecond bands; on
  validation it moves no event and no tempo, and the holdout was not read again
  (`docs/ml/slow-motion-rule.md`).
- **An agent loop** (Strategist, Builder, QA) now maintains the backlog and reviews
  every change (`bb32b18`; `agents/README.md`).

## What works

- **A clean checkout installs and runs.** Fresh clone, fresh virtualenv, 136 s to
  install; the desktop smoke test downloads the pose model and analyses the real
  fixture in 20 s. Lint, types and 253 tests pass (23 skipped: see below); the
  Swift core passes 12 tests; the radar project passes 148.
- **Real phone video is read.** HEVC/HDR, rotated, moov-at-end files decode in the
  browser; the desktop reads any OpenCV-readable clip, including slow motion
  (after the fix in this audit, which also corrected the pictures of slow-motion
  clips).
- **The model beats simple baselines on real held-out golfers.** Within one frame on
  the four core events: network 48.9% [44.8, 52.9] (at 429fb30, before the slow-motion
  rule; 49.0% with it, `release-gate-slowmo-rule.json`); the best simple baseline (a
  one-layer temporal classifier) 40.7%; hand-kinematic rules 26-33%; DTW
  templates 19%.
- **Refusals are real.** No synthetic no-swing clip is read; 3 of 424 no-swing
  stretches cut from real videos are accepted.
- **Provenance is explicit.** Every metric is a `Quantity` with provenance
  (measured, derived, projected, estimated 3D, modelled) and assumptions, or a
  `NoReading` with a reason. Error bands are measured on held-out real swings and
  refused when the weights do not match them.

## What does not work, or is not supported

- **Tempo is compressed toward 3.3** (slope 0.44 at 429fb30; 0.32 with the slow-motion rule
  that ships, `release-gate-slowmo-rule.json`). The headline number understates
  every golfer's distance from typical and every change a golfer makes. This is the
  most important limitation for an improvement product and it is not fixed.
- **Address is placed with a median error of 7 frames** on real footage, and the
  label convention is itself uncertain for phone video. Only one phone swing is
  labelled.
- **The finish is not measured** (median error 29 frames). Its duration was shown as
  measured; it is now refused on every platform.
- **Slow-motion replays were refused as "not a swing"** (71 of 82 in the real
  holdout). Fixed in the Python engine (desktop); the browser and iPhone engines
  still refuse them.
- **The published refusal rate was wrong** (0.9% claimed; 38% actual, almost all
  slow motion). Corrected.
- **CI skipped every parity test.** Fixed.
- **There is no improvement loop.** The product is upload -> metrics -> coach text.
  There is no priority, drill, retest or comparison with evidence.
- **Single user, local only.** No accounts, sync, coach sharing, permissions,
  deletion flow beyond deleting a swing, export beyond JSON, or instrumentation.

## Which claims hold

| Claim | Evidence | Holds? |
|---|---|---|
| 41.9% within one frame on 201 held-out real swings | breakdown | yes |
| Tempo within ±27% for 80% of swings | 85.4% coverage on the holdout before the slow-motion rule; 84.9% with the rule that ships (`release-gate-slowmo-rule.json`) | yes, on broadcast footage |
| 0.9% of real swings refused | whole decision refused 38% | **no** (corrected) |
| Works on the user's phone clip | it analyses; no truth exists | not an accuracy claim |
| Real-fixture tempo | reads 3.20, truth 2.10 | the model is 52% high on the one phone truth |
| iPhone app works | builds on CI; never run on a device | unverified |

## Biggest risks, in order

1. The headline metric cannot show change at its true size (tempo compression).
2. No phone-footage evaluation set: every accuracy number is on broadcast video.
3. No improvement loop, so there is nothing to retain a user once the novelty of
   the first analysis passes.
4. Legal: GolfDB is CC BY-NC (non-commercial) and the model is fine-tuned on it;
   commercial use needs counsel (`docs/legal/freedom-to-operate-questions.md`).
