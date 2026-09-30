"""Tempo-sensitivity experiments, scored the way the application decides.

The shipped model reads tempo at 0.44 of its real spread (slope of log read tempo
on log true tempo on the frozen holdout). Each experiment here changes one thing
and is scored on a split named by its frozen manifest, through the application's
own decision: the decoder's confidence thresholds, the plausible-timing gate and
the slow-motion retry. Intervals resample golfer/video groups, never clips, and
every variant is also reported as a paired difference from the shipped pipeline
on the same resamples.

Choosing happens on the validation split and fitting on the calibration split.
The holdout is not read here: a candidate reaches it once, through
`python -m swingml.model.release_gate`.

    python scripts/tempo_experiments.py decode \\
        --manifest swingml/manifests/golfdb-validation-v1.json --out out/w1/decode.json
    python scripts/tempo_experiments.py address \\
        --train-manifest swingml/manifests/golfdb-train-v1.json \\
        --manifest swingml/manifests/golfdb-validation-v1.json --out out/w1/address.json
    python scripts/tempo_experiments.py decompress \\
        --fit-manifest swingml/manifests/golfdb-calibration-v1.json \\
        --manifest swingml/manifests/golfdb-validation-v1.json --out out/w1/decompress.json
    python scripts/tempo_experiments.py model --candidate out/exp/t1/swing_event_net.pt \\
        --manifest swingml/manifests/golfdb-validation-v1.json --out out/w1/t1.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, _implausible_timing
from swingml.dataset.manifest import load, refuse_holdout_manifest, verify
from swingml.events import NUM_EVENTS
from swingml.model.baselines import ADDRESS, TOP, _rest_before, signals
from swingml.model.calibration import conformal_quantile, load_calibration
from swingml.model.decode import decode_events, log_softmax
from swingml.model.release_gate import CORE, Clip, compress, load_any, logits_of, read_archive
from swingml.model.rgb import fuse, load_sidecar, reading
from swingml.quantity import NoReading

SHIPPED_MODEL = Path("swingml/data/swing_event_net.pt")
SHIPPED_CALIBRATION = Path("swingml/data/event_calibration.json")

Refine = Callable[[NDArray[np.float64], NDArray[np.int64]], NDArray[np.float64]]
Hook = Callable[[NDArray[np.float32], NDArray[np.float64]], NDArray[np.float64]]
TempoMap = Callable[[float], float]


# -- sub-frame placement ------------------------------------------------------------


def argmax_frames(scores: NDArray[np.float64], frames: NDArray[np.int64]) -> NDArray[np.float64]:
    """The decoded frame itself: no sub-frame refinement at all."""
    return frames.astype(np.float64)


def centre_of_mass(half_width: int, clamp: float) -> Refine:
    """Probability-weighted centre within `half_width` frames, moved at most `clamp`.

    `centre_of_mass(2, 1.0)` is exactly what the shipped decoder does.
    """

    def refine(scores: NDArray[np.float64], frames: NDArray[np.int64]) -> NDArray[np.float64]:
        probabilities = np.exp(scores)
        n = probabilities.shape[0]
        out = np.empty(len(frames), dtype=np.float64)
        for event, frame in enumerate(frames):
            lo, hi = max(0, int(frame) - half_width), min(n, int(frame) + half_width + 1)
            window = probabilities[lo:hi, event]
            total = float(window.sum())
            if total <= 0.0:
                out[event] = float(frame)
                continue
            centre = float((np.arange(lo, hi) * window).sum() / total)
            out[event] = float(np.clip(centre, frame - clamp, frame + clamp))
        return out

    return refine


def parabola(scores: NDArray[np.float64], frames: NDArray[np.int64]) -> NDArray[np.float64]:
    """Vertex of the parabola through the log-probabilities at the peak and its neighbours."""
    n = scores.shape[0]
    out = frames.astype(np.float64)
    for event, frame in enumerate(frames):
        f = int(frame)
        if 0 < f < n - 1:
            a, b, c = scores[f - 1, event], scores[f, event], scores[f + 1, event]
            curvature = a - 2.0 * b + c
            if curvature < 0.0:
                out[event] = f + float(np.clip(0.5 * (a - c) / curvature, -0.5, 0.5))
    return out


def between_neighbours(
    scores: NDArray[np.float64], frames: NDArray[np.int64]
) -> NDArray[np.float64]:
    """Expected position of each event over the frames between its decoded neighbours."""
    probabilities = np.exp(scores)
    n = probabilities.shape[0]
    out = np.empty(len(frames), dtype=np.float64)
    for event, frame in enumerate(frames):
        lo = int(frames[event - 1]) + 1 if event > 0 else 0
        hi = int(frames[event + 1]) if event < len(frames) - 1 else n
        window = probabilities[lo:hi, event]
        total = float(window.sum())
        out[event] = (
            float(frame) if total <= 0.0 else float((np.arange(lo, hi) * window).sum() / total)
        )
    return out


SHIPPED_REFINE = centre_of_mass(2, 1.0)


# -- the decision -------------------------------------------------------------------


@dataclass
class Variant:
    """One way of turning a clip into positions and a tempo."""

    name: str
    model: Any
    refine: Refine = SHIPPED_REFINE
    hook: Hook | None = None
    """Moves positions after refinement and before the timing gate, as the app would."""
    tempo_map: TempoMap | None = None
    """Applied to the tempo read from the positions (post-hoc correction)."""
    band: float = float("nan")
    """Relative half-width of the tempo band this variant would state."""
    notes: str = ""


@dataclass
class Reading:
    positions: NDArray[np.float64] | None
    confidence: NDArray[np.float64] | None
    slowed_by: float | None


@dataclass
class ClipCache:
    """Logits (and the features they came from) per playback factor, computed once."""

    clip: Clip
    features: dict[float, NDArray[np.float32]] = field(default_factory=dict)
    logits: dict[int, dict[float, NDArray[np.float32]]] = field(default_factory=dict)

    def at(self, model: Any, factor: float) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
        if factor not in self.features:
            self.features[factor] = (
                self.clip.features if factor == 1.0 else compress(self.clip.features, factor)
            )
        per_model = self.logits.setdefault(id(model), {})
        if factor not in per_model:
            per_model[factor] = logits_of(model, self.features[factor])
        return self.features[factor], per_model[factor]


def _read_once(
    features: NDArray[np.float32],
    logits: NDArray[np.float32],
    variant: Variant,
    config: AnalysisConfig,
) -> tuple[NDArray[np.float64], NDArray[np.float64]] | None:
    decoded = decode_events(logits, config.min_mean_confidence, config.min_core_confidence)
    if isinstance(decoded, NoReading):
        return None
    frames = np.asarray(decoded.frames, dtype=np.int64)
    scores = log_softmax(logits)[:, :NUM_EVENTS]
    positions = variant.refine(scores, frames)
    if variant.hook is not None:
        positions = variant.hook(features, positions)
    rate = config.features.canonical_rate_hz
    back = (positions[3] - positions[0]) / rate
    down = (positions[5] - positions[3]) / rate
    tempo = back / down if down > 0 else float("inf")
    if _implausible_timing(back, down, tempo, config) is not None:
        return None
    return positions, np.asarray(decoded.confidence, dtype=np.float64)


def decide(cache: ClipCache, variant: Variant, config: AnalysisConfig) -> Reading:
    """`release_gate.decide`, with the refinement, hook and model supplied by the variant."""
    features, logits = cache.at(variant.model, 1.0)
    first = _read_once(features, logits, variant, config)
    if first is not None:
        return Reading(first[0], first[1], None)
    n = cache.clip.features.shape[0]
    best: tuple[float, Reading] | None = None
    for factor in config.slow_motion_factors:
        features, logits = cache.at(variant.model, factor)
        attempt = _read_once(features, logits, variant, config)
        if attempt is None:
            continue
        positions, confidence = attempt
        core = float(np.exp(np.mean(np.log(np.maximum(confidence[list(CORE)], 1e-12)))))
        stretch = (n - 1) / max(logits.shape[0] - 1, 1)
        reading = Reading(positions * stretch, confidence, factor)
        if best is None or core > best[0]:
            best = (core, reading)
    return best[1] if best is not None else Reading(None, None, None)


# -- scoring ------------------------------------------------------------------------


def tempo_of(positions: NDArray[np.float64] | NDArray[np.int64]) -> float:
    down = float(positions[5] - positions[3])
    return float(positions[3] - positions[0]) / down if down > 0 else float("nan")


@dataclass
class Row:
    answered: bool
    slow: bool
    w1_core: float = float("nan")
    address_error: float = float("nan")
    true_tempo: float = float("nan")
    read_tempo: float = float("nan")
    core_confidence: float = float("nan")


def score(cache: ClipCache, variant: Variant, config: AnalysisConfig) -> Row:
    reading = decide(cache, variant, config)
    clip = cache.clip
    if reading.positions is None or reading.confidence is None:
        return Row(answered=False, slow=clip.slow)
    truth = clip.events.astype(np.float64)
    read = tempo_of(reading.positions)
    if variant.tempo_map is not None and np.isfinite(read) and read > 0:
        read = variant.tempo_map(read)
    return Row(
        answered=True,
        slow=clip.slow,
        w1_core=float((np.abs(np.rint(reading.positions) - truth)[list(CORE)] <= 1).mean()),
        address_error=float(reading.positions[ADDRESS] - truth[ADDRESS]),
        true_tempo=tempo_of(truth),
        read_tempo=read,
        core_confidence=float(
            np.exp(np.mean(np.log(np.maximum(reading.confidence[list(CORE)], 1e-12))))
        ),
    )


def _slope(rows: Sequence[Row]) -> float:
    pairs = np.array([[math.log(r.true_tempo), math.log(r.read_tempo)] for r in rows if _usable(r)])
    if len(pairs) < 3 or np.ptp(pairs[:, 0]) <= 0:
        return float("nan")
    return float(np.polyfit(pairs[:, 0], pairs[:, 1], 1)[0])


def _usable(row: Row) -> bool:
    return (
        row.answered
        and np.isfinite(row.true_tempo)
        and np.isfinite(row.read_tempo)
        and row.true_tempo > 0
        and row.read_tempo > 0
    )


def metrics(rows: Sequence[Row], band: float) -> dict[str, float]:
    """Every figure the release gate judges on, for one set of rows."""
    answered = [r for r in rows if r.answered]
    usable = [r for r in answered if _usable(r)]
    errors = np.array([abs(r.read_tempo - r.true_tempo) / r.true_tempo for r in usable])
    covered = errors <= band if np.isfinite(band) else np.array([], dtype=bool)
    confident = np.array([r.core_confidence >= 0.5 for r in usable])
    return {
        "answered": len(answered) / max(len(rows), 1),
        "within_1_core4": float(np.mean([r.w1_core for r in answered])) if answered else math.nan,
        "tempo_median_rel_error": float(np.median(errors)) if errors.size else math.nan,
        "tempo_slope": _slope(usable),
        "tempo_band_coverage": float(covered.mean()) if covered.size else math.nan,
        "false_confidence_rate": (
            float(np.mean(~covered & confident)) if covered.size else math.nan
        ),
        "address_median_abs_error": (
            float(np.median([abs(r.address_error) for r in answered])) if answered else math.nan
        ),
    }


def group_bootstrap(
    rows_by_variant: dict[str, list[Row]],
    bands: dict[str, float],
    groups: Sequence[str],
    control: str,
    resamples: int,
    seed: int,
) -> dict[str, Any]:
    """Point, 95% interval and paired difference from the control, resampling groups."""
    labels = np.asarray(groups)
    members = [np.nonzero(labels == g)[0] for g in sorted(set(labels.tolist()))]
    rng = np.random.default_rng(seed)
    draws: dict[str, list[dict[str, float]]] = {name: [] for name in rows_by_variant}
    for _ in range(resamples):
        chosen = rng.integers(0, len(members), len(members))
        index = np.concatenate([members[i] for i in chosen])
        for name, rows in rows_by_variant.items():
            draws[name].append(metrics([rows[i] for i in index], bands[name]))
    out: dict[str, Any] = {}
    control_point = metrics(rows_by_variant[control], bands[control])
    keys = list(control_point)
    for name, rows in rows_by_variant.items():
        point = metrics(rows, bands[name])
        entry: dict[str, Any] = {}
        for key in keys:
            values = np.array([d[key] for d in draws[name]])
            diffs = np.array(
                [d[key] - c[key] for d, c in zip(draws[name], draws[control], strict=True)]
            )
            entry[key] = {
                "value": _round(point[key]),
                "ci95": [
                    _round(np.nanpercentile(values, 2.5)),
                    _round(np.nanpercentile(values, 97.5)),
                ],
            }
            if name != control:
                entry[key]["minus_control"] = _round(point[key] - control_point[key])
                entry[key]["minus_control_ci95"] = [
                    _round(np.nanpercentile(diffs, 2.5)),
                    _round(np.nanpercentile(diffs, 97.5)),
                ]
        out[name] = entry
    return out


def _round(value: float) -> float:
    return round(float(value), 4) if np.isfinite(value) else float("nan")


# -- data ---------------------------------------------------------------------------


def load_split(manifest_path: Path, root: Path) -> tuple[list[Clip], list[str], str]:
    manifest = load(manifest_path)
    # Before anything is loaded: every subcommand's every manifest comes through here.
    refuse_holdout_manifest(manifest)
    archive = verify(manifest, root)
    clips = read_archive(archive)
    if len(clips) != len(manifest.groups):
        raise SystemExit(f"{manifest.name}: {len(clips)} clips but {len(manifest.groups)} groups")
    return clips, list(manifest.groups), manifest.name


def run_variants(
    clips: Sequence[Clip], variants: Sequence[Variant], config: AnalysisConfig
) -> dict[str, list[Row]]:
    caches = [ClipCache(clip) for clip in clips]
    return {v.name: [score(c, v, config) for c in caches] for v in variants}


def shipped_band(path: Path) -> float:
    table = load_calibration(path)
    return table.tempo.half_width_fraction if table.tempo is not None else float("nan")


# -- experiment 3: an address rule ----------------------------------------------------


@dataclass(frozen=True)
class AddressRule:
    """Address as the last frame the hands were at rest before the model's top."""

    smoothing: int
    rest_speed: float
    rest_frames: int
    offset: float = 0.0

    def place(self, features: NDArray[np.float32], top: float) -> float:
        sig = signals(features, self.smoothing)
        end = int(min(max(round(top), 0), len(sig.speed) - 1))
        return float(_rest_before(sig.speed, end, self.rest_speed, self.rest_frames)) - self.offset

    def hook(self) -> Hook:
        def move(
            features: NDArray[np.float32], positions: NDArray[np.float64]
        ) -> NDArray[np.float64]:
            out = positions.copy()
            placed = self.place(features, positions[TOP])
            # The rule can only replace address with a frame that keeps the order.
            if 0.0 <= placed < positions[1]:
                out[ADDRESS] = placed
            return out

        return move


