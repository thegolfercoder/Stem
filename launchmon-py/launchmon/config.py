"""Typed, file-backed configuration.

Everything that could differ between builds of the hardware, between clubs or
between golfers lives here rather than in code. Nothing in this package reads
configuration from a global; every processing function is handed the pieces it
needs, so that replay can re-run an archived shot under different settings and
diff the results.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from pydantic import BaseModel, ConfigDict, Field

from launchmon.physics import cosine_projection_factor

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class CosineSource(StrEnum):
    """Where the launch angle used for the cosine correction comes from.

    The brief requires that either source can supply theta. Until the camera is
    working, the per-club prior stands in; once it is, the measured angle takes
    over and the prior becomes a fallback for shots the camera missed.
    """

    CLUB_PRIOR = "club_prior"
    MEASURED_LAUNCH_ANGLE = "measured_launch_angle"


class ClubConfig(_Frozen):
    """One club. Every field here is provisional until validation data replaces it."""

    name: str
    length_m: float = Field(description="Nominal club length, m.")
    clubhead_radius_m: float = Field(
        description=(
            "Radius used for v = omega*r when computing clubhead speed from the IMU. "
            "This is not the club length and it is not measured: it is the distance "
            "from the effective centre of rotation to the clubhead, which is a "
            "calibration to be fitted against reference data, not a property of the "
            "club. The value here is a starting point derived from length only."
        )
    )
    launch_angle_prior_deg: float = Field(
        description=(
            "Typical launch angle, used for the cosine correction until the camera "
            "supplies a measured one."
        )
    )
    spin_prior_rpm: float = Field(
        description=(
            "Typical backspin. The device does not and will not measure spin. This "
            "prior exists solely so the trajectory model has an input, and any value "
            "computed with it is MODELLED and must carry the assumption."
        )
    )


class ClubsConfig(_Frozen):
    clubs: tuple[ClubConfig, ...]

    def by_name(self, name: str) -> ClubConfig:
        for club in self.clubs:
            if club.name == name:
                return club
        raise KeyError(f"no club named {name!r} in config; known: {[c.name for c in self.clubs]}")


class RadarGeometryConfig(_Frozen):
    """Where the radar module physically sits. Drives the cosine correction."""

    range_from_tee_m: float
    height_m: float = Field(
        description=(
            "Phase-centre height above the ground. Mounting height changes the cosine "
            "correction materially, so it is measured on the range and recorded here "
            "per session rather than assumed."
        )
    )
    tee_height_m: float = Field(description="Ball centre height above the ground at rest, m.")
    azimuth_beamwidth_deg: float
    elevation_beamwidth_deg: float


class AmplifierConfig(_Frozen):
    """The analogue chain between the radar module and the sound card."""

    passband_low_hz: float
    passband_high_hz: float
    order: int


class AudioIngestConfig(_Frozen):
    sample_rate_hz: float = Field(
        description=(
            "iOS caps USB audio input at 48 kHz. Nothing downstream may assume a "
            "higher rate is available."
        )
    )
    capture_window_s: float


class HardwareConfig(_Frozen):
    radar_tx_hz: float
    radar_geometry: RadarGeometryConfig
    amplifier: AmplifierConfig
    audio: AudioIngestConfig
    ball_drag_coefficient_provisional: float = Field(
        description=(
            "Drag coefficient used only by the short-window along-beam decay model, "
            "for generating synthetic signals and for the fixed-k fallback in the "
            "speed fit. It is PROVISIONAL: the fitted value arrives with the Stage 2 "
            "trajectory fit and replaces this. It is not a measurement and no "
            "accuracy claim attaches to it."
        )
    )


class CameraConfig(_Frozen):
    fx_px: float
    fy_px: float
    cx_px: float
    cy_px: float
    width_px: int
    height_px: int
    frame_rate_hz: float


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} did not contain a mapping")
    return data


def load_clubs(path: Path | None = None) -> ClubsConfig:
    return ClubsConfig.model_validate(_load_yaml(path or CONFIG_DIR / "clubs.yaml"))


def load_hardware(path: Path | None = None) -> HardwareConfig:
    return HardwareConfig.model_validate(_load_yaml(path or CONFIG_DIR / "hardware.yaml"))


def load_camera(path: Path | None = None) -> CameraConfig:
    return CameraConfig.model_validate(_load_yaml(path or CONFIG_DIR / "camera.yaml"))


def cosine_correction_factor(
    geometry: RadarGeometryConfig,
    launch_angle_deg: float,
    average_over_m: float,
    n_samples: int = 201,
) -> float:
    """Mean cos(theta) over the first `average_over_m` of flight.

    Divide a radial speed by this to correct it. The launch angle is supplied by
    the caller so that either the per-club prior or a camera-measured angle can
    drive it; this function does not know or care which, which is what keeps the
    two sources interchangeable.
    """
    downrange = np.linspace(0.0, average_over_m, n_samples)
    factors = cosine_projection_factor(
        downrange,
        float(np.radians(launch_angle_deg)),
        geometry.range_from_tee_m,
        geometry.height_m,
        geometry.tee_height_m,
    )
    return float(np.mean(factors))
