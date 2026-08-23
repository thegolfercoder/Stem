"""Stage 1 acceptance: recovering a known launch speed, and refusing when it cannot."""

from __future__ import annotations

import numpy as np
import pytest

from launchmon.dsp.pipeline import RadarResult, analyse_radar_capture
from launchmon.dsp.presets import default_radar_pipeline
from launchmon.quantity import NoReading, Provenance
from tests.synth.presets import radar_config
from tests.synth.radar import CosineMode, generate_shot

# The signal-to-noise ratio at which the brief's accuracy target applies. It is
# stated here because "high SNR" is not a testable phrase, and because the
# analogue front end has to be specified against a number.
HIGH_SNR_DB = 20.0

# The whole range the instrument is meant to cover, from a chip to a tour drive.
ACCEPTANCE_SPEEDS_MPS = (15.0, 25.0, 40.0, 53.64, 62.58, 74.66)


def _run(**kwargs: object) -> tuple[RadarResult, float]:
    shot = generate_shot(radar_config(**kwargs))  # type: ignore[arg-type]
    result = analyse_radar_capture(shot.samples, default_radar_pipeline())
    return result, shot.ground_truth.radial_launch_speed_mps


@pytest.mark.parametrize("launch_speed_mps", ACCEPTANCE_SPEEDS_MPS)
@pytest.mark.parametrize("seed", [0, 1, 2, 3, 4])
def test_acceptance_launch_speed_within_half_a_percent_at_high_snr(
    launch_speed_mps: float, seed: int
) -> None:
    """Stage 1 acceptance, over the full speed range and several noise realisations."""
    result, truth = _run(launch_speed_mps=launch_speed_mps, snr_db=HIGH_SNR_DB, seed=seed)
    reading = result.ball_launch_speed.reading
    assert not isinstance(reading, NoReading), reading
    assert reading.provenance is Provenance.MEASURED
    assert abs(reading.value - truth) / truth < 0.005


def test_the_estimator_reports_which_fit_it_used() -> None:
    result, _ = _run(launch_speed_mps=74.66, snr_db=HIGH_SNR_DB)
    assert result.ball_launch_speed.fit_mode_used is not None


def test_mains_hum_does_not_move_the_answer() -> None:
    """Hum and its harmonics are a documented interferer for these modules."""
    clean, truth = _run(launch_speed_mps=53.64, snr_db=HIGH_SNR_DB)
    noisy, _ = _run(launch_speed_mps=53.64, snr_db=HIGH_SNR_DB, hum=True)
    for result in (clean, noisy):
        assert not isinstance(result.ball_launch_speed.reading, NoReading)
    assert abs(noisy.ball_launch_speed.reading.value - truth) / truth < 0.005  # type: ignore[union-attr]


@pytest.mark.parametrize("passband", [(200.0, 5_000.0), (200.0, 3_000.0)])
def test_a_front_end_that_cannot_pass_the_ball_is_refused_when_it_is_declared(
    passband: tuple[float, float],
) -> None:
    """A wrong passband the software knows about must produce no reading.

    Attenuating the ball's tone lets the club's own return become the strongest
    thing left, and the club is an extended body whose band is wide enough that
    part of it reads as a plausible ball. Knowing what the amplifier is specified
    to pass is what lets that be refused.
    """
    shot = generate_shot(
        radar_config(launch_speed_mps=74.66, snr_db=HIGH_SNR_DB, passband=passband)
    )
    config = default_radar_pipeline(front_end_passband_hz=passband)
    result = analyse_radar_capture(shot.samples, config)

    reading = result.ball_launch_speed.reading
    assert isinstance(reading, NoReading)
    assert reading.reason
    assert isinstance(result.smash_factor, NoReading)