def fit_address_rule(clips: Sequence[Clip]) -> tuple[AddressRule, dict[str, float]]:
    """Grid search on training clips against their labelled address, top taken from the label.

    The top is the labelled one here so the rule is judged on address alone; at
    serving time it runs from the model's top.
    """
    best: tuple[float, AddressRule] | None = None
    for smoothing in (3, 5, 9):
        for rest_speed in (0.04, 0.06, 0.09, 0.12, 0.16, 0.2):
            for rest_frames in (2, 4, 8):
                rule = AddressRule(smoothing, rest_speed, rest_frames)
                errors = [
                    rule.place(c.features, float(c.events[TOP])) - float(c.events[ADDRESS])
                    for c in clips
                ]
                cost = float(np.median(np.abs(errors)))
                if best is None or cost < best[0]:
                    best = (cost, rule)
    assert best is not None
    rule = best[1]
    signed = [
        rule.place(c.features, float(c.events[TOP])) - float(c.events[ADDRESS]) for c in clips
    ]
    offset = float(np.median(signed))
    fitted = AddressRule(rule.smoothing, rule.rest_speed, rule.rest_frames, offset)
    return fitted, {"train_median_abs_error_before_offset": best[0], "offset": offset}


def label_agreement(rule: AddressRule, clips: Sequence[Clip]) -> dict[str, float]:
    """How often the rule and the human address label agree, given the labelled top."""
    diffs = np.array(
        [rule.place(c.features, float(c.events[TOP])) - float(c.events[ADDRESS]) for c in clips]
    )
    absolute = np.abs(diffs)
    return {
        "n": float(len(diffs)),
        "median_signed": float(np.median(diffs)),
        "median_abs": float(np.median(absolute)),
        "within_2": float(np.mean(absolute <= 2)),
        "within_5": float(np.mean(absolute <= 5)),
        "within_10": float(np.mean(absolute <= 10)),
    }


