"""Batching variable-length swings, and what the model is asked to predict.

Two decisions live here that matter more than the architecture does.

**Soft targets in time.** Asking the network to fire on exactly one frame and to
stay silent on the frame beside it is asking it to learn something that is not
true. Impact is an instant, but which sampled frame is nearest to it is partly an
accident of when the shutter opened, and the frames either side are very nearly
right. Each event's target is therefore a narrow bump centred on its frame, so
being one frame out is a small error rather than a total one. Training against
hard targets makes the loss surface spiky and the confidences meaningless.

**Weighting.** Eight frames in every two hundred are events. Left alone, a
network minimises its loss almost perfectly by declaring every frame background,
and the gradient from the events is lost in the noise of that. Frames near an
event are weighted up so the rare class is worth attending to.
"""

from __future__ import annotations

import numpy as np
import torch
from numpy.typing import NDArray
from torch.utils.data import Dataset

from swingml.events import BACKGROUND_CLASS, NUM_CLASSES, NUM_EVENTS
from swingml.features import feature_layout
from swingml.model.augment import AugmentConfig, augment_sample
from synth.dataset import Sample


def soft_targets(
    event_frames: NDArray[np.int64], n_frames: int, sigma_frames: float
) -> NDArray[np.float32]:
    """(T, NUM_CLASSES) target distribution with a bump at each event."""
    times = np.arange(n_frames, dtype=np.float64)
    target = np.zeros((n_frames, NUM_CLASSES), dtype=np.float64)
    for event, frame in enumerate(event_frames):
        target[:, event] = np.exp(-0.5 * ((times - float(frame)) / sigma_frames) ** 2)
    event_mass = target[:, :NUM_EVENTS].sum(axis=1)
    target[:, BACKGROUND_CLASS] = np.clip(1.0 - event_mass, 0.0, 1.0)
    target /= np.maximum(target.sum(axis=1, keepdims=True), 1e-9)
    return target.astype(np.float32)


UNSUPERVISED_RADIUS_FRAMES = 18
"""Frames either side of a withheld event that are dropped from the loss.

Two things have to be covered. The soft target puts a bump of width
`sigma_frames` at the event, which is spent by three sigma - six frames at the
default. And the label itself sits somewhere else than the other label set would
have put it, by up to fourteen frames for the finish and thirteen for
mid-backswing, measured in matched tempo bands, so the frames the other
convention would have called the event have to go too.

Eighteen is those two added and rounded, which makes it a policy rather than a
measurement: it is wide enough to contain the largest disagreement measured, and
every frame it covers is a frame the model learns nothing from.
"""


def unsupervised_veto(
    event_frames: NDArray[np.int64],
    supervised_events: NDArray[np.bool_],
    n_frames: int,
    radius_frames: int = UNSUPERVISED_RADIUS_FRAMES,
) -> NDArray[np.float32]:
    """1.0 where the loss applies, 0.0 around an event whose label is not trusted.

    Multiplied into the per-frame weight rather than subtracted from the target.
    Removing the bump would leave those frames labelled background, which is a
    different claim and a false one - the event is there, its frame is just not
    known well enough to train on. Zero weight says nothing either way, which is
    the truth of the matter.
    """
    keep = np.ones(n_frames, dtype=np.float32)
    for event, trusted in enumerate(supervised_events):
        if trusted:
            continue
        centre = int(event_frames[event])
        keep[max(0, centre - radius_frames) : centre + radius_frames + 1] = 0.0
    return keep


