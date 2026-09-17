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
from collections.abc import Sequence
from dataclasses import dataclass
from functools import partial
from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model, save_model
from swingml.events import NUM_EVENTS, SwingEvent
from swingml.features import feature_dimension
from swingml.model.augment import AugmentConfig
from swingml.model.benchmark import (
    Corpus,
    Score,
    benchmark_paths,
    build_corpus,
    evaluate,
    load_samples,
    record,
)
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
    data: tuple[str, ...] = ()
    """The archives the splits were taken over."""
    extra_train: tuple[str, ...] = ()
    """Archives added to training only, never to validation or test.

    Recorded because it was not. Which clips a run trained on is the single most
    important thing about it, and the only place it appeared was in whatever was
    typed into --notes, so a checkpoint on disk could not be traced back to its
    data at all. Two runs that differ in their corpus and agree in every recorded
    field look, in the log, like a reproducibility problem.
    """
    extra_validation: tuple[str, ...] = ()
    """Real clips that decide which epoch is kept, scored apart from the synthetic ones.

    Validation was entirely generated footage, and choosing on generated footage
    is how this project once kept a checkpoint that put the finish thirty-eight
    frames late on the only real swing it had. A model meant to work on real
    video has to be chosen on real video.

    Scored apart rather than pooled in, and the two headline numbers averaged, so
    that neither domain can be traded away for the other: pooling would let a
    hundred synthetic clips outvote thirty real ones and the choice would be the
    old one again with extra steps.
    """
    selection_events: tuple[str, ...] = ()
    """Events the real validation clips are judged on. Empty means all eight.

    The clips whose labels disagree with this generator on four events are not
    trained on those events, so judging them there would score the model against
    a target it was deliberately never shown.
    """
    max_frames: int | None = None
    """Cap on the frames of any one training clip.

    Real clips run to five hundred frames and more where generated ones sit near
    a hundred and sixty, and collation pads every clip in a batch to the longest
    one in it, so a single long clip sets the width - and the cost - for all
    thirty-one beside it. The crop never cuts through an event.
    """
    extend_probability: float = 0.0
    """Chance of padding idle footage onto a clip's ends during training.

    Recorded rather than left to the augmenter's default, because it changes the
    length of what the model is shown: a run with it on is not comparable with
    one without, and the log has to be able to say which it was.
    """
    real_train: tuple[str, ...] = ()
    """Real footage added to training, kept apart from the generated extras.

    Separate from `extra_train` because the two are supervised differently: the
    generated extras agree with the generated splits on all eight events, and the
    real clips agree on four. One flag covering both would have applied the real
    clips' mask to the generated ones and quietly stopped training four events on
    the corpus that defines them.
    """
    extra_events: tuple[str, ...] = ()
    """Which events the --real-train clips are trained against. Empty means all.

    A property of the run, not of the archive. Whether real footage and this
    generator mean the same instant by "mid-backswing" is a judgement about two
    label sets, and writing it into the data file would freeze one answer into
    every future run and hide it from the log. Here it lands in the record beside
    the corpus it applies to.
    """
    holdout: tuple[str, ...] = ()
    """Archives scored separately, never trained on and never in a split.

    The four detected archives are the benchmark, and every number in the log was
    measured on the clips a fixed seed draws out of them, so real footage cannot
    join that pool without making the history incomparable. It goes to training
    through --extra-train instead - which would leave the real-footage accuracy,
    the thing this is all for, measured on one fixture clip. A holdout scored
    apart gives it a number of its own without touching the benchmark.
    """
    edge_padding: bool = False
    """Replicate the ends of a clip rather than padding them with zeros.

    One flag for two halves of the same idea: the network's convolutions read
    beyond the ends of the clip, and the batch collation decides what is beyond
    the end of a short clip in a batch. Setting one without the other trains a
    network against a boundary it will not meet when it runs.
    """
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
        max_frames=setup.max_frames,
        rng_seed=setup.seed,
        augment=AugmentConfig(enabled=setup.augment, extend_probability=setup.extend_probability),
    )
    return (
        DataLoader(
            dataset,
            batch_size=setup.batch_size,
            shuffle=True,
            collate_fn=partial(collate, edge_pad=setup.edge_padding),
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
    corpus: Corpus,
    setup: Setup,
    out: Path | None,
    extra: list[Sample] | None = None,
    real_validation: list[Sample] | None = None,
) -> tuple[SwingEventNet, Score, Score | None, dict[str, object]]:
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
            padding_mode="replicate" if setup.edge_padding else "zeros",
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
        real = evaluate(judged, real_validation) if real_validation else None

        # The mean of the two domains' headlines, not a pool of their clips. A
        # pool lets whichever domain brought more clips decide, which for 174
        # generated against a few dozen real is the generated-only choice again.
        ranked = (
            result.headline
            if real is None
            else 0.5 * (result.headline + within_on(real, setup.selection_events))
        )
        history.append(
            {
                "epoch": epoch,
                "loss": total / max(len(loader), 1),
                "within_1": result.within[1],
                "within_2": result.within[2],
                "tempo": result.tempo_median_relative_error,
                "ranked": ranked,
                **(
                    {}
                    if real is None
                    else {
                        "real_within_1": within_on(real, setup.selection_events, 1),
                        "real_within_2": within_on(real, setup.selection_events, 2),
                    }
                ),
            }
        )
        if ranked > best:
            best = ranked
            best_state = {k: v.detach().clone() for k, v in judged.state_dict().items()}
        line = (
            f"  epoch {epoch + 1:3d}/{setup.epochs}  loss {history[-1]['loss']:.4f}  "
            f"val ±1f {100 * result.within[1]:5.1f}%  ±2f {100 * result.within[2]:5.1f}%"
        )
        if real is not None:
            line += (
                f"  | real ±1f {100 * within_on(real, setup.selection_events, 1):5.1f}%"
                f"  ±2f {100 * within_on(real, setup.selection_events, 2):5.1f}%"
            )
        print(f"{line}  ranked {100 * ranked:5.1f}%", flush=True)

    model.load_state_dict(best_state)
    model.eval()
    final = evaluate(model, validation)
    final_real = evaluate(model, real_validation) if real_validation else None
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
    return model, final, final_real, meta


def supervised_mask(names: Sequence[str]) -> NDArray[np.bool_]:
    """Turn event names into the eight-long mask the dataset withholds by.

    Unknown names raise rather than being skipped. A typo that silently selected
    nothing would train against every event while the log recorded that it had
    not, which is the one failure mode worth spending an exception on.
    """
    mask = np.zeros(NUM_EVENTS, dtype=bool)
    for name in names:
        try:
            mask[int(SwingEvent[name.strip().upper()])] = True
        except KeyError:
            known = ", ".join(event.name.lower() for event in SwingEvent.ordered())
            raise SystemExit(f"unknown event {name!r}; known events are {known}") from None
    if not mask.any():
        raise SystemExit("--extra-events named no events")
    return mask


def within_on(score: Score, events: Sequence[str], tolerance: int = 2) -> float:
    """`score`'s within-tolerance rate over just these events.

    Read off `within_per_event` rather than recomputed, so it cannot drift from
    the number the report prints beside it.
    """
    per_event = score.within_per_event[tolerance]
    if not events:
        return float(np.mean(per_event))
    picked = [per_event[int(SwingEvent[name.strip().upper()])] for name in events]
    return float(np.mean(picked))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument("--notes", default="")
    parser.add_argument("--data", type=Path, nargs="+", default=benchmark_paths())
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
    parser.add_argument(
        "--edge-padding",
        action="store_true",
        help=(
            "hold the first and last frames beyond the ends of the clip rather "
            "than padding with zeros, in both the network and the batch"
        ),
    )
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
    parser.add_argument(
        "--real-train",
        type=Path,
        nargs="*",
        default=[],
        help=(
            "real footage added to training, supervised only on --extra-events; "
            "kept apart from --extra-train, which is generated and agrees on all eight"
        ),
    )
    parser.add_argument(
        "--extra-validation",
        type=Path,
        nargs="*",
        default=[],
        help=(
            "real clips that decide which epoch is kept, scored apart from the "
            "generated validation split and the two headlines averaged"
        ),
    )
    parser.add_argument(
        "--selection-events",
        default="",
        help=(
            "events the --extra-validation clips are judged on; empty means all "
            "eight. Match it to --extra-events or the model is scored against a "
            "target it was never shown"
        ),
    )
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help=(
            "cap the frames of any one training clip, so a long real clip does "
            "not set the batch width for every clip beside it; 0 leaves them whole"
        ),
    )
    parser.add_argument(
        "--extend-ends",
        type=float,
        default=0.0,
        metavar="P",
        help=(
            "probability of padding idle footage onto a clip's ends, to cover the "
            "loose framing of real clips; 0 leaves clips as drawn"
        ),
    )
    parser.add_argument(
        "--extra-events",
        default="",
        help=(
            "comma-separated events the --extra-train clips are trained against, "
            "e.g. address,top,mid_downswing,impact; empty means all eight"
        ),
    )
    parser.add_argument(
        "--holdout",
        type=Path,
        nargs="*",
        default=[],
        help="clip files scored on their own, never trained on and never split",
    )
    parser.add_argument("--test", action="store_true", help="also score the test split")
    args = parser.parse_args()

    setup = Setup(
        name=args.name,
        notes=args.notes,
        data=tuple(str(path) for path in args.data),
        extra_train=tuple(str(path) for path in args.extra_train),
        real_train=tuple(str(path) for path in args.real_train),
        extra_validation=tuple(str(path) for path in args.extra_validation),
        selection_events=tuple(name for name in args.selection_events.split(",") if name),
        max_frames=args.max_frames or None,
        extend_probability=args.extend_ends,
        extra_events=tuple(name for name in args.extra_events.split(",") if name),
        holdout=tuple(str(path) for path in args.holdout),
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
        edge_padding=args.edge_padding,
        init_from=args.init_from,
        validate_every=args.validate_every,
        extra_only=args.extra_only,
    )

    corpus = build_corpus(args.data)
    if args.limit_train:
        corpus = corpus.model_copy(update={"train": corpus.train[: args.limit_train]})
        setup.notes = f"{setup.notes} [first {args.limit_train} training clips]".strip()
    extra = load_samples(args.extra_train) if args.extra_train else []
    real = load_samples(args.real_train) if args.real_train else []
    if setup.extra_events:
        if not real:
            raise SystemExit("--extra-events given with no --real-train clips to apply it to")
        mask = supervised_mask(setup.extra_events)
        real = [sample.model_copy(update={"supervised_events": mask}) for sample in real]
    extra = extra + real
    print(
        f"{setup.name}: {corpus.describe()}"
        + (f", plus {len(extra) - len(real)} generated" if len(extra) > len(real) else "")
        + (f", plus {len(real)} real" if real else "")
    )
    real_validation = load_samples(args.extra_validation) if args.extra_validation else []
    if setup.selection_events:
        supervised_mask(setup.selection_events)  # Fail on a typo before training, not after.
    if real_validation:
        print(f"selecting on {len(real_validation)} real clips as well as the generated split")

    model, validation, real_final, meta = train(corpus, setup, args.out, extra, real_validation)
    print(f"\n{setup.name} validation: {validation.summary()}")
    print(validation.report())

    scores = {"validation": validation}
    if real_final is not None:
        print(f"\n{setup.name} real validation: {real_final.summary()}")
        print(real_final.report())
        scores["real_validation"] = real_final
    if args.test:
        test = evaluate(model, corpus.test)
        print(f"\n{setup.name} TEST: {test.summary()}")
        print(test.report())
        scores["test"] = test

    if args.holdout:
        held = load_samples(args.holdout)
        if not held:
            raise SystemExit(f"no clips in {[str(p) for p in args.holdout]}")
        holdout = evaluate(model, held)
        print(f"\n{setup.name} HOLDOUT ({len(held)} clips): {holdout.summary()}")
        print(holdout.report())
        scores["holdout"] = holdout

    record(args.log, setup.name, setup.notes or json.dumps(setup.__dict__, default=str), scores)
    print(
        f"\n{meta['parameters']:,} parameters, receptive field {meta['receptive_field']} "
        f"frames, {meta['minutes']:.1f} min"
    )


if __name__ == "__main__":
    main()
