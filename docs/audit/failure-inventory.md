# Failure inventory

Every failure, warning, skip and unsupported claim found in the audit of commit
`429fb30`, with the evidence and what was done. Numbers are from
`docs/audit/benchmark-baseline.json` and the files it names; nothing here is
estimated. "Real holdout" means `golfdb-holdout-v1`: 201 swings in 35
golfer/video groups that no model was trained, selected or calibrated on.

Status: **fixed** (with the test that pins it), **open** (not fixed; stated as a
limitation), **by design** (a limit of one camera, kept out of the product).

## The three largest sources of real-world error

Ranked by what they do to the headline number (tempo) and to the product's core
promise (showing a golfer whether they changed).

### 1. Tempo is pulled toward about 3.3 (open)

The slope of log read tempo on log true tempo was **0.44** (95% CI 0.15-0.70) on
the real holdout at 429fb30, and is 0.32 with the slow-motion rule that ships
(`release-gate-slowmo-rule.json`). A true 2.35 reads 2.95; a true 5.12 reads 3.65. Median error is
11% for true tempos between 3 and 4, and 19% below 3 and 17.5% above 4. The only
labelled phone swing (true 2.10) reads 3.20. Synthetic clips show the same thing:
a generated 2.18 reads 2.55.

*Consequence*: a golfer's real change in tempo shows up at under half its size,
and the golfers furthest from typical are the least accurately read. The
improvement loop has to compare **direction** of change within one golfer and
one camera position rather than read the size of a change off the number, and it
cannot quote a single swing's tempo as a diagnosis.

*Tried*: retraining on 2.2x the real swings raises the slope through the
application pipeline from 0.32 to 0.44 and cuts tempo error by 3.2 points
(group-bootstrap 95% CI -6.3 to -1.4), but fails the release gate on the phone
fixture and on false confidence (19.6% against 14.6%). A kinematic
refinement of the top does not help (tempo error 15.2% against 15.1%).

*Pinned by*: the release gate's `tempo_sensitivity` gate, which rejects any model
that lowers the slope by more than 0.05.

### 2. Address and top placement (open, measured)

Median absolute error: address **7 frames** (16 on slow-motion clips), top 2,
impact 1. Placing address exactly would cut the median tempo error from 15.1% to
11.0%; the top, to 10.5%; impact, to 12.7% (`tempo_error_if_one_event_were_exact`
in `docs/audit/error-breakdown.json`). Down-the-line clips lean early on address
(median signed error -2.5 frames); other angles lean late (+1.5). Part of the
address error is the label itself: GolfDB's address and the hand-verified phone
fixture disagree, and a model retrained on more GolfDB footage moves the fixture's
address from 81 to 79 against a verified 84.

*Consequence*: the backswing duration and the tempo carry most of their error from
two events. The fix that is supported by the evidence is data: labelled phone
swings (`scripts/make_labelled_dataset.py`, from positions a golfer confirms in the
desktop app).

### 3. Slow motion refused as "not a swing" (fixed)

82 of the 201 real holdout swings are slow-motion replays: median backswing 3.07 s
at playback speed, past the 2.5 s plausibility gate, and the model's confidence on
a swing slowed 4x or 8x collapses below the refusal threshold (0.16 and 0.11 on a
generated swing). Through the application's full decision, **71 of 82 were
refused**; the refusal said the clip was not a swing. A phone's slow-motion export
is the same footage.

*Fix*: a clip refused for its events is re-read as if played 2, 4 and 8 times
faster; the most confident reading that passes every gate is kept, marked
`playback_slowed_by`, with tempo reported under a stated assumption and every
duration refused. Measured: slow-motion swings answered 11/82 -> 82/82,
real-time 114/119 -> 117/119, no-swing stretches accepted 2/424 -> 3/424, slow-
motion tempo error 15.5%. *Pinned by*: `tests/test_measured_failures.py`,
`tests/test_release_gate.py::test_the_gate_reads_a_slow_motion_swing_the_way_the_app_does`.

*Ported*: the browser (`readAtSpeeds`, webapp/metrics.js) and iPhone
(`SwingAnalyzer.analyse`) engines run the same retry, held to the desktop's
answer on a slowed copy of the real swing (`tests/test_browser_slow_motion.py`,
`ParityTests.testASlowMotionClipIsReadAsSlowMotionWithNoDurations`). *Still
open*: a phone slow-motion clip ramps speed at its ends; if the swing crosses a
ramp the tempo is wrong, which is why it carries the assumption.

## Other failures

