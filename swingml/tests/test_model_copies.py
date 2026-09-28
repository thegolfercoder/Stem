"""Every platform runs the same model with the same error bands and thresholds.

The weights ship three times: the PyTorch checkpoint and its NumPy copy in the
package, the browser payload built from them, and a copy of that payload inside
the iPhone app. The iPhone copy is a file somebody has to remember to replace,
and nothing checked that anybody had: a model change would have shipped to two
platforms and not the third, with every test still green.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
SWINGML = HERE.parent
IOS_PAYLOAD = (
    SWINGML.parent / "ios" / "SwingCore" / "Sources" / "SwingCore" / "Resources" / "model.json"
)
SHARED = ("architecture", "tensors", "weights_base64", "features", "thresholds", "calibration",
          "time_warps")  # fmt: skip


@pytest.mark.skipif(not IOS_PAYLOAD.is_file(), reason="the iPhone app is not in this checkout")
def test_the_iphone_app_carries_the_shipped_model(tmp_path: Path) -> None:
    exported = tmp_path / "model.json"
    subprocess.run(
        [sys.executable, str(SWINGML / "scripts" / "export_web_model.py"), "--out", str(exported),
         "--model", str(SWINGML / "swingml" / "data" / "swing_event_net.pt"),
         "--calibration", str(SWINGML / "swingml" / "data" / "event_calibration.json")],
        check=True, capture_output=True, cwd=SWINGML,
    )  # fmt: skip
    fresh = json.loads(exported.read_text())
    shipped = json.loads(IOS_PAYLOAD.read_text())
    drifted = [key for key in SHARED if fresh.get(key) != shipped.get(key)]
    assert not drifted, (
        f"ios model.json differs from the shipped model in {drifted}. Re-export with "
        "scripts/export_web_model.py, copy it into the iPhone app, and regenerate the "
        "Swift reference with ios/SwingCore/Tests/make_golden.py"
    )
