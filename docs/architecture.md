# Architecture

A local-first modular monolith: one Python package that holds the analysis domain
and serves the desktop app, with two ports of the analysis engine (browser, iPhone)
held to it by parity tests. The component map is `docs/audit/architecture-map.md`;
decisions and their reasons are in `docs/adr/`.

## Boundaries (desktop, `swingml/swingml/`)

| Boundary | Module | Owns | Depends on |
|---|---|---|---|
| Capture | `capture.py`, `video/` | reading clips, preflight checks | OpenCV, pose |
| Pose | `pose/` | MediaPipe landmarks, the shared `PoseSequence` schema | MediaPipe |
| Analysis domain | `features.py`, `analysis.py`, `events.py`, `metrics/`, `quantity.py` | events, gates, refusals, metrics with provenance | pose, model |
| Model registry | `assets.py`, `model/` (`tcn`, `numpy_net`, `ensemble`, `calibration`) | loading weights, fingerprints, error bands | - |
| Dataset and evaluation | `dataset/manifest.py`, `model/release_gate.py`, `model/baselines.py`, `scripts/` | frozen splits, leakage checks, the release gate | analysis |
| Insights and drills | `insights/` | the priority rules, drill library, before/after comparison | analysis types only |
| Sessions and swings | `store.py` | SQLite: swings, plans, feedback, events | - |
| Labels | `labels.py` | golfer-set positions, training labels | pose |
| Coach | `coach/` | local LLM client, prompts from measured values, output guard | store |
| Web | `web/` | Flask routes, jobs, templates | everything above |
| Desktop shell | `desktop.py`, `packaging/` | native window, local server, PyInstaller | web |

Rules the code keeps:

- The analysis domain has no web, store or LLM imports. Insights import analysis
  *types*, never the other way round (the camera signature type lives in
  `insights/compare.py` and is imported by `analysis.py`; it has no dependencies).
- The LLM receives measured values and may phrase them; it never selects a priority
  or produces a number (`insights/engine.py` does; `coach/guard.py` filters output).
- Every stored analysis is the full `SwingAnalysis` as JSON beside a few queryable
  columns, so adding a field needs no migration and old rows still load.

## Storage

`~/.swingml/` (or `SWINGML_HOME`): `swings.db` (SQLite, WAL, schema version 2 in
`meta`), `videos/`, `frames/<swing id>/` (JPEGs, `pose.npz`, `sequence.json`,
`positions.json`, `model_analysis.json`), `models/` (pose model). Migrations are
additive `CREATE TABLE IF NOT EXISTS`; a destructive change would need a real
migration step and is not yet required.

## Jobs

Uploads run on a background thread, one at a time (`AnalysisService._run_lock`):
preflight → pose → analysis → frames → store → plan link → events. A job's state is
polled by the page. Jobs are in memory: a restart loses a running job but never a
stored swing; the upload stays in `videos/` and can be re-analysed. Not yet built:
cancellation, retry, a persistent queue, resumable tracking of long clips.

## Ports

| Port | Engine | Held to Python by |
|---|---|---|
| Browser (`swingml/webapp/`) | JS: `engine.js`, `model.js`, `metrics.js` | 22 parity tests on the real fixture (`test_browser_parity.py`), run in CI |
| iPhone (`ios/SwingCore`) | Swift | 12 `swift test` cases against the browser engine's outputs (`make_golden.py`) |

The practice loop and the slow-motion retry exist only in Python so far.

## Model release

`python -m swingml.model.release_gate` against frozen manifests; see
`docs/runbooks/model-release.md`. The shipped weights are identified by SHA-256 in
`docs/ml/model-card.md` and by a fingerprint that the error bands must match.

## Not built, and where it would go

| Capability | Where |
|---|---|
| Accounts, sync, coach permissions | a separate service; the local store stays the source of truth on the device, sync is opt-in per swing |
| Billing | behind the service; nothing in the local app |
| Feature flags | `AnalysisConfig` already carries behaviour switches (e.g. `slow_motion_factors`); a flags table in the store when there is a second user |
| Observability | the local `events` table; nothing leaves the machine |