| # | Failure | Evidence | Status |
|---|---|---|---|
| 4 | **Finish not measured, but its duration shown.** "Whole swing" (address to finish) was displayed in ms as *measured*. | Finish median error 29 frames (~0.5 s), within one frame 0.5% of the time. | **Fixed**: refused in Python, browser and Swift engines, with the reason; parity and Swift reference updated. `test_the_whole_swing_duration_is_not_reported_from_an_unreliable_finish` |
| 5 | **Published refusal rate was wrong.** "0.9% of real swings refused" measured the confidence rule only. | Through the timing gate as well: 76 of 201 refused. | **Fixed** (retry, above) and corrected in the model card; `scripts/measure_refusals.py` measures the whole decision. |
| 6 | **CI never ran browser/Python parity.** All 22 parity tests skip in a fresh checkout because the web payload is a build product. | Clean checkout: 253 passed, 23 skipped. | **Fixed**: CI exports the payload (2 s) before `pytest`. |
| 7 | **The iPhone model copy could drift silently.** | A hand-copied `model.json`; nothing compared it. | **Fixed**: `tests/test_model_copies.py`. It matches today. |
| 8 | **Synthetic evaluator scored every clip against tempo 3.0**, including clips generated at 2.2 and 3.8. | `scripts/evaluate_clips.py` had `--expect-tempo 3.0`. | **Fixed**: each clip is scored against the tempo it was generated with; JSON output. |
| 9 | **Confidence intervals resampled clips, not golfers.** Clips of one golfer from one video are correlated; clip resampling understates uncertainty. | 201 clips are only 35 groups. | **Fixed** in the release gate, `scripts/compare.py` and `scripts/benchmark_baselines.py`: all three resample golfer/video groups from the frozen manifest matching the archive (`manifest.group_resamples`), and say so when no manifest matches. The intervals already recorded in `docs/audit/baselines.json` were resampled by clip and were not recomputed, since that would mean reading the holdout again; they are narrower than a group bootstrap would give. |
| 10 | **No release gate.** A model shipped on a benchmark and a fixture test run by hand. | - | **Fixed**: `python -m swingml.model.release_gate`, nine gates, exit 2 on missing evidence. Retrained `g7_s1` fails it (fixture address, false confidence). |
| 11 | **No frozen manifests.** "The holdout" meant 201 clips, then 320. | - | **Fixed**: `swingml/swingml/manifests/golfdb-*-v1.json`, `-v2.json` with SHA-256 and golfer/video groups; `python -m swingml.dataset.manifest check`. |
| 12 | **False confidence.** On the real holdout 14.6% of answered swings read a tempo outside their own ±27% band while the model's core confidence was 0.5 or more. | Release gate report. | **Open**; gated so it cannot rise. |
| 13 | **Down-the-line synthetic clip reads tempo +41%** with confidence 0.39, above the 0.30 refusal line. | `docs/audit/synthetic-eval.json`. | **Open**; on real footage down-the-line is not worse than face-on (48.2% vs 53.7% within one frame, within noise), so this is flagged, not acted on. |
| 14 | **Left-handed golfers**: 23 in the holdout, tempo error 18.1% vs 14.6% right-handed. | Breakdown. | **Open**; too few to separate from noise. |
| 15 | **Slow-motion time scale is a guess.** Retried clips report no durations; ms error bands are refused for them. | By construction. | **By design.** |
| 16 | **ResourceWarning: unclosed socket** in three coach tests (FakeOllama fixture). | pytest warnings summary. | **Fixed**: the fixture shuts its server down and the client closes error responses. |
| 17 | **The rendered training corpus is not reproducible** byte-for-byte: it was lost with an earlier container. | `swingml/README.md`. | **Open**; the base model's synthetic pre-training cannot be re-run exactly. Fine-tuning on real data is reproducible from the manifests. |
| 18 | **Only one labelled phone swing.** Every real accuracy figure is on broadcast/range footage. | Data card. | **Open**; collection path built (`scripts/make_labelled_dataset.py`, desktop position editor). |
| 19 | **Club- and ball-defined values** (face, path, plane, attack angle, spin, speed, launch, carry) cannot come from one uncalibrated camera and a body tracker. | Physics of the setup. | **By design**: never output; the coach guard drops sentences that assert them. |
| 21 | **Local server open to other web pages.** No Host or Origin check: DNS rebinding could read swings; a cross-site post could reach routes that do not require JSON. | Found writing `docs/security/threat-model.md`. | **Fixed**: Host must be 127.0.0.1/localhost unless serving on the LAN by explicit choice; state changes with another site's Origin refused. `test_requests_for_another_host_name_are_refused` |
| 22 | **Deleting a swing left its video and frames on disk.** | Found writing `docs/legal/data-retention-and-deletion.md`. | **Fixed**: `test_deleting_a_swing_removes_its_files` |
| 23 | **The desktop app stamped frames one frame early after a slip.** `VideoReader` read OpenCV's time before each decode, which is the previous frame's time. A fallback hid it for the first few dozen frames, then every frame was one early: in 140 of 141 GolfDB validation clips from frame 37 or 69, on the phone fixture from frame 7. Durations spanning the slip were a frame short. The app's video path scored 29% within one frame on validation, against 67% through the archive. The browser and iPhone read each frame's own time. Measured since (#47): the browser page itself, run in headless Chromium on the same 81 clips (re-encoded to VP9, every frame at its own time), scored 64.7% [59.2, 70.8] against the archive's 67.2% [62.5, 72.7] on the 80 both answered; paired difference −2.5 points [−6.6, +1.5]. The median per-event offset from the archive is under 0.13 of a 60 Hz step for the first seven events (no slip), and the page refused one clip the archive answered (731). The iPhone's frame timing is held by `FrameGateTests` (SwingCore); its full video path has not been run. | Found by QA (#40) from the capture-sensitivity harness's 18%. | **Fixed** in `43c98b7`: the app path now gives the archive's reads exactly (67.3%; `docs/audit/video-path-check.json`). `tests/test_video_reader.py` |
| 20 | **Radar DSP (`launchmon-py`)** passes its tests on simulated signals only; no hardware, no field validation. | 148 tests on synthetic returns. | **Open**; not part of the product. |

## Claims checked

| Claim (where) | Supported? |
|---|---|
| "Within one frame 41.9% on 201 held-out real swings" (PR, README) | Yes: 41.85% (all 8 events). |
| "0.9% of real swings refused" (PR) | **No**: confidence rule only; the whole decision refused 38%. Corrected. |
| "Tempo band ±27%, 80% coverage" | Yes on the holdout: 85.4% of answered swings inside it before the slow-motion rule, 84.9% with the rule that ships (`release-gate-slowmo-rule.json`). |
| "Tested on the user's phone clip" | It analyses (tempo 2.89); there is no truth for that clip, so no accuracy claim. |
| iPhone app "builds" | Yes, on CI (simulator). Not run on a device. |
