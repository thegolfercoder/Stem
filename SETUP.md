# Getting this running in VS Code

Two ways to get the code. Either works.

**Clone it** (preferred — you get the history and can pull updates):

```bash
git clone https://github.com/thegolfercoder/Stem
cd Stem
git checkout claude/prompt-usage-0oy6wa
```

**Or unzip the archive** you were sent, and open the folder in VS Code.

## What's in here

| Folder | What it is |
|---|---|
| `swingml/` | The swing analyser. Video in, swing metrics out. This is the live work. |
| `launchmon-py/` | The earlier radar/Doppler work. Self-contained, still passing, not needed for swing analysis. |
| `models/` | Where the MediaPipe pose model goes (not in the repo — it's 30 MB, see below). |

## Setup

Python 3.11 or newer. From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e "swingml[dev]"
```

That pulls in PyTorch, MediaPipe, OpenCV, NumPy, SciPy and the dev tools. On
Linux, `pip install torch` fetches the CUDA build by default, which is several
gigabytes. If you don't have an NVIDIA GPU, get the CPU build instead:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

## The pose model

MediaPipe's pose landmarker is a 30 MB file that isn't committed. Fetch it once:

```bash
mkdir -p models
curl -L -o models/pose_landmarker_heavy.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task
```

## Check it works

```bash
cd swingml
PYTHONPATH=. python -m pytest tests/ -q      # 52 tests
ruff check . && mypy --explicit-package-bases swingml synth scripts
```

## Analyse a video

```bash
cd swingml
PYTHONPATH=. python scripts/analyse.py /path/to/your/swing.mov \
    --model out/events/swing_event_net.pt --handedness right
```

It takes any video the phone produces — portrait or landscape, 30/60/240 fps,
slow-motion included. It reads the real frame timestamps rather than trusting a
nominal frame rate, resamples internally to a fixed rate, and reports events back
in the frame numbers of *your* file. Output is JSON, and every number carries how
it was obtained.

If it can't find a swing it says so and explains why, rather than returning
numbers. That's deliberate.

## See it work without a video

```bash
cd swingml
PYTHONPATH=. python scripts/demo_end_to_end.py --azimuth 0 90
```

This generates a synthetic golfer, renders it to video, runs the real pose
estimator over the render, analyses it, and scores the result against the truth
it started from. It writes a summary card to `out/cards/`.

## Read this before trusting any number

`swingml/README.md` has the measured accuracy, and more importantly the places
where it is *not* accurate. The short version: the model is trained on synthetic
swings, so it works far better on synthetic pose than on real video, and the gap
is the dominant error in the system. Nothing here has been measured against
footage of an actual golfer, because there wasn't any. That's the next step and
it needs your clips.
