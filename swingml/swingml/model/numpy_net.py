"""The swing event network in NumPy, for the packaged desktop application.

PyTorch is a gigabyte installed and is used at run time for one thing: a forward
pass through 350 thousand weights. That is a few matrix products per layer, which
NumPy does as well, so the application that ships carries the weights as an .npz
and this instead of the framework. Training stays in PyTorch.

The arithmetic is the network's own, layer by layer: a 1x1 input projection,
group normalisation in eight groups, exact GELU, six residual blocks of two
dilated convolutions each, and a 1x1 head. Padding beyond the ends of the clip is
zeros or a held copy of the edge frames, whichever the weights were trained with.
tests/test_numpy_net.py holds it to PyTorch's answer on real features.

The weights keep their PyTorch names, and the calibration fingerprint is taken
over names and values, so the measured error bands recognise this as the same
model they were measured through.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

GROUPS = 8
EPSILON = 1e-5


def erf(x: NDArray[np.float64]) -> NDArray[np.float64]:
    """The error function, to 1.5e-7 (Abramowitz and Stegun 7.1.26).

    Written out rather than taken from SciPy, which is seventy megabytes in the
    packaged application for this one call. Its error is below float32's own
    rounding over the network, which is what the PyTorch comparison is held to.
    """
    sign = np.sign(x)
    a = np.abs(x)
    t = 1.0 / (1.0 + 0.3275911 * a)
    poly = t * (
        0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))
    )
    return np.asarray(sign * (1.0 - poly * np.exp(-a * a)), dtype=np.float64)


class NumpyEventNet:
    """Per-frame class scores over the eight events plus background."""

    def __init__(self, arrays: dict[str, NDArray[np.float32]], meta: dict[str, Any]) -> None:
        self.arrays = {name: np.asarray(value, dtype=np.float32) for name, value in arrays.items()}
        self.in_features = int(meta["in_features"])
        self.channels = int(meta["channels"])
        self.dilations = tuple(int(d) for d in meta["dilations"])
        self.kernel_size = int(meta["kernel_size"])
        self.padding_mode = str(meta.get("padding_mode", "zeros"))
        self._weights = {name: value.astype(np.float64) for name, value in self.arrays.items()}

    # -- persistence ---------------------------------------------------------

    def meta(self) -> dict[str, Any]:
        return {
            "in_features": self.in_features,
            "channels": self.channels,
            "dilations": list(self.dilations),
            "kernel_size": self.kernel_size,
            "padding_mode": self.padding_mode,
        }

    def save(self, path: Path | str) -> None:
        arrays: dict[str, Any] = dict(self.arrays)
        arrays["__meta__"] = np.frombuffer(json.dumps(self.meta()).encode("utf-8"), dtype=np.uint8)
        np.savez(str(path), **arrays)

    @classmethod
    def load(cls, path: Path | str) -> NumpyEventNet:
        with np.load(str(path)) as data:
            meta = json.loads(bytes(data["__meta__"]).decode("utf-8"))
            arrays = {name: data[name] for name in data.files if name != "__meta__"}
        return cls(arrays, meta)

    @classmethod
    def from_torch(cls, model: Any) -> NumpyEventNet:
        """The same weights, out of a trained PyTorch network."""
        arrays = {
            name: tensor.detach().cpu().numpy().astype(np.float32)
            for name, tensor in model.state_dict().items()
        }
        meta = {
            "in_features": model.in_features,
            "channels": model.channels,
            "dilations": list(model.dilations),
            "kernel_size": model.kernel_size,
            "padding_mode": model.padding_mode,
        }
        return cls(arrays, meta)

    def eval(self) -> NumpyEventNet:
        """Nothing to switch off: there is no dropout at inference here."""
        return self

    @property
    def receptive_field(self) -> int:
        return 1 + 2 * (self.kernel_size - 1) * sum(self.dilations)

    # -- the forward pass ----------------------------------------------------

    def _conv(self, x: NDArray[np.float64], prefix: str, dilation: int) -> NDArray[np.float64]:
        """A 1-D convolution over time; x is (channels, frames)."""
        weight = self._weights[f"{prefix}.weight"]  # (out, in, kernel)
        bias = self._weights[f"{prefix}.bias"]
        kernel = weight.shape[2]
        frames = x.shape[1]
        if kernel == 1:
            return weight[:, :, 0] @ x + bias[:, None]
        pad = dilation * (kernel - 1) // 2
        if self.padding_mode == "replicate":
            padded = np.pad(x, ((0, 0), (pad, pad)), mode="edge")
        else:
            padded = np.pad(x, ((0, 0), (pad, pad)), mode="constant")
        out = np.repeat(bias[:, None], frames, axis=1)
        for k in range(kernel):
            start = k * dilation
            out += weight[:, :, k] @ padded[:, start : start + frames]
        return out

    def _norm(self, x: NDArray[np.float64], prefix: str) -> NDArray[np.float64]:
        channels, frames = x.shape
        grouped = x.reshape(GROUPS, channels // GROUPS * frames)
        mean = grouped.mean(axis=1, keepdims=True)
        variance = grouped.var(axis=1, keepdims=True)
        normalised = ((grouped - mean) / np.sqrt(variance + EPSILON)).reshape(channels, frames)
        weight = self._weights[f"{prefix}.weight"]
        bias = self._weights[f"{prefix}.bias"]
        return np.asarray(normalised * weight[:, None] + bias[:, None], dtype=np.float64)

    @staticmethod
    def _gelu(x: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(0.5 * x * (1.0 + erf(x / np.sqrt(2.0))))

    def logits(self, features: NDArray[np.float32]) -> NDArray[np.float32]:
        """(frames, features) in; (frames, classes) out."""
        x = np.asarray(features, dtype=np.float64).T
        x = self._gelu(self._norm(self._conv(x, "input_projection", 1), "input_norm"))
        for index, dilation in enumerate(self.dilations):
            prefix = f"blocks.{index}"
            h = self._gelu(
                self._norm(self._conv(x, f"{prefix}.conv1", dilation), f"{prefix}.norm1")
            )
            h = self._gelu(
                self._norm(self._conv(h, f"{prefix}.conv2", dilation), f"{prefix}.norm2")
            )
            x = h + x
        return np.asarray(self._conv(x, "head", 1).T, dtype=np.float32)
