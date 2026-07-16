"""Scientific analysis and visualization with Matplotlib.

Turns the recorded time series (:class:`~evosim.stats.StatsRecorder`) into the
kind of figures a STEM exhibition needs to *evidence* evolution:

* population & food dynamics over time,
* mean-trait trajectories (directional selection made visible),
* number of coexisting species (divergence),
* trophic composition (herbivore/omnivore/carnivore),
* mortality broken down by cause,
* a predator-prey phase portrait (Lotka-Volterra-style).

Uses the non-interactive ``Agg`` backend so it runs headless on a server.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from ..stats import StatsRecorder  # noqa: E402


def _smooth(y, window: int = 9):
    import numpy as np

    if len(y) < window or window < 2:
        return y
    kernel = np.ones(window) / window
    return np.convolve(y, kernel, mode="same")


def plot_population_dynamics(stats: StatsRecorder, ax) -> None:
    t = stats.column("tick")
    ax.plot(t, stats.column("population"), color="#2b8cbe", label="organisms")
    ax2 = ax.twinx()
    ax2.plot(t, stats.column("food"), color="#31a354", alpha=0.5, label="plants")
    ax.set_title("Population & food dynamics")
    ax.set_xlabel("tick")
    ax.set_ylabel("organisms", color="#2b8cbe")
    ax2.set_ylabel("plants", color="#31a354")
    ax.grid(alpha=0.2)


def plot_trait_evolution(stats: StatsRecorder, ax) -> None:
    t = stats.column("tick")
    for key, color in [
        ("avg_speed", "#e6550d"),
        ("avg_size", "#756bb1"),
        ("avg_camouflage", "#3182bd"),
        ("avg_diet", "#c51b8a"),
    ]:
        y = stats.column(key)
        # Normalize each trait to its own 0..1 range for a shared axis.
        finite = y[~_isnan(y)]
        if len(finite) == 0:
            continue
        lo, hi = finite.min(), finite.max()
        span = hi - lo if hi > lo else 1.0
        ax.plot(t, (y - lo) / span, color=color, label=key.replace("avg_", ""))
    ax.set_title("Mean trait evolution (normalized)")
    ax.set_xlabel("tick")
    ax.set_ylabel("relative value")
    ax.legend(fontsize=8, loc="upper left")
    ax.grid(alpha=0.2)


def plot_species(stats: StatsRecorder, ax) -> None:
    t = stats.column("tick")
    ax.plot(t, stats.column("species"), color="#636363")
    ax.fill_between(t, stats.column("species"), color="#bdbdbd", alpha=0.4)
    ax.set_title("Emergent species count")
    ax.set_xlabel("tick")
    ax.set_ylabel("# species")
    ax.grid(alpha=0.2)


def plot_trophic(stats: StatsRecorder, ax) -> None:
    t = stats.column("tick")
    herb = _smooth(stats.column("herbivores"))
    omni = _smooth(stats.column("omnivores"))
    carn = _smooth(stats.column("carnivores"))
    ax.stackplot(
        t, herb, omni, carn,
        labels=["herbivore", "omnivore", "carnivore"],
        colors=["#31a354", "#fec44f", "#de2d26"],
        alpha=0.85,
    )
    ax.set_title("Trophic composition")
    ax.set_xlabel("tick")
    ax.set_ylabel("organisms")
    ax.legend(fontsize=8, loc="upper left")


def plot_mortality(stats: StatsRecorder, ax) -> None:
    t = stats.column("tick")
    ax.plot(t, _smooth(stats.column("deaths_starvation")), color="#d95f0e", label="starvation")
    ax.plot(t, _smooth(stats.column("deaths_predation")), color="#c51b8a", label="predation")
    ax.plot(t, _smooth(stats.column("deaths_old_age")), color="#2c7fb8", label="old age")
    ax.set_title("Mortality by cause (smoothed)")
    ax.set_xlabel("tick")
    ax.set_ylabel("deaths / tick")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.2)


def plot_predator_prey_phase(stats: StatsRecorder, ax) -> None:
    prey = _smooth(stats.column("herbivores"))
    pred = _smooth(stats.column("carnivores"))
    ax.plot(prey, pred, color="#756bb1", alpha=0.7, linewidth=0.9)
    ax.set_title("Predator-prey phase portrait")
    ax.set_xlabel("herbivores (prey)")
    ax.set_ylabel("carnivores (predators)")
    ax.grid(alpha=0.2)


def _isnan(arr):
    import numpy as np

    return np.isnan(arr)


def generate_report(stats: StatsRecorder, output_dir: str = "data", prefix: str = "evosim") -> str:
    """Render the full multi-panel scientific report to a PNG and return its path."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    fig, axes = plt.subplots(3, 2, figsize=(15, 12))
    plot_population_dynamics(stats, axes[0, 0])
    plot_trait_evolution(stats, axes[0, 1])
    plot_species(stats, axes[1, 0])
    plot_trophic(stats, axes[1, 1])
    plot_mortality(stats, axes[2, 0])
    plot_predator_prey_phase(stats, axes[2, 1])
    fig.suptitle("EvoSim - Evolution of a Digital Ecosystem", fontsize=16, y=0.995)
    fig.tight_layout(rect=(0, 0, 1, 0.98))

    path = out / f"{prefix}_report.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return str(path)
