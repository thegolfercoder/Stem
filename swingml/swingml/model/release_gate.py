"""Whether a candidate event model may replace the shipped one. Fails loudly.

    python -m swingml.model.release_gate \\
        --candidate path/to/candidate.pt --candidate-calibration path/to/bands.json \\
        --baseline swingml/data/swing_event_net.pt \\
        --baseline-calibration swingml/data/event_calibration.json \\
        --test-manifest swingml/manifests/golfdb-holdout-v1.json \\
        --calibration-manifest swingml/manifests/golfdb-calibration-v1.json \\
        --model-card docs/ml/model-card.md --report out/release/report.json

Every number is measured through the same decision the application makes: the
decoder's confidence thresholds, the plausible-timing gate, and the slow-motion
retry, on features re-read from frozen archives whose bytes must match their
manifests. The gates, all of which must pass:

1. **Evidence present.** Candidate, baseline, both calibrations (each measured
   through its own weights), both manifests and a model card with the required
   sections. Anything missing exits with status 2 before a number is computed.
2. **No leakage.** The test and calibration manifests share no clip and no
   golfer/video group (nor does a training manifest, when one is given).
3. **Better on frozen real golfers.** Paired bootstrap over test clips: not worse
   on either within-one-frame (core events) or tempo error beyond a small margin,
   and better on at least one with an interval that excludes zero.
4. **No real-fixture regression.** Every labelled event of the phone fixture
   within its tolerance.
5. **Uncertainty coverage.** Tempo and event bands contain the truth on the test
   clips at no less than their claimed coverage minus five points.
6. **False confidence does not rise.** The share of answered clips whose tempo
   falls outside its own band while the model's core confidence is 0.5 or more.
7. **Refusals do not get worse.** Real swings answered, and no-swing stretches cut
   from the same videos accepted, each within one point of the baseline.
8. **Subgroups.** No camera view, speed or handedness group of 30 or more clips
   loses more than five points within one frame.
9. **Sensitivity.** The slope of log read tempo on log true tempo does not fall by
   more than 0.05: a model that pulls every golfer toward the middle is a model
   that cannot show a golfer changing.
10. **Phone swings** (`--phone-manifest`, a `phone-holdout` frozen by
    `scripts/make_phone_test_set.py`). Reported in a section of their own, never
    pooled with GolfDB, with intervals that resample golfers. They gate, with the
    non-inferiority rule of gate 3, only once the set holds `PHONE_MIN_SWINGS`
    swings from `PHONE_MIN_GOLFERS` golfers. Below that they are reported and
    not gated, and without the manifest the report says "no phone evidence",
    which is not a pass.

Once per candidate. Every run that names a holdout manifest (`golfdb-holdout-*`,
`phone-holdout-*`) appends a record to `docs/audit/holdout-reads.jsonl`: the
candidate's and baseline's weights and rule overrides, a hash of the decision
code, the commit, the outcome, and which holdouts were actually read. A run whose
candidate weights were already scored on one of its holdouts exits 2 before
reading anything, unless `--owner-approved-reread` names the owner's recorded
decision. Keyed on the weights rather than the whole rule, so a sweep over
`--candidate-config` thresholds on one set of weights is refused too. It does not
stop someone editing the log; the log is committed, so that shows in review.
Reports on a holdout carry aggregates only, never a clip's id or reading, so a
gate failure cannot become design input.

Exit status: 0 all pass, 1 a gate failed, 2 evidence missing or a re-read refused.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from swingml.analysis import (
    AnalysisConfig,
    _implausible_timing,
    analyse_pose_sequence,
    core_confidence,
    load_event_model,
    model_fingerprint,
)
from swingml.dataset.manifest import (
    HOLDOUT_SPLITS,
    Manifest,
    ManifestError,
    guard_archive,
    holdout_access,
    leaks,
    load,
    verify,
)
from swingml.events import SwingEvent
from swingml.features import feature_layout
from swingml.model.calibration import ErrorBand, ModelCalibration, load_calibration
from swingml.model.decode import decode_events
from swingml.model.ensemble import SERVING_TIME_WARPS, EnsembleConfig, SwingEventEnsemble
from swingml.quantity import NoReading

CORE = (0, 3, 4, 5)
MODEL_CARD_SECTIONS = (
    "Intended use",
    "Training data",
    "Evaluation",
    "Known failure modes",
    "Rollback",
)
NON_INFERIORITY_W1 = 0.02
NON_INFERIORITY_TEMPO = 0.01
COVERAGE_SLACK = 0.05
SUBGROUP_MIN = 30
SUBGROUP_DROP = 0.05
SLOPE_DROP = 0.05
# docs/ml/evaluation-plan.md: 150+ labelled phone swings from 30+ golfers. Fewer
# golfers make the golfer-resampled interval wider than any margin worth gating on.
PHONE_MIN_SWINGS = 150
PHONE_MIN_GOLFERS = 30
READ_LOG = Path(__file__).resolve().parents[3] / "docs" / "audit" / "holdout-reads.jsonl"
"""Every release-gate run on a holdout, appended to, never rewritten (#55)."""


class MissingEvidenceError(RuntimeError):
    """Something the gate needs does not exist. Status 2, never a pass."""


class Decision(BaseModel):
    """What the application would do with one clip."""

    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    positions: NDArray[np.float64] | None
    confidence: tuple[float, ...] | None
    slowed_by: float | None
    reason: str | None
    backswing_s: float | None = None  # whole frames on the grid, as the app's check uses


def load_any(path: Path) -> Any:
    if not path.exists():
        raise MissingEvidenceError(f"model {path} does not exist")
    if path.is_dir():
        members = sorted(path.glob("member_*.pt")) or sorted(path.glob("*.pt"))
        if not members:
            raise MissingEvidenceError(f"no checkpoints in {path}")
        return SwingEventEnsemble.load(members, EnsembleConfig(time_warps=SERVING_TIME_WARPS))
    return load_event_model(path)


def logits_of(model: Any, features: NDArray[np.float32]) -> NDArray[np.float32]:
    if hasattr(model, "logits"):
        return np.asarray(model.logits(features), dtype=np.float32)
    import torch

    model.eval()
    with torch.no_grad():
        return np.asarray(model(torch.from_numpy(features).unsqueeze(0))[0].numpy())


def compress(features: NDArray[np.float32], factor: float) -> NDArray[np.float32]:
    """The same frames read as if played `factor` times faster, speeds rescaled to match."""
    n = features.shape[0]
    target = max(16, round(n / factor))
    source = np.linspace(0.0, n - 1, target)
    lower = np.floor(source).astype(int)
    upper = np.minimum(lower + 1, n - 1)
    blend = (source - lower).astype(np.float32)[:, None]
    out = features[lower] * (1.0 - blend) + features[upper] * blend
    for start, end in feature_layout().per_second_spans:
        out[:, start:end] *= np.float32(factor)
    return np.asarray(out, dtype=np.float32)


def _decide_once(model: Any, features: NDArray[np.float32], config: AnalysisConfig) -> Decision:
    decoded = decode_events(
        logits_of(model, features), config.min_mean_confidence, config.min_core_confidence
    )
    if isinstance(decoded, NoReading):
        return Decision(positions=None, confidence=None, slowed_by=None, reason=decoded.reason)
    positions = np.array([decoded.position_of(e) for e in SwingEvent.ordered()])
    rate = config.features.canonical_rate_hz
    back = (positions[3] - positions[0]) / rate
    down = (positions[5] - positions[3]) / rate
    tempo = back / down if down > 0 else float("inf")
    implausible = _implausible_timing(back, down, tempo, config)
    if implausible is not None:
        return Decision(positions=None, confidence=None, slowed_by=None, reason=implausible)
    return Decision(
        positions=positions,
        confidence=tuple(decoded.confidence),
        slowed_by=None,
        reason=None,
        backswing_s=decoded.duration_frames(SwingEvent.ADDRESS, SwingEvent.TOP) / rate,
    )


def decide(model: Any, features: NDArray[np.float32], config: AnalysisConfig) -> Decision:
    """The application's decision on already-extracted features, slow-motion retry included."""
    first = _decide_once(model, features, config)
    to_beat = None
    if first.positions is not None:
        # The same check as analyse_pose_sequence: an answered clip with a long
        # backswing is also read as slow motion (#32).
        bound = config.slow_motion_check_backswing_s
        if bound is None or first.backswing_s is None or first.backswing_s <= bound:
            return first
        if not config.slow_motion_check_rereads:
            # A fired check keeps the recorded-speed events and tempo and withholds
            # only durations and bands (#49), none of which the gate reads from a
            # decision: the decision is the recorded-speed one, by construction.
            return first
        assert first.confidence is not None
        to_beat = core_confidence(first.confidence) + config.slow_motion_margin
    best: tuple[float, Decision] | None = None
    for factor in config.slow_motion_factors:
        compressed = compress(features, factor)
        attempt = _decide_once(model, compressed, config)
        if attempt.positions is None or attempt.confidence is None:
            continue
        core = core_confidence(attempt.confidence)
        stretch = (features.shape[0] - 1) / max(compressed.shape[0] - 1, 1)
        rescaled = Decision(
            positions=attempt.positions * stretch,
            confidence=attempt.confidence,
            slowed_by=factor,
            reason=None,
        )
        if best is None or core > best[0]:
            best = (core, rescaled)
    if best is None or (to_beat is not None and best[0] <= to_beat):
        return first
    return best[1]


# -- data -------------------------------------------------------------------------


class Clip(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    features: NDArray[np.float32]
    events: NDArray[np.int64]
    azimuth_deg: float
    slow: bool
    left_handed: bool
    clip_id: int = -1


def read_archive(path: Path) -> list[Clip]:
    guard_archive(path)
    data = dict(np.load(path))
    offsets = np.concatenate(([0], np.cumsum(data["lengths"])))
    slow = data.get("slow", np.zeros(len(data["lengths"])))
    return [
        Clip(
            features=data["features"][offsets[i] : offsets[i + 1]],
            events=data["events"][i],
            azimuth_deg=float(data["azimuth_deg"][i]),
            slow=bool(slow[i] > 0.5),
            left_handed=bool(data["left_handed"][i] > 0.5),
            clip_id=int(data["seeds"][i]) if "seeds" in data else i,
        )
        for i in range(len(data["lengths"]))
    ]


def no_swing_stretches(clips: Sequence[Clip]) -> list[NDArray[np.float32]]:
    """Stretches of the same videos with no complete swing in them.

    Standing over the ball before address, walking off after the finish, and the
    swing's first half cut off after the top. A model that accepts these is one
    that returns a tempo for a clip of somebody standing still.
    """
    out: list[NDArray[np.float32]] = []
    for clip in clips:
        f, ev = clip.features, clip.events
        address, top, finish = int(ev[0]), int(ev[3]), int(ev[-1])
        if address >= 90:
            out.append(f[: address - 10])
        if f.shape[0] - finish >= 90:
            out.append(f[finish + 10 :])
        if top - address >= 40:
            out.append(f[max(0, address - 30) : top + 5])
    return out


# -- scoring ----------------------------------------------------------------------


def tempo_of(positions: NDArray[np.float64] | NDArray[np.int64]) -> float:
    down = float(positions[5] - positions[3])
    return float(positions[3] - positions[0]) / down if down > 0 else float("nan")


class Scored(BaseModel):
    model_config = ConfigDict(frozen=True)

    answered: bool
    w1_core: float = float("nan")
    tempo_error: float = float("nan")
    log_true_tempo: float = float("nan")
    log_read_tempo: float = float("nan")
    tempo_covered: bool | None = None
    events_covered: float | None = None
    falsely_confident: bool = False


def score_clip(clip: Clip, decision: Decision, calibration: ModelCalibration) -> Scored:
    if decision.positions is None or decision.confidence is None:
        return Scored(answered=False)
    truth = clip.events
    positions = decision.positions
    absolute = np.abs(np.rint(positions) - truth)
    true_tempo = tempo_of(truth)
    read_tempo = tempo_of(positions)
    tempo_covered: bool | None = None
    if calibration.tempo is not None:
        low, high = calibration.tempo.interval(read_tempo)
        tempo_covered = bool(low <= true_tempo <= high)
    events_covered: float | None = None
    if decision.slowed_by is None:
        bands = calibration.events.bands(decision.confidence)
        hits = [
            abs(positions[i] - truth[i]) <= band.half_width_frames
            for i, band in enumerate(bands)
            if isinstance(band, ErrorBand)
        ]
        events_covered = float(np.mean(hits)) if hits else None
    core_confidence = float(
        np.exp(np.mean(np.log(np.maximum([decision.confidence[i] for i in CORE], 1e-12))))
    )
    return Scored(
        answered=True,
        w1_core=float((absolute[list(CORE)] <= 1).mean()),
        tempo_error=abs(read_tempo - true_tempo) / true_tempo,
        log_true_tempo=float(np.log(true_tempo)),
        log_read_tempo=float(np.log(read_tempo)) if read_tempo > 0 else float("nan"),
        tempo_covered=tempo_covered,
        events_covered=events_covered,
        falsely_confident=bool(tempo_covered is False and core_confidence >= 0.5),
    )


def slope(rows: Sequence[Scored]) -> float:
    pairs = np.array([[r.log_true_tempo, r.log_read_tempo] for r in rows if r.answered])
    pairs = pairs[np.all(np.isfinite(pairs), axis=1)]
    return float(np.polyfit(pairs[:, 0], pairs[:, 1], 1)[0]) if len(pairs) > 2 else float("nan")


def summary(rows: Sequence[Scored], accepted_negatives: float) -> dict[str, float]:
    answered = [r for r in rows if r.answered]
    tempo_cov = [r.tempo_covered for r in answered if r.tempo_covered is not None]
    event_cov = [r.events_covered for r in answered if r.events_covered is not None]
    return {
        "n": float(len(rows)),
        "answered": len(answered) / max(len(rows), 1),
        "within_1_core4": float(np.mean([r.w1_core for r in answered])),
        "tempo_median_rel_error": float(np.median([r.tempo_error for r in answered])),
        "tempo_band_coverage": float(np.mean(tempo_cov)) if tempo_cov else float("nan"),
        "event_band_coverage": float(np.mean(event_cov)) if event_cov else float("nan"),
        "false_confidence_rate": float(np.mean([r.falsely_confident for r in answered])),
        "no_swing_accepted": accepted_negatives,
        "tempo_slope": slope(rows),
    }


def paired_difference(
    base: Sequence[Scored],
    cand: Sequence[Scored],
    groups: Sequence[str],
    pick: Callable[[Scored], float],
    reduce: Callable[[NDArray[np.float64]], float],
    resamples: int,
    seed: int,
) -> tuple[float, float, float]:
    """Candidate minus baseline, with a 95% interval from resampling whole groups.

    Clips of one golfer from one video are not independent draws: resampling them
    one at a time makes an interval look tighter than the evidence is, by as much
    as the clips within a group agree with each other.
    """
    kept = [
        (b, c, g) for b, c, g in zip(base, cand, groups, strict=True) if b.answered and c.answered
    ]
    xb = np.array([pick(b) for b, _, _ in kept])
    xc = np.array([pick(c) for _, c, _ in kept])
    labels = np.array([g for _, _, g in kept])
    members = [np.nonzero(labels == g)[0] for g in sorted(set(labels.tolist()))]
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(resamples):
        chosen = rng.integers(0, len(members), len(members))
        idx = np.concatenate([members[i] for i in chosen])
        draws.append(reduce(xc[idx]) - reduce(xb[idx]))
    return (
        reduce(xc) - reduce(xb),
        float(np.percentile(draws, 2.5)),
        float(np.percentile(draws, 97.5)),
    )


# -- the fixture ------------------------------------------------------------------


def fixture_check(
    model: Any, fixture: Path, config: AnalysisConfig | None = None
) -> dict[str, Any]:
    from swingml.pose.base import PoseSequence
    from swingml.skeleton import Handedness

    landmarks, truth_file = fixture.with_suffix(".npz"), fixture.with_suffix(".json")
    if not landmarks.is_file() or not truth_file.is_file():
        raise MissingEvidenceError(f"real fixture {fixture} (.npz and .json) is missing")
    data = np.load(landmarks)
    sequence = PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )
    truth = json.loads(truth_file.read_text())
    config = (config or AnalysisConfig()).model_copy(update={"handedness": Handedness.RIGHT})
    analysis = analyse_pose_sequence(sequence, model, config)
    if isinstance(analysis.events, NoReading):
        return {"passed": False, "refused": analysis.events.reason}
    names = {e.name.lower(): int(e) for e in SwingEvent.ordered()}
    rows = {}
    for key, frame in truth["events"].items():
        predicted = int(analysis.event_source_frames[names[key]])
        tolerance = int(truth["tolerance_frames"][key])
        rows[key] = {
            "truth": frame,
            "read": predicted,
            "tolerance": tolerance,
            "passed": abs(predicted - frame) <= tolerance,
        }
    return {"passed": all(r["passed"] for r in rows.values()), "events": rows}


# -- the gate ---------------------------------------------------------------------


def load_config(path: Path | None) -> tuple[AnalysisConfig, dict[str, Any]]:
    """The app's decision with a side's overrides, and the overrides as given.

    A JSON object of `AnalysisConfig` fields; unknown keys are refused, so a typo
    cannot quietly score the default rule under another name.
    """
    if path is None:
        return AnalysisConfig(), {}
    overrides = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(overrides, dict):
        raise SystemExit(f"{path}: expected a JSON object of AnalysisConfig fields")
    return AnalysisConfig.model_validate(overrides), overrides


def comparison_gate(
    base_rows: Sequence[Scored],
    cand_rows: Sequence[Scored],
    groups: Sequence[str],
    same_model: bool,
    resamples: int,
) -> tuple[str, dict[str, Any]]:
    """Gate 3: the candidate against the baseline on the frozen test set.

    A new model must beat the baseline (non-inferior and better on one measure).
    A decision-rule change on the same weights need not raise accuracy, since a
    correctness fix may not, but it must not lower it beyond the non-inferiority
    margins (#41). With the same model on both sides superiority is impossible by
    construction, which is why the rule-change verdict is its own gate.
    """
    name = (
        "not_worse_than_baseline_on_frozen_real_test"
        if same_model
        else "beats_baseline_on_frozen_real_test"
    )
    paired = sum(b.answered and c.answered for b, c in zip(base_rows, cand_rows, strict=True))
    if paired == 0:
        return name, {"passed": False, "detail": "no clip was answered by both sides"}
    w1 = paired_difference(
        base_rows, cand_rows, groups, lambda r: r.w1_core, lambda v: float(v.mean()), resamples, 1
    )
    tempo = paired_difference(
        base_rows, cand_rows, groups, lambda r: r.tempo_error, lambda v: float(np.median(v)),
        resamples, 2,
    )  # fmt: skip
    non_inferior = w1[1] > -NON_INFERIORITY_W1 and tempo[2] < NON_INFERIORITY_TEMPO
    superior = w1[1] > 0.0 or tempo[2] < 0.0
    return name, {
        "passed": bool(non_inferior if same_model else non_inferior and superior),
        "rule": "non-inferior" if same_model else "non-inferior and better on one measure",
        "n_paired": paired,
        "within_1_core4_difference": [round(v, 4) for v in w1],
        "tempo_error_difference": [round(v, 4) for v in tempo],
    }


def decision_row(decision: Decision) -> dict[str, Any]:
    if decision.positions is None:
        return {"answered": False, "slowed_by": None, "tempo": None}
    return {
        "answered": True,
        "slowed_by": decision.slowed_by,
        "tempo": round(tempo_of(decision.positions), 4),
    }


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(path.glob("*")) if path.is_dir() else [path]
    for file in files:
        digest.update(file.read_bytes())
    return digest.hexdigest()


def check_model_card(path: Path | None) -> list[str]:
    if path is None or not path.is_file():
        raise MissingEvidenceError(f"model card {path} is missing")
    text = path.read_text(encoding="utf-8")
    return [s for s in MODEL_CARD_SECTIONS if s.lower() not in text.lower()]


def matching_calibration(model: Any, path: Path | None, which: str) -> ModelCalibration:
    if path is None or not path.is_file():
        raise MissingEvidenceError(f"{which} calibration {path} is missing")
    table = load_calibration(path)
    if not table.matches(model_fingerprint(model)):
        raise MissingEvidenceError(
            f"{which} calibration {path} was measured through different weights"
        )
    return table


def phone_section(
    manifest: Manifest | None,
    root: Path,
    models: tuple[Any, Any],
    calibrations: tuple[ModelCalibration, ModelCalibration],
    configs: tuple[AnalysisConfig, AnalysisConfig],
    resamples: int,
) -> dict[str, Any]:
    """Baseline and candidate on labelled phone swings, kept apart from GolfDB.

    `gating` is true only when the set is large enough to say something. The
    rule is gate 3's non-inferiority only: a phone set this small cannot show a
    candidate better, only whether it is clearly worse.
    """
    if manifest is None:
        return {"status": "no phone evidence", "gating": False, "passed": None}
    clips = read_archive(verify(manifest, root))
    golfers = len(set(manifest.groups))
    (baseline, candidate), (base_cal, cand_cal) = models, calibrations
    base_config, cand_config = configs
    base_rows = [score_clip(c, decide(baseline, c.features, base_config), base_cal) for c in clips]
    cand_rows = [score_clip(c, decide(candidate, c.features, cand_config), cand_cal) for c in clips]
    groups = list(manifest.groups)
    w1 = paired_difference(
        base_rows, cand_rows, groups, lambda r: r.w1_core, lambda v: float(v.mean()), resamples, 3
    )
    tempo = paired_difference(
        base_rows, cand_rows, groups, lambda r: r.tempo_error, lambda v: float(np.median(v)),
        resamples, 4,
    )  # fmt: skip
    gating = len(clips) >= PHONE_MIN_SWINGS and golfers >= PHONE_MIN_GOLFERS
    non_inferior = bool(w1[1] > -NON_INFERIORITY_W1 and tempo[2] < NON_INFERIORITY_TEMPO)
    return {
        "status": "gating"
        if gating
        else (
            f"reported, not gating: {len(clips)} swings from {golfers} golfers, "
            f"gating needs {PHONE_MIN_SWINGS} from {PHONE_MIN_GOLFERS}"
        ),
        "manifest": manifest.name,
        "n_swings": len(clips),
        "n_golfers": golfers,
        "gating": gating,
        "passed": non_inferior if gating else None,
        "baseline_summary": summary(base_rows, float("nan")),
        "candidate_summary": summary(cand_rows, float("nan")),
        "within_1_core4_difference": [round(v, 4) for v in w1],
        "tempo_error_difference": [round(v, 4) for v in tempo],
    }


# -- once per candidate (#55) ---------------------------------------------------------


def code_sha256() -> str:
    """A hash of the swingml package's Python sources: the decision code that ran."""
    package = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    for path in sorted(package.rglob("*.py")):
        digest.update(path.relative_to(package).as_posix().encode() + b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def git_commit() -> str | None:
    try:
        done = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10,
            cwd=Path(__file__).resolve().parent, check=True,
        )  # fmt: skip
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() or None


def holdouts_named(args: argparse.Namespace) -> list[str]:
    """The holdout manifests this run would read, by name."""
    paths = [args.test_manifest] + ([args.phone_manifest] if args.phone_manifest else [])
    try:
        manifests = [load(Path(path)) for path in paths]
    except (OSError, ValueError) as error:
        raise MissingEvidenceError(f"a manifest cannot be read: {error}") from error
    return [m.name for m in manifests if m.split in HOLDOUT_SPLITS]


def read_log(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def earlier_reads(
    log: Sequence[dict[str, Any]], candidate_sha: str, holdout: str
) -> list[dict[str, Any]]:
    """Runs that read `holdout` with these candidate weights."""
    return [
        e for e in log if holdout in e.get("read", []) and e["candidate"]["sha256"] == candidate_sha
    ]


def append_read(path: Path, entry: dict[str, Any]) -> None:
    with path.open("a", encoding="utf-8") as log:
        log.write(json.dumps(entry, sort_keys=True) + "\n")


def clip_detail(decisions: Sequence[dict[str, Any]], on_holdout: bool) -> dict[str, Any]:
    """What a report says clip by clip: on a holdout, a count only (#49, #55).

    Off the holdout, every clip's decision on both sides, to see which a rule moved.
    On it, a clip's id or reading would be design input for the next candidate.
    """
    changed = [d["clip"] for d in decisions if d["baseline"] != d["candidate"]]
    if on_holdout:
        return {"n_changed_clips": len(changed)}
    return {"n_changed_clips": len(changed), "changed_clips": changed, "decisions": list(decisions)}


def run(args: argparse.Namespace, read: list[str] | None = None) -> dict[str, Any]:
    """The report. `read` collects the holdout manifests this run actually read."""
    read = [] if read is None else read
    root = Path(args.root)
    candidate = load_any(args.candidate)
    baseline = load_any(args.baseline)
    cand_cal = matching_calibration(candidate, args.candidate_calibration, "candidate")
    base_cal = matching_calibration(baseline, args.baseline_calibration, "baseline")
    missing_sections = check_model_card(args.model_card)
    manifests = [load(args.test_manifest), load(args.calibration_manifest)]
    if args.train_manifest is not None:
        manifests.append(load(args.train_manifest))
    phone = load(args.phone_manifest) if args.phone_manifest is not None else None
    try:
        test_archive = verify(manifests[0], root)
        for manifest in manifests[1:]:
            verify(manifest, root)
        if phone is not None:
            verify(phone, root)
    except (ManifestError, FileNotFoundError) as error:
        raise MissingEvidenceError(str(error)) from error

    base_config, base_overrides = load_config(args.baseline_config)
    cand_config, cand_overrides = load_config(args.candidate_config)
    same_model = sha256_of(args.candidate) == sha256_of(args.baseline)
    on_holdout = manifests[0].split in HOLDOUT_SPLITS
    if on_holdout:
        read.append(manifests[0].name)
    clips = read_archive(test_archive)
    negatives = no_swing_stretches(clips)

    def evaluate(
        model: Any, calibration: ModelCalibration, config: AnalysisConfig
    ) -> tuple[list[Decision], list[Scored], float]:
        decisions = [decide(model, c.features, config) for c in clips]
        rows = [score_clip(c, d, calibration) for c, d in zip(clips, decisions, strict=True)]
        accepted = [decide(model, f, config).positions is not None for f in negatives]
        return decisions, rows, float(np.mean(accepted)) if accepted else float("nan")

    base_decisions, base_rows, base_neg = evaluate(baseline, base_cal, base_config)
    cand_decisions, cand_rows, cand_neg = evaluate(candidate, cand_cal, cand_config)
    base, cand = summary(base_rows, base_neg), summary(cand_rows, cand_neg)

    gates: dict[str, dict[str, Any]] = {}
    gates["evidence"] = {
        "passed": not missing_sections,
        "detail": f"model card lacks sections {missing_sections}"
        if missing_sections
        else "all present",
    }
    problems = leaks(manifests + ([phone] if phone is not None else []))
    gates["no_leakage"] = {
        "passed": not problems,
        "detail": problems or "no shared clips or groups",
    }

    groups_of_clip = list(manifests[0].groups)
    name, verdict = comparison_gate(
        base_rows, cand_rows, groups_of_clip, same_model, args.resamples
    )
    gates[name] = verdict
    fixture = fixture_check(candidate, Path(args.fixture), cand_config)
    gates["real_fixture"] = fixture
    gates["uncertainty_coverage"] = {
        "passed": bool(
            cand["tempo_band_coverage"]
            >= (cand_cal.tempo.coverage if cand_cal.tempo else 0.8) - COVERAGE_SLACK
            and cand["event_band_coverage"] >= cand_cal.events.coverage - COVERAGE_SLACK
        ),
        "tempo": cand["tempo_band_coverage"],
        "events": cand["event_band_coverage"],
        "claimed": cand_cal.events.coverage,
    }
    gates["false_confidence"] = {
        "passed": bool(cand["false_confidence_rate"] <= base["false_confidence_rate"] + 0.02),
        "candidate": cand["false_confidence_rate"],
        "baseline": base["false_confidence_rate"],
    }
    gates["refusals"] = {
        "passed": bool(
            cand["answered"] >= base["answered"] - 0.01
            and cand["no_swing_accepted"] <= base["no_swing_accepted"] + 0.01
        ),
        "real_swings_answered": [base["answered"], cand["answered"]],
        "no_swing_accepted": [base["no_swing_accepted"], cand["no_swing_accepted"]],
        "n_no_swing_stretches": len(negatives),
    }
    groups: dict[str, Callable[[Clip], bool]] = {
        "face_on": lambda c: c.azimuth_deg == 0.0,
        "down_the_line": lambda c: c.azimuth_deg == 90.0,
        "other_view": lambda c: not np.isfinite(c.azimuth_deg),
        "slow_motion": lambda c: c.slow,
        "real_time": lambda c: not c.slow,
        "left_handed": lambda c: c.left_handed,
        "right_handed": lambda c: not c.left_handed,
    }
    subgroups: dict[str, Any] = {}
    regressions = []
    for name, test in groups.items():
        idx = [i for i, c in enumerate(clips) if test(c)]
        b = summary([base_rows[i] for i in idx], float("nan"))
        c = summary([cand_rows[i] for i in idx], float("nan"))
        subgroups[name] = {"n": len(idx), "baseline": b, "candidate": c}
        if len(idx) >= SUBGROUP_MIN and c["within_1_core4"] < b["within_1_core4"] - SUBGROUP_DROP:
            regressions.append(name)
    gates["subgroups"] = {"passed": not regressions, "regressed": regressions, "groups": subgroups}
    gates["tempo_sensitivity"] = {
        "passed": bool(cand["tempo_slope"] >= base["tempo_slope"] - SLOPE_DROP),
        "baseline_slope": base["tempo_slope"],
        "candidate_slope": cand["tempo_slope"],
    }
    if phone is not None and phone.split in HOLDOUT_SPLITS:
        read.append(phone.name)
    phone_report = phone_section(
        phone, root, (baseline, candidate), (base_cal, cand_cal), (base_config, cand_config),
        args.resamples,
    )  # fmt: skip
    if phone_report["gating"]:
        gates["phone_not_worse"] = {
            "passed": phone_report["passed"],
            "within_1_core4_difference": phone_report["within_1_core4_difference"],
            "tempo_error_difference": phone_report["tempo_error_difference"],
        }
    decisions = [
        {
            "clip": clip.clip_id,
            "group": group,
            "slow_motion_replay": clip.slow,
            "azimuth_deg": clip.azimuth_deg if np.isfinite(clip.azimuth_deg) else None,
            "baseline": decision_row(b),
            "candidate": decision_row(c),
        }
        for clip, group, b, c in zip(
            clips, groups_of_clip, base_decisions, cand_decisions, strict=True
        )
    ]
    return {
        "candidate": {"path": str(args.candidate), "sha256": sha256_of(args.candidate)},
        "baseline": {"path": str(args.baseline), "sha256": sha256_of(args.baseline)},
        "comparison": {
            "kind": "decision rule (same weights)" if same_model else "model",
            "baseline_config": base_overrides,
            "candidate_config": cand_overrides,
        },
        "test": {"manifest": manifests[0].name, "n_clips": len(clips)},
        "baseline_summary": base,
        "candidate_summary": cand,
        "gates": gates,
        "phone": phone_report,
        "passed": all(g["passed"] for g in gates.values()),
        **clip_detail(decisions, on_holdout),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--candidate-calibration", type=Path, default=None)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--baseline-calibration", type=Path, default=None)
    parser.add_argument("--test-manifest", type=Path, required=True)
    parser.add_argument("--calibration-manifest", type=Path, required=True)
    parser.add_argument("--train-manifest", type=Path, default=None)
    parser.add_argument("--phone-manifest", type=Path, default=None)
    parser.add_argument(
        "--baseline-config",
        type=Path,
        default=None,
        help="JSON of AnalysisConfig fields for the baseline's decision (default: the app's)",
    )
    parser.add_argument(
        "--candidate-config",
        type=Path,
        default=None,
        help="JSON of AnalysisConfig fields for the candidate's decision (default: the app's)",
    )
    parser.add_argument("--model-card", type=Path, default=None)
    parser.add_argument("--fixture", type=Path, default=Path("tests/fixtures/real_swing_01"))
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--resamples", type=int, default=2000)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--read-log", type=Path, default=READ_LOG)
    parser.add_argument(
        "--owner-approved-reread",
        default=None,
        metavar="LINK",
        help="the owner's recorded decision allowing these weights another holdout read",
    )
    args = parser.parse_args(argv)
    try:
        with holdout_access():
            holdouts = holdouts_named(args)
    except MissingEvidenceError as error:
        print(f"RELEASE GATE: MISSING EVIDENCE - {error}", file=sys.stderr)
        return 2
    entry: dict[str, Any] | None = None
    if holdouts:
        if not args.read_log.parent.is_dir():
            print(
                f"RELEASE GATE: MISSING EVIDENCE - no read log at {args.read_log}", file=sys.stderr
            )
            return 2
        try:
            candidate_sha, baseline_sha = sha256_of(args.candidate), sha256_of(args.baseline)
        except OSError as error:
            print(f"RELEASE GATE: MISSING EVIDENCE - {error}", file=sys.stderr)
            return 2
        log = read_log(args.read_log)
        entry = {
            "date": datetime.now(UTC).isoformat(timespec="seconds"),
            "holdouts": holdouts,
            "candidate": {"path": str(args.candidate), "sha256": candidate_sha,
                          "config": load_config(args.candidate_config)[1]},
            "baseline": {"path": str(args.baseline), "sha256": baseline_sha,
                         "config": load_config(args.baseline_config)[1]},
            "code_sha256": code_sha256(),
            "commit": git_commit(),
            "owner_approved_reread": args.owner_approved_reread,
            "read": [],
        }  # fmt: skip
        before = {h: earlier_reads(log, candidate_sha, h) for h in holdouts}
        for holdout in holdouts:
            total = sum(holdout in e.get("read", []) for e in log)
            print(f"HOLDOUT  {holdout}: read {total} time(s) before, "
                  f"{len(before[holdout])} with these candidate weights")  # fmt: skip
        if any(before.values()) and not args.owner_approved_reread:
            entry["outcome"] = "refused: these weights were already read on this holdout"
            append_read(args.read_log, entry)
            print(
                "RELEASE GATE: REFUSED - the holdout is read once per candidate "
                "(agents/CHARTER.md section 3); these weights were already scored on it. "
                "Another read needs --owner-approved-reread with the owner's decision.",
                file=sys.stderr,
            )
            return 2
    read: list[str] = []
    outcome = "error"
    try:
        # The one place the holdout may be read (swingml.dataset.manifest.guard_archive).
        with holdout_access():
            report = run(args, read)
        outcome = "passed" if report["passed"] else "failed"
    except MissingEvidenceError as error:
        outcome = f"missing evidence: {error}"
        print(f"RELEASE GATE: MISSING EVIDENCE - {error}", file=sys.stderr)
        return 2
    finally:
        if entry is not None:
            entry.update(outcome=outcome, read=read)
            append_read(args.read_log, entry)
    for name, gate in report["gates"].items():
        print(f"{'PASS' if gate['passed'] else 'FAIL'}  {name}")
    if not report["phone"]["gating"]:
        print(f"INFO  phone: {report['phone']['status']}")
    print("RELEASE GATE:", "PASSED" if report["passed"] else "FAILED")
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, default=str) + "\n")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
