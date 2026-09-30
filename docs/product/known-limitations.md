# Known limitations

Stated to users, in the product and here. Each links to its evidence. When one is
fixed, it moves to the changelog with the measurement that shows it.

## Accuracy

1. **Measured on the wrong footage.** Every accuracy figure is on broadcast and range
   video of tour players (GolfDB). One phone swing has been checked by hand, and its
   tempo read 3.20 against a true 2.10.
2. **Tempo is compressed toward 3.3.** A golfer's distance from typical, and a
   golfer's change, show at about 0.44 of their real size (95% CI 0.15-0.70). A quick
   tempo can read as normal. `docs/audit/benchmark-baseline.json`.
3. **Positions within one frame about half the time.** 48.9% for address, top,
   mid-downswing and impact on held-out real swings; address is the worst (median 7
   frames at 60 Hz).
4. **The finish is not measured.** It appears on the timeline, but no duration ends there.
5. **Toe-up and mid-follow-through are guesses from the body.** They are defined by
   the club, which is not tracked.
6. **Confidently wrong 14.6% of the time.** That share of answered test swings read
   a tempo outside its own band while the model was fairly sure.

## Capture

7. **One golfer, one swing per stretch.** A second person in shot is not detected;
   long clips are searched for the best candidate swing (browser app).
8. **Slow motion.** All three apps read a slow-motion export by re-timing it: a
   clip refused at its recorded speed is read again at 2, 4 and 8 times speed and
   the most confident read is kept (desktop since `b4f86e0`; browser and iPhone
   since `64463a1`, held to the desktop's answer by
   `tests/test_browser_slow_motion.py` and
   `ParityTests.testASlowMotionClipIsReadAsSlowMotionWithNoDurations`). Tempo
   assumes the whole swing was slowed evenly, which a phone's slow-motion clip
   breaks if the swing crosses the speed ramp at its start or end, and no
   durations are shown because the real speed-up is unknown.
9. **30 fps.** At 30 fps the hands can be lost through impact, which moves impact and
   the tempo; the app warns and recommends 60 fps or more.
10. **Camera shake** is not detected.

## Practice loop

11. **Comparability is judged, not measured.** How far a phone can move before a
    picture-based measurement stops being comparable has not been measured; the
    thresholds are stated in `insights/compare.py`.
12. **The smallest detectable change is unknown in general.** Each verdict states
    what its own swings could resolve; no study of within-golfer repeatability exists.
13. **Priorities are limited to what has a reference.** Only tempo has one (tour
    readings); for everything else the golfer chooses the focus and the app measures it.
14. **The browser keeps its practice log in the browser.** Clearing site data, a
    private window, or another browser starts from nothing, and nothing moves between
    the desktop, the browser and the iPhone. The iPhone's practice screen builds in CI
    but has not been run on a phone. The same clip analysed twice: the browser
    replaces the earlier reading (it recognises the file by a hash of its name, size
    and date), except that a refused run never replaces an analysed reading of the
    clip, which is kept and named on the page. The desktop (#25) and the iPhone
    (#29) do the same, recognising the clip by a SHA-256 of the file. The
    iPhone's Practice tab lists refused clips so they can be removed. All three
    drop a deleted swing from its plans. The browser's sample swing is never
    kept. The iPhone's side of this is tested in SwingCore; the app itself is
    only built in CI and has not been run on a phone (item 16).

## Product

15. **Single user, one computer.** No accounts, sync, sharing or coach access.
16. **The iPhone app has not been run on a phone**; it builds for the simulator in CI.
17. **Commercial use of the model is unresolved**: it is fine-tuned on GolfDB, whose
    annotations are licensed for non-commercial use (`docs/legal/freedom-to-operate-questions.md`).
