"""Per-club calibration of the IMU's clubhead radius, kept across shots.

Clubhead speed from the IMU is the shaft's rotation rate times a radius from
the effective centre of rotation to the clubhead. That radius is not the club's
length: the hands are still moving at impact, so the centre sits somewhere
between the grip and the shoulder, and where depends on the golfer and the
club. `clubs.yaml` starts it at the club's length and marks the result MODELLED.

Every shot that both the radar and the IMU see measures it:
`effective_clubhead_radius` is the radar's clubhead speed over the IMU's rate at
impact. This module keeps those measurements per club in a small JSON file, so
that a shot the radar missed can use this golfer's own radius for this club
rather than the assumed one.

What is accepted
----------------
A shot offers a sample only when the radar's clubhead speed and the IMU's rate
at impact are both MEASURED. The sample is then refused, with the reason kept,
if

* it is outside `plausible_radius_m`. The lower bound, 0.6 m, is about two
  thirds of the shortest club in `clubs.yaml` (a 0.90 m wedge); below it the
  clubhead would be moving slower than a club pivoting about the hands, which
  means the radar read something other than the head or the rate is wrong. The
  upper bound, 1.8 m, is the longest club the rules allow (1.17 m, 46 in) plus
  a typical shoulder-to-grip distance (about 0.6 m): the radius of a club and a
  straight arm swung as one lever about the shoulder, which no release makes
  longer. Real swings sit well inside, around 1.1 to 1.4 m.
* it is an outlier against this club's accepted samples: further than
  `outlier_threshold` robust standard deviations (1.4826 x the median absolute
  deviation) from their median. 3.5 is Iglewicz and Hoaglin's cut for the
  modified z-score. The test applies only once `outlier_min_samples` samples
  exist, because the median and MAD of two or three numbers are not a reference,
  and the deviation is floored at `min_spread_m` so a run of nearly identical
  early samples cannot make every later one look wrong. 2 cm is about 1.5
  percent of a typical radius, the order of the radar's and the gyro's combined
  per-shot noise.

Accepted and refused samples are both kept, each list capped at the most recent
`max_history`. The calibration is the median of the accepted ones with its
robust spread and count, and is usable once `min_samples` exist. Before that it
is a refusal that says how many more are needed.

The store has no global state: it is an immutable value, loaded from and saved
to a path the caller chooses. Saving writes a temporary file beside the target
and renames it over the target, so a crash leaves either the old file or the
new one, never half of one. A file that cannot be read is an error, not an
empty store, so a damaged history is never silently overwritten.
"""

from __future__ import annotations

import json
import math
import os
import secrets
from enum import StrEnum
from pathlib import Path
from typing import TYPE_CHECKING, Literal

import numpy as np
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError

from launchmon.quantity import NoReading, Provenance, Quantity

if TYPE_CHECKING:
    from launchmon.fusion.shot import FusedShot

StoreFormat = Literal["launchmon.club-radius-calibration"]
MAD_TO_SIGMA = 1.4826  # robust standard deviation from the MAD, for normal scatter


class CalibrationFileError(ValueError):
    """A calibration file exists but cannot be read as one. It is left as it is."""


class RadiusCalibrationConfig(BaseModel):
    """Thresholds for accepting radius samples. Choices, justified in the module docstring."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    plausible_radius_m: tuple[float, float] = Field(
        default=(0.6, 1.8),
        description="Centre of rotation to clubhead, m, that a golf swing can produce.",
    )
    outlier_threshold: float = Field(
        default=3.5, description="Robust standard deviations from the median that refuse a sample."
    )
    outlier_min_samples: int = Field(
        default=5, description="Accepted samples needed before outliers are refused."
    )
    min_spread_m: float = Field(
        default=0.02, description="Floor on the robust deviation used by the outlier test, m."
    )
    min_samples: int = Field(
        default=5, description="Accepted samples needed before the calibration is used."
    )
    max_history: int = Field(
        default=50, description="Most recent accepted (and refused) samples kept per club."
    )


class RadiusSample(BaseModel):
    """One accepted measurement of the effective radius."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    radius_m: float
    recorded_at: AwareDatetime
    shot: str | None = Field(default=None, description="Which shot it came from, if known.")


