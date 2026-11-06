"""Every engine uses the one pose model the analysis was measured with (#51).

The event model, its calibration and every figure in docs/audit were measured on
landmarks from one MediaPipe bundle. A floating "latest" URL with no digest would
let a different bundle change every reading unseen. swingml/assets.py records its
URL (version 1) and SHA-256; these hold the browser, the iPhone build scripts and
CI to the same two values, and check that a bundle off by one byte is refused.
"""

from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import ClassVar

import pytest

from swingml import assets
from swingml.assets import POSE_MODEL_SHA256, POSE_MODEL_URL, PoseModelMismatchError
from swingml.pose.mediapipe_pose import resolve_model_path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
MODEL_JS = HERE.parent / "webapp" / "model.js"

PINNED = [
    "ios/setup.sh",
    "ios/project.yml",
    "ios/SwingStudio.xcodeproj/project.pbxproj",
    ".github/workflows/ios.yml",
]
# Protected (agents/CHARTER.md): changed only by the owner. Its download is checked
# when the desktop app loads it.
UNPINNED_PROTECTED = {".github/workflows/desktop.yml"}


def test_the_pin_is_a_version_not_latest() -> None:
    assert "/float16/1/" in POSE_MODEL_URL and "latest" not in POSE_MODEL_URL
    assert re.fullmatch(r"[0-9a-f]{64}", POSE_MODEL_SHA256)


@pytest.mark.parametrize("relative", PINNED)
def test_every_build_script_fetches_and_checks_the_same_bundle(relative: str) -> None:
    text = (REPO / relative).read_text(encoding="utf-8")
    assert POSE_MODEL_URL in text, relative
    assert POSE_MODEL_SHA256 in text, relative


def test_the_browser_pins_the_same_bundle() -> None:
    text = MODEL_JS.read_text(encoding="utf-8")
    url = re.search(r'POSE_MODEL_URL = "([^"]+)" \+\s*"([^"]+)"', text)
    assert url and url.group(1) + url.group(2) == POSE_MODEL_URL
    assert f'POSE_MODEL_SHA256 = "{POSE_MODEL_SHA256}"' in text


def test_nothing_else_fetches_a_floating_bundle() -> None:
    found = subprocess.run(
        # Assembled, so this file does not match its own search.
        ["git", "grep", "-l", "pose_landmarker_heavy/float16/" + "latest"],
        cwd=REPO, capture_output=True, text=True, check=False,
    ).stdout.split()  # fmt: skip
    assert set(found) <= UNPINNED_PROTECTED, found


@pytest.fixture
def bundle(tmp_path: Path) -> Path:
    found = assets.find_pose_model()
    if found is None:
        pytest.skip("no pose model on this machine")
    copy = tmp_path / "pose_landmarker_heavy.task"
    shutil.copyfile(found, copy)
    return copy


def corrupt(path: Path) -> Path:
    data = bytearray(path.read_bytes())
    data[len(data) // 2] ^= 0x01
    bad = path.with_name("corrupt.task")
    bad.write_bytes(bytes(data))
    return bad


def test_the_desktop_uses_the_pinned_bundle_and_refuses_one_byte_off(bundle: Path) -> None:
    assert resolve_model_path(bundle, allow_download=False) == bundle
    with pytest.raises(PoseModelMismatchError, match="not the pose model this analysis"):
        resolve_model_path(corrupt(bundle), allow_download=False)


def test_a_bundle_found_by_the_environment_is_checked_too(
    bundle: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(assets.POSE_MODEL_ENV_VAR, str(corrupt(bundle)))
    with pytest.raises(PoseModelMismatchError):
        resolve_model_path(None, allow_download=False)


def test_a_download_that_does_not_match_is_not_kept(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Response(io.BytesIO):
        headers: ClassVar[dict[str, str]] = {"Content-Length": "16"}

        def __enter__(self) -> Response:
            return self

        def __exit__(self, *_: object) -> None:
            self.close()

    monkeypatch.setattr(assets.urllib.request, "urlopen", lambda url: Response(b"x" * 16))
    target = tmp_path / "models" / "pose_landmarker_heavy.task"
    with pytest.raises(PoseModelMismatchError):
        assets.download_pose_model(target)
    assert list(target.parent.iterdir()) == []


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_the_browser_refuses_a_bundle_one_byte_off(bundle: Path) -> None:
    script = (
        f"import {{ checkPoseModel }} from {json.dumps(MODEL_JS.as_uri())};"
        "import { readFileSync } from 'node:fs';"
        "const out = {};"
        "for (const [k, p] of Object.entries(JSON.parse(process.argv[1]))) {"
        " try { out[k] = await checkPoseModel(readFileSync(p)); }"
        " catch (e) { out[k] = String(e.message); } }"
        "out.none = await checkPoseModel(new Uint8Array(4), null);"
        "console.log(JSON.stringify(out));"
    )
    paths = {"good": str(bundle), "bad": str(corrupt(bundle))}
    done = subprocess.run(
        ["node", "--input-type=module", "-e", script, json.dumps(paths)],
        capture_output=True, text=True, timeout=120, check=True,
    )  # fmt: skip
    result = json.loads(done.stdout)
    assert result["good"] == {"checked": True}
    assert "is not the one its analysis was measured with" in result["bad"]
    assert result["none"] == {"checked": False}
