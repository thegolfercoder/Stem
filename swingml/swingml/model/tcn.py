"""A dilated temporal convolutional network over pose features.

Why this rather than a recurrent network or a video model.

*Not a video model.* Running a convolutional network over raw frames is the
obvious approach and is what the published baselines do, but it needs a great
deal of labelled video and a GPU, and it learns the background of the driving
range along with the swing. Pose features throw away everything that is not the
golfer before training starts, which is most of the pixels and nearly all of the
nuisance variation.

*Not recurrent.* A recurrent network processes frames one at a time, which is
slow to train and awkward to make bidirectional over long sequences. Dilated
convolutions reach the whole swing in a handful of layers, train in parallel
across time, and have a receptive field that can be read off the architecture
rather than hoped for.

*What lies beyond the clip.* A convolution at the first frame has to be told what
came before it, and the answer had been zeros. Zero is not "nothing" for these
features - it is a specific hand position, a specific normalised velocity - so the
network met an abrupt discontinuity a few frames before address and again a few
frames after the finish, which are precisely the two events it is worst at. Edge
replication says instead that before the clip the golfer was standing as they were
in the first frame, and after it they are holding the finish, which is what was
actually happening. `padding_mode` selects between the two; see the measured
comparison in the README.

*Not causal.* Nothing here runs live. The whole clip exists before analysis
begins, so a frame is allowed to depend on what happens after it - which matters,
because the top of the backswing is only recognisable as the top once you have
seen the club come back down.

The receptive field is set so that one layer stack spans a whole swing at the
canonical rate. A model that cannot see address and impact at the same time
cannot use the relationship between them, and that relationship is most of what
distinguishes the top of a backswing from any other moment of stillness.
"""

from __future__ import annotations

from functools import partial
from typing import Literal

import torch
from torch import nn

from swingml.events import NUM_CLASSES

DEFAULT_DILATIONS = (1, 2, 4, 8, 16, 32)
"""Reaches 253 frames, which is longer than any swing at the canonical rate."""

PaddingMode = Literal["zeros", "replicate"]
"""What a convolution sees beyond the ends of the clip.

"zeros" is what PyTorch does by default and what every model here was trained
with until it was measured. "replicate" holds the first and last frames, which is
the physically true answer: the golfer existed before the recording started and
is still standing there after it stops.
"""


class TemporalBlock(nn.Module):
    """Two dilated convolutions with a residual connection."""

    def __init__(
        self,
        channels: int,
        dilation: int,
        kernel_size: int,
        dropout: float,
        padding_mode: PaddingMode = "zeros",
    ) -> None:
        super().__init__()
        padding = dilation * (kernel_size - 1) // 2
        conv = partial(
            nn.Conv1d,
            channels,
            channels,
            kernel_size,
            padding=padding,
            dilation=dilation,
            padding_mode=padding_mode,
        )
        self.conv1 = conv()
        self.conv2 = conv()
        # Group normalisation rather than batch normalisation: batches here are
        # small and hold sequences of different lengths with padding in them, and
        # batch statistics computed over padding are not statistics of anything.
        self.norm1 = nn.GroupNorm(8, channels)
        self.norm2 = nn.GroupNorm(8, channels)
        self.activation = nn.GELU()
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        x = self.dropout(self.activation(self.norm1(self.conv1(x))))
        x = self.dropout(self.activation(self.norm2(self.conv2(x))))
        return x + residual


class SwingEventNet(nn.Module):
    """Per-frame class scores over the eight events plus background."""

    def __init__(
        self,
        in_features: int,
        channels: int = 96,
        dilations: tuple[int, ...] = DEFAULT_DILATIONS,
        kernel_size: int = 3,
        dropout: float = 0.1,
        padding_mode: PaddingMode = "zeros",
    ) -> None:
        super().__init__()
        self.in_features = in_features
        self.channels = channels
        self.dilations = dilations
        self.kernel_size = kernel_size
        self.padding_mode = padding_mode

        self.input_projection = nn.Conv1d(in_features, channels, kernel_size=1)
        self.input_norm = nn.GroupNorm(8, channels)
        self.blocks = nn.ModuleList(
            TemporalBlock(channels, dilation, kernel_size, dropout, padding_mode)
            for dilation in dilations
        )
        self.head = nn.Conv1d(channels, NUM_CLASSES, kernel_size=1)

    @property
    def receptive_field(self) -> int:
        """Frames one output position can see. Should exceed a whole swing."""
        return 1 + 2 * (self.kernel_size - 1) * sum(self.dilations)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        """Args: (B, T, F). Returns: (B, T, NUM_CLASSES) logits."""
        x = features.transpose(1, 2)
        x = torch.nn.functional.gelu(self.input_norm(self.input_projection(x)))
        for block in self.blocks:
            x = block(x)
        logits: torch.Tensor = self.head(x).transpose(1, 2)
        return logits
