"""Commission models.

Commission is the part of trading cost you can look up, which is why it is
modelled separately from slippage - the part you have to assume. Keeping them
apart means the tear sheet can say how much of the gap between gross and net
came from each.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


class CommissionModel(ABC):
    """Charge for one fill. Always returns a non-negative cash amount."""

    @abstractmethod
    def charge(self, quantity: float, price: float) -> float:
        """Commission on a fill of ``quantity`` units at ``price``."""

    @abstractmethod
    def describe(self) -> str:
        """One line for the assumptions block of a report."""


@dataclass(frozen=True)
class NoCommission(CommissionModel):
    """Zero commission. Useful for isolating a strategy's gross behaviour, and
    dishonest as a headline assumption - say so if you report a result with it."""

    def charge(self, quantity: float, price: float) -> float:
        return 0.0

    def describe(self) -> str:
        return "no commission"


@dataclass(frozen=True)
class PerShareCommission(CommissionModel):
    """A per-unit rate with a per-order floor, as US equity brokers usually bill."""

    rate: float = 0.005
    minimum: float = 1.0
    maximum_fraction_of_notional: float = 0.01

    def charge(self, quantity: float, price: float) -> float:
        raw = abs(quantity) * self.rate
        capped = min(
            max(raw, self.minimum), abs(quantity) * price * self.maximum_fraction_of_notional
        )
        return max(capped, 0.0)

    def describe(self) -> str:
        return (
            f"{self.rate:.4f} per unit, {self.minimum:.2f} minimum, "
            f"capped at {self.maximum_fraction_of_notional:.1%} of notional"
        )


@dataclass(frozen=True)
class BpsCommission(CommissionModel):
    """A flat rate in basis points of notional. The usual convention outside US
    equities, and the safer default when you do not know the fee schedule."""

    bps: float = 2.0

    def charge(self, quantity: float, price: float) -> float:
        return abs(quantity) * price * self.bps * 1e-4

    def describe(self) -> str:
        return f"{self.bps:g} bps of notional"


@dataclass(frozen=True)
class FixedCommission(CommissionModel):
    """A flat fee per order, as retail brokers outside the US often charge."""

    fee: float = 1.0

    def charge(self, quantity: float, price: float) -> float:
        return self.fee if quantity != 0.0 else 0.0

    def describe(self) -> str:
        return f"{self.fee:.2f} per order"


@dataclass(frozen=True)
class CompositeCommission(CommissionModel):
    """Several charges applied together, for venues that bill more than one way."""

    models: tuple[CommissionModel, ...]

    def charge(self, quantity: float, price: float) -> float:
        return sum(model.charge(quantity, price) for model in self.models)

    def describe(self) -> str:
        return " + ".join(model.describe() for model in self.models)
