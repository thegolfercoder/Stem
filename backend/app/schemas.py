"""Request and response models for the HTTP API.

Response shapes are declared here rather than inferred, so the TypeScript client
in `frontend/src/lib/api` has a stable contract to mirror.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Point(BaseModel):
    x: float
    y: float


class FitRequest(BaseModel):
    """Fit a set of points, from any source — stroke, trace or spreadsheet."""

    points: list[Point] = Field(min_length=2)
    max_results: int = Field(default=6, ge=1, le=12)
    #: Restrict the search to these model kinds. Empty means "try everything".
    kinds: list[str] = Field(default_factory=list)


class ParameterOut(BaseModel):
    name: str
    value: float
    min: float
    max: float
    step: float
    stderr: float | None = None


class MetricsOut(BaseModel):
    n: int
    n_effective: float
    k: int
    rss: float
    r2: float
    adjusted_r2: float
    rmse: float
    mae: float
    max_error: float
    aic: float
    aicc: float
    bic: float


class DomainOut(BaseModel):
    x_min: float
    x_max: float


class CandidateOut(BaseModel):
    kind: str
    label: str
    family: str
    latex: str
    text: str
    #: Infix form with parameter names intact; the client compiles this once and
    #: re-evaluates it as sliders move.
    template: str
    expression: str
    params: list[ParameterOut]
    exact: bool
    complexity: float
    smoothness_penalty: float
    score: float
    confidence: float
    metrics: MetricsOut
    residuals: list[float]
    singularities: list[float]
    domain: DomainOut


class SampleOut(BaseModel):
    x: list[float]
    y: list[float]
    n: int
    is_function: bool


class FitResponse(BaseModel):
    candidates: list[CandidateOut]
    sample: SampleOut
    notes: list[str] = Field(default_factory=list)
    considered: int = 0


class AxesOut(BaseModel):
    origin_x: float
    origin_y: float
    pixels_per_cell_x: float
    pixels_per_cell_y: float
    units_per_cell: float
    detected: bool
    x_gridlines: list[int]
    y_gridlines: list[int]


class ImageSizeOut(BaseModel):
    width: int
    height: int


class ExtractedCurveOut(BaseModel):
    x: list[float]
    y: list[float]
    pixel_count: int


class ExtractResponse(BaseModel):
    axes: AxesOut
    image: ImageSizeOut
    curves: list[ExtractedCurveOut]
    notes: list[str] = Field(default_factory=list)


class ModelInfo(BaseModel):
    kind: str
    label: str
    family: str
    param_names: list[str]
    complexity: float
    template: str
