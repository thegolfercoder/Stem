# Open this in VS Code

## Get the code

Either clone it:

```bash
git clone https://github.com/thegolfercoder/launch-monitor-ml
cd launch-monitor-ml
code .
```

Or unzip the archive you were sent and open that folder in VS Code.

## Install

Python 3.11 or newer.

```bash
python3 -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -e "swingml[dev]"
```

On Linux, `pip install torch` pulls the CUDA build by default — several gigabytes
you do not need without an NVIDIA card. If that applies, install the CPU build
first:

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu
```

In VS Code, press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> →
*Python: Select Interpreter* → pick `.venv`.

## Run it

```bash
swingml
```

That is the whole thing. It opens the application in your browser, downloads the
pose model on first run (about 30 MB, once), and keeps your swings in
`~/.swingml/`.

Drag a clip in. Any video your phone makes — portrait or landscape, 30/60/240 fps,
slow motion. Nothing needs measuring or lining up.

Other commands:

```bash
swingml ui --port 8000 --no-open    # run the interface without opening a browser
swingml analyse clip.mov            # one clip, results in the terminal
swingml analyse swings/ --save      # a whole folder, recorded in the database
swingml doctor                      # what is installed, what is missing
swingml doctor --fix                # download anything missing
```

## Check everything works

```bash
cd swingml
pytest -q
ruff check . && ruff format --check .
mypy --explicit-package-bases swingml synth scripts
```

These are the same checks the machine runs on every push, so if they pass here
they pass there. A count is not quoted because it goes stale; the number that
matters is that nothing fails.

Some tests skip themselves in a fresh checkout. The browser-parity and page
tests need the exported weights and the built page, and both are build products
rather than checked-in files:

```bash
python scripts/export_web_model.py     # weights the page can carry
python scripts/build_web_app.py        # the single-file page
```

## Try it without a clip of your own

```bash
cd swingml
python scripts/make_test_clips.py          # renders 15 synthetic clips
swingml analyse out/testclips --save       # analyses them all
swingml                                    # look at the results
```

Three of those fifteen deliberately contain no swing. They should be refused with
a reason rather than measured — that is the behaviour worth checking.

## Where things live

| Path | What it is |
|---|---|
| `swingml/swingml/` | The package: analysis, metrics, model, web app, CLI |
| `swingml/synth/` | The synthetic golfer used to generate training data |
| `swingml/scripts/` | Training, dataset building, evaluation |
| `swingml/tests/` | The test suite |
| `~/.swingml/` | Your swings, uploaded clips, downloaded models |
| `swingml/out/` | Build products and training runs. Not checked in, safe to delete. |
| `launchmon-py/` | Earlier radar work. Self-contained, unrelated to swing analysis. |

## Before trusting any number

`swingml/README.md` has the measured accuracy and, more usefully, where it is
*not* accurate. The short version: the model is trained on synthetic swings, so
it does better on those than on video of a real person, and nothing here has been
measured against footage of an actual golfer because there wasn't any. Tempo and
the event timings hold up well; anything angular under-reads and should be
compared against your own swings from the same camera position rather than
against a published figure.
