# ADR 0003: A deterministic insight engine; the LLM explains, never chooses

**Status:** accepted · 2026-09-28

## Context
A language model asked "what should I work on" will name a fault whether or not the
measurements support one. Tempo is uncertain by ±27% per swing and compressed toward
3.3; no other metric has a reference distribution the product can defend.

## Decision
Fixed rules in `insights/engine.py` choose one priority: capture problems first;
nothing from fewer than three comparable swings; tempo only when the mean reading
leaves the range the same model reads for tour swings; otherwise "nothing stands out,
choose a focus". Each priority carries its evidence, confidence, limitations, one drill,
a retest plan and a definition of improvement. Change is judged by a Welch interval on
the golfer's own swings, refusing comparisons across club, orientation, angle or a
moved phone.

## Consequences
The common answer is "nothing stands out", which is honest and may feel thin; the
wedge experiments test whether golfers find it useful. New priorities need a
reference measured through the model, not a number from coaching folklore.