# -- experiment 4: de-compression ------------------------------------------------------


@dataclass(frozen=True)
class Decompression:
    """Inverts log(read) = intercept + slope * log(true), fitted on held-out swings."""

    intercept: float
    slope: float

    def __call__(self, read: float) -> float:
        return math.exp((math.log(read) - self.intercept) / self.slope)


def fit_decompression(rows: Sequence[Row]) -> Decompression:
    usable = [r for r in rows if _usable(r)]
    x = np.log([r.true_tempo for r in usable])
    y = np.log([r.read_tempo for r in usable])
    slope, intercept = np.polyfit(x, y, 1)
    return Decompression(float(intercept), float(slope))


def cross_fitted_band(rows: Sequence[Row], groups: Sequence[str], coverage: float) -> float:
    """The band for de-compressed readings, each fold's errors from a map fitted on the other.

    Fitting the map and measuring its band on the same swings would make the band
    too narrow by exactly as much as the map fitted their noise.
    """
    names = sorted(set(groups))
    fold_of = {g: i % 2 for i, g in enumerate(names)}
    errors: list[float] = []
    for fold in (0, 1):
        fit_rows = [r for r, g in zip(rows, groups, strict=True) if fold_of[g] != fold]
        test_rows = [r for r, g in zip(rows, groups, strict=True) if fold_of[g] == fold]
        mapping = fit_decompression(fit_rows)
        for r in test_rows:
            if _usable(r):
                errors.append(abs(mapping(r.read_tempo) - r.true_tempo) / r.true_tempo)
    return conformal_quantile(np.asarray(errors), coverage)


