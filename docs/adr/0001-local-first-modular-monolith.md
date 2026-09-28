# ADR 0001: Local-first modular monolith

**Status:** accepted (records the existing design) · 2026-09-28

## Context
Swing video is personal and identifying. The analysis runs on a laptop or phone in
seconds to a minute. There is one user per install and no revenue to fund servers.

## Decision
One Python package holds the analysis domain and serves the desktop app from
127.0.0.1. The browser and iPhone apps carry ports of the same engine, held to it by
parity tests. Nothing leaves the device unless the user sends it. Boundaries inside
the package are modules with one-way dependencies (`docs/architecture.md`), not services.

## Consequences
No accounts, sync or coach sharing until a service exists; when it does, the device
store stays the source of truth and sync is opt-in per swing. Three engines must be
kept in step: parity tests in CI, and a test that the iPhone's model copy matches.
