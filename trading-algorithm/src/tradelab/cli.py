"""Command line interface.

``tradelab --help`` is the entry point for someone who has just cloned the
repository. Every subcommand prints the assumptions behind whatever it computed,
so a number copied out of a terminal carries its caveats with it.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from tradelab import __version__
from tradelab.analytics.metrics import PerformanceSummary
from tradelab.analytics.tearsheet import comparison_table, report, to_markdown
from tradelab.config import load_run
from tradelab.data.loaders import load_directory
from tradelab.research import run_split, with_data_directory


def command_run(args: argparse.Namespace) -> int:
    config = with_data_directory(load_run(args.config), args.data)
    run = run_split(config, args.split)
    result = run.result
    print(report(result, title=f"{config.name}  [{args.split}]"))
    if args.output:
        destination = Path(args.output)
        destination.mkdir(parents=True, exist_ok=True)
        result.equity_curve.to_csv(destination / f"{config.name}_{args.split}_equity.csv")
        result.trades.to_csv(destination / f"{config.name}_{args.split}_trades.csv", index=False)
        print(f"\nwrote equity curve and trade log to {destination}/")
    return 0


def command_compare(args: argparse.Namespace) -> int:
    summaries: dict[str, PerformanceSummary] = {}
    for path in sorted(Path(args.configs).glob("*.yaml")):
        config = with_data_directory(load_run(path), args.data)
        summaries[config.name] = run_split(config, args.split).summary
    if not summaries:
        print(f"no .yaml configs found in {args.configs}", file=sys.stderr)
        return 1
    table = comparison_table(summaries)
    table.index.name = "strategy"
    print(f"split: {args.split}\n")
    print(to_markdown(table))
    print(
        "\nEvery row is one strategy over the same bars with the same cost model. "
        "Compare within a column; nothing here says any of them would work on other data."
    )
    return 0


def command_check(args: argparse.Namespace) -> int:
    _, reports = load_directory(args.directory)
    failures = 0
    for quality in reports:
        print(quality)
        failures += len(quality.warnings)
    print(f"\n{len(reports)} symbol(s) checked, {failures} warning(s)")
    return 0


def command_generate(args: argparse.Namespace) -> int:
    from tradelab.data.synthetic import generate_panel

    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    panel = generate_panel(start=args.start, end=args.end, seed=args.seed)
    for symbol, frame in panel.items():
        path = destination / f"{symbol.lower()}.csv"
        frame = frame.assign(volume=frame["volume"].astype("int64"))
        frame.to_csv(path, float_format="%.4f")
        print(f"wrote {path} ({len(frame)} bars)")
    print(
        "\nThis data is synthetic and was generated with known statistical properties. "
        "A strategy that performs well on it has demonstrated that the code runs, "
        "and nothing about markets."
    )
    return 0


def command_strategies(_args: argparse.Namespace) -> int:
    from tradelab.strategies.registry import registry

    for name, cls in sorted(registry().items()):
        summary = (cls.__doc__ or "").strip().splitlines()
        print(f"{name:<20} {summary[0] if summary else ''}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tradelab",
        description="Backtesting framework for systematic trading research. Not financial advice.",
    )
    parser.add_argument("--version", action="version", version=f"tradelab {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="run one strategy config")
    run.add_argument("config", help="path to a run config YAML")
    run.add_argument("--data", help="override the data directory in the config")
    run.add_argument(
        "--split",
        choices=("development", "out_of_sample", "all"),
        default="development",
        help="which portion of history to report on (default: development)",
    )
    run.add_argument("--output", help="directory to write the equity curve and trade log to")
    run.set_defaults(func=command_run)

    compare = subparsers.add_parser("compare", help="run every config in a directory side by side")
    compare.add_argument("configs", nargs="?", default="configs", help="directory of config files")
    compare.add_argument("--data", help="override the data directory in every config")
    compare.add_argument(
        "--split", choices=("development", "out_of_sample", "all"), default="development"
    )
    compare.set_defaults(func=command_compare)

    check = subparsers.add_parser("check", help="validate a directory of data files")
    check.add_argument("directory")
    check.set_defaults(func=command_check)

    generate = subparsers.add_parser("generate", help="write the synthetic example dataset")
    generate.add_argument("--output", default="data/sample")
    generate.add_argument("--start", default="2010-01-04")
    generate.add_argument("--end", default="2025-12-31")
    generate.add_argument("--seed", type=int, default=20240101)
    generate.set_defaults(func=command_generate)

    strategies = subparsers.add_parser("strategies", help="list registered strategies")
    strategies.set_defaults(func=command_strategies)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
