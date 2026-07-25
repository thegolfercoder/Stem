"""Recover plotted data from a picture of a graph.

The pipeline is geometric rather than learned, which makes it predictable and
debuggable — every stage returns evidence the UI can show and the user can
override:

1. **Gridlines** — long axis-aligned runs of near-identical pixels.
2. **Axes** — the darkest, longest horizontal and vertical lines, which in most
   plotting tools are drawn heavier than the grid.
3. **Calibration** — the modal gridline spacing gives pixels-per-unit once the
   user states what one grid square is worth (default 1).
4. **Curve pixels** — everything that is neither background, grid, axis, nor
   text: in practice, saturated colour, or dark ink on a plain grid.
5. **Trace** — one y per column, taken as the median of that column's curve
   pixels, with columns split into separate strokes across large jumps.

There is no OCR stage: no text engine is guaranteed present, and guessing tick
labels wrongly is worse than asking. The caller supplies (or accepts) the axis
scale, and everything else is measured from the image.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

#: A line must span at least this fraction of the image to count as an axis or
#: gridline, which rejects tick marks and the edges of legend boxes.
MIN_LINE_SPAN = 0.55

#: Saturation above which a pixel is treated as coloured plot ink rather than
#: greyscale chrome.
SATURATION_FLOOR = 80

#: Columns whose traced y differs by more than this fraction of the image height
#: start a new stroke — a real discontinuity, not a steep segment.
STROKE_BREAK_FRACTION = 0.22


@dataclass
class Axes:
    """Pixel geometry of the detected coordinate frame."""

    origin_x: float
    origin_y: float
    #: Pixels per grid square, horizontally and vertically.
    pixels_per_cell_x: float
    pixels_per_cell_y: float
    x_gridlines: list[int] = field(default_factory=list)
    y_gridlines: list[int] = field(default_factory=list)
    #: True when a heavy axis line was found rather than assumed.
    detected: bool = True

    def to_world(
        self, px: np.ndarray, py: np.ndarray, units_per_cell: float
    ) -> tuple[np.ndarray, np.ndarray]:
        """Map pixel coordinates to graph coordinates.

        The y axis is flipped: image rows increase downwards, graph y increases
        upwards.
        """
        x = (px - self.origin_x) / self.pixels_per_cell_x * units_per_cell
        y = -(py - self.origin_y) / self.pixels_per_cell_y * units_per_cell
        return x, y


def _long_runs(mask: np.ndarray, axis: int, min_span: int) -> list[int]:
    """Indices of rows (axis=1) or columns (axis=0) that are mostly set."""
    counts = mask.sum(axis=axis) / 255
    candidates = np.flatnonzero(counts >= min_span)
    if candidates.size == 0:
        return []

    # Collapse adjacent indices: an anti-aliased line is 2-3 pixels wide and
    # would otherwise be reported as several distinct gridlines.
    groups: list[list[int]] = [[int(candidates[0])]]
    for index in candidates[1:]:
        if index - groups[-1][-1] <= 2:
            groups[-1].append(int(index))
        else:
            groups.append([int(index)])
    return [int(round(float(np.mean(group)))) for group in groups]


def _modal_spacing(positions: list[int]) -> float | None:
    """Most common gap between consecutive lines, ignoring outliers.

    The median is used rather than the mean because a missing gridline produces
    a double-width gap that would otherwise drag the estimate off.
    """
    if len(positions) < 2:
        return None
    gaps = np.diff(sorted(positions))
    gaps = gaps[gaps > 2]
    if gaps.size == 0:
        return None
    return float(np.median(gaps))


def detect_axes(image_bgr: np.ndarray) -> Axes:
    """Locate the coordinate frame: axes, gridlines and cell size."""
    height, width = image_bgr.shape[:2]
    grey = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    # Any pixel darker than the local page white is chrome: grid, axes or text.
    ink = cv2.adaptiveThreshold(
        grey, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 8
    )

    horizontal_rows = _long_runs(ink, axis=1, min_span=int(width * MIN_LINE_SPAN))
    vertical_cols = _long_runs(ink, axis=0, min_span=int(height * MIN_LINE_SPAN))

    # The axis is the darkest of the long lines; plotting tools draw it heavier
    # than the surrounding grid.
    def darkest(indices: list[int], along_rows: bool) -> int | None:
        if not indices:
            return None
        strengths = [
            float(np.mean(grey[i, :] if along_rows else grey[:, i])) for i in indices
        ]
        return indices[int(np.argmin(strengths))]

    origin_y = darkest(horizontal_rows, True)
    origin_x = darkest(vertical_cols, False)

    spacing_x = _modal_spacing(vertical_cols)
    spacing_y = _modal_spacing(horizontal_rows)

    # Fall back to a sane frame when the image has no visible grid: centre the
    # origin and assume ten cells across. The user can correct the scale.
    detected = origin_x is not None and origin_y is not None
    if spacing_x is None:
        spacing_x = width / 10.0
    if spacing_y is None:
        spacing_y = height / 10.0

    return Axes(
        origin_x=float(origin_x if origin_x is not None else width / 2),
        origin_y=float(origin_y if origin_y is not None else height / 2),
        pixels_per_cell_x=float(spacing_x),
        pixels_per_cell_y=float(spacing_y),
        x_gridlines=vertical_cols,
        y_gridlines=horizontal_rows,
        detected=detected,
    )


def curve_mask(image_bgr: np.ndarray, axes: Axes) -> np.ndarray:
    """Isolate plotted ink from grid, axes and background.

    Two independent cues are combined, because plots come in two flavours: a
    Desmos-style screenshot where the curve is the only saturated thing on the
    page, and a textbook scan where everything is black. Saturated pixels are
    taken outright; for a greyscale image the curve is what survives removing
    the long straight lines.
    """
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    coloured = ((saturation > SATURATION_FLOOR) & (value > 40)).astype(np.uint8) * 255

    if float(np.count_nonzero(coloured)) / coloured.size > 0.0004:
        mask = coloured
    else:
        grey = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        ink = cv2.adaptiveThreshold(
            grey, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 25, 10
        )
        # Erase the detected chrome so only the plotted line is left behind.
        for row in axes.y_gridlines:
            ink[max(0, row - 2) : row + 3, :] = 0
        for column in axes.x_gridlines:
            ink[:, max(0, column - 2) : column + 3] = 0
        mask = ink

    # Close single-pixel gaps from anti-aliasing, then drop specks and leftover
    # text, which survive as small blobs rather than long thin strokes.
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    cleaned = np.zeros_like(mask)
    min_area = max(20, mask.size // 20000)
    for label in range(1, count):
        area = stats[label, cv2.CC_STAT_AREA]
        extent = max(stats[label, cv2.CC_STAT_WIDTH], stats[label, cv2.CC_STAT_HEIGHT])
        if area >= min_area and extent >= 12:
            cleaned[labels == label] = 255
    return cleaned


def trace(mask: np.ndarray) -> list[list[tuple[int, float]]]:
    """Reduce the mask to one y per column, split into continuous strokes.

    Taking the median of each column's set pixels keeps the trace centred on a
    thick line, and behaves sensibly where a nearly vertical segment fills many
    rows at once.
    """
    height = mask.shape[0]
    points: list[tuple[int, float]] = []
    for column in range(mask.shape[1]):
        rows = np.flatnonzero(mask[:, column])
        if rows.size:
            points.append((column, float(np.median(rows))))

    if not points:
        return []

    strokes: list[list[tuple[int, float]]] = [[points[0]]]
    break_distance = STROKE_BREAK_FRACTION * height
    for previous, current in zip(points, points[1:]):
        gap_in_x = current[0] - previous[0]
        jump_in_y = abs(current[1] - previous[1])
        if gap_in_x > 6 or jump_in_y > break_distance:
            strokes.append([])
        strokes[-1].append(current)

    # A stroke of a handful of columns is noise, not a curve.
    return [stroke for stroke in strokes if len(stroke) >= 8]


def extract(
    image_bytes: bytes, *, units_per_cell: float = 1.0
) -> dict[str, Any]:
    """Full pipeline: image bytes in, world-space curves out."""
    buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("could not decode image")

    # Very large screenshots cost time and buy no precision; a curve is a curve
    # at 1600px wide.
    height, width = image.shape[:2]
    if width > 1600:
        scale = 1600 / width
        image = cv2.resize(
            image, (1600, int(height * scale)), interpolation=cv2.INTER_AREA
        )
        height, width = image.shape[:2]

    axes = detect_axes(image)
    mask = curve_mask(image, axes)
    strokes = trace(mask)

    curves: list[dict[str, Any]] = []
    for stroke in strokes:
        px = np.array([p[0] for p in stroke], dtype=float)
        py = np.array([p[1] for p in stroke], dtype=float)
        x, y = axes.to_world(px, py, units_per_cell)
        curves.append(
            {
                "x": [float(v) for v in x],
                "y": [float(v) for v in y],
                "pixel_count": len(stroke),
            }
        )

    notes: list[str] = []
    if not axes.detected:
        notes.append(
            "No axis lines found — assumed the image centre is the origin. "
            "Drag the axes or set the scale to correct it."
        )
    if not curves:
        notes.append("No plotted curve was found in this image.")

    return {
        "axes": {
            "origin_x": axes.origin_x,
            "origin_y": axes.origin_y,
            "pixels_per_cell_x": axes.pixels_per_cell_x,
            "pixels_per_cell_y": axes.pixels_per_cell_y,
            "units_per_cell": units_per_cell,
            "detected": axes.detected,
            "x_gridlines": axes.x_gridlines,
            "y_gridlines": axes.y_gridlines,
        },
        "image": {"width": width, "height": height},
        "curves": curves,
        "notes": notes,
    }
