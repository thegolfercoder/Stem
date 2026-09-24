# Launch Monitor ML

[![checks](https://github.com/thegolfercoder/launch-monitor-ml/actions/workflows/checks.yml/badge.svg)](https://github.com/thegolfercoder/launch-monitor-ml/actions/workflows/checks.yml)

Measuring a golf swing and a golf ball without a launch monitor's price tag. Two
pieces of work toward that, sharing a set of principles and no code: swing
analysis from a phone camera, and radar DSP for the ball.

| Path | What it is | State |
|---|---|---|
| `swingml/` | **Swing analysis from a single phone camera.** Pose estimation, a temporal model over the eight swing events, and the metrics that follow. Runs as a local web app, a command line tool, or one self-contained HTML file with no install. | Working. |
| `launchmon-py/` | **Radar DSP for a launch monitor.** A 24 GHz CW Doppler front end arriving as USB-C audio, and the signal processing that turns it into ball and club speed. | Working. No hardware yet. |
| [`GolfLaunchMonitor_V1_Proposal.pdf`](GolfLaunchMonitor_V1_Proposal.pdf) | The V1 build proposal both halves are aimed at. | — |

Both suites run on every push - lint, types and tests - and the badge above is
the only place a test count belongs. Written into prose it goes stale the day
after somebody adds a test, and this file carried "151 tests" for a while after
the number was 195.

Most of the repository is `swingml/`, and it has its own
[README](swingml/README.md) covering how it works, what it measures, what it
refuses to measure, and what has actually been validated.

## Swing analysis, briefly

Video of a swing goes in. Out comes the eight positions of the swing with a time
for each, the tempo ratio, rotation at the top and movement against the ground -
each carrying a measured error band and a label saying how it was arrived at.

On **real swings no model trained on** - 201 clips from GolfDB, grouped so no golfer
or source video reaches training - the shipped model places address, the top,
mid-downswing and impact **within one frame 45.5% of the time and within five
80.2%**, with a median tempo error of **15.4%**. The model before it scored 26.4%,
53.6% and 25.0% on the same clips. The tempo band it shows is **±29%**, measured on
85 further real swings and cross-validated at 82.4% coverage against the 80% it
claims. On 23 swings of Rory McIlroy held out on purpose it scores 41.3% within a
frame and a 13.9% median tempo error, against 18.5% and 30.1% before.

Those are lower than the figures on rendered swings, which is the point:
`swingml/README.md` explains why the rendered numbers flattered the model and what
changed.

```bash
cd swingml
pip install -e ".[dev]"
swingml ui                    # the local app
swingml analyse clip.mov      # one clip
```

Or build the single-file page and open it in a browser:

```bash
python scripts/build_web_app.py     # writes out/web/swing-analysis.html
```

Drop a video on it. Nothing to install, no server, and the clip never leaves the
machine. The page is a build product and is not checked in, which is why a fresh
clone has no `out/`.

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

## Licence and legal note

The code is MIT licensed - see [LICENSE](LICENSE). That covers copyright and
nothing else, which matters here: overlaying motion metrics on swing video sits
squarely within claims asserted in Blast Motion's patent portfolio, including
US 9,039,527. An MIT licence grants no patent rights and cannot grant rights
nobody here holds. This is a university research prototype and that is fine for
private research. **Nobody should assume this is safe to sell.**

## Working on either project

They are separate installs sharing one virtual environment. `SETUP.md` covers
the swing analyser in more detail; this is the whole of it for the radar.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e "swingml[dev]" -e "launchmon-py[dev]"

cd swingml     && pytest -q && ruff check . && mypy -p swingml -p synth && mypy scripts
cd launchmon-py && PYTHONPATH=. pytest -q && ruff check . && mypy launchmon tests scripts
```

The MediaPipe pose landmarker is about 30 MB and is downloaded on first run
rather than checked in - `swingml doctor --fix` fetches it, and `models/` is
where it lands.
