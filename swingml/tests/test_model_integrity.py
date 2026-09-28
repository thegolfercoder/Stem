"""The released model files are the ones that were measured, or they are not loaded.

Every accuracy figure in docs/ml/model-card.md describes one set of weights and
one error-band table, identified there by SHA-256. A PyTorch checkpoint is also
unpickled when it loads. So a shipped file whose bytes have changed is refused
before it is opened, and the checksums the app checks against are held to the
files in the repository here, which is what fails when a model is replaced
without the release step that records its checksum.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from swingml import assets
from swingml.analysis import load_event_model
from swingml.assets import ModelIntegrityError, sha256_of, verify_shipped
from swingml.model.calibration import load_calibration

SHIPPED = ("swing_event_net.pt", "swing_event_net.npz", "event_calibration.json")


def test_every_released_file_matches_its_recorded_checksum() -> None:
    recorded = assets.shipped_checksums()
    assert set(SHIPPED) <= set(recorded), "checksums.json must list every shipped model file"
    for name in SHIPPED:
        assert sha256_of(assets.package_data() / name) == recorded[name], name


def test_the_model_card_names_the_released_checksums() -> None:
    card = (Path(__file__).resolve().parents[2] / "docs" / "ml" / "model-card.md").read_text()
    recorded = assets.shipped_checksums()
    for name in ("swing_event_net.pt", "swing_event_net.npz"):
        assert recorded[name] in card, f"{name}'s checksum is not in the model card"


@pytest.fixture()
def copied_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data = tmp_path / "data"
    data.mkdir()
    for name in (*SHIPPED, assets.CHECKSUMS_NAME):
        shutil.copy(assets.package_data() / name, data / name)
    monkeypatch.setattr(assets, "package_data", lambda: data)
    return data


def test_an_intact_copy_loads(copied_data: Path) -> None:
    load_event_model(copied_data / "swing_event_net.npz")
    load_calibration(copied_data / "event_calibration.json")


@pytest.mark.parametrize("name", ["swing_event_net.npz", "event_calibration.json"])
def test_a_changed_file_is_refused(copied_data: Path, name: str) -> None:
    path = copied_data / name
    content = bytearray(path.read_bytes())
    content[len(content) // 2] ^= 0x01
    path.write_bytes(bytes(content))
    loader = load_event_model if name.endswith(".npz") else load_calibration
    with pytest.raises(ModelIntegrityError, match="changed since release"):
        loader(path)


def test_a_file_with_no_released_checksum_is_refused(copied_data: Path) -> None:
    checksums = json.loads((copied_data / assets.CHECKSUMS_NAME).read_text())
    del checksums["swing_event_net.npz"]
    (copied_data / assets.CHECKSUMS_NAME).write_text(json.dumps(checksums))
    with pytest.raises(ModelIntegrityError, match="no released checksum"):
        verify_shipped(copied_data / "swing_event_net.npz")


def test_a_developer_model_outside_the_package_is_not_checked(tmp_path: Path) -> None:
    elsewhere = tmp_path / "out" / "swing_event_net.npz"
    elsewhere.parent.mkdir()
    shutil.copy(assets.package_data() / "swing_event_net.npz", elsewhere)
    load_event_model(elsewhere)
