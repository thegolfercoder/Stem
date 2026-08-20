# Golf launch monitor

A budget golf launch monitor built around an iPhone. A 24 GHz CW Doppler radar
arrives as USB-C audio, a club-mounted IMU arrives over BLE, and the phone's own
rear camera shoots down the line. Everything is computed on the phone; there is
no laptop in the field.

This repository is at **Stage 1**: the Python research environment, the synthetic
radar generator and the radar DSP core. No hardware is involved yet.

## Layout

| Path | What it is |
|---|---|
| `launchmon-py/` | Python. Research and validation. Where algorithms are developed and proven. |
| `LaunchMon/` | Swift/iOS. The field instrument. Not started. |
| `firmware/pico/` | RP2350: IMU over SPI, impact microphone, BLE. Not started. |

The contract between the Python and Swift implementations is a golden vector
suite: Python generates synthetic inputs with known ground truth plus its own
outputs, and the Swift test suite must reproduce them. Algorithm changes happen
in Python first, regenerate the fixtures, then port.

## Principles these codebases are held to

1. **Measured, derived, low-confidence and modelled values are distinguishable
   everywhere.** This is enforced by a type, `launchmon.quantity.Quantity`, not
   by a naming convention. A modelled value cannot be constructed without listing
   the assumptions behind it.
2. **No invented accuracy figures.** No tolerance appears in a docstring, a UI
   string or a comment unless it came from validation data or from the project
   brief. Fit diagnostics are labelled as diagnostics and are not error bars.
3. **Every stage is testable against a synthetic input with known ground truth**,
   in both languages.
4. **Raw data is kept forever.** Raw audio, raw IMU samples and raw video are
   never overwritten or re-encoded. The dataset is the deliverable; the code is
   replaceable.
5. **Replay is a day-one feature.** Nothing holds global state, and every
   processing function takes its parameters explicitly, so the whole pipeline can
   be re-run over every shot ever recorded and the results diffed.
6. **A refusal is a result.** When the pipeline cannot measure something it
   returns `NoReading` with the reason, never a substituted guess. The proportion
   of shots producing no reading is a reported figure.

## What this instrument will not report

Spin rate, spin axis, club face angle, club path, attack angle and swing plane
are **not** outputs and will not become outputs. A single consumer IMU at this
price cannot measure them reliably, and claiming them is how budget devices lose
credibility. This is enforced by `tests/test_forbidden_outputs.py`, which
inspects the data model rather than trusting prose.

Spin appears in the codebase as an *input*: the trajectory model needs a value
and takes a per-club prior. Anything computed from it is `MODELLED` and carries
that assumption with it wherever it goes.

## Legal note

Overlaying motion metrics on swing video sits squarely within claims asserted in
Blast Motion's patent portfolio, including US 9,039,527. This is a university
research prototype and that is fine for private research. **Nobody should assume
this is safe to sell.**

## Running the Python environment

```bash
python3 -m venv .venv && .venv/bin/pip install -e "launchmon-py[dev]"
cd launchmon-py
PYTHONPATH=. ../.venv/bin/python -m pytest tests/ -q     # 148 tests
../.venv/bin/ruff check . && ../.venv/bin/mypy launchmon tests scripts
PYTHONPATH=. ../.venv/bin/python scripts/snr_sweep.py --seeds 20
```
