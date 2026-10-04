# User journeys

The loop the product is built around, step by step, with what exists and what does
not. Platform: the desktop app (Swing Studio). The browser app and the iPhone app run
the same practice loop (priority, drill, retest, verdict) under the same rules, held to
the desktop's by tests; they have no capture preflight, event log or feedback form.

## 1. First swing

| Step | What happens | Status |
|---|---|---|
| Profile | No profile: single user, handedness detected per swing, club typed per upload | **Not built**; a profile adds little until there are several users |
| Record or import | Drop a video on the Swings page (any phone format OpenCV reads, including slow motion) | Built |
| Capture check | Ten sampled frames: blocks a clip with nobody in it or too short; warns on light, framing, size, frame rate | Built (`capture.py`) |
| Analyse | Pose on every frame (at most 60 fps), eight positions, gates, metrics | Built |
| Result or refusal | A refusal gives the reason and what to change; a result leads with one priority | Built |
| Evidence | Key frames with pose drawn on, a frame-accurate scrubber, every metric with provenance and bands | Built |
| What is not known | Listed on the swing page: club and ball values, finish timing, tempo compression | Built |

## 2. Getting a priority

1. After three analysed swings from the same spot with the same club, the swing page
   names one priority, chosen by fixed rules (`insights/engine.py`):
   - **capture** if the latest swing was refused or badly seen;
   - **tempo** if the average reading is outside what tour swings read as;
   - otherwise **"nothing measured stands out; choose what to work on"**.
2. The priority shows its evidence (the swings, their readings, the tour reference),
   its confidence, what it cannot tell, one drill, a retest plan and what would count
   as improvement.

## 3. Practising and retesting

1. **Start practising this** creates a plan. The most recent swings that are comparable
   with each other as one set (same hand, club and camera, up to 5) become the
   baseline, so the retest is compared with a baseline the comparison accepts (#53).
2. The Practice page shows the drill. **Record retest swings** opens the upload page
   tied to the plan.
3. After 3 retest swings the verdict appears:
   - *improved*: the change exceeds what the spread between swings explains, in the
     drill's direction;
   - *worsened*: the same, in the other direction;
   - *no detectable change*: with the smallest change these swings could have shown;
   - *not comparable*: says what differed (club, angle, orientation, phone moved);
   - *not enough swings*.
4. The golfer rates usefulness (1-5) and notes how it felt. Finish or stop the plan;
   earlier plans stay listed.

## 4. Correcting and contributing

On any swing: move a position to the right frame, and the swing is re-measured.
Confirm all eight and the swing becomes a phone-footage training label
(`docs/ml/annotation-guide.md`).

## 5. Your data

Export everything as JSON, or erase everything after typing ERASE. The event
counts the app keeps are shown on the same page.

## Not built

| Journey | Blocker |
|---|---|
| Share a swing with a coach; coach annotates, assigns a drill, revokes access | Needs accounts, sync and permissions |
| History across devices | Needs sync |
| Live capture guidance in the camera | Needs the capture flow on the phone, not an upload |
