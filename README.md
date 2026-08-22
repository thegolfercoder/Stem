# Stem

Two pieces of work on measuring a golf swing without a launch monitor's price
tag. They share a set of principles and no code.

| Path | What it is | State |
|---|---|---|
| `swingml/` | **Swing analysis from a single phone camera.** Pose estimation, a temporal model over the eight swing events, and the metrics that follow. Runs as a local web app, a command line tool, or one self-contained HTML file with no install. | Working. 151 tests. |
| `launchmon-py/` | **Radar DSP for a launch monitor.** A 24 GHz CW Doppler front end arriving as USB-C audio, and the signal processing that turns it into ball and club speed. | Working. 148 tests. No hardware yet. |
| `models/` | The MediaPipe pose landmarker. Downloaded, not built here. | — |

Most of the repository is `swingml/`, and it has its own
[README](swingml/README.md) covering how it works, what it measures, what it
refuses to measure, and what has actually been validated.

## Swing analysis, briefly

Video of a swing goes in. Out comes the eight positions of the swing with a time
for each, the tempo ratio, rotation at the top and movement against the ground -
each carrying a measured error band and a label saying how it was arrived at.

Accuracy on clips no part of training touched: **80% of events within one frame
and 94% within two**, with tempo carrying a measured spread of **±14%**. Those
figures come from rendered swings put through the real pose estimator, and
`swingml/README.md` is explicit about that and about the one real clip in the
repository.

```bash
cd swingml
pip install -e ".[dev]"
swingml ui                    # the local app
swingml analyse clip.mov      # one clip
```

Or open `swingml/out/web/swing-analysis.html` in a browser and drop a video on
it. Nothing to install; the clip never leaves the machine.

## The launch monitor

A 24 GHz CW Doppler radar over USB-C audio, a club-mounted IMU over BLE, and the
phone's own camera down the line, with everything computed on the phone. The
Python here is the research environment where the algorithms are developed and
proven; the iOS and firmware sides are not started.

The contract between the Python and any later Swift implementation is a golden
vector suite: Python generates synthetic inputs with known ground truth plus its
own outputs, and the other implementation must reproduce them. Algorithm changes
happen in Python first, regenerate the fixtures, then port.

## Principles these codebases are held to

1. **Measured, derived, low-confidence and modelled values are distinguishable
   everywhere.** This is enforced by a type - `launchmon.quantity.Quantity` and
   `swingml.quantity.Quantity` - not by a naming convention. A modelled value cannot be constructed without listing
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
credibility. This is enforced by
`launchmon-py/tests/test_forbidden_outputs.py`, which inspects the data model
rather than trusting prose. The swing analyser reports none of them either, for
the same reason: one uncalibrated camera cannot measure them.

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
