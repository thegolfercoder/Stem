"""Sweep signal-to-noise ratio, ball speed and transform length; report what breaks.

This is a Stage 1 deliverable rather than a diagnostic. Two questions it answers:

*What must the analogue front end deliver?* The specification for the amplifier
is whatever signal-to-noise ratio keeps speed error and the no-reading rate
acceptable, and that is a measurement, not a guess.

*How long should the transform be?* A driven ball's tone sweeps downward while a
single frame is being collected, so a longer window buys frequency resolution and
spends it again on smearing the very peak it is trying to resolve. Which way that
trades is not obvious and is swept rather than argued about.

Every cell reports the no-reading rate alongside the error, because a pipeline
that refuses is behaving correctly and a mean error computed only over the shots
that produced an answer is a misleading number on its own.

Nothing here is an accuracy claim about the instrument. It is the behaviour of
this pipeline on this synthetic signal model, and it will move when the model is
replaced by measurements from real hardware.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from launchmon.dsp.pipeline import analyse_radar_capture
from launchmon.dsp.presets import default_radar_pipeline
from launchmon.quantity import NoReading
from tests.synth.presets import radar_config
from tests.synth.radar import generate_shot

DEFAULT_SPEEDS_MPS = (15.0, 25.0, 40.0, 53.64, 62.58, 74.66)
DEFAULT_SNRS_DB = (40.0, 30.0, 20.0, 15.0, 10.0, 6.0, 3.0, 0.0, -3.0, -6.0)
DEFAULT_WINDOWS = (1024, 2048, 4096)


@dataclass(frozen=True)
class Cell:
    """One combination of conditions, summarised over its noise realisations."""

    n_fft: int
    hop: int
    launch_speed_mps: float
    snr_db: float
    n_shots: int
    n_readings: int
    no_reading_rate: float
    bias_percent: float
    rms_error_percent: float
    max_abs_error_percent: float
    median_frames_used: float
    median_observation_span_ms: float


def run_cell(
    n_fft: int, launch_speed_mps: float, snr_db: float, n_seeds: int, overlap: float
) -> Cell:
    hop = round(n_fft * (1.0 - overlap))
    config = default_radar_pipeline(n_fft=n_fft, hop=hop)

    errors: list[float] = []
    frames: list[int] = []
    spans: list[float] = []
    for seed in range(n_seeds):
        shot = generate_shot(
            radar_config(launch_speed_mps=launch_speed_mps, snr_db=snr_db, seed=seed)
        )
        estimate = analyse_radar_capture(shot.samples, config).ball_launch_speed
        if isinstance(estimate.reading, NoReading):
            continue
        truth = shot.ground_truth.radial_launch_speed_mps
        errors.append(100.0 * (estimate.reading.value - truth) / truth)
        frames.append(estimate.n_frames_used)
        spans.append(1e3 * estimate.observation_span_s)

    e = np.asarray(errors, dtype=np.float64)
    return Cell(
        n_fft=n_fft,
        hop=hop,
        launch_speed_mps=launch_speed_mps,
        snr_db=snr_db,
        n_shots=n_seeds,
        n_readings=e.size,
        no_reading_rate=1.0 - e.size / n_seeds,
        bias_percent=float(np.mean(e)) if e.size else float("nan"),
        rms_error_percent=float(np.sqrt(np.mean(e**2))) if e.size else float("nan"),
        max_abs_error_percent=float(np.max(np.abs(e))) if e.size else float("nan"),
        median_frames_used=float(np.median(frames)) if frames else float("nan"),
        median_observation_span_ms=float(np.median(spans)) if spans else float("nan"),
    )


def sweep(
    speeds: tuple[float, ...],
    snrs: tuple[float, ...],
    windows: tuple[int, ...],
    n_seeds: int,
    overlap: float,
) -> list[Cell]:
    cells: list[Cell] = []
    total = len(windows) * len(speeds) * len(snrs)
    done = 0
    for n_fft in windows:
        for speed in speeds:
            for snr in snrs:
                cells.append(run_cell(n_fft, speed, snr, n_seeds, overlap))
                done += 1
                print(f"\r  {done}/{total} cells", end="", flush=True)
    print()
    return cells


def write_csv(cells: list[Cell], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(asdict(cells[0])))
        writer.writeheader()
        for cell in cells:
            writer.writerow(asdict(cell))


def plot(cells: list[Cell], path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    windows = sorted({c.n_fft for c in cells})
    speeds = sorted({c.launch_speed_mps for c in cells})
    figure, axes = plt.subplots(2, len(windows), figsize=(5.0 * len(windows), 8.0), sharey="row")
    axes = np.atleast_2d(axes)

    for column, n_fft in enumerate(windows):
        for speed in speeds:
            selected = sorted(
                (c for c in cells if c.n_fft == n_fft and c.launch_speed_mps == speed),
                key=lambda c: c.snr_db,
            )
            snrs = [c.snr_db for c in selected]
            axes[0, column].plot(
                snrs, [c.rms_error_percent for c in selected], marker="o", label=f"{speed:.0f} m/s"
            )
            axes[1, column].plot(snrs, [100.0 * c.no_reading_rate for c in selected], marker="o")
        axes[0, column].set_title(f"{n_fft}-point window")
        axes[0, column].set_yscale("log")
        axes[0, column].axhline(0.5, linestyle="--", linewidth=1, color="grey")
        axes[0, column].set_ylabel("RMS speed error (%)")
        axes[1, column].set_ylabel("no reading (%)")
        for row in (0, 1):
            axes[row, column].set_xlabel("in-band SNR of the ball return (dB)")
            axes[row, column].grid(alpha=0.3)

    axes[0, 0].legend(fontsize="small", title="launch speed")
    figure.suptitle(
        "Radar speed estimation against signal-to-noise ratio\n"
        "synthetic signal model; the dashed line is the Stage 1 acceptance target"
    )
    figure.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, dpi=140)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=20, help="noise realisations per cell")
    parser.add_argument("--overlap", type=float, default=0.75, help="STFT overlap fraction")
    parser.add_argument("--out", type=Path, default=Path("out/snr_sweep"))
    parser.add_argument("--windows", type=int, nargs="+", default=list(DEFAULT_WINDOWS))
    parser.add_argument("--speeds", type=float, nargs="+", default=list(DEFAULT_SPEEDS_MPS))
    parser.add_argument("--snrs", type=float, nargs="+", default=list(DEFAULT_SNRS_DB))
    parser.add_argument("--no-plot", action="store_true")
    args = parser.parse_args()

    print(
        f"sweeping {len(args.windows)} windows x {len(args.speeds)} speeds x "
        f"{len(args.snrs)} SNRs x {args.seeds} seeds"
    )
    cells = sweep(
        tuple(args.speeds), tuple(args.snrs), tuple(args.windows), args.seeds, args.overlap
    )

    write_csv(cells, args.out.with_suffix(".csv"))
    args.out.with_suffix(".json").write_text(
        json.dumps([asdict(c) for c in cells], indent=2), encoding="utf-8"
    )
    if not args.no_plot:
        plot(cells, args.out.with_suffix(".png"))
    print(f"wrote {args.out.with_suffix('.csv')}")


if __name__ == "__main__":
    main()
