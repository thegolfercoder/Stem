"""Cost models.

The property that matters for all of them: a cost model may never make a fill
better than the reference price. A sign error here turns a losing strategy into
a winning one and is invisible in a summary table.
"""

from __future__ import annotations

import pytest

from tradelab.backtesting.costs import (
    BpsCommission,
    CompositeCommission,
    FixedCommission,
    NoCommission,
    PerShareCommission,
)
from tradelab.backtesting.slippage import (
    FixedBpsSlippage,
    NoSlippage,
    VolatilityScaledSlippage,
    VolumeShareSlippage,
)

SLIPPAGE_MODELS = [
    NoSlippage(),
    FixedBpsSlippage(5.0),
    VolumeShareSlippage(spread_bps=3.0, coefficient=0.6),
    VolatilityScaledSlippage(fraction=0.05),
]


@pytest.mark.parametrize("model", SLIPPAGE_MODELS, ids=lambda m: type(m).__name__)
@pytest.mark.parametrize("quantity", [1.0, 500.0, -1.0, -500.0])
def test_slippage_never_favours_the_trader(model: object, quantity: float) -> None:
    price = model.fill_price(  # type: ignore[attr-defined]
        reference_price=100.0, quantity=quantity, bar_volume=10_000.0, recent_volatility=0.02
    )
    if quantity > 0:
        assert price >= 100.0
    else:
        assert price <= 100.0


@pytest.mark.parametrize("model", SLIPPAGE_MODELS, ids=lambda m: type(m).__name__)
def test_slippage_survives_missing_volume_and_volatility(model: object) -> None:
    price = model.fill_price(  # type: ignore[attr-defined]
        reference_price=50.0, quantity=100.0, bar_volume=0.0, recent_volatility=0.0
    )
    assert price >= 50.0


def test_fixed_bps_slippage_is_exactly_the_stated_fraction() -> None:
    model = FixedBpsSlippage(bps=10.0)
    assert model.fill_price(
        reference_price=100.0, quantity=1.0, bar_volume=1e6, recent_volatility=0.01
    ) == pytest.approx(100.10)
    assert model.fill_price(
        reference_price=100.0, quantity=-1.0, bar_volume=1e6, recent_volatility=0.01
    ) == pytest.approx(99.90)


def test_volume_share_slippage_grows_with_participation() -> None:
    model = VolumeShareSlippage(spread_bps=0.0, coefficient=1.0, max_participation=1.0)
    small = model.fill_price(
        reference_price=100.0, quantity=10.0, bar_volume=1_000_000.0, recent_volatility=0.02
    )
    large = model.fill_price(
        reference_price=100.0, quantity=100_000.0, bar_volume=1_000_000.0, recent_volatility=0.02
    )
    assert large > small > 100.0


def test_volume_share_slippage_is_capped_at_max_participation() -> None:
    """Beyond the cap the price stops worsening; the broker truncates the order instead."""
    model = VolumeShareSlippage(spread_bps=0.0, coefficient=1.0, max_participation=0.10)
    at_cap = model.fill_price(
        reference_price=100.0, quantity=100_000.0, bar_volume=1_000_000.0, recent_volatility=0.02
    )
    far_beyond = model.fill_price(
        reference_price=100.0, quantity=50_000_000.0, bar_volume=1_000_000.0, recent_volatility=0.02
    )
    assert at_cap == pytest.approx(far_beyond)


def test_commission_is_never_negative() -> None:
    for model in (
        NoCommission(),
        BpsCommission(2.0),
        PerShareCommission(),
        FixedCommission(1.0),
    ):
        for quantity in (1.0, -1.0, 10_000.0, -10_000.0):
            assert model.charge(quantity, 100.0) >= 0.0


def test_bps_commission_matches_the_arithmetic() -> None:
    assert BpsCommission(2.0).charge(1000.0, 50.0) == pytest.approx(1000 * 50 * 2e-4)


def test_per_share_commission_respects_its_floor_and_its_cap() -> None:
    model = PerShareCommission(rate=0.005, minimum=1.0, maximum_fraction_of_notional=0.01)
    assert model.charge(10.0, 100.0) == pytest.approx(1.0)  # floor binds
    assert model.charge(10_000.0, 100.0) == pytest.approx(50.0)  # rate applies
    assert model.charge(100.0, 0.50) == pytest.approx(0.50)  # cap binds on a penny stock


def test_composite_commission_adds_its_parts() -> None:
    model = CompositeCommission((FixedCommission(1.0), BpsCommission(1.0)))
    assert model.charge(1000.0, 10.0) == pytest.approx(1.0 + 1000 * 10 * 1e-4)


def test_every_model_describes_itself() -> None:
    """The tear sheet prints these, so an empty one is a silent gap in a report."""
    for model in (NoCommission(), BpsCommission(), PerShareCommission(), FixedCommission()):
        assert model.describe().strip()
    for slippage in SLIPPAGE_MODELS:
        assert slippage.describe().strip()
