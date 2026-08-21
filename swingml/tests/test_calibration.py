"""What an error band is allowed to claim.

The failure this module exists to prevent is a confident-looking error bar that
nothing measured. So the tests are less about arithmetic than about refusals: a
thin bin must decline rather than report, a table must not promise a tighter
band at low confidence than at high, and an analysis with no calibration must
come back with no bands rather than bands of zero.

The one arithmetic property worth pinning is coverage, because it is the whole
claim. A table built on one sample and checked on another should contain about
the share of the second sample that it says it will.
"""

from __future__ import annotations

from itertools import pairwise

import numpy as np
import pytest
from pydantic import ValidationError

from swingml.events import NUM_EVENTS, SwingEvent
from swingml.model.calibration import (
    MIN_BIN_COUNT,
    ErrorBand,
    ModelCalibration,
    build_calibration,
    build_tempo_calibration,
    conformal_quantile,
    load_calibration,
    measure_coverage,
    measure_tempo_coverage,
)
from swingml.quantity import NoReading

MEASURED_ON = "a synthetic corpus made up for this test"


def synthetic(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Confidences, and errors that genuinely shrink as confidence rises.

    Built so that a table has something real to find. If the errors were
    independent of confidence the bands would all come out the same, and a test
    that passes on that data would not notice a lookup that ignored confidence.
    """
    rng = np.random.default_rng(seed)
    confidence = rng.uniform(0.3, 0.99, size=(n, NUM_EVENTS))
    scale = 8.0 * (1.0 - confidence)
    error = rng.exponential(scale)
    return confidence, error


def test_a_thin_bin_declines_instead_of_reporting() -> None:
    confidence, error = synthetic(MIN_BIN_COUNT - 5, seed=0)
    calibration = build_calibration(
        confidence, error, measured_on=MEASURED_ON, n_clips=len(confidence), n_bins=1
    )
    band = calibration.band(SwingEvent.IMPACT, 0.9)
    assert isinstance(band, NoReading)
    assert str(MIN_BIN_COUNT) in band.reason


def test_a_full_bin_reports_a_band_that_carries_its_provenance() -> None:
    confidence, error = synthetic(400, seed=1)
    calibration = build_calibration(
        confidence, error, measured_on=MEASURED_ON, n_clips=400, n_bins=2
    )
    band = calibration.band(SwingEvent.IMPACT, 0.95)
    assert isinstance(band, ErrorBand)
    assert band.measured_on == MEASURED_ON
    assert band.n_calibration >= MIN_BIN_COUNT
    # The corpus is named in the band's own words, not only in a docstring.
    assert MEASURED_ON in str(band)


def test_bands_never_widen_as_the_model_grows_more_confident() -> None:
    """The property the running maximum is there to guarantee."""
    confidence, error = synthetic(800, seed=2)
    calibration = build_calibration(
        confidence, error, measured_on=MEASURED_ON, n_clips=800, n_bins=4
    )
    for event in range(NUM_EVENTS):
        widths = calibration.half_width_frames[event]
        assert all(b <= a for a, b in pairwise(widths)), widths


def test_a_confident_prediction_gets_a_tighter_band_than_a_doubtful_one() -> None:
    confidence, error = synthetic(800, seed=3)
    calibration = build_calibration(
        confidence, error, measured_on=MEASURED_ON, n_clips=800, n_bins=4
    )
    low = calibration.band(SwingEvent.TOP, 0.35)
    high = calibration.band(SwingEvent.TOP, 0.98)
    assert isinstance(low, ErrorBand)
    assert isinstance(high, ErrorBand)
    assert high.half_width_frames < low.half_width_frames


def test_the_promised_coverage_holds_on_data_the_table_did_not_see() -> None:
    """The claim itself, checked the only way it can be: out of sample."""
    fit_confidence, fit_error = synthetic(1500, seed=4)
    check_confidence, check_error = synthetic(1500, seed=5)
    calibration = build_calibration(
        fit_confidence,
        fit_error,
        measured_on=MEASURED_ON,
        n_clips=1500,
        coverage=0.8,
        n_bins=4,
    )
    observed = measure_coverage(calibration, check_confidence, check_error)
    # Continuous errors, so there is no discretisation slack to hide behind and
    # the observed share should land close to the claim from either side.
    assert 0.75 <= observed["all"] <= 0.87, observed


def test_the_conformal_quantile_covers_and_costs_at_most_one_order_statistic() -> None:
    """Covers the nominal share, and is barely wider than the plain quantile.

    The (n+1) correction deliberately steps one order statistic further out than
    the naive percentile, which is what buys coverage in finite samples. It must
    step out - a bound that covered exactly eighty of a hundred would under-cover
    on the next sample - and it must not step out further than that, or the bands
    become pessimistic for no reason.
    """
    errors = np.arange(1.0, 101.0)
    bound = conformal_quantile(errors, 0.8)
    assert float(np.mean(errors <= bound)) >= 0.8
    naive = float(np.quantile(errors, 0.8))
    assert naive <= bound <= naive + 1.0


def test_a_sample_too_small_for_the_coverage_returns_the_widest_honest_answer() -> None:
    """Two samples cannot support ninety-nine percent coverage; say the largest."""
    assert conformal_quantile(np.array([2.0, 7.0]), 0.99) == 7.0


def test_a_table_whose_shape_does_not_agree_is_rejected() -> None:
    confidence, error = synthetic(200, seed=6)
    good = build_calibration(confidence, error, measured_on=MEASURED_ON, n_clips=200, n_bins=2)
    broken = good.model_dump()
    broken["counts"] = tuple(row[:1] for row in good.counts)
    with pytest.raises(ValidationError):
        type(good).model_validate(broken)


def test_a_calibration_survives_the_round_trip_through_disk(tmp_path) -> None:  # type: ignore[no-untyped-def]
    confidence, error = synthetic(400, seed=7)
    predicted, truth = synthetic_tempo(400, seed=7)
    calibration = ModelCalibration(
        events=build_calibration(confidence, error, measured_on=MEASURED_ON, n_clips=400, n_bins=3),
        tempo=build_tempo_calibration(predicted, truth, measured_on=MEASURED_ON),
    )
    path = tmp_path / "event_calibration.json"
    path.write_text(calibration.model_dump_json(), encoding="utf-8")
    assert load_calibration(path) == calibration


def test_a_calibration_with_no_tempo_band_loads_as_having_none(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Absent must survive the round trip as absent, never as zero."""
    confidence, error = synthetic(400, seed=11)
    calibration = ModelCalibration(
        events=build_calibration(confidence, error, measured_on=MEASURED_ON, n_clips=400, n_bins=2)
    )
    path = tmp_path / "event_calibration.json"
    path.write_text(calibration.model_dump_json(), encoding="utf-8")
    assert load_calibration(path).tempo is None


def test_bands_come_back_one_per_event_in_order() -> None:
    confidence, error = synthetic(400, seed=8)
    calibration = build_calibration(
        confidence, error, measured_on=MEASURED_ON, n_clips=400, n_bins=2
    )
    bands = calibration.bands(tuple(0.9 for _ in range(NUM_EVENTS)))
    assert len(bands) == NUM_EVENTS
    with pytest.raises(ValueError, match="expected"):
        calibration.bands((0.9, 0.9))


def test_the_report_names_every_event() -> None:
    confidence, error = synthetic(400, seed=9)
    calibration = build_calibration(
        confidence, error, measured_on=MEASURED_ON, n_clips=400, n_bins=2
    )
    text = calibration.report()
    for event in SwingEvent.ordered():
        assert event.label in text
    assert MEASURED_ON in text


def synthetic_tempo(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """True tempo ratios and predictions off them by a known relative spread."""
    rng = np.random.default_rng(seed)
    truth = rng.uniform(1.8, 4.0, size=n)
    return truth * (1.0 + rng.normal(0.0, 0.12, size=n)), truth


def test_the_tempo_band_is_relative_and_carries_its_corpus() -> None:
    predicted, truth = synthetic_tempo(600, seed=20)
    band = build_tempo_calibration(predicted, truth, measured_on=MEASURED_ON)
    assert band.n_calibration == 600
    assert band.measured_on == MEASURED_ON
    # Predictions were drawn 12% wide, so an 80% band lands near 1.28 sigma.
    assert 0.10 <= band.half_width_fraction <= 0.22, band


def test_the_tempo_band_covers_what_it_claims_out_of_sample() -> None:
    fit_predicted, fit_truth = synthetic_tempo(1200, seed=21)
    check_predicted, check_truth = synthetic_tempo(1200, seed=22)
    band = build_tempo_calibration(fit_predicted, fit_truth, measured_on=MEASURED_ON, coverage=0.8)
    observed = measure_tempo_coverage(band, check_predicted, check_truth)
    assert 0.75 <= observed <= 0.87, observed


def test_the_tempo_interval_widens_with_the_value_it_describes() -> None:
    """A relative band on a bigger ratio is a wider absolute range, not the same one."""
    predicted, truth = synthetic_tempo(400, seed=23)
    band = build_tempo_calibration(predicted, truth, measured_on=MEASURED_ON)
    narrow = band.interval(2.0)
    wide = band.interval(4.0)
    assert (wide[1] - wide[0]) > (narrow[1] - narrow[0])
    assert narrow[0] < 2.0 < narrow[1]


def test_a_tempo_band_cannot_be_measured_from_nothing() -> None:
    with pytest.raises(ValueError, match="no swings"):
        build_tempo_calibration(np.empty(0), np.empty(0), measured_on=MEASURED_ON)


def test_an_impossible_true_tempo_is_rejected_rather_than_divided_by() -> None:
    with pytest.raises(ValueError, match="positive"):
        build_tempo_calibration(np.array([2.0, 3.0]), np.array([2.0, 0.0]), measured_on=MEASURED_ON)
