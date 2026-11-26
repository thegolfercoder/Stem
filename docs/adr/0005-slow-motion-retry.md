# ADR 0005: Read slow motion by re-timing, and refuse its durations

**Status:** accepted for the desktop engine · 2026-09-28

## Context
71 of the 82 slow-motion swings in the frozen real test set were refused as "not a
swing": their backswing is 3 s at playback speed, and the model's confidence collapses
on a swing slowed 4-8x. A phone's slow-motion export is the same kind of footage.

## Decision
A clip refused for its events is re-read as if played 2, 4 and 8 times faster; the most
confident reading that passes every gate is kept, marked `playback_slowed_by`. Tempo is
reported with the assumption that the slow-down was even; every duration and every
millisecond band is refused, because the true speed is unknown.

## Consequences
Measured on the test set: slow-motion answered 11/82 → 82/82, real-time 114/119 →
117/119, no-swing stretches accepted 2/424 → 3/424. One more false accept in 424 is
the cost. Phone slow motion ramps speed at the ends of the clip, which can distort
tempo; that is stated with every such reading. Not yet ported to the browser or iPhone.
