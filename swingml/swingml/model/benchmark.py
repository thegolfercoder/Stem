"""One definition of the corpus, the splits, and what counts as better.

Every experiment from here on is measured through this. That is the whole point:
a run scored on its own split against its own metric is not evidence about
anything, and a sequence of such runs is a way of persuading yourself that the
last idea worked.

Three splits, fixed by seed and taken over clips:

*train* is what gradients see. *validation* chooses epochs and settles which of
two ideas to pursue. *test* is looked at when an idea has already been chosen,
and is never used to choose. Keeping the second and third apart matters more than
it looks: an idea selected on a set is fitted to that set, loosely but really,
and its score there stops being a prediction about new footage.

Accuracy is the share of events landing within a tolerance, which is what the
event-detection literature reports and what a person experiences. Two tolerances
because one flatters: a tight one says the instant was found, a loose one says
the right part of the swing was found, and the gap between them is the difference
between a near miss and a total failure.

Tempo is scored separately and in relative terms, because it is the number the
interface leads with and it is a quotient of two durations one of which is short.
An event one frame out moves it by ten percent at thirty frames a second, so a
model can be excellent by the frame metric and useless for tempo.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from swingml.events import NUM_EVENTS, EventSequence, SwingEvent
from swingml.features import CANONICAL_RATE_HZ
from swingml.model.decode import decode_events
from swingml.model.ensemble import SwingEventEnsemble
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from synth.dataset import Sample

SPLIT_SEED = 20260822
"""Fixed for the life of the project. Changing it reshuffles every result."""

TRAIN_FRACTION = 0.70
VALIDATION_FRACTION = 0.15
# The remainder is test.

TOLERANCES = (1, 2, 5)

BENCHMARK_ARCHIVES = (
    "down_the_line.npz",
    "extra_a.npz",
    "extra_dtl2.npz",
    "train.npz",
)
"""The archives the splits are taken over, named rather than globbed.

A glob over a directory was the original arrangement and it is a trap, because
the directory grows. Every recorded result was measured on the validation and
test clips that fall out of pooling exactly these four archives in exactly this
order and permuting them with `SPLIT_SEED`; drop a fifth archive into the
directory and the pool lengthens, the permutation lands elsewhere, and clips move
between training and test. Nothing fails. The numbers simply stop being
comparable with the ones above them in the log, and there is no way to notice.

So the corpus is a list. New footage is added to training through
`--extra-train`, which never touches validation or test - which also means the
held-out sets stay the ones every earlier number was measured on, and a
comparison across the whole history of the project stays honest.
"""


def benchmark_paths(root: Path = Path("out/detected")) -> list[Path]:
    """The benchmark corpus, in the order the splits were taken in."""
    return [root / name for name in BENCHMARK_ARCHIVES]


class Corpus(BaseModel):
    """The detected clips, split three ways and kept that way."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    train: list[Sample]
    validation: list[Sample]
    test: list[Sample]
    files: tuple[str, ...]
    test_indices: tuple[int, ...] = ()
    """Where the test clips sit in the pooled loading order.

    Carried so that anything needing to name those clips later - measuring error
    bands is the case that matters - can do so without re-deriving the split and
    risking a different answer. A calibration measured on clips the model trained
    on is the one failure the whole calibration exists to prevent.
    """

    def describe(self) -> str:
        return (
            f"{len(self.train)} train, {len(self.validation)} validation, "
            f"{len(self.test)} test, from {len(self.files)} files"
        )


