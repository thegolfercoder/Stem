# Architecture map

What exists, where it is, and how the pieces connect. Lines of code from
`git ls-files | xargs wc -l` at the audited commit.

```
                         ┌──────────────── one analysis engine, three ports ────────────────┐
 video ─► pose (MediaPipe) ─► resample 60 Hz ─► features (132) ─► TCN ─► ordered decoder ─► gates ─► metrics
          swingml/pose          swingml/features        swingml/model  model/decode.py   analysis.py  metrics/swing.py
          webapp/app.js         webapp/engine.js        webapp/model.js                  app.js judge  webapp/metrics.js
          ios Pipeline/         SwingCore/Engine.swift  SwingCore/EventNet.swift         Analyzer      SwingCore/Metrics.swift
                                                                                            │
                     refusal (NoReading, with reason)  ◄────────────────────────────────────┘
```

## Components

| Component | Path | Size | Role | Tested by |
|---|---|---|---|---|
| Analysis engine (Python) | `swingml/swingml/` | 56 files, ~15k lines of code | pose, features, model, decoder, gates, metrics, calibration, provenance | 297 pytest tests |
| Event model | `swingml/swingml/data/swing_event_net.{pt,npz}` | 349k params | dilated TCN, 8 events + background | release gate, real fixture test |
| Error bands | `swingml/swingml/data/event_calibration.json` | | per-event and tempo bands measured on `golfdb-calibration-v1`, fingerprint-matched | `test_calibration*`, gate coverage |
| Synthetic generator | `swingml/synth/` | 1.6k | swing kinematics, camera, noise, renderer | synth tests |
| Training / evaluation scripts | `swingml/scripts/` | 25 scripts | GolfDB extraction, splits, training, benchmark, baselines, calibration, export | `mypy scripts` |
| Dataset manifests | `swingml/swingml/dataset/`, `swingml/swingml/manifests/` | | frozen splits: SHA-256, clip ids, golfer/video groups; leakage check | `test_release_gate.py` |
| Release gate | `swingml/swingml/model/release_gate.py` | | nine gates, exit 0/1/2 | `test_release_gate.py` |
| Desktop app | `swingml/swingml/web/`, `desktop.py`, `packaging/` | Flask + pywebview | upload, analysis jobs, swing page, scrubber, position editor, labels, history, coach, chat | `test_store_and_web.py`, `test_golfer_positions.py`, `test_coach.py`, smoke test |
| Store | `swingml/swingml/store.py` | SQLite | one row per swing, full analysis JSON | `test_store_and_web.py` |
| Local coach | `swingml/swingml/coach/` | | Ollama client, prompts from measured values, sentence guard | `test_coach.py` |
| Browser app | `swingml/webapp/` | 3.7k | WebCodecs decode, MediaPipe (WASM), JS port of the engine, Claude coach via artifact capability | parity tests (22), `test_page.py` (Playwright, skipped in CI) |
| iPhone app | `ios/SwingCore` (Swift package), `ios/SwingStudio` (SwiftUI) | 2.9k | Swift port of the engine; AVFoundation + MediaPipe; history, coach over LAN | `swift test` (12, against the browser engine's reference), `xcodebuild` on CI |
| Radar research | `launchmon-py/` | 2k | 24 GHz radar DSP on simulated signals | 148 tests |
| CI | `.github/workflows/` | 3 workflows | `checks.yml` (lint, types, tests, parity), `ios.yml` (swift test, xcodebuild), `desktop.yml` (PyInstaller, 3 OSes, manual/tag) | |

## Data flow and storage

- **Desktop**: uploads are copied to `~/.swingml/videos/`; analysis writes a SQLite
  row (`~/.swingml/swings.db`), key-frame and scrubber JPEGs, and the tracked
  landmarks (`pose.npz`) to `~/.swingml/frames/<id>/`. Positions a golfer sets are
  `positions.json` beside them, with the model's original answer kept for reset.
  Nothing leaves the machine; the server listens on 127.0.0.1 only.
- **Browser**: everything runs in the page. Run reports and diagnostics go to the
  artifact's own storage only when the owner sends them.
- **iPhone**: history is local JSON; the coach talks to Ollama on the user's LAN.
- **Training data**: GolfDB clips are downloaded and processed under the
  gitignored `swingml/out/`; only manifests (ids and hashes) are committed.

## Model versioning

One model file per platform build, identified by SHA-256 and a weight fingerprint
that the error-band file must match (`ModelCalibration.matches`). The iPhone app
carries a copy checked by `tests/test_model_copies.py`. There is no model registry
beyond git history and the model card.

## What does not exist

- Accounts, sync, sharing, coach permissions: every platform is single-user and local.
- A practice loop that ties an insight to a drill and a retest.
- Instrumentation of any kind.
- Billing.
