# Failure taxonomy

Which layer a wrong answer comes from, how to tell, and what the product does about
it. "Model accuracy" is not a cause.

| Layer | Failure | How to tell | Product response | Evidence |
|---|---|---|---|---|
| Capture | nobody in shot, too short, too dark, feet or head out of frame, golfer tiny | preflight on 10 sampled frames | block (no body, too short) or warn, with advice | `swingml/capture.py`, `test_capture.py` |
| Capture | slow-motion export (time stretched 2-8x) | refused at recorded speed, accepted when re-read faster | tempo with assumption; durations refused | 71/82 refused before, 82/82 after |
| Decode | wrong orientation, frames dropped, moov at end, HDR | browser: orientation probe, WebCodecs; desktop: OpenCV | pictures and positions matched by time, not position | `test_frames_slow_motion.py` |
| Pose | hands lost through impact at 30 fps | wrist visibility near impact; hand-speed discontinuities | none automatic; frame-rate warning at preflight | phone fixture hand speed 19.8, 6.7, 1.9, 3.9 across impact |
| Pose | 3D output not rigid | shoulder/hip line length varies >25% | 3D angles refused | `metrics/swing.py` |
| Pose | left/right confusion | handedness call margin at the top | tries both ways; reports how it was decided | `infer_handedness` |
| Event model | address placed early or late | median 7 frames; label convention differs on phone | measured band; golfer can move it | error breakdown |
| Event model | tempo compressed toward 3.3 | slope 0.44 of log read on log true tempo | tour-range reference compares readings with readings; comparison says change is understated | error breakdown, gate |
| Event model | finish not locatable | median 29 frames | never used as a duration end | `FINISH_UNRELIABLE` |
| Event model | confident and wrong | tempo outside its band with core confidence ≥0.5: 14.6% | gated so it cannot rise | release gate |
| Gates | no-swing clip accepted | no-swing stretches accepted: 3/424 | refusal thresholds tuned on validation, measured on test | `measure_refusals.py` |
| Metrics | camera moved between swings | camera signature (orientation, body size and position, shoulder ratio) | comparison refused or warned | `insights/compare.py` |
| Labels | annotator convention | GolfDB address vs fixture address | phone labels via the golfer; disagreement as intervals (planned) | `event-labeling-spec.md` |
| Coach (LLM) | asserts an unmeasurable value | sentence regex guard | sentence dropped as it streams | `coach/guard.py` |

To localise a new failure: run `scripts/error_breakdown.py` on the clip set, compare
subgroups, then replay one clip's poses (`pose.npz` in the app's frames folder) through
`analyse_pose_sequence` with the gates relaxed to see whether the model or a gate made
the call.
