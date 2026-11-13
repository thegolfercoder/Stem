# ADR 0004: Refuse what one camera cannot measure, including the finish

**Status:** accepted · 2026-09-28

## Context
Club face, path, plane, attack angle, speeds, spin, launch and carry were already
never output. The audit found the whole-swing duration was: it ends at the finish,
which the model places a median 29 frames (about 0.5 s) from the label, and it was
shown as measured.

## Decision
The whole-swing duration is a `NoReading` with the reason, in the Python, browser and
Swift engines. The finish stays on the timeline, marked as not timed. A position is
used as the end of a duration only if its measured error supports it.

## Consequences
One fewer number on the page. Parity tests and the Swift reference changed with it.
If phone labels show the finish can be placed, this is revisited with that evidence.
