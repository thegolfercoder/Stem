"""FastAPI application for Reverse Desmos.

Fitting is CPU-bound and takes between a few hundred milliseconds and a few
seconds, so every solve is dispatched to a worker thread. That keeps the event
loop free to serve concurrent requests instead of blocking the whole process on
one user's parabola.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from .engine.fitting import discover
from .engine.models import REGISTRY
from .engine.prettify import to_template
from .schemas import (
    ExtractResponse,
    FitRequest,
    FitResponse,
    ModelInfo,
)
from .vision.extract import extract

logger = logging.getLogger(__name__)

#: Refuse oversized uploads before decoding them; a graph screenshot that does
#: not fit in 12 MB is not a graph screenshot.
MAX_UPLOAD_BYTES = 12 * 1024 * 1024

app = FastAPI(
    title="Reverse Desmos",
    version="1.0.0",
    description="Reconstructs equations from drawings, screenshots and data.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.environ.get(
            "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "models": len(REGISTRY)}


@app.get("/api/models", response_model=list[ModelInfo])
async def list_models() -> list[ModelInfo]:
    """The model library, so the client can offer a search filter."""
    return [
        ModelInfo(
            kind=spec.kind,
            label=spec.label,
            family=spec.family,
            param_names=list(spec.param_names),
            complexity=spec.complexity,
            template=to_template(spec),
        )
        for spec in REGISTRY
    ]


@app.post("/api/fit", response_model=FitResponse)
async def fit(request: FitRequest) -> FitResponse:
    """Rank candidate equations for a set of points."""
    xs = [point.x for point in request.points]
    ys = [point.y for point in request.points]

    try:
        result = await run_in_threadpool(
            discover,
            xs,
            ys,
            max_results=request.max_results,
            kinds=request.kinds or None,
        )
    except ValueError as error:
        # Raised by `prepare` for structurally unusable input, e.g. all points
        # non-finite. This is a client problem, not a server fault.
        raise HTTPException(status_code=422, detail=str(error)) from error

    return FitResponse.model_validate(result)


@app.post("/api/extract", response_model=ExtractResponse)
async def extract_from_image(
    file: UploadFile = File(...),
    units_per_cell: float = Form(1.0),
) -> ExtractResponse:
    """Recover plotted curves from an uploaded screenshot."""
    if units_per_cell <= 0:
        raise HTTPException(status_code=422, detail="units_per_cell must be positive")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=422, detail="empty upload")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image too large")

    try:
        result = await run_in_threadpool(
            extract, payload, units_per_cell=units_per_cell
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return ExtractResponse.model_validate(result)
