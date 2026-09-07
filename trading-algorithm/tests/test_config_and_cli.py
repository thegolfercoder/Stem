"""Config parsing and the command line, which are how most people will use this."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from tradelab.backtesting.costs import BpsCommission
from tradelab.backtesting.slippage import VolumeShareSlippage
from tradelab.cli import main
from tradelab.config import ConfigError, load_run, parse_run
from tradelab.risk.sizing import VolatilityTarget
from tradelab.risk.stops import ATRStop

MINIMAL = {
    "name": "example",
    "strategy": {"type": "ma_crossover", "parameters": {"fast": 10, "slow": 30}},
    "data": {"directory": "data/sample", "development_end": "2019-12-31"},
}


def test_a_minimal_config_gets_sensible_defaults() -> None:
    run = parse_run(MINIMAL)
    assert run.name == "example"
    assert run.strategy.name == "ma_crossover"
    assert run.backtest.initial_capital == 100_000.0
    assert run.data.development_end == "2019-12-31"


def test_every_layer_can_be_configured() -> None:
    run = parse_run(
        {
            **MINIMAL,
            "backtest": {
                "initial_capital": 250_000,
                "commission": {"type": "bps", "bps": 4.0},
                "slippage": {"type": "volume_share", "spread_bps": 2.0},
                "stop": {"type": "atr", "multiple": 2.5},
            },
            "risk": {
                "sizer": {"type": "volatility_target", "annual_target": 0.08},
                "limits": {"max_gross_exposure": 0.8, "allow_shorts": False},
                "drawdown_guard": {"max_drawdown": 0.15},
            },
        }
    )
    assert run.backtest.initial_capital == 250_000
    assert isinstance(run.backtest.commission, BpsCommission)
    assert isinstance(run.backtest.slippage, VolumeShareSlippage)
    assert isinstance(run.backtest.stop, ATRStop)
    assert isinstance(run.risk.sizer, VolatilityTarget)
    assert run.risk.limits.allow_shorts is False
    assert run.risk.drawdown_guard is not None


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        ({**MINIMAL, "rebalance_tolerance": 0.05}, "unknown top-level keys"),
        ({**MINIMAL, "data": {"directroy": "x"}}, "unknown keys under 'data'"),
        ({**MINIMAL, "risk": {"sizerr": {}}}, "unknown keys under 'risk'"),
        ({**MINIMAL, "backtest": {"commission": {"type": "made_up"}}}, "unknown type"),
        ({**MINIMAL, "backtest": {"commission": {"bps": 1}}}, "missing 'type'"),
        ({**MINIMAL, "backtest": {"rebalance_tolerence": 0.1}}, "backtest:"),
        ({"strategy": {"type": "nope"}}, "strategy:"),
        ({"name": "x"}, "'strategy' must be a mapping"),
    ],
)
def test_a_misspelled_key_is_an_error_rather_than_a_silent_default(
    bad: dict[str, object], message: str
) -> None:
    """The whole point: a typo must not leave the default quietly in place."""
    with pytest.raises(ConfigError, match=message):
        parse_run(bad)


def test_symbol_lists_become_tuples_so_a_strategy_stays_hashable() -> None:
    run = parse_run(
        {**MINIMAL, "strategy": {"type": "ma_crossover", "parameters": {"symbols": ["AAA", "BBB"]}}}
    )
    assert run.strategy.symbols == ("AAA", "BBB")  # type: ignore[attr-defined]


def test_the_shipped_configs_all_load() -> None:
    """A config in the repository that does not parse is a broken example."""
    paths = sorted(Path("configs").glob("*.yaml"))
    assert paths, "the configs directory should not be empty"
    for path in paths:
        run = load_run(path)
        assert run.strategy is not None
        assert run.notes.strip(), f"{path.name} has no notes explaining what it is"


def test_the_top_level_of_a_config_must_be_a_mapping(tmp_path: Path) -> None:
    path = tmp_path / "bad.yaml"
    path.write_text("- just\n- a list\n")
    with pytest.raises(ConfigError, match="top level"):
        load_run(path)


def test_cli_lists_strategies(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["strategies"]) == 0
    assert "ma_crossover" in capsys.readouterr().out


def test_cli_checks_data(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["check", "data/sample"]) == 0
    assert "symbol(s) checked" in capsys.readouterr().out


def test_cli_generates_reproducible_data(tmp_path: Path) -> None:
    assert (
        main(
            ["generate", "--output", str(tmp_path), "--start", "2020-01-01", "--end", "2020-06-30"]
        )
        == 0
    )
    first = (tmp_path / "syn_trend.csv").read_bytes()
    assert (
        main(
            ["generate", "--output", str(tmp_path), "--start", "2020-01-01", "--end", "2020-06-30"]
        )
        == 0
    )
    assert (tmp_path / "syn_trend.csv").read_bytes() == first


def test_cli_runs_a_backtest_and_prints_its_assumptions(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    config = {
        **MINIMAL,
        "data": {"directory": "data/sample", "start": "2015-01-01", "end": "2016-12-31"},
    }
    path = tmp_path / "run.yaml"
    path.write_text(yaml.safe_dump(config))

    assert main(["run", str(path), "--split", "all", "--output", str(tmp_path)]) == 0
    output = capsys.readouterr().out
    assert "Sharpe ratio" in output
    assert "Assumptions" in output
    assert "commission:" in output
    assert (tmp_path / "example_all_equity.csv").exists()
    assert (tmp_path / "example_all_trades.csv").exists()