# -- commands -----------------------------------------------------------------------


def _report(
    args: argparse.Namespace,
    split: str,
    variants: Sequence[Variant],
    rows: dict[str, list[Row]],
    groups: Sequence[str],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bands = {v.name: v.band for v in variants}
    control = variants[0].name
    table = group_bootstrap(rows, bands, groups, control, args.resamples, args.seed)
    report = {
        "split": split,
        "n_clips": len(groups),
        "n_groups": len(set(groups)),
        "control": control,
        "variants": {v.name: {"notes": v.notes, "band": _round(v.band)} for v in variants},
        "results": table,
        **(extra or {}),
    }
    print(f"{split}: {len(groups)} clips in {len(set(groups))} groups; control {control}")
    columns = (
        ("answered", "answered", 9),
        ("within_1_core4", "w1 core", 8),
        ("tempo_median_rel_error", "tempo err", 10),
        ("tempo_slope", "slope", 7),
        ("false_confidence_rate", "false conf", 11),
    )
    print(f"{'variant':24s}" + "".join(f" {label:>{width}s}" for _, label, width in columns))
    for name, entry in table.items():
        values = "".join(f" {entry[key]['value']:{width}.3f}" for key, _, width in columns)
        print(f"{name:24s}{values}")
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.out}")
    return report


