"""The parameter draw, and the guard against it quietly losing an axis.

There used to be two of these. Cheap samples projected the rig through a camera
model; expensive ones rendered it to video and ran a real pose estimator over the
result, and each had its own copy of the code that decides what one golfer, one
swing and one camera look like. They drifted, in both directions and silently.

The rendered path - the one the shipped model is actually trained on - had ended
up drawing no body-width variation whatsoever while its config declared a range
of 0.55 to 1.15, no per-segment length jitter, and every golfer turning pelvis and
thorax through identical angles. The cheap path had lost the waggle at address.
Neither was decided; each was a field added on one side of a fork.

What makes that failure invisible is that both paths keep working. Nothing raises,
nothing looks wrong, the model trains and scores fine - it has simply never been
shown a golfer of a different shape, and nobody finds out until real footage
arrives. So the test below is not about any particular field: it pins every range
the config declares, one at a time, and fails if moving it changes nothing.
"""

from __future__ import annotations

import numpy as np
import pytest

from synth.dataset import SampleConfig, draw_swing

RANGE_FIELDS = tuple(
    name
    for name, field in SampleConfig.model_fields.items()
    if str(field.annotation) in ("tuple[float, float]", "tuple[int, int]")
)


def summarise(config: SampleConfig, seeds: range) -> str:
    """Every drawn number, as one comparable string."""
    return "|".join(draw_swing(seed, config).model_dump_json() for seed in seeds)


def test_there_is_at_least_a_realistic_number_of_ranges_to_check() -> None:
    """Guards the guard: a rename that emptied RANGE_FIELDS would pass everything."""
    assert len(RANGE_FIELDS) > 15


@pytest.mark.parametrize("field", RANGE_FIELDS)
def test_every_range_the_config_declares_reaches_the_draw(field: str) -> None:
    """Pin a range to each end in turn; the swings drawn must differ.

    Pinning rather than widening keeps the random stream aligned - `_uniform`
    consumes exactly one number whatever its bounds - so the only thing that can
    differ between the two runs is the field under test.
    """
    low, high = getattr(SampleConfig(), field)
    if low == high:
        pytest.skip(f"{field} is not a range")
    at_low = SampleConfig(**{field: (low, low)})
    at_high = SampleConfig(**{field: (high, high)})
    seeds = range(4_000, 4_012)
    assert summarise(at_low, seeds) != summarise(at_high, seeds), (
        f"{field} is declared in SampleConfig and makes no difference to what is drawn"
    )


def test_the_same_seed_draws_the_same_swing() -> None:
    assert draw_swing(77).model_dump_json() == draw_swing(77).model_dump_json()
    assert draw_swing(77).model_dump_json() != draw_swing(78).model_dump_json()


def test_the_capture_rates_are_the_ones_asked_for() -> None:
    """A caller that renders video cannot afford 240 Hz and has to be able to say so."""
    config = SampleConfig(capture_rates_hz=(30.0, 60.0))
    drawn = {draw_swing(seed, config).capture_rate_hz for seed in range(200)}
    assert drawn == {30.0, 60.0}


def test_an_azimuth_range_is_honoured_up_to_the_mirror() -> None:
    """A left-hander filmed from the same side of the bay presents mirrored."""
    for seed in range(150):
        drawn = draw_swing(seed, azimuth_range=(70.0, 110.0))
        assert 70.0 <= abs(drawn.azimuth_deg) <= 110.0
        assert (drawn.azimuth_deg < 0) == drawn.left_handed


def test_the_corpus_gets_both_orientations() -> None:
    orientations = {draw_swing(seed).landscape for seed in range(100)}
    assert orientations == {True, False}


def test_landscape_costs_the_same_to_render_as_portrait() -> None:
    """Sized by the long edge, so orientation does not decide the pixel budget.

    Sizing by height instead makes a landscape clip three times the pixels of a
    portrait one, and a corpus built under a compute budget then quietly contains
    no landscape at all - which is what the first eighteen hundred clips did.
    """
    portrait = next(d for d in map(draw_swing, range(50)) if not d.landscape)
    landscape = next(d for d in map(draw_swing, range(50)) if d.landscape)
    assert portrait.frame_size(854) == (480, 854)
    assert landscape.frame_size(854) == (854, 480)


def test_bodies_are_not_all_the_same_shape() -> None:
    """The axis the rendered corpus had lost entirely.

    A pose estimator does not report the width of the body in front of it; it
    reports where its own anatomical prior puts the joints, and that prior moves
    a long way with camera angle. A model trained on one shoulder-to-hip ratio has
    learned that ratio.
    """
    draws = [draw_swing(seed) for seed in range(120)]
    ratio = np.array([d.body.shoulder_width_m / d.body.hip_width_m for d in draws])
    widths = np.array([d.body.shoulder_width_m for d in draws])
    assert widths.max() / widths.min() > 1.8
    assert ratio.std() > 0.05


def test_golfers_do_not_all_turn_by_the_same_angles() -> None:
    draws = [draw_swing(seed) for seed in range(120)]
    for attribute in ("pelvis_turn_top_deg", "thorax_turn_top_deg", "thorax_turn_finish_deg"):
        values = np.array([getattr(d.geometry, attribute) for d in draws])
        assert values.std() > 1.0, attribute


def test_some_golfers_waggle_before_they_swing() -> None:
    counts = {draw_swing(seed).timing.waggle_count for seed in range(100)}
    assert counts != {0}
    assert 0 in counts
