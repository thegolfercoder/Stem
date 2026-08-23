"""Physical constants fixed by nature or by the rules of golf.

Nothing in this module is fitted, tuned or device-specific. Anything that could
differ between builds of the hardware, between clubs or between golfers belongs
in `launchmon.config`, not here.
"""

from __future__ import annotations

# --- Electromagnetic -------------------------------------------------------

SPEED_OF_LIGHT_MPS: float = 299_792_458.0
"""Speed of light in vacuum, m/s (SI definition, exact)."""

RADAR_TX_HZ: float = 24.125e9
"""Nominal transmit frequency of the CDM324 24 GHz Doppler module, Hz.

The part is a free-running Gunn/DRO-style oscillator, so the true centre
frequency of an individual module differs from nominal. Any measured offset
belongs in hardware config as a correction factor, not here.
"""

# --- Golf ball, R&A/USGA Equipment Rules Part 4 ----------------------------

BALL_MASS_KG: float = 0.04593
"""Maximum permitted ball mass, kg."""

BALL_DIAMETER_M: float = 0.04267
"""Minimum permitted ball diameter, m. Also the camera's scale reference."""

# --- Air -------------------------------------------------------------------

AIR_DENSITY_KGM3: float = 1.225
"""ISA sea-level air density, kg/m^3.

Real ranges are not at ISA conditions. This is the reference value used to
define the model; site density is a config input, not a constant.
"""

AIR_DYNAMIC_VISCOSITY_PAS: float = 1.81e-5
"""Dynamic viscosity of air at 15 degC, Pa.s, used for Reynolds number."""

GRAVITY_MPS2: float = 9.80665
"""Standard gravity, m/s^2."""
