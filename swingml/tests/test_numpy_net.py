"""The NumPy network the packaged application runs, held to PyTorch's answer.

If these drift, the desktop application quietly becomes a different model from
the one every benchmark and error band describes. So they are compared on a real
swing at every level a person would notice: the raw scores, the positions decoded
from them, the fingerprint the error bands are matched by, and a whole analysis
run in a Python that cannot import PyTorch at all.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import torch

from swingml.analysis import (
    AnalysisConfig,
    analyse_pose_sequence,
    load_event_model,
    load_model,
    model_fingerprint,
)
from swingml.assets import package_data
from swingml.features import extract_features, resample_pose
from swingml.model.calibration import load_calibration
from swingml.model.numpy_net import NumpyEventNet
from swingml.model.tcn import SwingEventNet
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

HERE = Path(__file__).parent
FIXTURE = HERE / "fixtures" / "real_swing_01.npz"
TORCH_MODEL = package_data() / "swing_event_net.pt"
NUMPY_MODEL = package_data() / "swing_event_net.npz"


def fixture_sequence() -> PoseSequence:
    data = np.load(FIXTURE)
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )


def features() -> np.ndarray:
    resampled, _ = resample_pose(fixture_sequence(), 60.0)
    return extract_features(resampled, Handedness.RIGHT)


def torch_logits(model: SwingEventNet, x: np.ndarray) -> np.ndarray:
    with torch.no_grad():
        return model(torch.from_numpy(x)[None])[0].numpy()


@pytest.mark.parametrize("padding", ["zeros", "replicate"])
def test_the_numpy_network_gives_pytorchs_scores(padding: str) -> None:
    source = load_model(TORCH_MODEL)
    assert isinstance(source, SwingEventNet)
    source.padding_mode = padding  # type: ignore[assignment]
    for block in source.blocks:
        for conv in (block.conv1, block.conv2):
            conv.padding_mode = padding  # type: ignore[assignment]
    x = features()
    expected = torch_logits(source, x)
    got = NumpyEventNet.from_torch(source).logits(x)
    assert got.shape == expected.shape
    assert np.abs(got - expected).max() < 1e-4


def test_the_shipped_npz_is_the_shipped_model() -> None:
    """A retrained .pt with a stale .npz beside it would ship the old model."""
    shipped = load_event_model(NUMPY_MODEL)
    assert isinstance(shipped, NumpyEventNet)
    assert model_fingerprint(shipped) == model_fingerprint(load_model(TORCH_MODEL)), (
        "swing_event_net.npz is out of date: run scripts/export_numpy_model.py"
    )


def test_the_error_bands_recognise_the_numpy_copy() -> None:
    calibration = load_calibration(package_data() / "event_calibration.json")
    assert calibration.matches(model_fingerprint(load_event_model(NUMPY_MODEL)))


def test_the_analysis_is_the_same_either_way() -> None:
    config = AnalysisConfig(handedness=Handedness.RIGHT)
    a = analyse_pose_sequence(fixture_sequence(), load_model(TORCH_MODEL), config)
    b = analyse_pose_sequence(fixture_sequence(), load_event_model(NUMPY_MODEL), config)
    assert not isinstance(a.events, NoReading) and not isinstance(b.events, NoReading)
    assert a.events.frames == b.events.frames
    assert np.allclose(a.events.confidence, b.events.confidence, atol=1e-5)


NO_TORCH = """
import importlib.abc, json, sys
class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if name == "torch" or name.startswith("torch."):
            raise ImportError("torch is not installed in this test")
        return None
sys.meta_path.insert(0, Block())
import importlib.util
_original = importlib.util.find_spec
def _find(name, *a, **k):
    return None if name == "torch" else _original(name, *a, **k)
importlib.util.find_spec = _find
import numpy as np
from swingml.analysis import AnalysisConfig, analyse_pose_sequence, resolve_model
from swingml.pose.base import PoseSequence
from swingml.skeleton import Handedness
import swingml.web.app  # the whole application must import
resolved = resolve_model()
d = np.load(sys.argv[1])
seq = PoseSequence(xy=d["xy"], visibility=d["visibility"], timestamps_s=d["timestamps_s"],
                   frame_width=int(d["frame_width"]), frame_height=int(d["frame_height"]),
                   world_xyz=d["world_xyz"], detected=d["detected"])
config = AnalysisConfig(handedness=Handedness.RIGHT, calibration=resolved.calibration)
a = analyse_pose_sequence(seq, resolved.model, config)
print(json.dumps({"model": type(resolved.model).__name__, "path": str(resolved.paths[0]),
                  "frames": list(a.events.frames), "bands": resolved.calibration is not None,
                  "torch_loaded": "torch" in sys.modules}))
"""


def test_the_application_runs_without_pytorch(tmp_path: Path) -> None:
    script = tmp_path / "no_torch.py"
    script.write_text(NO_TORCH, encoding="utf-8")
    done = subprocess.run(
        [sys.executable, str(script), str(FIXTURE)],
        capture_output=True,
        text=True,
        cwd=str(HERE.parent),
        timeout=300,
        env={"PYTHONPATH": str(HERE.parent), "SWINGML_HOME": str(tmp_path), "PATH": "/usr/bin"},
    )
    assert done.returncode == 0, done.stderr[-3000:]
    result = json.loads(done.stdout.strip().splitlines()[-1])
    assert result["model"] == "NumpyEventNet"
    assert result["torch_loaded"] is False
    assert result["bands"] is True, "the error bands must still attach without PyTorch"
    expected = analyse_pose_sequence(
        fixture_sequence(), load_model(TORCH_MODEL), AnalysisConfig(handedness=Handedness.RIGHT)
    )
    assert not isinstance(expected.events, NoReading)
    assert result["frames"] == list(expected.events.frames)