class SwingDataset(Dataset[dict[str, torch.Tensor]]):
    """Feature sequences, their targets, and a mask marking the real frames."""

    def __init__(
        self,
        samples: list[Sample],
        sigma_frames: float = 2.0,
        event_weight: float = 24.0,
        feature_noise: float = 0.0,
        max_frames: int | None = None,
        rng_seed: int = 0,
        augment: AugmentConfig | None = None,
        unsupervised_radius_frames: int = UNSUPERVISED_RADIUS_FRAMES,
    ) -> None:
        self.samples = samples
        self.sigma_frames = sigma_frames
        self.event_weight = event_weight
        self.feature_noise = feature_noise
        self.max_frames = max_frames
        self.rng = np.random.default_rng(rng_seed)
        self.augment = augment or AugmentConfig()
        self.unsupervised_radius_frames = unsupervised_radius_frames
        self.layout = feature_layout()

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        sample = self.samples[index]
        features = sample.features
        events = sample.event_frames

        if self.augment.enabled:
            # A fresh generator per item, drawn from the dataset's own stream. That
            # makes a run reproducible while the loader is single-process, which it
            # is, and only while it is: the seed comes from how many items have been
            # asked for rather than from which item, so several worker processes
            # would each get their own copy of the counter and augment the same clip
            # differently. Seeding from the index and a per-index draw count would
            # hold under workers, and is a change that moves every result, so it
            # waits for a moment when nothing is mid-comparison.
            features, events = augment_sample(
                features.copy(),
                events.copy(),
                np.random.default_rng(int(self.rng.integers(0, 2**31))),
                self.augment,
                self.layout,
            )

        if self.max_frames is not None and features.shape[0] > self.max_frames:
            # Crop, but never through an event: a window that cuts the finish off
            # would teach the model that swings sometimes lack one.
            latest_start = min(int(events[0]), features.shape[0] - self.max_frames)
            earliest_start = max(0, int(events[-1]) - self.max_frames + 1)
            start = int(self.rng.integers(earliest_start, max(earliest_start, latest_start) + 1))
            features = features[start : start + self.max_frames]
            events = events - start

        if self.feature_noise > 0.0:
            features = features + self.rng.normal(0.0, self.feature_noise, features.shape).astype(
                np.float32
            )

        n_frames = features.shape[0]
        target = soft_targets(events, n_frames, self.sigma_frames)
        weight = 1.0 + self.event_weight * (1.0 - target[:, BACKGROUND_CLASS])
        if sample.supervised_events is not None and not sample.supervised_events.all():
            weight = weight * unsupervised_veto(
                events, sample.supervised_events, n_frames, self.unsupervised_radius_frames
            )

        return {
            "features": torch.from_numpy(np.ascontiguousarray(features)),
            "target": torch.from_numpy(target),
            "weight": torch.from_numpy(weight.astype(np.float32)),
            "events": torch.from_numpy(np.ascontiguousarray(events)),
            "length": torch.tensor(n_frames, dtype=torch.long),
        }


def collate(
    batch: list[dict[str, torch.Tensor]], edge_pad: bool = False
) -> dict[str, torch.Tensor]:
    """Pad to the longest sequence in the batch and mark what is padding.

    Padding is excluded from the loss by the mask either way; what it holds is
    what the convolutions see beyond the end of a short clip, and that has to
    match what they see beyond the end of the only clip in the batch at serving
    time, where there is no batch padding at all and the network's own
    `padding_mode` decides.

    With zeros - the original choice - the argument against edge padding was that
    repeating the final frame puts a long stretch of held finish into every short
    clip, so the model learns that stillness at the end of a sequence means
    something when it is an artefact of batching. That argument holds only while
    the network zero-pads too. Set against a network that replicates, the
    reasoning inverts: the held finish is exactly what it will see when it runs
    for real, and zeros here are the artefact. So `edge_pad` is not an independent
    knob - it travels with the network's padding mode, and the experiment script
    sets both from one flag.
    """
    lengths = torch.stack([item["length"] for item in batch])
    longest = int(lengths.max())
    n_features = batch[0]["features"].shape[1]

    features = torch.zeros(len(batch), longest, n_features)
    target = torch.zeros(len(batch), longest, NUM_CLASSES)
    target[..., BACKGROUND_CLASS] = 1.0
    weight = torch.zeros(len(batch), longest)
    mask = torch.zeros(len(batch), longest, dtype=torch.bool)
    events = torch.stack([item["events"] for item in batch])

    for i, item in enumerate(batch):
        n = int(item["length"])
        features[i, :n] = item["features"]
        target[i, :n] = item["target"]
        weight[i, :n] = item["weight"]
        mask[i, :n] = True
        if edge_pad and n < longest:
            # The target and the weight stay as they are: the padding is still
            # background and still carries no loss. Only what the convolutions
            # read is changed.
            features[i, n:] = item["features"][-1]

    return {
        "features": features,
        "target": target,
        "weight": weight,
        "mask": mask,
        "events": events,
        "lengths": lengths,
    }


def masked_soft_cross_entropy(
    logits: torch.Tensor,
    target: torch.Tensor,
    weight: torch.Tensor,
    mask: torch.Tensor,
    label_smoothing: float = 0.0,
) -> torch.Tensor:
    """Cross-entropy against a soft target, weighted per frame, ignoring padding.

    `label_smoothing` mixes a little of the uniform distribution into the target.
    The target is already soft in time - a bump rather than a spike - so this is
    smoothing of a different kind: it caps how confident the network is rewarded
    for being about the *class*, which is what keeps the probabilities usable as
    the input to a measured error band rather than saturating at one.
    """
    log_probabilities = torch.log_softmax(logits, dim=-1)
    if label_smoothing > 0.0:
        classes = target.shape[-1]
        target = target * (1.0 - label_smoothing) + label_smoothing / classes
    per_frame = -(target * log_probabilities).sum(dim=-1)
    weighted = per_frame * weight * mask
    return weighted.sum() / weight.mul(mask).sum().clamp_min(1.0)
