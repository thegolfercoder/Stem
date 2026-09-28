"""The production network against simple baselines, on the frozen real holdout.

The rule this enforces: if a complicated model does not beat a simple one on
real held-out footage, the complicated one does not ship. Every method here is
fitted on the training split only, any choice between variants is made on the
validation split only, and the holdout is touched once, to report.

Methods, from simplest:

- `velocity_peak`: impact where the hands are fastest, the top where they were
  highest before that, address and finish where they were last and next at rest.
- `kinematic`: impact and top from the hands' fastest descent instead, which a
  fast follow-through cannot imitate; thresholds fitted on training clips.
- `dtw_template`: the clip warped onto labelled training clips, labels carried
  across the warp.
- `linear_classifier`: one temporal convolution over the same features, trained
  on the real training clips with the network's own targets and decoder.
- `network`: the shipped temporal convolutional network.
- `hybrid`: the network with some events snapped to nearby kinematic landmarks;
  which events and how far is chosen on validation.

Metrics are per clip and resampled by clip for intervals. `tempo_slope` is the
slope of log predicted tempo on log true tempo: 1.0 means a golfer's tempo moves
the reading by as much as it moves, and below 1.0 means readings are pulled
toward the middle, so a real change shows up smaller than it is.

    python scripts/benchmark_baselines.py --out docs/audit/baselines.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import load_model
from swingml.events import SwingEvent
from swingml.features import feature_dimension
from swingml.model import baselines as bl
from swingml.model.data import soft_targets
from swingml.model.decode import decode_events
from swingml.quantity import NoReading

CORE = [0, 3, 4, 5]
Clip = tuple[NDArray[np.float32], NDArray[np.int64], float]  # features, events, slow


def load(path: Path) -> list[Clip]:
    data = dict(np.load(path))
    offsets = np.concatenate(([0], np.cumsum(data["lengths"])))
    slow = data.get("slow", np.zeros(len(data["lengths"])))
    return [
        (data["features"][offsets[i] : offsets[i + 1]], data["events"][i], float(slow[i]))
        for i in range(len(data["lengths"]))
    ]


def tempo(positions: NDArray[np.float64]) -> float:
    down = float(positions[5] - positions[3])
    return float(positions[3] - positions[0]) / down if down > 0 else float("nan")


def per_clip(predicted: NDArray[np.float64] | None, truth: NDArray[np.int64]) -> dict[str, float]:
    if predicted is None:
        return {"refused": 1.0}
    absolute = np.abs(np.rint(predicted) - truth)
    true_tempo = tempo(truth.astype(np.float64))
    pred_tempo = tempo(predicted)
    return {
        "refused": 0.0,
        "w1_core": float((absolute[CORE] <= 1).mean()),
        "w2_core": float((absolute[CORE] <= 2).mean()),
        "w1_all": float((absolute <= 1).mean()),
        "tempo_err": abs(pred_tempo - true_tempo) / true_tempo,
        "log_true_tempo": float(np.log(true_tempo)),
        "log_pred_tempo": float(np.log(pred_tempo)) if pred_tempo > 0 else float("nan"),
        **{f"abs_{i}": float(absolute[i]) for i in range(8)},
    }


def summarise(rows: Sequence[dict[str, float]], resamples: int, seed: int) -> dict[str, object]:
    answered = [r for r in rows if r["refused"] == 0.0]
    n = len(answered)
    rng = np.random.default_rng(seed)

    def stat(
        values: NDArray[np.float64], fn: Callable[[NDArray[np.float64]], float]
    ) -> list[float]:
        point = fn(values)
        draws = [fn(values[rng.integers(0, len(values), len(values))]) for _ in range(resamples)]
        return [
            round(point, 4),
            round(float(np.percentile(draws, 2.5)), 4),
            round(float(np.percentile(draws, 97.5)), 4),
        ]

    column = {k: np.array([r[k] for r in answered]) for k in answered[0] if k != "refused"}
    return {
        "n_clips": len(rows),
        "n_answered": n,
        "within_1_core4": stat(column["w1_core"], lambda v: float(v.mean())),
        "within_2_core4": stat(column["w2_core"], lambda v: float(v.mean())),
        "within_1_all8": stat(column["w1_all"], lambda v: float(v.mean())),
        "tempo_median_rel_error": stat(column["tempo_err"], lambda v: float(np.median(v))),
        "median_abs_error_frames": [
            round(float(np.median(column[f"abs_{i}"])), 1) for i in range(8)
        ],
    }


def slope_interval(rows: Sequence[dict[str, float]], resamples: int, seed: int) -> list[float]:
    answered = [r for r in rows if r["refused"] == 0.0]
    pairs = np.array([[r["log_true_tempo"], r["log_pred_tempo"]] for r in answered])
    pairs = pairs[np.all(np.isfinite(pairs), axis=1)]
    rng = np.random.default_rng(seed)
    point = float(np.polyfit(pairs[:, 0], pairs[:, 1], 1)[0])
    draws = []
    for _ in range(resamples):
        sample = pairs[rng.integers(0, len(pairs), len(pairs))]
        draws.append(float(np.polyfit(sample[:, 0], sample[:, 1], 1)[0]))
    return [
        round(point, 4),
        round(float(np.percentile(draws, 2.5)), 4),
        round(float(np.percentile(draws, 97.5)), 4),
    ]


def paired(
    a: Sequence[dict[str, float]], b: Sequence[dict[str, float]], resamples: int, seed: int
) -> dict[str, list[float]]:
    """b minus a on clips both answered, with a 95% interval resampled by clip."""
    both = [(x, y) for x, y in zip(a, b, strict=True) if x["refused"] == 0 and y["refused"] == 0]
    rng = np.random.default_rng(seed)
    out: dict[str, list[float]] = {}
    for key, fn in (("w1_core", np.mean), ("tempo_err", np.median)):
        xa = np.array([x[key] for x, _ in both])
        xb = np.array([y[key] for _, y in both])
        point = float(fn(xb) - fn(xa))
        draws = []
        for _ in range(resamples):
            idx = rng.integers(0, len(both), len(both))
            draws.append(float(fn(xb[idx]) - fn(xa[idx])))
        out[key] = [
            round(point, 4),
            round(float(np.percentile(draws, 2.5)), 4),
            round(float(np.percentile(draws, 97.5)), 4),
        ]
    return out


# -- the methods ------------------------------------------------------------------


def velocity_peak(
    features: NDArray[np.float32], params: bl.KinematicParams
) -> NDArray[np.float64] | None:
    sig = bl.signals(features, params.smoothing)
    impact = int(np.argmax(sig.speed))
    if impact < 4:
        return None
    top = int(np.argmin(sig.height[: impact + 1]))
    address = bl._rest_before(sig.speed, top, params.rest_speed, params.rest_frames)
    finish = bl._rest_after(sig.speed, impact + 1, params.rest_speed, params.rest_frames)
    marks = np.full(8, np.nan)
    marks[[0, 3, 5, 7]] = [address, top, impact, finish]
    return bl._ordered(bl._fill_between(marks, params) - np.asarray(params.offsets), len(features))


def fit_velocity_offsets(clips: Sequence[Clip], params: bl.KinematicParams) -> bl.KinematicParams:
    residuals = []
    zeroed = params.model_copy(update={"offsets": (0.0,) * 8})
    for features, truth, _ in clips:
        predicted = velocity_peak(features, zeroed)
        if predicted is not None:
            residuals.append(predicted - truth)
    return zeroed.model_copy(
        update={"offsets": tuple(float(v) for v in np.median(np.stack(residuals), axis=0))}
    )


def train_linear(clips: Sequence[Clip], epochs: int, seed: int) -> torch.nn.Module:
    torch.manual_seed(seed)
    net = torch.nn.Conv1d(feature_dimension(), 9, kernel_size=31, padding=15)
    optimiser = torch.optim.Adam(net.parameters(), lr=3e-3, weight_decay=1e-4)
    data = [
        (torch.from_numpy(f).T.unsqueeze(0), torch.from_numpy(soft_targets(e, len(f), 2.0)))
        for f, e, _ in clips
    ]
    for _ in range(epochs):
        for index in torch.randperm(len(data)).tolist():
            x, target = data[index]
            logits = net(x)[0].T
            loss = -(target * torch.log_softmax(logits, dim=-1)).sum(dim=-1).mean()
            optimiser.zero_grad()
            loss.backward()
            optimiser.step()
    return net


def linear_predict(
    net: torch.nn.Module, features: NDArray[np.float32]
) -> NDArray[np.float64] | None:
    with torch.no_grad():
        logits = net(torch.from_numpy(features).T.unsqueeze(0))[0].T.numpy()
    decoded = decode_events(logits)
    if isinstance(decoded, NoReading):
        return None
    return np.array([decoded.position_of(e) for e in decoded_events()])


def decoded_events() -> list[SwingEvent]:
    return list(SwingEvent.ordered())


def network_predict(
    model: torch.nn.Module, features: NDArray[np.float32]
) -> NDArray[np.float64] | None:
    with torch.no_grad():
        logits = model(torch.from_numpy(features).unsqueeze(0))[0].numpy()
    decoded = decode_events(logits)
    if isinstance(decoded, NoReading):
        return None
    return np.array([decoded.position_of(e) for e in decoded_events()])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", type=Path, default=Path("out/golfdb/split/train.npz"))
    parser.add_argument("--validation", type=Path, default=Path("out/golfdb/split/validation.npz"))
    parser.add_argument("--holdout", type=Path, default=Path("out/golfdb/split/holdout.npz"))
    parser.add_argument("--model", type=Path, default=Path("swingml/data/swing_event_net.pt"))
    parser.add_argument("--resamples", type=int, default=2000)
    parser.add_argument("--templates", type=int, default=25)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    train, validation, holdout = load(args.train), load(args.validation), load(args.holdout)
    print(f"train {len(train)}, validation {len(validation)}, holdout {len(holdout)} real swings")
    started = time.time()

    kin = bl.fit_kinematic([(f, e) for f, e, _ in train])
    vel = fit_velocity_offsets(train, kin)
    templates = bl.build_templates([(f, e) for f, e, _ in train], args.templates, step=4, seed=0)
    linear = train_linear(train, epochs=12, seed=0)
    linear.eval()
    network = load_model(args.model)
    network.eval()
    print(f"fitted in {time.time() - started:.0f}s; kinematic params {kin.model_dump()}")

    def run(
        method: Callable[[NDArray[np.float32]], NDArray[np.float64] | None], clips: Sequence[Clip]
    ) -> list[dict[str, float]]:
        return [per_clip(method(f), e) for f, e, _ in clips]

    network_val = [network_predict(network, f) for f, _, _ in validation]
    network_hold = [network_predict(network, f) for f, _, _ in holdout]

    # The hybrid's variant is chosen on validation, never on the holdout.
    variants = [
        bl.RefineParams(events=events, window=window, kinematic=kin)
        for events in (
            (bl.TOP,),
            (bl.IMPACT,),
            (bl.TOP, bl.IMPACT),
            (bl.ADDRESS, bl.TOP, bl.IMPACT),
        )
        for window in (0.05, 0.1, 0.15)
    ]
    scored = []
    for params in variants:
        rows = [
            per_clip(None if n is None else bl.refine(f, n, params), e)
            for (f, e, _), n in zip(validation, network_val, strict=True)
        ]
        answered = [r for r in rows if r["refused"] == 0]
        cost = float(np.median([r["tempo_err"] for r in answered])) - float(
            np.mean([r["w1_core"] for r in answered])
        )
        scored.append((cost, params))
    network_rows_val = [
        per_clip(n, e) for (_, e, _), n in zip(validation, network_val, strict=True)
    ]
    network_cost = float(
        np.median([r["tempo_err"] for r in network_rows_val if r["refused"] == 0])
    ) - float(np.mean([r["w1_core"] for r in network_rows_val if r["refused"] == 0]))
    best_cost, best_hybrid = min(scored, key=lambda item: item[0])
    print(
        f"hybrid chosen on validation: {best_hybrid.events} window {best_hybrid.window} "
        f"(cost {best_cost:.4f} against the network's {network_cost:.4f})"
    )

    methods: dict[str, Callable[[Sequence[Clip]], list[dict[str, float]]]] = {
        "velocity_peak": lambda clips: run(lambda f: velocity_peak(f, vel), clips),
        "kinematic": lambda clips: run(lambda f: bl.kinematic(f, kin), clips),
        "dtw_template": lambda clips: run(lambda f: bl.template(f, templates), clips),
        "linear_classifier": lambda clips: run(lambda f: linear_predict(linear, f), clips),
    }
    report: dict[str, object] = {
        "splits": {
            "train": str(args.train),
            "validation": str(args.validation),
            "holdout": str(args.holdout),
        },
        "note": "fitted on train only, variants chosen on validation only, holdout reported once",
        "hybrid_choice": {"events": list(best_hybrid.events), "window": best_hybrid.window},
        "kinematic_params": kin.model_dump(),
        "results": {},
    }
    results: dict[str, object] = {}
    rows_by_method: dict[str, list[dict[str, float]]] = {}
    for name, method in methods.items():
        began = time.time()
        rows_by_method[name] = method(holdout)
        print(f"  {name}: {time.time() - began:.0f}s")
    rows_by_method["network"] = [
        per_clip(n, e) for (_, e, _), n in zip(holdout, network_hold, strict=True)
    ]
    rows_by_method["hybrid"] = [
        per_clip(None if n is None else bl.refine(f, n, best_hybrid), e)
        for (f, e, _), n in zip(holdout, network_hold, strict=True)
    ]
    slow = np.array([s for _, _, s in holdout]) > 0.5
    for name, rows in rows_by_method.items():
        entry = summarise(rows, args.resamples, seed=1)
        entry["tempo_slope"] = slope_interval(rows, args.resamples, seed=2)
        entry["real_time_only"] = summarise(
            [r for r, s in zip(rows, slow, strict=True) if not s], args.resamples, 3
        )
        entry["slow_motion_only"] = summarise(
            [r for r, s in zip(rows, slow, strict=True) if s], args.resamples, 4
        )
        entry["paired_vs_network"] = (
            paired(rows_by_method["network"], rows, args.resamples, seed=5)
            if name != "network"
            else None
        )
        results[name] = entry
        print(
            f"{name:18s} answered {entry['n_answered']:3d}/{entry['n_clips']}  "
            f"w1 core {entry['within_1_core4']}  tempo med {entry['tempo_median_rel_error']}  "
            f"slope {entry['tempo_slope']}"
        )
    report["results"] = results
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
