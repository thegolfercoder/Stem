"""Tests for the screenshot extraction pipeline.

Synthetic plots stand in for real screenshots: they are generated with a known
origin, grid pitch and equation, so extraction accuracy can be asserted in
absolute terms rather than eyeballed.
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.engine.fitting import discover
from app.vision.extract import extract

WIDTH, HEIGHT, CELL = 800, 600, 40
ORIGIN_X, ORIGIN_Y = WIDTH // 2, HEIGHT // 2


def render_plot(
    fn,
    *,
    grid: bool = True,
    axes: bool = True,
    curve_colour: tuple[int, int, int] = (200, 60, 30),
    background: tuple[int, int, int] = (255, 255, 255),
) -> bytes:
    """Draw a Desmos-like plot of `fn` and return it as PNG bytes."""
    image = np.full((HEIGHT, WIDTH, 3), background, np.uint8)

    if grid:
        for gx in range(ORIGIN_X % CELL, WIDTH, CELL):
            cv2.line(image, (gx, 0), (gx, HEIGHT), (222, 222, 222), 1)
        for gy in range(ORIGIN_Y % CELL, HEIGHT, CELL):
            cv2.line(image, (0, gy), (WIDTH, gy), (222, 222, 222), 1)
    if axes:
        cv2.line(image, (0, ORIGIN_Y), (WIDTH, ORIGIN_Y), (60, 60, 60), 2)
        cv2.line(image, (ORIGIN_X, 0), (ORIGIN_X, HEIGHT), (60, 60, 60), 2)

    points = []
    for px in range(WIDTH):
        py = ORIGIN_Y - fn((px - ORIGIN_X) / CELL) * CELL
        if 0 <= py < HEIGHT:
            points.append((px, int(py)))
    for start, end in zip(points, points[1:]):
        if abs(end[1] - start[1]) < HEIGHT // 2:
            cv2.line(image, start, end, curve_colour, 3)

    return cv2.imencode(".png", image)[1].tobytes()


def test_detects_origin_and_grid_pitch():
    result = extract(render_plot(lambda x: 0.5 * x**2 - 2))
    axes = result["axes"]
    assert axes["detected"] is True
    assert axes["origin_x"] == pytest.approx(ORIGIN_X, abs=2)
    assert axes["origin_y"] == pytest.approx(ORIGIN_Y, abs=2)
    assert axes["pixels_per_cell_x"] == pytest.approx(CELL, abs=1)
    assert axes["pixels_per_cell_y"] == pytest.approx(CELL, abs=1)


def test_traced_curve_lands_on_the_true_equation():
    result = extract(render_plot(lambda x: 0.5 * x**2 - 2))
    assert result["curves"]

    curve = max(result["curves"], key=lambda c: c["pixel_count"])
    x = np.array(curve["x"])
    y = np.array(curve["y"])
    error = np.abs(y - (0.5 * x**2 - 2))

    # Typical error is sub-pixel. The worst case sits where the curve is
    # steepest, because a near-vertical segment fills a whole column of pixels
    # and the column median lands part-way along it — bounded by the stroke
    # width, which is what `pixels_per_cell` converts to world units here.
    stroke_width_in_units = 3.0 / CELL
    assert np.median(error) < stroke_width_in_units
    assert np.max(error) < 4 * stroke_width_in_units

    top = discover(curve["x"], curve["y"])["candidates"][0]
    assert top["kind"] == "quadratic"
    assert top["metrics"]["r2"] > 0.999


def test_units_per_cell_rescales_the_result():
    """Declaring one square as 2 units should double the recovered scale."""
    payload = render_plot(lambda x: x)
    single = extract(payload, units_per_cell=1.0)
    double = extract(payload, units_per_cell=2.0)

    single_span = np.ptp(single["curves"][0]["x"])
    double_span = np.ptp(double["curves"][0]["x"])
    assert double_span == pytest.approx(2 * single_span, rel=1e-6)


def test_handles_a_greyscale_plot_without_colour_cues():
    """Textbook scans are black ink on white; the colour cue is unavailable."""
    result = extract(render_plot(lambda x: 0.5 * x**2 - 2, curve_colour=(20, 20, 20)))
    assert result["curves"], "no curve found in a greyscale plot"
    curve = max(result["curves"], key=lambda c: c["pixel_count"])
    top = discover(curve["x"], curve["y"])["candidates"][0]
    assert top["kind"] in {"quadratic", "cubic", "quartic"}


def test_reports_when_no_axes_are_present():
    result = extract(render_plot(lambda x: x, grid=False, axes=False))
    assert result["axes"]["detected"] is False
    assert any("No axis lines" in note for note in result["notes"])


def test_rejects_undecodable_bytes():
    with pytest.raises(ValueError):
        extract(b"this is not an image")


def test_reports_an_empty_plot():
    blank = cv2.imencode(".png", np.full((200, 200, 3), 255, np.uint8))[1].tobytes()
    result = extract(blank)
    assert result["curves"] == []
    assert any("No plotted curve" in note for note in result["notes"])
