"""Derived physical relationships shared by the generators and the estimators.

Everything here is derived from `launchmon.constants` at call time. No number in
this module is written down that could instead be computed.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from launchmon.constants import (
    AIR_DENSITY_KGM3,
    AIR_DYNAMIC_VISCOSITY_PAS,
    BALL_DIAMETER_M,
    BALL_MASS_KG,
    RADAR_TX_HZ,
    SPEED_OF_LIGHT_MPS,
)


def ball_frontal_area_m2(diameter_m: float = BALL_DIAMETER_M) -> float:
    """Frontal area of a sphere, A = pi*d^2/4, in m^2."""
    return float(np.pi * diameter_m**2 / 4.0)


def doppler_hz_per_mps(tx_hz: float = RADAR_TX_HZ, c_mps: float = SPEED_OF_LIGHT_MPS) -> float:
    """Doppler sensitivity of a monostatic CW radar, Hz per m/s of radial speed.

    From f_d = 2*v*f_tx/c, so the sensitivity is 2*f_tx/c. Derived rather than
    written down, because a module whose oscillator sits off nominal changes it.
    """
    return 2.0 * tx_hz / c_mps


def speed_to_doppler_hz(
    speed_mps: float | NDArray[np.float64],
    tx_hz: float = RADAR_TX_HZ,
    c_mps: float = SPEED_OF_LIGHT_MPS,
) -> NDArray[np.float64]:
    """Doppler beat frequency, Hz, for a radial speed in m/s.

    A homodyne module such as the CDM324 outputs |f_d| only: the sign of the
    radial velocity is not recoverable from a single mixer output.
    """
    return np.asarray(speed_mps, dtype=np.float64) * doppler_hz_per_mps(tx_hz, c_mps)


def doppler_hz_to_speed(
    doppler_hz: float | NDArray[np.float64],
    tx_hz: float = RADAR_TX_HZ,
    c_mps: float = SPEED_OF_LIGHT_MPS,
) -> NDArray[np.float64]:
    """Radial speed, m/s, for a Doppler beat frequency in Hz."""
    return np.asarray(doppler_hz, dtype=np.float64) / doppler_hz_per_mps(tx_hz, c_mps)


def drag_decel_coefficient(
    drag_coefficient: float,
    air_density_kgm3: float = AIR_DENSITY_KGM3,
    ball_mass_kg: float = BALL_MASS_KG,
    ball_diameter_m: float = BALL_DIAMETER_M,
) -> float:
    """The k in dv/dt = -k*v^2 for a sphere in pure drag, units 1/m.

    k = rho*A*Cd / (2*m). `drag_coefficient` is a caller-supplied input, not a
    constant of this module: the fitted value comes from the Stage 2 trajectory
    fit, and any value used before that fit exists is provisional.
    """
    area = ball_frontal_area_m2(ball_diameter_m)
    return air_density_kgm3 * area * drag_coefficient / (2.0 * ball_mass_kg)


def drag_decay_speed(
    t_s: NDArray[np.float64], launch_speed_mps: float, k_per_m: float
) -> NDArray[np.float64]:
    """Speed against time for pure quadratic drag, v(t) = v0 / (1 + k*v0*t).

    This is the exact solution of dv/dt = -k*v^2 for constant k, and it is the
    functional form the ball-segment decay fit inverts to recover v0 at t=0.

    It is a one-dimensional model: it carries no gravity, no lift and no change
    in Cd with Reynolds number, and it treats the flight direction as fixed. It
    describes the along-beam speed history over the short window in which the
    ball is still inside the radar beam. It is not the trajectory model, must
    not be used to compute carry, apex or any flight outcome, and will diverge
    from the Stage 2 integrator over a full flight.
    """
    t = np.asarray(t_s, dtype=np.float64)
    return np.asarray(launch_speed_mps / (1.0 + k_per_m * launch_speed_mps * t))


def reynolds_number(
    speed_mps: float,
    ball_diameter_m: float = BALL_DIAMETER_M,
    air_density_kgm3: float = AIR_DENSITY_KGM3,
    dynamic_viscosity_pas: float = AIR_DYNAMIC_VISCOSITY_PAS,
) -> float:
    """Reynolds number for a ball of given speed, Re = rho*v*d/mu."""
    return air_density_kgm3 * speed_mps * ball_diameter_m / dynamic_viscosity_pas


def cosine_projection_factor(
    downrange_m: NDArray[np.float64],
    launch_angle_rad: float,
    sensor_range_m: float,
    sensor_height_m: float,
    tee_height_m: float,
) -> NDArray[np.float64]:
    """cos(theta) between the ball velocity and the sensor line of sight.

    The radar measures only the component of velocity along its line of sight,
    so it under-reads by this factor: v_true = v_radial / cos(theta). The factor
    is not constant. It changes as the ball climbs away from a sensor that sits
    behind and below it, which is why it is returned per sample rather than as a
    single number.

    Args:
        downrange_m: horizontal distance travelled from the tee, m.
        launch_angle_rad: launch angle above horizontal, radians.
        sensor_range_m: horizontal distance from sensor to tee, m.
        sensor_height_m: sensor phase-centre height above the ground, m.
        tee_height_m: ball centre height above the ground at rest, m.

    Returns:
        cos(theta) per input sample, dimensionless.
    """
    x = np.asarray(downrange_m, dtype=np.float64)
    # Ball position relative to the sensor, in the vertical plane containing both.
    los_x = sensor_range_m + x
    los_y = tee_height_m - sensor_height_m + x * np.tan(launch_angle_rad)
    los_norm = np.hypot(los_x, los_y)
    # Unit velocity vector: fixed direction over the short observation window.
    vx, vy = np.cos(launch_angle_rad), np.sin(launch_angle_rad)
    return np.asarray((los_x * vx + los_y * vy) / los_norm)