def load_samples(paths: Sequence[Path]) -> list[Sample]:
    """Every cached detected clip, in the order the files give them."""
    samples: list[Sample] = []
    for path in paths:
        if not Path(path).is_file():
            continue
        data = np.load(path)
        features = data["features"]
        events = data["events"]
        left_handed = data["left_handed"]
        tempo_ratio = data["tempo_ratio"]
        capture_rate_hz = data["capture_rate_hz"]
        azimuth_deg = data["azimuth_deg"]
        lengths = data["lengths"]
        offsets = np.concatenate(([0], np.cumsum(lengths)))
        for index, length in enumerate(lengths):
            samples.append(
                Sample(
                    features=features[offsets[index] : offsets[index] + length],
                    event_frames=events[index],
                    handedness=(Handedness.LEFT if left_handed[index] > 0.5 else Handedness.RIGHT),
                    tempo_ratio=float(tempo_ratio[index]),
                    capture_rate_hz=float(capture_rate_hz[index]),
                    azimuth_deg=float(azimuth_deg[index]),
                )
            )
    return samples


def build_corpus(paths: Sequence[Path]) -> Corpus:
    """Load and split. Same files in, same three sets out, always."""
    samples = load_samples(paths)
    if not samples:
        raise ValueError(f"no clips found in {[str(p) for p in paths]}")

    order = np.random.default_rng(SPLIT_SEED).permutation(len(samples))
    n_train = int(len(samples) * TRAIN_FRACTION)
    n_validation = int(len(samples) * VALIDATION_FRACTION)
    train = [samples[i] for i in order[:n_train]]
    validation = [samples[i] for i in order[n_train : n_train + n_validation]]
    test = [samples[i] for i in order[n_train + n_validation :]]
    return Corpus(
        train=train,
        validation=validation,
        test=test,
        files=tuple(str(p) for p in paths),
        test_indices=tuple(int(i) for i in order[n_train + n_validation :]),
    )


def tempo_of(frames: NDArray[np.int64] | Sequence[int]) -> float:
    """Backswing over downswing, in frames, which the uniform grid makes a ratio."""
    address = int(SwingEvent.ADDRESS)
    top = int(SwingEvent.TOP)
    impact = int(SwingEvent.IMPACT)
    downswing = int(frames[impact]) - int(frames[top])
    return float(int(frames[top]) - int(frames[address])) / float(max(downswing, 1))


def tempo_of_positions(positions: NDArray[np.float64] | Sequence[float]) -> float:
    """The same ratio from sub-frame positions, which is what the interface shows.

    Worth having separately because the two can disagree, and for a while the
    benchmark measured one while the application reported the other. A downswing
    is about fifteen frames at the canonical rate, so a third of a frame either
    side of the top is two percent of the tempo - the same size as the differences
    whole experiments have turned on.
    """
    address = int(SwingEvent.ADDRESS)
    top = int(SwingEvent.TOP)
    impact = int(SwingEvent.IMPACT)
    downswing = float(positions[impact]) - float(positions[top])
    return (float(positions[top]) - float(positions[address])) / max(downswing, 1e-6)


