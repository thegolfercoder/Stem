# Initial wedge

## The choice: self-coached serious amateurs who already film their swing

Golfers who practise on their own at least weekly, film themselves on a phone, and
want to know whether practice is changing anything. Handicap roughly 5-20.

**The promise:** record a few swings, get one thing to practise that the measurements
support, practise it, record again, and see honestly whether it moved.

## Why this segment, from what the product can actually do

| What the evidence says the product does well | Who values exactly that |
|---|---|
| Timing from a phone, with a stated ±27% per swing and a within-golfer comparison that refuses to compare what was filmed differently | Someone comparing themselves with themselves, week to week |
| Honest refusals and capture advice | Someone filming alone, with nobody to say the phone is badly placed |
| Local-only, no account, nothing uploaded | Someone wary of putting video of themselves in a cloud |

| What it cannot do | Who that rules out, for now |
|---|---|
| Club and ball data (face, path, speed, spin, carry) | Fitters and anyone whose decisions turn on ball flight |
| Multi-user accounts, sharing, permissions | Coaches with many clients, academies, facilities |
| Accuracy validated on phone footage | Anyone who needs a number they can quote, rather than a trend |

**Why not coaches first.** Coaches are the natural second segment and the best
distribution channel, but the coach workflow (invite, share selected swings,
annotate, assign drills, revoke) needs accounts and sync that do not exist, and a
coach's eye already does what the event model does, better, on one swing. What a
coach does not have is objective change measurement between lessons for a client
practising alone: that arrives through the amateur, who can later share with a coach.

**Why not facilities or fitting.** Both need club and ball data. A camera-based body
analysis sold to a fitter competes with launch monitors on the one thing it cannot do.

## What is assumed and has to be tested

No market sizing or willingness-to-pay figure is claimed here: none has been
measured. These are the falsifiable assumptions the wedge rests on, and the
experiments that would test them. None requires a paywall.

| # | Assumption | Experiment | Kill criterion |
|---|---|---|---|
| 1 | Golfers will film 3+ comparable swings per session | 20 golfers, two weeks, local event log (`plan_started`, `retest_recorded`) | Fewer than half start a plan with a baseline of 3 |
| 2 | They return to retest | Same cohort: share who record a retest within 14 days | Under 30% |
| 3 | An honest "no detectable change" is useful, not discouraging | Usefulness rating (1-5) on the practice page, split by verdict | Mean below 3 when the verdict is "no detectable change" |
| 4 | The capture advice gets clips measured | Share of refusals followed by an accepted clip in the same session | Under 50% |
| 5 | Someone would pay for this loop | After 4 weeks, a price question with a real checkout link, no charge taken | Under 10% click through at a price that covers support |
| 6 | Coaches would receive shared swings | Offer an export to share with a coach; count shares | Under 10% of active users share once |

Instrumentation for 1-4 and 6 exists locally (the events table; your-data page
shows it to the golfer). Nothing is sent anywhere, so an experiment needs
participants to send their export, with consent.

## What is deliberately not being built yet

A social feed, leaderboards, a paywall, cloud sync, a coach marketplace, a
hardware launch monitor. Each waits until the loop above keeps golfers coming back.