def cmd_decode(args: argparse.Namespace) -> None:
    clips, groups, split = load_split(args.manifest, args.root)
    model = load_any(args.model)
    band = shipped_band(args.calibration)
    variants = [
        Variant("shipped_com2_clamp1", model, SHIPPED_REFINE, band=band, notes="shipped decoder"),
        Variant("argmax_frames", model, argmax_frames, band=band, notes="no sub-frame step"),
        Variant("com4_clamp2", model, centre_of_mass(4, 2.0), band=band, notes="wider window"),
        Variant("parabola", model, parabola, band=band, notes="log-probability vertex"),
        Variant("between_neighbours", model, between_neighbours, band=band, notes="soft-argmax"),
    ]
    rows = run_variants(clips, variants, AnalysisConfig())
    _report(args, split, variants, rows, groups)


def cmd_address(args: argparse.Namespace) -> None:
    train, _, train_name = load_split(args.train_manifest, args.root)
    clips, groups, split = load_split(args.manifest, args.root)
    rule, fit = fit_address_rule(train)
    agreement = {
        "train": label_agreement(rule, train),
        split: label_agreement(rule, clips),
    }
    print(f"address rule fitted on {train_name}: {rule} ({fit})")
    for name, values in agreement.items():
        print(f"  agreement with the human address label on {name}: {values}")
    model = load_any(args.model)
    band = shipped_band(args.calibration)
    variants = [
        Variant("shipped", model, SHIPPED_REFINE, band=band, notes="shipped decoder"),
        Variant(
            "address_rule",
            model,
            SHIPPED_REFINE,
            hook=rule.hook(),
            band=band,
            notes=f"address from hand rest before the model's top: {rule}",
        ),
    ]
    rows = run_variants(clips, variants, AnalysisConfig())
    _report(
        args,
        split,
        variants,
        rows,
        groups,
        {"rule": rule.__dict__, "fit": fit, "label_agreement": agreement},
    )


