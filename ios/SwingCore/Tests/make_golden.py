"""Regenerate SwingCoreTests/Resources/golden_real_swing_01.json.

Runs the repository's real-swing fixture through the browser engine (node), which
swingml/tests hold to the Python pipeline, and writes every intermediate the Swift
tests compare against. Run from ios/SwingCore after exporting a new model.
"""

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
fixture = np.load(REPO / "swingml" / "tests" / "fixtures" / "real_swing_01.npz")
job = {
    "xy": np.round(fixture["xy"].astype(float), 6).tolist(),
    "visibility": np.round(fixture["visibility"].astype(float), 6).tolist(),
    "world": np.zeros((fixture["xy"].shape[0], 33, 3)).tolist(),
    "detected": [bool(v) for v in fixture["detected"]],
    "times": [float(t) for t in fixture["timestamps_s"]],
    "width": int(fixture["frame_width"]),
    "height": int(fixture["frame_height"]),
}
payload = HERE.parent / "Sources" / "SwingCore" / "Resources" / "model.json"
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
    json.dump(job, handle)
done = subprocess.run(
    ["node", str(HERE / "make_golden.mjs"), handle.name, str(payload)],
    capture_output=True, text=True, check=True,
)
target = HERE / "SwingCoreTests" / "Resources" / "golden_real_swing_01.json"
target.write_text(done.stdout, encoding="utf-8")
print(f"wrote {target} ({target.stat().st_size / 1e6:.2f} MB)")
