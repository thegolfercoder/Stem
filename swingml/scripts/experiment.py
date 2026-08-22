"""Train one model under one configuration, and score it the same way every time.

Built for a sequence of experiments on four CPU cores, which is the constraint
that shapes everything here. A full run is minutes, not seconds, so the number of
ideas that can be tried is small and each one has to be worth the time. Ranking
happens on the validation split at a reduced epoch count; only an idea that has
already won is given a full run, and only then is the test split looked at.

Every knob an experiment might want to turn is an argument, so that the record of
what was run is the command line, and two runs differing in one flag differ in
one thing.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model, save_model
from swingml.features import feature_dimension
from swingml.model.augment import AugmentConfig
from swingml.model.benchmark import Corpus, Score, build_corpus, evaluate, load_samples, record
from swingml.model.data import SwingDataset, collate, masked_soft_cross_entropy
from swingml.model.tcn import SwingEventNet
from synth.dataset import Sample


@dataclass
class Setup:
    """One experiment, in full."""

    name: str
    notes: str
    channels: int
    dilations: tuple[int, ...]
    kernel_size: int
    dropout: float
    sigma_frames: float
    event_weight: float
    learning_rate: float
    weight_decay: float
    epochs: int
    batch_size: int
    augment: bool
    feature_noise: float
    seed: int
    ema_decay: float
    label_smoothing: float
    init_from: Path | None = None
    validate_every: int = 1
    extra_only: bool = False
    """Train on the extra clips alone.

    The splits still come from the detected clips, so validation and test stay
    in the domain the thing runs in. Pretraining on cheap generator clips and
    reporting the score on cheap generator clips measures nothing anyone cares
    about; the question is always what it does to real-estimator footage.
    """


def loaders(
    corpus: Corpus, setup: Setup, extra: list[Sample] | None = None
) -> tuple[DataLoader[dict[str, torch.Tensor]], list[Sample]]:
    """Training loader, and the clips to judge on.

    `extra` is training-only material - cheap clips built straight from the
    generator, with no rendering and no pose estimator in the way. It never
    reaches validation or test, which stay entirely the detected clips, because
    those are the domain the thing actually runs in and the only honest place to
    measure whether an idea helped.
    """
    training = list(extra or []) if setup.extra_only else corpus.train + list(extra or [])
    dataset = SwingDataset(
        training,
        sigma_frames=setup.sigma_frames,
        event_weight=setup.event_weight,
        feature_noise=setup.feature_noise,
        rng_seed=setup.seed,
        augment=AugmentConfig(enabled=setup.augment),
    )
    return (
        DataLoader(
            dataset,
            batch_size=setup.batch_size,
            shuffle=True,
            collate_fn=collate,
            drop_last=False,
        ),
        corpus.validation,
    )


class Averaged:
    """An exponential moving average of the weights, kept alongside training.

    The last epoch's weights are one sample from a trajectory that is still
    bouncing around; the average of the recent past is a better point than any
    single step of it, costs one extra copy of the model, and needs no tuning
    beyond a decay. Cheap enough to always be worth trying at this scale.
    """

    def __init__(self, model: torch.nn.Module, decay: float) -> None:
        self.decay = decay
        self.shadow = {k: v.detach().clone() for k, v in model.state_dict().items()}

    def update(self, model: torch.nn.Module) -> None:
        for key, value in model.state_dict().items():
            if value.dtype.is_floating_point:
                self.shadow[key].mul_(self.decay).add_(value.detach(), alpha=1.0 - self.decay)
            else:
                self.shadow[key].copy_(value.detach())

    def apply_to(self, model: torch.nn.Module) -> SwingEventNet:
        clone = SwingEventNet(
            model.in_features,  # type: ignore[arg-type]
            channels=model.channels,  # type: ignore[arg-type]
            dilations=model.dilations,  # type: ignore[arg-type]
            kernel_size=model.kernel_size,  # type: ignore[arg-type]
        )
        clone.load_state_dict(self.shadow)
        clone.eval()
        return clone


def train(
    corpus: Corpus, setup: Setup, out: Path | None, extra: list[Sample] | None = None
) -> tuple[SwingEventNet, Score, dict]:
    torch.manual_seed(setup.seed)
    np.random.seed(setup.seed)

    if setup.init_from is not None:
        # Fine-tuning. Cheap generator landmarks are plentiful and are not what
        # the thing runs on, so they belong in a first pass that learns what a
        # swing looks like, followed by a short second pass on the far smaller
        # set of clips that went through the real pose estimator. Mixing the two
        # in one pass was tried and lost: the cheap clips outnumber the real ones
        # nine to one and the model drifts to their landmark conventions.
        model = load_model(setup.init_from)
        model.train()
    else:
        model = SwingEventNet(
            feature_dimension(),
            channels=setup.channels,
            dilations=setup.dilations,
            kernel_size=setup.kernel_size,
            dropout=setup.dropout,
        )
    loader, validation = loaders(corpus, setup, extra)
    optimiser = torch.optim.AdamW(
        model.parameters(), lr=setup.learning_rate, weight_decay=setup.weight_decay
    )
    schedule = torch.optim.lr_scheduler.OneCycleLR(
        optimiser,
        max_lr=setup.learning_rate,
        total_steps=max(1, setup.epochs * len(loader)),
        pct_start=0.15,
    )
    averaged = Averaged(model, setup.ema_decay) if setup.ema_decay > 0 else None

    best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    best = -1.0
    history: list[dict[str, float]] = []
    started = time.time()

    for epoch in range(setup.epochs):
        model.train()
        total = 0.0
        for batch in loader:
            optimiser.zero_grad(set_to_none=True)
            logits = model(batch["features"])
            loss = masked_soft_cross_entropy(
                logits,
                batch["target"],
                batch["weight"],
                batch["mask"],
                label_smoothing=setup.label_smoothing,
            )
            loss.backward()  # type: ignore[no-untyped-call]
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
            schedule.step()
            if averaged is not None:
                averaged.update(model)
            total += float(loss.detach())

        # Validation is a hundred and seventy-four sequential forward passes and
        # dominates the epoch whenever the training set is small - which is most
        # of the time a learning curve spends. The final epoch is always judged,
        # so the figure reported at the end is never a stale one.
        final_epoch = epoch == setup.epochs - 1
        if not final_epoch and (epoch + 1) % setup.validate_every:
            print(
                f"  epoch {epoch + 1:3d}/{setup.epochs}  loss {total / max(len(loader), 1):.4f}",
                flush=True,
            )
            continue
        judged = averaged.apply_to(model) if averaged is not None else model
        result = evaluate(judged, validation)
        history.append(
            {
                "epoch": epoch,
                "loss": total / max(len(loader), 1),
                "within_1": result.within[1],
                "within_2": result.within[2],
                "tempo": result.tempo_median_relative_error,
            }
        )
        if result.headline > best:
            best = result.headline
            best_state = {k: v.detach().clone() for k, v in judged.state_dict().items()}
        print(
            f"  epoch {epoch + 1:3d}/{setup.epochs}  loss {history[-1]['loss']:.4f}  "
            f"val ±1f {100 * result.within[1]:5.1f}%  ±2f {100 * result.within[2]:5.1f}%  "
            f"tempo {100 * result.tempo_median_relative_error:4.1f}%",
            flush=True,
        )

    model.load_state_dict(best_state)
    model.eval()
    final = evaluate(model, validation)
    meta = {
        "minutes": (time.time() - started) / 60.0,
        "parameters": sum(p.numel() for p in model.parameters()),
        "receptive_field": model.receptive_field,
        "history": history,
    }
    if out is not None:
        out.mkdir(parents=True, exist_ok=True)
        save_model(model, out / "swing_event_net.pt")
        (out / "setup.json").write_text(
            json.dumps({"setup": setup.__dict__, "meta": meta}, indent=1, default=str),
            encoding="utf-8",
        )
    return model, final, meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--notes", default="")
    parser.add_argument(
        "--data", type=Path, nargs="+", default=sorted(Path("out/detected").glob("*.npz"))
    )
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--log", type=Path, default=Path("out/experiments/log.json"))
    parser.add_argument("--channels", type=int, default=96)
    parser.add_argument("--dilations", type=int, nargs="+", default=[1, 2, 4, 8, 16, 32])
    parser.add_argument("--kernel-size", type=int, default=3)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--sigma-frames", type=float, default=2.0)
    parser.add_argument("--event-weight", type=float, default=24.0)
    parser.add_argument("--learning-rate", type=float, default=3e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--no-augment", action="store_true")
    parser.add_argument("--feature-noise", type=float, default=0.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--ema-decay", type=float, default=0.0)
    parser.add_argument("--label-smoothing", type=float, default=0.0)
    parser.add_argument("--init-from", type=Path, default=None, help="start from these weights")
    parser.add_argument("--validate-every", type=int, default=1)
    parser.add_argument(
        "--limit-train",
        type=int,
        default=0,
        help="use only this many training clips, for measuring a learning curve",
    )
    parser.add_argument(
        "--extra-only",
        action="store_true",
        help="train on --extra-train alone, still judged on the detected splits",
    )
    parser.add_argument(
        "--extra-train",
        type=Path,
        nargs="*",
        default=[],
        help="clip files added to training only, never to validation or test",
    )
    parser.add_argument("--test", action="store_true", help="also score the test split")
    args = parser.parse_args()

    setup = Setup(
        name=args.name,
        notes=args.notes,
        channels=args.channels,
        dilations=tuple(args.dilations),
        kernel_size=args.kernel_size,
        dropout=args.dropout,
        sigma_frames=args.sigma_frames,
        event_weight=args.event_weight,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        epochs=args.epochs,
        batch_size=args.batch_size,
        augment=not args.no_augment,
        feature_noise=args.feature_noise,
        seed=args.seed,
        ema_decay=args.ema_decay,
        label_smoothing=args.label_smoothing,
        init_from=args.init_from,
        validate_every=args.validate_every,
        extra_only=args.extra_only,
    )

    corpus = build_corpus(args.data)
    if args.limit_train:
        corpus = corpus.model_copy(update={"train": corpus.train[: args.limit_train]})
    extra = load_samples(args.extra_train) if args.extra_train else []
    print(
        f"{setup.name}: {corpus.describe()}"
        + (f", plus {len(extra)} training-only" if extra else "")
    )
    model, validation, meta = train(corpus, setup, args.out, extra)
    print(f"\n{setup.name} validation: {validation.summary()}")
    print(validation.report())

    scores = {"validation": validation}
    if args.test:
        test = evaluate(model, corpus.test)
        print(f"\n{setup.name} TEST: {test.summary()}")
        print(test.report())
        scores["test"] = test

    record(args.log, setup.name, setup.notes or json.dumps(setup.__dict__, default=str), scores)
    print(
        f"\n{meta['parameters']:,} parameters, receptive field {meta['receptive_field']} "
        f"frames, {meta['minutes']:.1f} min"
    )


if __name__ == "__main__":
    main()
