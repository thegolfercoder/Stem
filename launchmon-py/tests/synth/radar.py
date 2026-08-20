"""Synthetic 24 GHz CW Doppler radar signals with known ground truth.

What this models
----------------
The signal a homodyne Doppler module produces at its IF output, amplified and
digitised by a 48 kHz USB sound card, for one golf shot. Components are
independent and individually disableable so that a failure can be attributed:

* **Club return.** The clubhead is not a point. The shaft is a rigid body
  rotating about a centre well up the golfer's arms, so every point along it
  moves at a different speed and the return is a *band* whose upper edge is the
  head, not a single tone. Modelled as scatterers spread along the shaft, each
  at a fixed fraction of the head's radius and therefore of the head's speed,
  weighted so the head dominates. Modelling the club as one clean tone makes a
  ridge tracker look better than it will be on real hardware.
* **Ball return.** A single scatterer from impact, its speed decaying under
  quadratic drag, so the tone is a downchirp rather than a constant frequency.
* **Range and beam envelope.** Received *power* falls as 1/R^4 for a point
  target, so amplitude falls as 1/R^2, and the two-way antenna pattern rolls the
  return off as the ball climbs out of the beam. Together these decide how long
  the ball is actually observable, which is far shorter than the capture window.
* **Additive noise** at a specified in-band SNR, **mains hum** and harmonics as a
  documented interferer, an **amplifier passband** so a wrong analogue front end
  can be simulated, a **DC offset** as produced by a homodyne mixer, and
  **quantisation** by the sound card.

What this does not model
------------------------
Ground clutter and body return, multipath, oscillator phase noise and drift,
sound-card clock error, and the acoustic environment. None of these are
negligible in the field; they are absent because nothing yet measures them.
The ground truth this generator asserts is an along-beam speed history, not a
flight path: ball position is integrated along a fixed launch direction purely
so that range and beam angle are physically plausible, and is not a trajectory.
"""

from __future__ import annotations

from enum import StrEnum

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field
from scipy import signal as sps

from launchmon.constants import GRAVITY_MPS2, RADAR_TX_HZ
from launchmon.physics import (
    cosine_projection_factor,
    drag_decay_speed,
    drag_decel_coefficient,
    speed_to_doppler_hz,
)


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class CosineMode(StrEnum):
    """Whether the generator projects ball speed onto the sensor line of sight."""

    ALONG_BEAM = "along_beam"
    """The ball recedes straight down the beam. The estimator's target is then the
    true launch speed, which isolates the DSP from the geometry."""

    PROJECTED = "projected"
    """The ball climbs away from a sensor behind and below it, so the radial speed
    is the true speed times a cos(theta) that varies over the flight. Used to
    measure what the varying projection does to a fit that assumes it is absent."""


class ClubSynthConfig(_Frozen):
    """The club return: an extended, rotating body, not a point."""

    peak_speed_mps: float = Field(description="Clubhead speed at impact.")
    downswing_duration_s: float
    profile_exponent: float = Field(
        description=(
            "Shape of the clubhead speed rise, v = v_peak * sin(pi/2 * u)**exponent "
            "over the downswing. 1.0 is a quarter-sine; larger values put more of "
            "the acceleration late, as a real downswing does."
        )
    )
    n_scatterers: int = Field(description="Points distributed along the shaft.")
    radius_fraction_min: float = Field(
        description="Innermost modelled scatterer, as a fraction of the head's radius."
    )
    weight_exponent: float = Field(
        description=(
            "Scatterer amplitude weight goes as (radius fraction)**exponent, so the "
            "head dominates. Larger values narrow the club band toward a single tone."
        )
    )
    collapse_time_constant_s: float = Field(
        description="Exponential decay of the club return after impact."
    )
    amplitude: float = Field(description="Peak club return amplitude, arbitrary units.")


class BallSynthConfig(_Frozen):
    """The ball return: a single scatterer, chirping down under drag."""

    launch_speed_mps: float
    launch_angle_deg: float
    drag_coefficient: float = Field(
        description=(
            "Sets the chirp rate through k = rho*A*Cd/(2m). Provisional until the "
            "Stage 2 trajectory fit exists."
        )
    )
    amplitude: float = Field(
        description="Ball return amplitude referred to the range at impact, arbitrary units."
    )


class GeometrySynthConfig(_Frozen):
    sensor_range_m: float
    sensor_height_m: float
    tee_height_m: float
    azimuth_beamwidth_deg: float
    elevation_beamwidth_deg: float
    cosine_mode: CosineMode = CosineMode.ALONG_BEAM
    range_envelope: bool = Field(
        default=True, description="Apply 1/R^4 power (1/R^2 amplitude) range loss."
    )
    beam_envelope: bool = Field(
        default=True, description="Apply the two-way antenna pattern, hence beam exit."
    )