class Score(BaseModel):
    """What one model did on one set of clips."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    n_clips: int
    n_refused: int
    within: dict[int, float]
    within_per_event: dict[int, tuple[float, ...]]
    mean_error: tuple[float, ...]
    median_error: tuple[float, ...]
    tempo_median_relative_error: float
    tempo_p80_relative_error: float
    tempo_subframe_median_relative_error: float = float("nan")
    tempo_subframe_p80_relative_error: float = float("nan")
    """Tempo from the decoder's sub-frame refinement rather than whole frames.

    The number the interface leads with is computed this way, so this is the one
    that describes what a person sees. It defaults to not-a-number because the
    results logged before it existed do not have it, and a zero there would read
    as a perfect score.
    """

    @property
    def headline(self) -> float:
        """The number one experiment is ranked against another by."""
        return self.within.get(2, 0.0)

    def summary(self) -> str:
        parts = "  ".join(
            f"±{t}f {100 * self.within.get(t, 0.0):5.1f}%" for t in sorted(self.within)
        )
        refused = f", {self.n_refused} refused" if self.n_refused else ""
        return (
            f"{self.n_clips} clips{refused}:  {parts}   "
            f"tempo med {100 * self.tempo_median_relative_error:4.1f}% "
            f"p80 {100 * self.tempo_p80_relative_error:4.1f}%"
            + (
                ""
                if np.isnan(self.tempo_subframe_median_relative_error)
                else f"   sub-frame med {100 * self.tempo_subframe_median_relative_error:4.1f}%"
            )
        )

    def report(self) -> str:
        lines = [self.summary(), "    event                 mean  median   ±1f     ±2f"]
        for event in SwingEvent.ordered():
            index = int(event)
            lines.append(
                f"    {event.label:<20} {self.mean_error[index]:5.2f}  "
                f"{self.median_error[index]:5.1f}  "
                f"{100 * self.within_per_event[1][index]:5.1f}%  "
                f"{100 * self.within_per_event[2][index]:5.1f}%"
            )
        return "\n".join(lines)


def predict_events(
    model: torch.nn.Module | SwingEventEnsemble, samples: Iterable[Sample]
) -> list[EventSequence | None]:
    """The decoder's full answer for each clip, or None where the model refused."""
    out: list[EventSequence | None] = []
    if isinstance(model, torch.nn.Module):
        model.eval()
    with torch.no_grad():
        for sample in samples:
            if isinstance(model, SwingEventEnsemble):
                logits = model.logits(sample.features)
            else:
                logits = model(torch.from_numpy(sample.features).unsqueeze(0))[0].numpy()
            decoded = decode_events(logits)
            out.append(None if isinstance(decoded, NoReading) else decoded)
    return out


def predict_frames(
    model: torch.nn.Module | SwingEventEnsemble, samples: Iterable[Sample]
) -> list[NDArray[np.int64] | None]:
    """Decoded event frames for each clip, or None where the model refused."""
    return [
        None if decoded is None else np.asarray(decoded.frames)
        for decoded in predict_events(model, samples)
    ]


def subframe_positions(decoded: EventSequence) -> NDArray[np.float64]:
    return np.array([decoded.position_of(event) for event in SwingEvent.ordered()])


def score(
    predicted: Sequence[NDArray[np.int64] | None],
    samples: Sequence[Sample],
    positions: Sequence[NDArray[np.float64] | None] | None = None,
) -> Score:
    """Turn predictions into the numbers experiments are compared on."""
    errors: list[NDArray[np.int64]] = []
    tempo_errors: list[float] = []
    subframe_errors: list[float] = []
    refused = 0
    for index, (prediction, sample) in enumerate(zip(predicted, samples, strict=True)):
        if prediction is None:
            refused += 1
            continue
        truth = np.asarray(sample.event_frames)
        errors.append(np.abs(prediction - truth))
        true_tempo = tempo_of(truth)
        tempo_errors.append(abs(tempo_of(prediction) - true_tempo) / max(true_tempo, 1e-9))
        refined = None if positions is None else positions[index]
        if refined is not None:
            subframe_errors.append(
                abs(tempo_of_positions(refined) - true_tempo) / max(true_tempo, 1e-9)
            )

    if not errors:
        zeros = tuple(0.0 for _ in range(NUM_EVENTS))
        return Score(
            n_clips=len(samples),
            n_refused=refused,
            within=dict.fromkeys(TOLERANCES, 0.0),
            within_per_event={t: zeros for t in TOLERANCES},
            mean_error=zeros,
            median_error=zeros,
            tempo_median_relative_error=float("nan"),
            tempo_p80_relative_error=float("nan"),
        )

    stacked = np.stack(errors)
    tempo = np.asarray(tempo_errors)
    return Score(
        n_clips=len(samples),
        n_refused=refused,
        within={t: float((stacked <= t).mean()) for t in TOLERANCES},
        within_per_event={
            t: tuple(float(v) for v in (stacked <= t).mean(axis=0)) for t in TOLERANCES
        },
        mean_error=tuple(float(v) for v in stacked.mean(axis=0)),
        median_error=tuple(float(v) for v in np.median(stacked, axis=0)),
        tempo_median_relative_error=float(np.median(tempo)),
        tempo_p80_relative_error=float(np.percentile(tempo, 80)),
        tempo_subframe_median_relative_error=(
            float(np.median(subframe_errors)) if subframe_errors else float("nan")
        ),
        tempo_subframe_p80_relative_error=(
            float(np.percentile(subframe_errors, 80)) if subframe_errors else float("nan")
        ),
    )


