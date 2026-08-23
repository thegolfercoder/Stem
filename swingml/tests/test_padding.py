"""What the network sees beyond the ends of a clip.

A convolution at the first frame has to read frames that do not exist, and the
answer had been zeros. Zero is not "unknown" for these features - it is a
particular hand position and a particular normalised velocity - so the network met
a discontinuity a few frames before address and again a few frames after the
finish. Those are the two events it is measurably worst at.

The alternative is to hold the first and last frames, which is what was actually
happening: the golfer was standing there before the recording started and is still
holding the finish after it stops. That is two changes rather than one, and they
have to travel together - the network's own padding, and what the batch holds
beyond the end of a clip shorter than the longest in its batch. A network that
replicates trained against batches that zero-pad is a network trained against a
boundary it will never meet.

These tests pin the mechanism. Whether it makes the model more accurate is a
question for the benchmark, and the answer is in the README.
"""

from __future__ import annotations

import numpy as np
import torch

from swingml.analysis import load_model, save_model
from swingml.features import feature_dimension
from swingml.model.data import collate
from swingml.model.tcn import SwingEventNet


def constant_clip(n_frames: int, value: float = 0.37) -> torch.Tensor:
    return torch.full((1, n_frames, feature_dimension()), value)


def test_replication_makes_a_constant_clip_look_the_same_all_the_way_along() -> None:
    """The property that says the boundary has stopped being an event.

    Feed a clip in which nothing whatsoever happens. A network that holds the
    edges cannot tell the first frame from the middle one, so its output must be
    the same at both. A network that pads with zeros can, and does.
    """
    torch.manual_seed(0)
    model = SwingEventNet(feature_dimension(), channels=16, padding_mode="replicate").eval()
    with torch.no_grad():
        logits = model(constant_clip(300))[0]
    middle = logits[150]
    assert torch.allclose(logits[0], middle, atol=1e-5)
    assert torch.allclose(logits[-1], middle, atol=1e-5)


def test_zero_padding_makes_the_first_frame_a_different_place() -> None:
    """The behaviour being replaced, asserted so the comparison is not folklore."""
    torch.manual_seed(0)
    model = SwingEventNet(feature_dimension(), channels=16, padding_mode="zeros").eval()
    with torch.no_grad():
        logits = model(constant_clip(300))[0]
    assert not torch.allclose(logits[0], logits[150], atol=1e-3)


def items(lengths: list[int]) -> list[dict[str, torch.Tensor]]:
    rng = np.random.default_rng(4)
    return [
        {
            "features": torch.from_numpy(
                rng.normal(size=(n, feature_dimension())).astype(np.float32)
            ),
            "target": torch.zeros(n, 9),
            "weight": torch.ones(n),
            "events": torch.arange(8),
            "length": torch.tensor(n),
        }
        for n in lengths
    ]


def test_edge_padded_batches_hold_the_final_frame() -> None:
    batch = items([40, 90])
    padded = collate(batch, edge_pad=True)
    short = padded["features"][0]
    assert torch.equal(short[40], batch[0]["features"][-1])
    assert torch.equal(short[-1], batch[0]["features"][-1])
    assert not padded["mask"][0, 40:].any(), "the padding must still carry no loss"


def test_zero_padded_batches_are_left_alone() -> None:
    padded = collate(items([40, 90]), edge_pad=False)
    assert not padded["features"][0, 40:].any()


def test_padding_a_batch_never_changes_the_real_frames() -> None:
    batch = items([40, 90])
    for edge_pad in (False, True):
        padded = collate(batch, edge_pad=edge_pad)
        assert torch.equal(padded["features"][0, :40], batch[0]["features"])
        assert torch.equal(padded["features"][1], batch[1]["features"])


def test_a_checkpoint_comes_back_as_the_network_that_was_saved(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Both fields were missing from the format, for the reason its docstring gives.

    The experiment script offers a kernel size and a padding mode; neither was
    written, so a run that changed either produced a checkpoint that trained for an
    hour and then loaded as a different network with the same weights in it.
    """
    saved = SwingEventNet(
        feature_dimension(), channels=16, kernel_size=5, dilations=(1, 2), padding_mode="replicate"
    )
    path = tmp_path / "net.pt"
    save_model(saved, path)
    loaded = load_model(path)
    assert loaded.kernel_size == 5
    assert loaded.padding_mode == "replicate"
    assert loaded.dilations == (1, 2)
    assert loaded.channels == 16

    clip = constant_clip(120, 0.21)
    with torch.no_grad():
        assert torch.allclose(loaded(clip), saved.eval()(clip), atol=1e-6)


def test_a_checkpoint_from_before_the_fields_existed_still_loads(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Every trained model on disk predates this, and none should become unloadable."""
    model = SwingEventNet(feature_dimension(), channels=16, dilations=(1, 2))
    path = tmp_path / "old.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "in_features": feature_dimension(),
            "channels": 16,
            "dilations": [1, 2],
        },
        str(path),
    )
    loaded = load_model(path)
    assert loaded.kernel_size == 3
    assert loaded.padding_mode == "zeros"
