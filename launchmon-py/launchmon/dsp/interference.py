"""Suppressing interference that does not move.

Mains hum and its harmonics are a documented interferer for these radar modules,
and they are dangerous here for a reason that has nothing to do with their level.
The pipeline identifies the ball by looking for the strongest tone above the club,
and hum harmonics are tones: they can be picked as the club, as the ball, or as
both, and the answer that comes back is then a plausible speed derived from the
mains frequency. Raising thresholds does not help, because the problem is not that
hum is weak.

What separates hum from a golf shot is not amplitude but *motion*. Every real
component in this signal sweeps: the club's tone climbs through the downswing,
the ball's falls away under drag. An interferer locked to the mains sits in the
same bin for the entire capture. Bins occupied for most of the capture are
therefore not shot content, whatever their level, and are pushed down to the
local noise floor before anything tries to interpret them.

This suppresses any stationary narrowband interferer, not only mains: a switching
supply, a fan, a nearby motor. It does not suppress broadband noise, and it is
not a substitute for an analogue front end that rejects hum in the first place.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from launchmon.dsp.stft import StftResult


class InterferenceConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    presence_fraction: float = Field(
        description=(
            "Fraction of frames a bin must stand above the floor in to be treated as "
            "stationary interference. It must sit above the share of the capture any "
            "real component can occupy a single bin for: the ball exists in only the "
            "part of the capture after impact, and its tone drifts across bins "
            "throughout that, so it cannot approach a value near one."
        )
    )
    margin_db: float = Field(
        description="How far above its frame's noise floor a bin counts as occupied."
    )


def stationary_bin_mask(result: StftResult, config: InterferenceConfig) -> NDArray[np.bool_]:
    """Bins occupied for more than `presence_fraction` of the capture."""
    log_mag = 20.0 * np.log10(np.maximum(result.magnitude, 1e-15))
    floor = np.median(log_mag, axis=0)
    occupied = log_mag >= (floor + config.margin_db)[None, :]
    return np.asarray(occupied.mean(axis=1) > config.presence_fraction)


def suppress_stationary_bins(
    result: StftResult, config: InterferenceConfig
) -> tuple[StftResult, NDArray[np.bool_]]:
    """Push stationary bins down to their frame's noise floor.

    They are flattened rather than removed so that frequencies, frame times and
    array shapes are untouched, and so that the suppression is visible in the
    debug spectrogram rather than hidden by a change of axis.

    Returns the cleaned spectrogram and the mask, so that what was removed can be
    shown and counted rather than silently discarded.
    """
    mask = stationary_bin_mask(result, config)
    if not mask.any():
        return result, mask

    magnitude = result.magnitude.copy()
    floor = np.median(magnitude, axis=0)
    magnitude[mask, :] = floor[None, :]
    return (
        StftResult(
            config=result.config,
            freqs_hz=result.freqs_hz,
            times_s=result.times_s,
            magnitude=magnitude,
        ),
        mask,
    )