class NoiseSynthConfig(_Frozen):
    """Additive noise, specified by the in-band SNR it produces.

    `snr_db` is defined exactly: it is the ratio of the mean power of the *ball*
    component, over `window_s` from impact and after the amplifier passband, to
    the mean power of the noise after that same passband. It is a ball SNR, not
    a whole-signal SNR, because the ball segment is what sets launch speed.
    """

    snr_db: float | None = Field(description="None disables noise entirely.")
    window_s: float
    seed: int


class HumSynthConfig(_Frozen):
    """Mains-derived interference, a documented interferer for these modules."""

    fundamental_hz: float
    n_harmonics: int
    level_dbc: float = Field(
        description="Fundamental amplitude relative to the ball amplitude at impact, dB."
    )
    harmonic_rolloff_db: float = Field(description="Additional attenuation per harmonic, dB.")


class FrontEndSynthConfig(_Frozen):
    """The analogue chain and the ADC."""

    passband_low_hz: float | None
    passband_high_hz: float | None
    filter_order: int
    dc_offset: float = Field(
        description="Homodyne mixers sit on a large DC pedestal; the high-pass removes it."
    )
    bit_depth: int | None = Field(description="None leaves the signal unquantised.")
    full_scale: float = Field(description="Amplitude mapping to digital full scale; clips above.")


class RadarSynthConfig(_Frozen):
    sample_rate_hz: float
    duration_s: float
    impact_time_s: float
    radar_tx_hz: float = RADAR_TX_HZ
    club: ClubSynthConfig
    ball: BallSynthConfig
    geometry: GeometrySynthConfig
    noise: NoiseSynthConfig
    hum: HumSynthConfig | None
    front_end: FrontEndSynthConfig


class RadarGroundTruth(_Frozen):
    """Everything the generator knows and the estimator is not told."""

    sample_rate_hz: float
    impact_time_s: float
    impact_sample: int

    launch_speed_mps: float = Field(description="True ball speed leaving the club face.")
    radial_launch_speed_mps: float = Field(
        description=(
            "Component of the launch speed along the sensor line of sight at impact. "
            "This is what the radar can observe and therefore what the speed "
            "estimator is scored against. Under CosineMode.ALONG_BEAM the two are "
            "equal by construction."
        )
    )
    club_peak_speed_mps: float
    drag_k_per_m: float
    launch_angle_deg: float

    ball_observable_start_s: float
    ball_observable_end_s: float = Field(
        description=(
            "When the ball envelope has fallen 20 dB below its peak, through range "
            "loss and beam exit combined. The ball is not observable for the whole "
            "capture window and any estimator that assumes it is will be optimistic."
        )
    )


class SyntheticRadarShot(_Frozen):
    """One generated shot: the digitised waveform, its truth, and its parts."""

    model_config = ConfigDict(frozen=True, extra="forbid", arbitrary_types_allowed=True)

    samples: NDArray[np.float64]
    ground_truth: RadarGroundTruth
    config: RadarSynthConfig
    club_component: NDArray[np.float64]
    ball_component: NDArray[np.float64]
    noise_component: NDArray[np.float64]
    hum_component: NDArray[np.float64]

    @property
    def time_s(self) -> NDArray[np.float64]:
        n = self.samples.size
        return np.arange(n, dtype=np.float64) / self.config.sample_rate_hz


def _integrate_phase(freq_hz: NDArray[np.float64], sample_rate_hz: float) -> NDArray[np.float64]:
    """Phase in radians from an instantaneous frequency track, by trapezoid rule."""
    increments = 0.5 * (freq_hz[:-1] + freq_hz[1:]) / sample_rate_hz
    phase = np.empty_like(freq_hz)
    phase[0] = 0.0
    np.cumsum(increments, out=phase[1:])
    return 2.0 * np.pi * phase


def _clubhead_speed_track(
    t_s: NDArray[np.float64], impact_time_s: float, cfg: ClubSynthConfig
) -> NDArray[np.float64]:
    """Clubhead speed against time: rises through the downswing, peaks at impact."""
    start = impact_time_s - cfg.downswing_duration_s
    u = np.clip((t_s - start) / cfg.downswing_duration_s, 0.0, 1.0)
    speed = cfg.peak_speed_mps * np.sin(0.5 * np.pi * u) ** cfg.profile_exponent
    # After impact the head has struck the ball and is decelerating hard; the
    # return dies with the amplitude envelope rather than with a modelled speed.
    return np.asarray(speed)


