"""Turning a YAML file into the objects a run needs.

A run is defined entirely by its config file plus the data it points at, so a
result can be reproduced by anyone with the same two things. Unknown keys are an
error rather than being ignored: a silently misspelled ``rebalance_tolerence``
would otherwise leave the default in place and quietly change the answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from tradelab.backtesting.costs import (
    BpsCommission,
    CommissionModel,
    FixedCommission,
    NoCommission,
    PerShareCommission,
)
from tradelab.backtesting.engine import BacktestConfig
from tradelab.backtesting.slippage import (
    FixedBpsSlippage,
    NoSlippage,
    SlippageModel,
    VolatilityScaledSlippage,
    VolumeShareSlippage,
)
from tradelab.risk.limits import DrawdownGuard, RiskLimits, RiskManager
from tradelab.risk.sizing import (
    FixedFractional,
    InverseVolatility,
    PositionSizer,
    Unsized,
    VolatilityTarget,
)
from tradelab.risk.stops import ATRStop, PercentStop, StopRule, TrailingStop
from tradelab.strategies import build as build_strategy
from tradelab.strategies.base import Strategy

_COMMISSIONS: dict[str, type[CommissionModel]] = {
    "none": NoCommission,
    "bps": BpsCommission,
    "per_share": PerShareCommission,
    "fixed": FixedCommission,
}
_SLIPPAGE: dict[str, type[SlippageModel]] = {
    "none": NoSlippage,
    "fixed_bps": FixedBpsSlippage,
    "volume_share": VolumeShareSlippage,
    "volatility_scaled": VolatilityScaledSlippage,
}
_SIZERS: dict[str, type[PositionSizer]] = {
    "none": Unsized,
    "fixed_fractional": FixedFractional,
    "inverse_volatility": InverseVolatility,
    "volatility_target": VolatilityTarget,
}
_STOPS: dict[str, type[StopRule]] = {
    "percent": PercentStop,
    "atr": ATRStop,
    "trailing": TrailingStop,
}


class ConfigError(ValueError):
    """Raised for anything wrong with a config file."""


def _build(table: dict[str, type[Any]], spec: dict[str, Any] | None, what: str) -> Any:
    if spec is None:
        return None
    spec = dict(spec)
    kind = spec.pop("type", None)
    if kind is None:
        raise ConfigError(f"{what}: missing 'type'")
    if kind not in table:
        raise ConfigError(f"{what}: unknown type {kind!r}; known: {sorted(table)}")
    try:
        return table[kind](**spec)
    except TypeError as exc:
        raise ConfigError(f"{what}: {exc}") from exc


@dataclass(frozen=True)
class DataConfig:
    """Where the bars come from, and where the out-of-sample boundary sits."""

    directory: str = "data/sample"
    symbols: list[str] | None = None
    development_end: str | None = None
    start: str | None = None
    end: str | None = None


@dataclass(frozen=True)
class RunConfig:
    """One complete, reproducible experiment."""

    name: str
    strategy: Strategy
    data: DataConfig
    backtest: BacktestConfig
    risk: RiskManager
    notes: str = ""
    source_path: Path | None = None


def load_run(path: Path | str) -> RunConfig:
    """Read a run config from YAML."""
    path = Path(path)
    raw = yaml.safe_load(path.read_text())
    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: the top level must be a mapping")
    return parse_run(raw, source_path=path)


def parse_run(raw: dict[str, Any], *, source_path: Path | None = None) -> RunConfig:
    known = {"name", "notes", "strategy", "data", "backtest", "risk"}
    unknown = set(raw) - known
    if unknown:
        raise ConfigError(f"unknown top-level keys: {sorted(unknown)}")

    strategy_spec = raw.get("strategy")
    if not isinstance(strategy_spec, dict) or "type" not in strategy_spec:
        raise ConfigError("'strategy' must be a mapping with a 'type'")
    parameters = dict(strategy_spec.get("parameters") or {})
    if isinstance(parameters.get("symbols"), list):
        parameters["symbols"] = tuple(parameters["symbols"])
    try:
        strategy = build_strategy(strategy_spec["type"], parameters)
    except (KeyError, TypeError, ValueError) as exc:
        raise ConfigError(f"strategy: {exc}") from exc

    data_spec = dict(raw.get("data") or {})
    unknown_data = set(data_spec) - {
        "directory",
        "symbols",
        "development_end",
        "start",
        "end",
    }
    if unknown_data:
        raise ConfigError(f"unknown keys under 'data': {sorted(unknown_data)}")
    data = DataConfig(**data_spec)

    backtest_spec = dict(raw.get("backtest") or {})
    commission = _build(_COMMISSIONS, backtest_spec.pop("commission", None), "commission")
    slippage = _build(_SLIPPAGE, backtest_spec.pop("slippage", None), "slippage")
    stop = _build(_STOPS, backtest_spec.pop("stop", None), "stop")
    defaults = BacktestConfig()
    try:
        backtest = BacktestConfig(
            commission=commission or defaults.commission,
            slippage=slippage or defaults.slippage,
            stop=stop,
            **backtest_spec,
        )
    except TypeError as exc:
        raise ConfigError(f"backtest: {exc}") from exc

    risk_spec = dict(raw.get("risk") or {})
    unknown_risk = set(risk_spec) - {"sizer", "limits", "drawdown_guard"}
    if unknown_risk:
        raise ConfigError(f"unknown keys under 'risk': {sorted(unknown_risk)}")
    sizer = _build(_SIZERS, risk_spec.get("sizer"), "risk.sizer") or Unsized()
    try:
        limits = RiskLimits(**(risk_spec.get("limits") or {}))
        guard_spec = risk_spec.get("drawdown_guard")
        guard = DrawdownGuard(**guard_spec) if guard_spec else None
    except TypeError as exc:
        raise ConfigError(f"risk: {exc}") from exc

    return RunConfig(
        name=str(raw.get("name") or (source_path.stem if source_path else strategy.name)),
        strategy=strategy,
        data=data,
        backtest=backtest,
        risk=RiskManager(limits=limits, sizer=sizer, drawdown_guard=guard),
        notes=str(raw.get("notes") or ""),
        source_path=source_path,
    )