def evaluate(model: torch.nn.Module | SwingEventEnsemble, samples: Sequence[Sample]) -> Score:
    decoded = predict_events(model, samples)
    return score(
        [None if d is None else np.asarray(d.frames) for d in decoded],
        samples,
        [None if d is None else subframe_positions(d) for d in decoded],
    )


def slice_report(model: torch.nn.Module | SwingEventEnsemble, samples: Sequence[Sample]) -> str:
    """Where the error is, rather than how much of it there is.

    A single accuracy figure averages over the conditions a clip can be shot in,
    and the whole question when improving something is which of those conditions
    it is failing. Down the line and face on are different problems; thirty frames
    a second and two hundred and forty are different problems.
    """
    predicted = predict_frames(model, samples)
    lines = ["  slice                     n    ±1f     ±2f   tempo med"]

    def add(label: str, chosen: list[int]) -> None:
        if len(chosen) < 12:
            return
        part = score([predicted[i] for i in chosen], [samples[i] for i in chosen])
        lines.append(
            f"  {label:<22} {len(chosen):4d}  {100 * part.within[1]:5.1f}%  "
            f"{100 * part.within[2]:5.1f}%   {100 * part.tempo_median_relative_error:5.1f}%"
        )

    azimuth = np.abs([s.azimuth_deg for s in samples])
    add("face on (|az| < 30)", [i for i, a in enumerate(azimuth) if a < 30])
    add("angled (30-70)", [i for i, a in enumerate(azimuth) if 30 <= a < 70])
    add("down the line (70-110)", [i for i, a in enumerate(azimuth) if 70 <= a < 110])
    add("behind (> 110)", [i for i, a in enumerate(azimuth) if a >= 110])

    for rate in (30.0, 60.0, 120.0, 240.0):
        add(f"{rate:.0f} fps", [i for i, s in enumerate(samples) if s.capture_rate_hz == rate])

    add("right handed", [i for i, s in enumerate(samples) if s.handedness is Handedness.RIGHT])
    add("left handed", [i for i, s in enumerate(samples) if s.handedness is Handedness.LEFT])

    tempo = np.asarray([s.tempo_ratio for s in samples])
    add("tempo < 2.6", [i for i, t in enumerate(tempo) if t < 2.6])
    add("tempo 2.6-3.3", [i for i, t in enumerate(tempo) if 2.6 <= t < 3.3])
    add("tempo > 3.3", [i for i, t in enumerate(tempo) if t >= 3.3])

    lengths = np.asarray([s.n_frames for s in samples])
    add("short clips (< 150f)", [i for i, n in enumerate(lengths) if n < 150])
    add("long clips (> 250f)", [i for i, n in enumerate(lengths) if n > 250])
    return "\n".join(lines)


def record(path: Path, name: str, notes: str, scores: dict[str, Score]) -> None:
    """Append one experiment's results to a running log.

    Written as it happens so that a run which is interrupted still leaves what it
    learned, and so the sequence of ideas can be read back in order rather than
    reconstructed from memory.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    entries = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else []
    entries.append(
        {
            "name": name,
            "notes": notes,
            "canonical_rate_hz": CANONICAL_RATE_HZ,
            "scores": {key: value.model_dump() for key, value in scores.items()},
        }
    )
    path.write_text(json.dumps(entries, indent=1), encoding="utf-8")
