# Event labelling specification

The eight swing positions the model predicts, defined so that two people labelling
the same clip mark the same frame, and so that it is clear which positions one
camera and a body tracker can support. Frame numbers are in the clip's own frames;
the model works on a 60 Hz grid, so at 30 fps one clip frame is two grid frames.

Tolerances are the phone fixture's, in its own 30 fps frames, set from how sharply
each position is defined in that clip; positions the fixture does not label have
none yet. The benchmarks score every position at 1, 2 and 5 frames of the 60 Hz grid.

The taxonomy is GolfDB's (McNally et al., CVPR Workshops 2019). The operational
definitions below are this project's, written for single-camera phone video and
checked against the one hand-verified phone clip (`swingml/tests/fixtures/real_swing_01`).

## Summary

| # | Event | Defined by | Operational definition | Evidence required | Tolerance (fixture, 30 fps frames) | Product status |
|---|---|---|---|---|---|---|
| 0 | Address | body + club | The last frame before the takeaway starts: hands still, then moving | Hands visible; ≥0.3 s of stillness before | ±3 | Measured; median error 7 on real footage |
| 1 | Toe-up | **club** (shaft parallel to ground, backswing) | Placed from the body; the pose tracker does not see the club | Hands and lead forearm visible | not set | Shown with an asterisk; no metric uses it |
| 2 | Mid-backswing | body (lead arm parallel to ground) | Lead arm horizontal in the image during the backswing | Lead shoulder, elbow, wrist visible | not set | Shown; no metric uses it |
| 3 | Top | club (direction change) | The frame where the hands reach their highest point and reverse | Hands visible at the top | ±3 | Measured; tempo endpoint |
| 4 | Mid-downswing | body (lead arm parallel to ground) | Lead arm horizontal in the image during the downswing | Lead arm visible | not set | Measured |
| 5 | Impact | club meets ball | The last frame with the ball on the tee (or ground) | Ball visible, or hands at their lowest if not | ±2 | Measured; tempo endpoint |
| 6 | Mid-follow-through | **club** (shaft parallel, follow-through) | Placed from the body | Arms visible | not set | Shown with an asterisk |
| 7 | Finish | body (pose held) | First frame where motion falls back to the address noise floor and stays | ≥0.3 s after it in the clip | ±6 | **Marked, not timed**: no duration ends here |

## Definitions in full

**Address.** Measure hand speed over a settled stretch before the takeaway (at least
nine frames at 30 fps). Address is the frame before the one where hand speed first
exceeds eight standard deviations above that stretch's mean. On the phone fixture
this rule gives frame 84 (settled speed 0.042 ± 0.012 body lengths per second).
*Ambiguous*: waggles and forward presses before the takeaway. Mark the address
after the last waggle, from the start of the continuous backswing. GolfDB's
labellers mark it earlier on average; a model trained on more GolfDB labels moved
the fixture's address from 81 to 79 against this definition's 84.

**Top.** The frame where the hands are highest in the image before descending. The
club keeps travelling after the hands reverse, so a club-defined top is one or two
frames later than this; the model is trained on GolfDB's club-defined label and
leans +0.9 frames late on held-out swings, consistent with that.

**Impact.** The last frame with the ball in its original place. Where the ball is
not visible, the frame where the hands are lowest in the downswing. On the phone
fixture the ball is on the tee through frame 114 and gone at 115, so impact is 114
under this definition; the fixture records 115 as the first frame without the ball
and allows ±2.

**Finish.** Motion after impact falls back to within the address noise floor and
stays there. A golfer holds a pose rather than arriving at an instant, so this is
the loosest event; with the model's median error of 29 frames on real footage it
is shown on the timeline and never used as the end of a duration.

**Club-defined positions (toe-up, mid-follow-through).** The shaft is not tracked.
These are placed from the body's motion and marked with an asterisk wherever they
appear. If a club tracker is added they become measurable; until then no metric
depends on them.

## When a position is unavailable

Mark it unavailable, not guessed, when:

- the body part that defines it is out of frame or occluded for its whole window
  (for example the lead arm hidden behind the torso down the line at mid-downswing);
- the clip starts after it (no address) or ends before it (no finish);
- two positions would fall on the same frame at the clip's frame rate.

The desktop app's position editor requires all eight to confirm a training label;
a swing with an unavailable position can still be corrected for its own
measurements but is not used as a label. Partial labels are a known gap: the
archive format supports per-event supervision masks for GolfDB (`--extra-events`)
but the golfer-label path does not yet write them.

## Disagreement

Two labellers' frames for the same event are both kept. The adjudicated frame is
the median of three labels where three exist; otherwise the event is recorded as an
interval `[min, max]` and a model is scored as correct if it lands inside the
interval widened by the tolerance above. Not yet implemented in the archive format:
today each label is a single frame, and GolfDB supplies one label per event.
