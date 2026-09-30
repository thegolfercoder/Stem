# Development runbook

## Set up (Linux, macOS, Windows with Python 3.11)

```bash
git clone <repo> && cd Stem/swingml
python3.11 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev,desktop]"        # add --extra-index-url https://download.pytorch.org/whl/cpu for CPU torch
python -m swingml.desktop              # native window; --browser to use a browser tab
```

The first analysis downloads the pose model (about 30 MB) to `~/.swingml/models/`.
Set `SWINGML_HOME` to keep a separate store (tests do).

## Checks (what CI runs)

```bash
cd swingml
ruff check . && ruff format --check .
mypy -p swingml -p synth && mypy scripts
python scripts/export_web_model.py     # without it, 22 browser parity tests skip
pytest -q -rs --ignore=tests/test_page.py
# The page in Chromium: Playwright pinned in requirements-page.txt, then the page
# built from the tree. STEM_PAGE_TESTS=required fails rather than skips.
pip install -r requirements-page.txt && python -m playwright install chromium
python scripts/build_web_app.py && STEM_PAGE_TESTS=required pytest -q -rs tests/test_page.py
cd ../ios/SwingCore && swift test      # needs Swift 6
cd ../../launchmon-py && pytest -q
```

A clean clone installs in about 2 minutes and passes all of the above
(`docs/audit/benchmark-baseline.json`).

## Driving the app for real

```bash
python -m swingml.desktop --smoke-test tests/fixtures/real_swing_01.mov   # one clip, prints JSON
```

For the whole practice loop, start the server on a scratch home and drive it with
Playwright (the approach used to verify the loop is in the practice-loop commit
message): upload three swings, open the newest, press **Start practising this**,
upload three retests through **Record retest swings**, read `/practice`.

## Real-data work

GolfDB extraction, splits and training are in `swingml/README.md` ("Real footage").
Everything derived from GolfDB stays under `swingml/out/` (gitignored). Freeze a
split before training on anything:

```bash
python -m swingml.dataset.manifest freeze --archive out/golfdb/split/holdout.npz \
    --assignment out/golfdb/split/assignment.json --annotations <golfDB.mat> \
    --split holdout --name golfdb-holdout-v1 --out swingml/manifests/golfdb-holdout-v1.json
python -m swingml.dataset.manifest check swingml/manifests/*.json
```

## Changing the analysis

1. Add a failing test that shows the product-level problem (`tests/test_measured_failures.py`
   is the pattern: the measurement that exposed it is in the docstring).
2. Change Python; if the change affects outputs, change `webapp/metrics.js` (or the
   engine) and `ios/SwingCore` to match, run `python ios/SwingCore/Tests/make_golden.py`,
   and run all three test suites.
3. If a model changes, follow `model-release.md`.
