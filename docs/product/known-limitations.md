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
   a tempo outside its own band while the model was fairly sure. Bands do not
   follow the model's confidence: the shipped table has one band per event,
   measured on 85 clips, so every swing gets the same one (desktop and browser
   pages say so since #30; the iPhone app shows the ± figures with no note).

6a. **Left-handed swings read less accurately, and the tempo band is not theirs.**
   On held-out swings, 80% of left-handed tempo readings were within 43% (23
   swings), against 27% for right-handed ones (178). Within one frame on the
   core four: 42.4% against 49.7% (`docs/audit/error-breakdown.json`). The model
   reads the same swing mirrored about 11% lower in tempo, because left-handers'
   poses are not mirrored before features are made. The ±27% band was measured
   on 85 swings, 8 of them left-handed. Every app shows it to a left-hander with
   a note saying it was not measured for them (#33). Mirroring left-handers is
   a follow-up experiment (#45).

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
   durations are shown because the real speed-up is unknown. **A clip slowed
   only 2-3x** passes every gate at recorded speed. Since #49, an answered clip
   whose backswing is over 1.1 s and which reads clearly more confidently as
   slow motion keeps its recorded-speed events and tempo, and its durations and
   millisecond bands are withheld. On `golfdb-validation-v2` that withholds them
   for every clip slowed 2x, 2.5x and 3x, and for 27 of 81 slowed 1.5x; the other
   54 still show durations 1.5x too long. It fired on none of the 81 real-time
   swings, and moved no event and no tempo on any of 465 reads
   (`docs/audit/slow-motion-withhold.json`). Re-reading such a clip at the slowed
   speed instead failed the release gate on tempo (#41) and stays off.
9. **30 fps.** At 30 fps the hands can be lost through impact, which moves impact and
   the tempo; the app warns and recommends 60 fps or more.
10. **Camera shake** is not detected.

10a. **Recording in the app is browser-only.** The browser page can record a swing
   with the camera (#34): a live framing check, a level indicator and a 3 s
   countdown, then 6 s of recording that goes straight into the analysis and
   never leaves the device. The desktop app and the iPhone app still only import
   clips; iPhone recording is #42. Browsers often grant 30 fps, which the page
   reports with the 30 fps caution above. The framing band (body 45-85% of the
   frame's height, centred) is judgement, not measured. The analysis's own
   refusals remain the real test.

10b. **Range sessions are browser-only, and their swing finder is tuned on one
   swing (#56).** In a range session the page keeps the camera on and records
   each swing by itself: still at address for 1 s starts a recording, and it stops
   1.5 s after the last swing-speed movement (8 s at most). Each clip is analysed
   while the next is recorded and kept in the practice log; refused clips and
   recordings with no swing are counted on screen. The thresholds were set on the
   one real phone swing in the tests (`capture.js` `SESSION`); a golfer who
   waggles for over a second, or holds very still after a short swing, may be
   cut early or missed, and that has not been measured on range footage. A phone
   busy analysing the last swing samples the camera less often. The swing finder
   allows for that down to about twice a second. Below that, a recording runs to
   8 s and is kept for the analysis to judge rather than dropped. The
   screen is kept awake only where the browser offers the Wake Lock API. The
   camera uses a second copy of the pose estimator, so a session needs memory for
   two; where the second cannot be made, the camera waits while each swing is
   analysed and the page says so. Tested with Chromium's fake camera and a stand-in
   estimator, not yet on a phone at a range. An optional spoken cue after each
   swing (#62) uses the browser's own voice (speechSynthesis), where it has one,
   and says no more than Stem's read. The desktop app and the iPhone app have no
   session mode.

## Practice loop

11. **Comparability is judged, not measured.** How far a phone can move before a
    picture-based measurement stops being comparable has not been measured; the
    thresholds are stated in `insights/compare.py`.
12. **The smallest detectable change is unknown in general.** Each verdict states
    what its own swings could resolve; no study of within-golfer repeatability exists.
13. **Priorities are limited to what has a reference.** Only tempo has one (tour
    readings); for everything else the golfer chooses the focus and the app measures it.
13a. **Stem's read is a summary, not a coach (#52).** The browser page writes a few
    sentences after each analysis from the numbers already on the page: tempo against
    the tour readings, head, sway and turn against the face-on tour readings of #12,
    and the practice engine's priority. It is made on the device, with no network and
    no Claude, and adds nothing that was not measured. The body comparison is made
    only when the camera looks face on (shoulder ratio at address 0.60 or more: every
    face-on validation clip passes and no down-the-line one does, but 1 of 15 clips
    from other angles passes too, `docs/audit/face-on-shoulder-ratio.json`), and a
    reading outside the tour range is a difference from those tour swings, not a
    fault; no priority rule uses it. One swing's tempo is called quick or long only
    when its whole measured spread lies outside the tour range.
    The desktop keeps its optional local Ollama coach instead, and the iPhone app has
    the Ollama coach but not this read: the iPhone is a step behind the browser here.
13b. **Progress charts differ by app (#38).** The browser draws one chart per
    measure (tempo, head movement, pelvis sway, shoulder turn) from its practice
    log. Swings filmed differently from the latest one are drawn hollow and left
    out of each day's median, and the tour readings sit behind as a labelled band.
    The tour band for head, sway and turn is face on only, and is drawn whatever
    the camera. The desktop's session page draws a band of one standard deviation
    around the golfer's own average, with no comparability check and no tour band.
    The iPhone's History screen charts tempo only.
13c. **Sharing a swing is browser-only (#44).** The browser makes a picture of a
    swing on the device: the frames at address, top and impact with the pose, the
    tempo with its spread, where it sits against tour swings, the practice priority,
    and what one phone camera cannot promise. It goes to the device's share sheet,
    or is downloaded where the browser cannot share files. A photo-heavy card over
    1 MB is saved as JPEG. Long lines wrap and the card grows to fit, so a caveat
    (slow motion, left-handed) is never cut off (#71). The card is dated with the
    device's own day. A left-hander's card quotes no ±% coverage, which was measured
    on right-handed swings only. The desktop app and the iPhone app have no share card yet.
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
