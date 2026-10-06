# Metric definitions (for golfers)

What each number on the swing page means, how far to trust it, and when it is not
shown. The engineering contract, with types and tests, is `docs/ml/metric-contract.md`.

| Shown as | What it is | How far to trust it | Compare only with |
|---|---|---|---|
| **Tempo** | Backswing time divided by downswing time. Tour players' swings read between 2.89 and 4.59 through this analysis (80% of them). | ±27% on one swing for 80% of swings. Readings are pulled toward 3.3, so a tempo far from 3 reads closer to 3 than it is, and a change shows smaller than it is. | Swings with the same club, the same hand, the same orientation (portrait or landscape) and roughly the same camera angle. The phone may be nearer, further or to one side: a ratio of times does not depend on that |
| **Backswing, downswing** | Milliseconds from address to the top, and from the top to impact | Address is the least precise position (about 7 frames at 60 Hz median on test swings), so the backswing is the less precise of the two | As tempo, and filmed at normal speed |
| **Whole swing** | Not shown: the finish cannot be placed reliably from one camera | - | - |
| **Hands fastest** | When the hands moved fastest, relative to impact | To the nearest frame; at 30 fps a frame is 33 ms | Same frame rate |
| **Shoulder turn, hip turn** | How far the shoulders and hips turned away from square to the camera at the top, read from how much they narrow in the picture | Reads low against reality, and only the size of the turn, not its direction | Swings filmed from the same spot |
| **Line tilt, separation** | How far the shoulder and hip lines rotated in the picture | A picture angle, not a body angle | Same spot |
| **Head movement, pelvis sway, pelvis lift** | How far the head and pelvis moved between address and impact, measured against the feet, in body lengths | Refused if the feet are not in shot | Same spot |
| **Kinematic sequence** | The order the pelvis, chest and lead arm reached their fastest in the downswing | Reported as seen, not scored | - |

"Compare only with" is the rule the practice loop applies before it judges a change
(`insights/compare.py` `comparability`, the same in the browser and the iPhone app).
Every comparison needs the same club, the same hand and the same orientation, and a
camera angle that stayed roughly the same (face on throughout, or down the line
throughout); the app refuses one that mixes them and says why. "Same spot" adds that
the phone did not move nearer, further or to one side, which tempo and the backswing
and downswing times do not need.

## Signs next to a number

- **measured**: read from the frames and their times.
- **derived**: calculated from measured numbers (tempo).
- **projected**: an angle or distance in the picture, which changes if the phone moves.
- **estimated 3D**: from the pose network's own depth guess; refused when it does not
  hold the body together.
- **± band**: how far the truth fell from readings like this one on held-out real
  swings, for 80% of them. Missing when no band was measured.

## Never shown

Club face, club path, swing plane, attack angle, club-head speed, ball speed, spin,
launch angle, carry and distance. A phone camera watching the body cannot measure
them; a launch monitor or a club tracker can.