def cmd_decompress(args: argparse.Namespace) -> None:
    fit_clips, fit_groups, fit_name = load_split(args.fit_manifest, args.root)
    clips, groups, split = load_split(args.manifest, args.root)
    model = load_any(args.model)
    config = AnalysisConfig()
    band = shipped_band(args.calibration)
    shipped = Variant("shipped", model, SHIPPED_REFINE, band=band, notes="shipped decoder")
    fit_rows = run_variants(fit_clips, [shipped], config)["shipped"]
    mapping = fit_decompression(fit_rows)
    new_band = cross_fitted_band(fit_rows, fit_groups, coverage=0.8)
    print(
        f"fitted on {fit_name}: log read = {mapping.intercept:.3f} + {mapping.slope:.3f} log true;"
        f" cross-fitted 80% band +/-{100 * new_band:.1f}% (shipped +/-{100 * band:.1f}%)"
    )
    variants = [
        shipped,
        Variant(
            "decompressed",
            model,
            SHIPPED_REFINE,
            tempo_map=mapping,
            band=new_band,
            notes=f"inverse of the {fit_name} fit, band cross-fitted on {fit_name}",
        ),
    ]
    rows = run_variants(clips, variants, config)
    _report(
        args,
        split,
        variants,
        rows,
        groups,
        {
            "fit": {
                "manifest": fit_name,
                "intercept": mapping.intercept,
                "slope": mapping.slope,
                "band": new_band,
            }
        },
    )


def with_images(clips: list[Clip], split_archive: Path, sidecar_path: Path) -> list[Clip]:
    """The verified clips with image columns appended (`swingml.model.rgb`)."""
    ids = [int(v) for v in np.load(split_archive)["seeds"]]
    sidecar = load_sidecar(sidecar_path)
    return [
        clip.model_copy(update={"features": fuse(clip.features, clip_id, sidecar)})
        for clip, clip_id in zip(clips, ids, strict=True)
    ]


# -- W3: tempo bands that depend on the model's confidence ---------------------------


