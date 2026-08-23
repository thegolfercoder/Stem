"""A swing card: the eight events as frames, with the skeleton and the numbers.

A table of frame indices is not what a golfer wants back from their video. The
eight events laid out side by side, with the body drawn on each, is - it is the
sequence they have been shown by every coach they have had, and it is immediately
checkable: if the frame labelled "top" is not the top of the backswing, the
reader can see that without knowing anything about the model.

Making the output falsifiable at a glance is the point. Numbers alone would hide
a mis-detected event behind a confident-looking tempo ratio.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from swingml.analysis import SwingAnalysis
from swingml.events import CLUB_DEFINED_EVENTS, SwingEvent
from swingml.metrics.swing import SwingMetrics
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import BONES

BONE_COLOUR = (0.30, 0.78, 0.95)
JOINT_COLOUR = (1.00, 0.72, 0.20)


def draw_skeleton(
    axis: object, sequence: PoseSequence, frame: int, min_visibility: float = 0.3
) -> None:
    """Draw the pose over whatever is already on the axis, in pixel coordinates."""
    import matplotlib.axes

    assert isinstance(axis, matplotlib.axes.Axes)
    points = sequence.xy[frame].astype(np.float64).copy()
    points[:, 0] *= sequence.frame_width
    points[:, 1] *= sequence.frame_height
    visibility = sequence.visibility[frame]

    for start, end in BONES:
        if min(visibility[int(start)], visibility[int(end)]) < min_visibility:
            continue
        axis.plot(
            [points[int(start), 0], points[int(end), 0]],
            [points[int(start), 1], points[int(end), 1]],
            color=BONE_COLOUR,
            linewidth=1.6,
            solid_capstyle="round",
        )

    visible = visibility >= min_visibility
    axis.scatter(points[visible, 0], points[visible, 1], s=6, color=JOINT_COLOUR, zorder=3)


def _crop_around_body(
    sequence: PoseSequence, frame: int, margin: float = 0.55
) -> tuple[float, float, float, float]:
    """A window around the golfer, so the figure is not a speck in a wide frame."""
    points = sequence.xy[frame].astype(np.float64).copy()
    points[:, 0] *= sequence.frame_width
    points[:, 1] *= sequence.frame_height
    usable = points[sequence.visibility[frame] >= 0.3]
    if len(usable) < 4:
        return 0.0, float(sequence.frame_width), float(sequence.frame_height), 0.0

    centre = usable.mean(axis=0)
    extent = max(np.ptp(usable[:, 0]), np.ptp(usable[:, 1])) * (1.0 + margin)
    extent = max(extent, 32.0)
    return (
        centre[0] - extent / 2,
        centre[0] + extent / 2,
        centre[1] + extent / 2,
        centre[1] - extent / 2,
    )


def swing_card(
    analysis: SwingAnalysis,
    frames: NDArray[np.uint8],
    sequence: PoseSequence,
    path: Path | str,
    title: str = "swing",
) -> Path:
    """Write a figure showing the eight events and the metrics.

    Args:
        analysis: the result to render.
        frames: the source clip's frames, indexed by `event_source_frames`.
        sequence: landmarks on that same frame indexing, for the overlay.
        path: where to write the image.
        title: heading for the card.
    """
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    if isinstance(analysis.events, NoReading):
        raise ValueError(f"nothing to draw: {analysis.events}")

    figure = plt.figure(figsize=(16.0, 6.4), facecolor="#111318")
    grid = figure.add_gridspec(2, 8, height_ratios=[3.0, 1.25], hspace=0.16, wspace=0.04)

    for event in SwingEvent.ordered():
        index = int(event)
        frame_index = int(np.clip(analysis.event_source_frames[index], 0, len(frames) - 1))
        axis = figure.add_subplot(grid[0, index])
        axis.imshow(frames[frame_index])
        draw_skeleton(axis, sequence, frame_index)

        left, right, bottom, top = _crop_around_body(sequence, frame_index)
        axis.set_xlim(left, right)
        axis.set_ylim(bottom, top)
        axis.set_xticks([])
        axis.set_yticks([])
        for spine in axis.spines.values():
            spine.set_color("#333944")

        uncertain = event in CLUB_DEFINED_EVENTS
        axis.set_title(
            event.label + (" *" if uncertain else ""),
            color="#9aa4b2" if uncertain else "#e8ecf2",
            fontsize=9,
            pad=4,
        )
        axis.set_xlabel(
            f"frame {frame_index}  {analysis.event_times_s[index]:.2f}s",
            color="#6b7484",
            fontsize=7.5,
        )

    text_axis = figure.add_subplot(grid[1, :])
    text_axis.axis("off")
    text_axis.set_facecolor("#111318")

    lines: list[str] = []
    metrics = analysis.metrics

    def number(reading: object, template: str) -> str:
        """Format a reading, or say nothing at all where there is no reading.

        A metric that could not be measured is left out of the card rather than
        shown as a dash next to real ones, which reads as a zero.
        """
        return (
            template.format(getattr(reading, "value", float("nan")))
            if not isinstance(reading, NoReading)
            else ""
        )

    if isinstance(metrics, SwingMetrics):
        lines.append(
            "   ".join(
                part
                for part in (
                    number(metrics.tempo_ratio, "tempo {:.2f} : 1"),
                    number(metrics.backswing_duration, "backswing {:.0f} ms"),
                    number(metrics.downswing_duration, "downswing {:.0f} ms"),
                )
                if part
            )
        )
        lines.append(
            "   ".join(
                part
                for part in (
                    number(metrics.shoulder_turn_projected, "shoulder turn {:.0f}deg (projected)"),
                    number(metrics.separation_projected, "separation {:.0f}deg (projected)"),
                    number(metrics.shoulder_turn_3d, "shoulder turn {:.0f}deg (inferred 3D)"),
                )
                if part
            )
        )
        head = metrics.head_movement
        lines.append(
            f"head movement: {head.reason}"
            if isinstance(head, NoReading)
            else f"head movement {head.value:.3f} body lengths"
        )
        lines.append(
            f"kinematic sequence: {' -> '.join(metrics.kinematic_sequence)} "
            f"(from {metrics.kinematic_sequence_source})"
        )
    else:
        lines.append(str(metrics))

    lines.append(
        "* toe-up and mid-follow-through are defined by the club shaft, which a body-pose "
        "estimator does not see; their position rests on the regularity of the swing."
    )
    lines.append(
        "Projected angles are measured in the image plane and are not body angles. "
        "Lengths are in units of the golfer's own body. Nothing here is calibrated."
    )

    text_axis.text(
        0.005,
        0.92,
        "\n".join(line for line in lines if line.strip()),
        color="#c6cedb",
        fontsize=9.5,
        va="top",
        family="monospace",
        linespacing=1.7,
    )

    figure.suptitle(title, color="#e8ecf2", fontsize=13, y=0.985)
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output, dpi=130, facecolor=figure.get_facecolor(), bbox_inches="tight")
    plt.close(figure)
    return output