def _ball_kinematics(
    t_since_impact: NDArray[np.float64], cfg: RadarSynthConfig, k_per_m: float
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Ball speed, downrange distance and height against time since impact.

    Speed is the exact solution of pure quadratic drag. Position is integrated
    along a *fixed* launch direction with a gravity drop added to the height.
    That is enough to make range and beam angle physically plausible over the
    tens of milliseconds the ball stays in the beam, and it is not a trajectory:
    it carries no lift, no drag-induced direction change and no varying Cd.
    """
    speed = drag_decay_speed(t_since_impact, cfg.ball.launch_speed_mps, k_per_m)
    angle = np.radians(cfg.ball.launch_angle_deg)
    dt = 1.0 / cfg.sample_rate_hz
    distance = np.concatenate(([0.0], np.cumsum(0.5 * (speed[:-1] + speed[1:]) * dt)))
    downrange = distance * np.cos(angle)
    height = (
        cfg.geometry.tee_height_m
        + distance * np.sin(angle)
        - 0.5 * GRAVITY_MPS2 * t_since_impact**2
    )
    return speed, downrange, height


def _two_way_beam_gain(
    off_axis_rad: NDArray[np.float64], beamwidth_deg: float
) -> NDArray[np.float64]:
    """Two-way voltage gain of a Gaussian-approximated pattern, unity on boresight.

    A Gaussian whose one-way power is -3 dB at half the beamwidth. Two-way power
    is that squared, so two-way *voltage* gain equals the one-way power gain.
    """
    half = np.radians(beamwidth_deg) / 2.0
    return np.asarray(np.exp(-np.log(2.0) * (off_axis_rad / half) ** 2))


def _bandpass(
    x: NDArray[np.float64], cfg: FrontEndSynthConfig, sample_rate_hz: float
) -> NDArray[np.float64]:
    """Zero-phase-free Butterworth band-pass, applied as a real analogue stage would be."""
    nyquist = 0.5 * sample_rate_hz
    low = cfg.passband_low_hz
    high = cfg.passband_high_hz
    if low is None and high is None:
        return x
    if low is not None and high is not None:
        sos = sps.butter(
            cfg.filter_order, [low / nyquist, high / nyquist], btype="bandpass", output="sos"
        )
    elif low is not None:
        sos = sps.butter(cfg.filter_order, low / nyquist, btype="highpass", output="sos")
    else:
        assert high is not None
        sos = sps.butter(cfg.filter_order, high / nyquist, btype="lowpass", output="sos")
    # lfilter, not filtfilt: the analogue chain is causal and does have phase.
    return np.asarray(sps.sosfilt(sos, x), dtype=np.float64)


def generate_shot(cfg: RadarSynthConfig) -> SyntheticRadarShot:
    """Generate one synthetic radar capture with its ground truth.

    The signal chain is assembled in the order the physical one is: returns are
    summed at the mixer output, a DC pedestal is added, the amplifier band-limits
    everything including its own noise, and the sound card quantises the result.
    """
    n = round(cfg.duration_s * cfg.sample_rate_hz)
    t = np.arange(n, dtype=np.float64) / cfg.sample_rate_hz
    impact_sample = round(cfg.impact_time_s * cfg.sample_rate_hz)
    if not 0 < impact_sample < n:
        raise ValueError("impact_time_s must fall strictly inside the capture window")

    # --- Club: an extended rotating body, so a band rather than a tone --------
    head_speed = _clubhead_speed_track(t, cfg.impact_time_s, cfg.club)
    head_phase = _integrate_phase(
        speed_to_doppler_hz(head_speed, cfg.radar_tx_hz), cfg.sample_rate_hz
    )
    fractions = np.linspace(cfg.club.radius_fraction_min, 1.0, cfg.club.n_scatterers)
    weights = fractions**cfg.club.weight_exponent
    weights /= weights.sum()

    club_envelope = np.where(
        t <= cfg.impact_time_s,
        # The head sweeps into the beam as it comes down.
        np.clip(
            (t - (cfg.impact_time_s - cfg.club.downswing_duration_s))
            / cfg.club.downswing_duration_s,
            0.0,
            1.0,
        ),
        np.exp(-(t - cfg.impact_time_s) / cfg.club.collapse_time_constant_s),
    )
    club = np.zeros(n, dtype=np.float64)
    for fraction, weight in zip(fractions, weights, strict=True):
        club += weight * np.cos(fraction * head_phase)
    club *= cfg.club.amplitude * club_envelope

    # --- Ball: a single scatterer chirping down under drag -------------------
    k = drag_decel_coefficient(cfg.ball.drag_coefficient)
    t_ball = t[impact_sample:] - cfg.impact_time_s
    speed, downrange, height = _ball_kinematics(t_ball, cfg, k)

    if cfg.geometry.cosine_mode is CosineMode.PROJECTED:
        cos_theta = cosine_projection_factor(
            downrange,
            float(np.radians(cfg.ball.launch_angle_deg)),
            cfg.geometry.sensor_range_m,
            cfg.geometry.sensor_height_m,
            cfg.geometry.tee_height_m,
        )
    else:
        cos_theta = np.ones_like(speed)
    radial_speed = speed * cos_theta

    ball_freq = speed_to_doppler_hz(radial_speed, cfg.radar_tx_hz)
    ball_phase = _integrate_phase(ball_freq, cfg.sample_rate_hz)

    los_x = cfg.geometry.sensor_range_m + downrange
    los_y = height - cfg.geometry.sensor_height_m
    range_m = np.hypot(los_x, los_y)
    envelope = np.ones_like(range_m)
    if cfg.geometry.range_envelope:
        # Received power goes as 1/R^4 for a point target, so amplitude as 1/R^2,
        # referred to the range at impact so that `amplitude` stays meaningful.
        envelope *= (range_m[0] / range_m) ** 2
    if cfg.geometry.beam_envelope:
        elevation = np.arctan2(los_y, los_x)
        envelope *= _two_way_beam_gain(elevation, cfg.geometry.elevation_beamwidth_deg)

    ball = np.zeros(n, dtype=np.float64)
    ball[impact_sample:] = cfg.ball.amplitude * envelope * np.cos(ball_phase)

    # --- Mains hum ------------------------------------------------------------
    hum = np.zeros(n, dtype=np.float64)
    if cfg.hum is not None:
        rng_phase = np.random.default_rng(cfg.noise.seed + 1)
        for harmonic in range(1, cfg.hum.n_harmonics + 1):
            level = cfg.hum.level_dbc - cfg.hum.harmonic_rolloff_db * (harmonic - 1)
            amplitude = cfg.ball.amplitude * 10.0 ** (level / 20.0)
            hum += amplitude * np.cos(
                2.0 * np.pi * cfg.hum.fundamental_hz * harmonic * t
                + rng_phase.uniform(0.0, 2.0 * np.pi)
            )

    # --- Amplifier and noise --------------------------------------------------
    # Filter the components separately so the SNR can be defined on the ball
    # component *after* the passband, which is where it actually matters.
    club_f = _bandpass(club, cfg.front_end, cfg.sample_rate_hz)
    ball_f = _bandpass(ball, cfg.front_end, cfg.sample_rate_hz)
    hum_f = _bandpass(hum + cfg.front_end.dc_offset, cfg.front_end, cfg.sample_rate_hz)

    noise_f = np.zeros(n, dtype=np.float64)
    if cfg.noise.snr_db is not None:
        rng = np.random.default_rng(cfg.noise.seed)
        noise_f = _bandpass(rng.standard_normal(n), cfg.front_end, cfg.sample_rate_hz)
        window_end = min(n, impact_sample + round(cfg.noise.window_s * cfg.sample_rate_hz))
        ball_power = float(np.mean(ball_f[impact_sample:window_end] ** 2))
        noise_power = float(np.mean(noise_f**2))
        if ball_power <= 0.0 or noise_power <= 0.0:
            raise ValueError("cannot set SNR against a zero-power component")
        noise_f *= np.sqrt(ball_power / (noise_power * 10.0 ** (cfg.noise.snr_db / 10.0)))

    total = club_f + ball_f + hum_f + noise_f

    # --- Sound card -----------------------------------------------------------
    if cfg.front_end.bit_depth is not None:
        fs_amp = cfg.front_end.full_scale
        step = 2.0 * fs_amp / (2**cfg.front_end.bit_depth)
        total = np.clip(np.round(total / step) * step, -fs_amp, fs_amp - step)

    # --- Ground truth ---------------------------------------------------------
    ball_envelope_db = 20.0 * np.log10(np.maximum(envelope, 1e-12) / envelope.max())
    below = np.flatnonzero(ball_envelope_db < -20.0)
    observable_end = cfg.impact_time_s + float(t_ball[below[0]]) if below.size else float(t[-1])

    truth = RadarGroundTruth(
        sample_rate_hz=cfg.sample_rate_hz,
        impact_time_s=cfg.impact_time_s,
        impact_sample=impact_sample,
        launch_speed_mps=cfg.ball.launch_speed_mps,
        radial_launch_speed_mps=float(radial_speed[0]),
        club_peak_speed_mps=cfg.club.peak_speed_mps,
        drag_k_per_m=k,
        launch_angle_deg=cfg.ball.launch_angle_deg,
        ball_observable_start_s=cfg.impact_time_s,
        ball_observable_end_s=observable_end,
    )

    return SyntheticRadarShot(
        samples=total,
        ground_truth=truth,
        config=cfg,
        club_component=club_f,
        ball_component=ball_f,
        noise_component=noise_f,
        hum_component=hum_f,
    )