def test_a_front_end_that_does_not_match_its_configuration_is_not_detectable() -> None:
    """A documented limitation, pinned by a test so it cannot be quietly forgotten.

    When the hardware band-limits the ball away but the configuration still
    describes the intended passband, both the ball speed and the clubhead speed
    are drawn from the same distorted club band. They are both wrong and they
    agree with each other, so neither the smash-factor cross-check nor the
    passband guard fires.

    This is not a defect that a better estimator fixes: the information needed to
    settle it was destroyed before the converter. It is an argument for verifying
    the analogue chain at capture time - an injected tone, or the shape of the
    noise floor - which belongs to the capture layer. Until that exists, this is
    what happens, and the test says so.
    """
    shot = generate_shot(
        radar_config(launch_speed_mps=74.66, snr_db=HIGH_SNR_DB, passband=(200.0, 5_000.0))
    )
    # The configuration still claims the intended front end.
    result = analyse_radar_capture(shot.samples, default_radar_pipeline())

    reading = result.ball_launch_speed.reading
    assert not isinstance(reading, NoReading), (
        "if this now refuses, the pipeline gained a genuine detector for a "
        "mismatched front end and this test should be replaced by one asserting it"
    )
    assert reading.value < 0.8 * 74.66
    assert not isinstance(result.smash_factor, NoReading)


def test_smash_factor_is_derived_and_refused_alongside_its_inputs() -> None:
    result, _ = _run(launch_speed_mps=74.66, snr_db=HIGH_SNR_DB)
    assert not isinstance(result.smash_factor, NoReading)
    assert result.smash_factor.provenance is Provenance.DERIVED
    assert 1.05 <= result.smash_factor.value <= 1.60

    empty = analyse_radar_capture(
        np.random.default_rng(5).standard_normal(int(0.7 * 48_000)), default_radar_pipeline()
    )
    assert isinstance(empty.smash_factor, NoReading)


def test_projected_geometry_yields_the_radial_speed_not_the_true_speed() -> None:
    """The radar measures along its own line of sight and nothing else.

    Correcting for that needs a launch angle, which belongs to fusion. The DSP
    must not quietly apply a cosine factor of its own.
    """
    shot = generate_shot(
        radar_config(launch_speed_mps=74.66, snr_db=HIGH_SNR_DB, cosine_mode=CosineMode.PROJECTED)
    )
    result = analyse_radar_capture(shot.samples, default_radar_pipeline())
    reading = result.ball_launch_speed.reading
    assert not isinstance(reading, NoReading)

    truth = shot.ground_truth
    assert truth.radial_launch_speed_mps < truth.launch_speed_mps
    assert abs(reading.value - truth.radial_launch_speed_mps) / truth.radial_launch_speed_mps < 0.02


def test_noise_alone_produces_no_reading_with_a_reason() -> None:
    rng = np.random.default_rng(11)
    result = analyse_radar_capture(rng.standard_normal(int(0.7 * 48_000)), default_radar_pipeline())
    assert isinstance(result.ball_launch_speed.reading, NoReading)
    assert isinstance(result.clubhead_speed, NoReading)


@pytest.mark.parametrize("clubhead_speed_mps", [16.89, 36.24, 50.45])
def test_clubhead_speed_reads_the_upper_edge_of_the_club_band(
    clubhead_speed_mps: float,
) -> None:
    """The head is the fastest point on the shaft, so it is the band's edge, not its peak."""
    result, _ = _run(
        launch_speed_mps=clubhead_speed_mps * 1.48,
        clubhead_speed_mps=clubhead_speed_mps,
        snr_db=30.0,
    )
    reading = result.clubhead_speed
    assert not isinstance(reading, NoReading), reading
    assert abs(reading.value - clubhead_speed_mps) / clubhead_speed_mps < 0.02


def test_clubhead_edge_estimate_does_not_depend_on_the_shaft_scatterer_model() -> None:
    """If it did, it would be fitted to the generator rather than to the physics.

    The band's upper edge is a hard cutoff at the head's speed however the return
    is distributed along the shaft below it, so the estimate should barely move
    when that distribution is changed. This holds for the family of distributions
    the generator can produce; it says nothing about a real club, hands and body,
    which is what validation against reference clubhead speeds is for.
    """
    readings = []
    for weight_exponent in (3.0, 6.0, 10.0, 20.0):
        result, _ = _run(
            launch_speed_mps=50.45 * 1.48,
            clubhead_speed_mps=50.45,
            snr_db=30.0,
            club_weight_exponent=weight_exponent,
        )
        assert not isinstance(result.clubhead_speed, NoReading)
        readings.append(result.clubhead_speed.value)
    assert (max(readings) - min(readings)) / np.mean(readings) < 0.01