def relative_errors(rows: Sequence[Row]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Relative tempo error and core confidence of every answered swing."""
    kept = [r for r in rows if r.answered and np.isfinite(r.read_tempo) and r.true_tempo > 0]
    error = np.array([abs(r.read_tempo - r.true_tempo) / r.true_tempo for r in kept])
    confidence = np.array([r.core_confidence for r in kept])
    return error, confidence


def banded(
    confidence: NDArray[np.float64], edges: Sequence[float], widths: Sequence[float]
) -> NDArray[np.float64]:
    return np.asarray([widths[int(np.searchsorted(edges, c, side="right"))] for c in confidence])


SIGNALS = ("confidence", "spread", "short_downswing")


def signals_of(cache: ClipCache, variant: Variant, config: AnalysisConfig) -> dict[str, float]:
    """Candidate per-swing uncertainty signals, from the same read the app makes.

    All three are oriented so that higher means less sure:

    - `confidence`: the core confidence the app shows today, negated.
    - `spread`: how spread out the model's probability is around address, the top
      and impact (within 15 frames of each), carried through to the tempo ratio.
    - `short_downswing`: one over the downswing's length in frames; a frame of
      error is a larger share of a short downswing.
    """
    reading = decide(cache, variant, config)
    if reading.positions is None or reading.confidence is None:
        return {}
    factor = reading.slowed_by or 1.0
    _, logits = cache.at(variant.model, factor)
    n = cache.clip.features.shape[0]
    stretch = (n - 1) / max(logits.shape[0] - 1, 1) if reading.slowed_by else 1.0
    grid = reading.positions / stretch
    probabilities = np.exp(log_softmax(logits))
    frames = np.arange(logits.shape[0], dtype=np.float64)

    def sd(event: int) -> float:
        window = np.abs(frames - grid[event]) <= 15
        weights = probabilities[window, event]
        if weights.sum() <= 0:
            return float("nan")
        weights = weights / weights.sum()
        mean = float((frames[window] * weights).sum())
        return float(np.sqrt(((frames[window] - mean) ** 2 * weights).sum()))

    back = grid[3] - grid[0]
    down = grid[5] - grid[3]
    core = float(np.exp(np.mean(np.log(np.maximum(reading.confidence[list(CORE)], 1e-12)))))
    return {
        "confidence": -core,
        "spread": float(np.hypot(sd(0), sd(3)) / back + np.hypot(sd(3), sd(5)) / down),
        "short_downswing": float(1.0 / down) if down > 0 else float("nan"),
    }


def rank_correlation(a: NDArray[np.float64], b: NDArray[np.float64]) -> float:
    finite = np.isfinite(a) & np.isfinite(b)
    ranks_a = np.argsort(np.argsort(a[finite]))
    ranks_b = np.argsort(np.argsort(b[finite]))
    return float(np.corrcoef(ranks_a, ranks_b)[0, 1])


def cmd_bands(args: argparse.Namespace) -> None:
    """Fit an 80% tempo band per uncertainty level on one split; check it on another.

    The shipped band is one number, +/-27%, for every swing. If some per-swing
    signal says how wrong a reading is likely to be, a band per level of it should
    hold its 80% coverage within each level and be narrower where the signal says
    sure. Which signal is decided on the fitting split, by how well it ranks that
    split's errors, before the checking split is read. If no signal ranks the
    errors, the per-level widths come out alike and the single band stays.
    """
    fit_clips, _, fit_name = load_split(args.fit_manifest, args.root)
    clips, groups, split = load_split(args.manifest, args.root)
    model = load_any(args.model)
    config = AnalysisConfig()
    shipped = Variant("shipped", model, SHIPPED_REFINE, band=shipped_band(args.calibration))

    def measured(
        some: Sequence[Clip],
    ) -> tuple[NDArray[np.float64], NDArray[np.float64], dict[str, NDArray[np.float64]], list[int]]:
        caches = [ClipCache(c) for c in some]
        rows = [score(c, shipped, config) for c in caches]
        found = [signals_of(c, shipped, config) for c in caches]
        kept = [
            i
            for i, r in enumerate(rows)
            if r.answered and np.isfinite(r.read_tempo) and r.true_tempo > 0 and found[i]
        ]
        error = np.array(
            [abs(rows[i].read_tempo - rows[i].true_tempo) / rows[i].true_tempo for i in kept]
        )
        claimed = np.array([rows[i].core_confidence for i in kept])
        table = {name: np.array([found[i][name] for i in kept]) for name in SIGNALS}
        return error, claimed, table, kept

    fit_error, _, fit_table, _ = measured(fit_clips)
    ranking = {name: rank_correlation(fit_table[name], fit_error) for name in SIGNALS}
    signal = args.signal or max(ranking, key=lambda k: ranking[k])
    print(
        f"rank correlation with relative tempo error on {fit_name}: "
        + ", ".join(f"{k} {v:+.3f}" for k, v in ranking.items())
        + f"; using {signal}"
    )
    fit_signal = fit_table[signal]
    edges = [float(q) for q in np.quantile(fit_signal, np.linspace(0, 1, args.levels + 1)[1:-1])]
    level_of_fit = np.searchsorted(edges, fit_signal, side="right")
    widths = [conformal_quantile(fit_error[level_of_fit == k], 0.8) for k in range(args.levels)]
    single = conformal_quantile(fit_error, 0.8)
    print(f"fitted on {fit_name} ({len(fit_error)} answered swings), 80% bands by {signal}:")
    for k in range(args.levels):
        lo = "min" if k == 0 else f"{edges[k - 1]:.4f}"
        hi = "max" if k == args.levels - 1 else f"{edges[k]:.4f}"
        n = int((level_of_fit == k).sum())
        print(f"  {lo:>7} to {hi:<7}  n={n:3d}  +/-{100 * widths[k]:.1f}%")
    print(f"  one band for all: +/-{100 * single:.1f}%")

    error, claimed, table, kept = measured(clips)
    value = table[signal]
    labels = np.asarray([groups[i] for i in kept])
    per_swing = banded(value, edges, widths)
    level = np.searchsorted(edges, value, side="right")
    members = [np.nonzero(labels == g)[0] for g in sorted(set(labels.tolist()))]
    rng = np.random.default_rng(args.seed)

    def summary(idx: NDArray[np.int64]) -> dict[str, float]:
        out = {
            "coverage_single": float(np.mean(error[idx] <= single)),
            "coverage_banded": float(np.mean(error[idx] <= per_swing[idx])),
            "median_width_banded": float(np.median(per_swing[idx])),
            # Outside its band while the app claims confidence (the release gate's rule).
            "false_confidence_single": float(
                np.mean((error[idx] > single) & (claimed[idx] >= 0.5))
            ),
            "false_confidence_banded": float(
                np.mean((error[idx] > per_swing[idx]) & (claimed[idx] >= 0.5))
            ),
            "rank_correlation": rank_correlation(value[idx], error[idx]),
        }
        for k in range(args.levels):
            in_level = idx[level[idx] == k]
            out[f"coverage_level_{k}"] = (
                float(np.mean(error[in_level] <= widths[k])) if len(in_level) else float("nan")
            )
        return out

    point = summary(np.arange(len(error)))
    draws = []
    for _ in range(args.resamples):
        chosen = rng.integers(0, len(members), len(members))
        draws.append(summary(np.concatenate([members[i] for i in chosen])))
    result: dict[str, Any] = {
        "split": split,
        "fit": fit_name,
        "signal": signal,
        "ranking_on_fit": ranking,
        "edges": edges,
        "widths": widths,
        "single": single,
        "metrics": {},
    }
    print(f"\n{split}: {len(error)} answered swings in {len(members)} groups")
    for key, number in point.items():
        values = np.array([d[key] for d in draws], dtype=np.float64)
        values = values[np.isfinite(values)]
        low, high = np.percentile(values, [2.5, 97.5]) if len(values) else (np.nan, np.nan)
        result["metrics"][key] = {"value": number, "ci95": [float(low), float(high)]}
        print(f"  {key:26s} {number:.3f}  [{low:.3f}, {high:.3f}]")
    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2) + "\n")
        print(f"wrote {args.out}")


def cmd_model(args: argparse.Namespace) -> None:
    clips, groups, split = load_split(args.manifest, args.root)
    if args.rgb is not None:
        clips = with_images(clips, args.root / load(args.manifest).archive, args.rgb)
    width = clips[0].features.shape[1]
    band = shipped_band(args.calibration)
    variants = [
        Variant("shipped", reading(load_any(args.model), width), band=band, notes=str(args.model))
    ]
    for path in args.candidate:
        variants.append(
            Variant(
                path.parent.name or path.stem,
                reading(load_any(path), width),
                band=band,
                notes=str(path),
            )
        )
    rows = run_variants(clips, variants, AnalysisConfig())
    _report(args, split, variants, rows, groups)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)

    def common(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("--manifest", type=Path, required=True)
        sub.add_argument("--model", type=Path, default=SHIPPED_MODEL)
        sub.add_argument("--calibration", type=Path, default=SHIPPED_CALIBRATION)
        sub.add_argument("--root", type=Path, default=Path("."))
        sub.add_argument("--resamples", type=int, default=1000)
        sub.add_argument("--seed", type=int, default=0)
        sub.add_argument("--out", type=Path, default=None)

    decode = commands.add_parser("decode", help="experiment 1: sub-frame placement")
    common(decode)
    address = commands.add_parser("address", help="experiment 3: an address rule")
    common(address)
    address.add_argument("--train-manifest", type=Path, required=True)
    decompress = commands.add_parser("decompress", help="experiment 4: post-hoc de-compression")
    common(decompress)
    decompress.add_argument("--fit-manifest", type=Path, required=True)
    bands = commands.add_parser("bands", help="W3: tempo bands by confidence level")
    common(bands)
    bands.add_argument("--fit-manifest", type=Path, required=True)
    bands.add_argument("--levels", type=int, default=3)
    bands.add_argument(
        "--signal",
        choices=SIGNALS,
        default=None,
        help="default: whichever ranks the fitting split's errors best",
    )
    model = commands.add_parser("model", help="experiment 2: candidate weights against shipped")
    common(model)
    model.add_argument("--candidate", type=Path, nargs="+", required=True)
    model.add_argument(
        "--rgb",
        type=Path,
        default=None,
        help="image-feature sidecar for the manifest's split; pose-only models read past it",
    )

    args = parser.parse_args(argv)
    {
        "decode": cmd_decode,
        "address": cmd_address,
        "decompress": cmd_decompress,
        "model": cmd_model,
        "bands": cmd_bands,
    }[args.command](args)


if __name__ == "__main__":
    main()