class RejectedSample(BaseModel):
    """A measurement that was refused, kept with the reason."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    radius_m: float
    recorded_at: AwareDatetime
    reason: str
    shot: str | None = None


class ClubRadiusHistory(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    accepted: tuple[RadiusSample, ...] = ()
    rejected: tuple[RejectedSample, ...] = ()

    def radii(self) -> list[float]:
        return [s.radius_m for s in self.accepted]


class RadiusCalibration(BaseModel):
    """The calibrated radius for one club: the median of its accepted samples."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    club: str
    radius_m: float
    spread_m: float = Field(
        description="1.4826 x the median absolute deviation of the samples: their robust scatter."
    )
    n_samples: int

    def prediction_spread_m(self) -> float:
        """Robust standard deviation of this radius as an estimate for one new shot.

        The shot's own radius scatters about the club's by `spread_m`, and the
        median of n samples is itself uncertain by about sqrt(pi / 2n) of that.
        """
        return self.spread_m * math.sqrt(1.0 + math.pi / (2.0 * self.n_samples))


class SampleOutcome(StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    NO_SAMPLE = "no_sample"
    """The shot did not measure the radius, so there was nothing to accept or refuse."""


class SampleDecision(BaseModel):
    """What happened to the radius a shot offered."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    club: str
    outcome: SampleOutcome
    radius_m: float | None
    reason: str
    n_accepted: int = Field(description="Accepted samples for the club after this decision.")


def _median_and_spread(values: list[float]) -> tuple[float, float]:
    x = np.asarray(values, dtype=np.float64)
    med = float(np.median(x))
    return med, MAD_TO_SIGMA * float(np.median(np.abs(x - med)))


def _check_club(club: str) -> str:
    if not club.strip():
        raise ValueError("a club identifier must not be empty")
    return club


def judge_radius_sample(
    radius_m: float, history: ClubRadiusHistory, config: RadiusCalibrationConfig
) -> str | None:
    """Why this radius is refused for this club's history, or None if it is accepted."""
    lo, hi = config.plausible_radius_m
    if not lo <= radius_m <= hi:
        return (
            f"a {radius_m:.3f} m radius is outside the {lo:.2f} to {hi:.2f} m a golf club "
            "can have from its centre of rotation: the radar or the IMU misread this shot"
        )
    radii = history.radii()
    if len(radii) >= config.outlier_min_samples:
        med, spread = _median_and_spread(radii)
        sigma = max(spread, config.min_spread_m)
        z = abs(radius_m - med) / sigma
        if z > config.outlier_threshold:
            return (
                f"outlier: {radius_m:.3f} m is {z:.1f} robust deviations from this club's "
                f"median {med:.3f} m over {len(radii)} samples (limit "
                f"{config.outlier_threshold:.1f})"
            )
    return None


def radius_sample_from_shot(shot: FusedShot) -> float | str:
    """The radius a fused shot measured, or why it offers none (a str)."""
    club, rate, radius = (
        shot.clubhead_speed_radial,
        shot.shaft_rate_at_impact,
        shot.effective_clubhead_radius,
    )
    if isinstance(club, NoReading):
        return f"no radar clubhead speed ({club.reason})"
    if isinstance(rate, NoReading):
        return f"no IMU rate at impact ({rate.reason})"
    if isinstance(radius, NoReading):
        return f"no effective radius ({radius.reason})"
    return radius.value


class CalibrationStore(BaseModel):
    """Every club's radius history. Immutable: `offer_shot` returns a new store."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    format: StoreFormat = "launchmon.club-radius-calibration"
    version: Literal[1] = 1
    clubs: dict[str, ClubRadiusHistory] = Field(default_factory=dict)

    def history(self, club: str) -> ClubRadiusHistory:
        return self.clubs.get(club, ClubRadiusHistory())

    def calibration(
        self, club: str, config: RadiusCalibrationConfig | None = None
    ) -> RadiusCalibration | NoReading:
        """The club's calibrated radius, or a refusal until enough samples exist."""
        config = config or RadiusCalibrationConfig()
        radii = self.history(_check_club(club)).radii()
        if len(radii) < config.min_samples:
            return NoReading(
                reason=(
                    f"{len(radii)} of the {config.min_samples} accepted radius samples a "
                    f"calibration for {club!r} needs"
                ),
                source="calibration",
            )
        med, spread = _median_and_spread(radii)
        return RadiusCalibration(club=club, radius_m=med, spread_m=spread, n_samples=len(radii))

    def offer_radius(
        self,
        club: str,
        radius_m: float,
        *,
        recorded_at: AwareDatetime,
        config: RadiusCalibrationConfig | None = None,
        shot: str | None = None,
    ) -> tuple[CalibrationStore, SampleDecision]:
        """Judge one measured radius and record it, accepted or refused.

        A sample already recorded for this club from the same shot (same label,
        same value: the same capture fused again) is not counted twice.
        """
        return self._offer(club, radius_m, None, recorded_at, config, shot)

    def offer_shot(
        self,
        club: str,
        shot: FusedShot,
        *,
        recorded_at: AwareDatetime,
        config: RadiusCalibrationConfig | None = None,
        label: str | None = None,
    ) -> tuple[CalibrationStore, SampleDecision]:
        """Offer the radius a fused shot measured. A shot that measured none changes nothing.

        `label` names the shot in the file (e.g. "session.bin#7"); with it, fusing
        the same capture again does not add its sample a second time.
        """
        sample = radius_sample_from_shot(shot)
        if isinstance(sample, str):
            return self._no_sample(club, sample)
        untrusted: str | None = None
        for name, reading in (
            ("radar clubhead speed", shot.clubhead_speed_radial),
            ("IMU rate at impact", shot.shaft_rate_at_impact),
        ):
            if isinstance(reading, Quantity) and reading.provenance is not Provenance.MEASURED:
                untrusted = (
                    f"the {name} is {reading.provenance.value}, not measured: "
                    "a calibration is only as good as what it is fitted to"
                )
                break
        return self._offer(club, sample, untrusted, recorded_at, config, label)

    def _no_sample(self, club: str, reason: str) -> tuple[CalibrationStore, SampleDecision]:
        return self, SampleDecision(
            club=_check_club(club),
            outcome=SampleOutcome.NO_SAMPLE,
            radius_m=None,
            reason=reason,
            n_accepted=len(self.history(club).accepted),
        )

    def _offer(
        self,
        club: str,
        radius_m: float,
        refusal: str | None,
        recorded_at: AwareDatetime,
        config: RadiusCalibrationConfig | None,
        shot: str | None,
    ) -> tuple[CalibrationStore, SampleDecision]:
        """Record the sample: refused with `refusal` if given, else as judged."""
        config = config or RadiusCalibrationConfig()
        history = self.history(_check_club(club))
        if not math.isfinite(radius_m):
            return self._no_sample(club, f"the radius offered is {radius_m}, not a number")
        seen: tuple[RadiusSample | RejectedSample, ...] = (*history.accepted, *history.rejected)
        if shot is not None and any(s.shot == shot and s.radius_m == radius_m for s in seen):
            return self._no_sample(club, f"already recorded from {shot}")
        reason = refusal or judge_radius_sample(radius_m, history, config)
        cap = config.max_history
        if reason is None:
            accepted = RadiusSample(radius_m=radius_m, recorded_at=recorded_at, shot=shot)
            history = history.model_copy(update={"accepted": (*history.accepted, accepted)[-cap:]})
            outcome, reason = SampleOutcome.ACCEPTED, "accepted"
        else:
            refused = RejectedSample(
                radius_m=radius_m, recorded_at=recorded_at, reason=reason, shot=shot
            )
            history = history.model_copy(update={"rejected": (*history.rejected, refused)[-cap:]})
            outcome = SampleOutcome.REJECTED
        store = self.model_copy(update={"clubs": {**self.clubs, club: history}})
        return store, SampleDecision(
            club=club,
            outcome=outcome,
            radius_m=radius_m,
            reason=reason,
            n_accepted=len(history.accepted),
        )


def load_calibration(path: Path) -> CalibrationStore:
    """Read a store. A missing file is an empty store; an unreadable one is an error."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return CalibrationStore()
    except OSError as e:
        raise CalibrationFileError(f"cannot read calibration file {path}: {e}") from e
    try:
        return CalibrationStore.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError) as e:
        raise CalibrationFileError(
            f"{path} is not a radius calibration file this version can read ({e}); "
            "it has been left untouched"
        ) from e


def save_calibration(store: CalibrationStore, path: Path) -> None:
    """Write the store atomically: a temporary file beside the target, renamed over it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(store.model_dump(mode="json"), indent=2, allow_nan=False) + "\n"
    # Opened like any new file, so it gets the usual permissions, not mkstemp's 0600.
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o666)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
