"""HTTP contract tests."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests.test_vision import render_plot


@pytest.fixture(scope="module")
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_models_endpoint_describes_the_registry(client: TestClient):
    response = client.get("/api/models")
    assert response.status_code == 200
    models = response.json()
    assert len(models) > 10
    linear = next(m for m in models if m["kind"] == "linear")
    assert linear["param_names"] == ["m", "b"]
    assert "x" in linear["template"]


def test_fit_returns_ranked_candidates(client: TestClient):
    x = np.linspace(-4, 4, 60)
    y = x**2 - 3
    points = [{"x": float(a), "y": float(b)} for a, b in zip(x, y)]

    response = client.post("/api/fit", json={"points": points})
    assert response.status_code == 200
    body = response.json()
    assert body["candidates"][0]["kind"] == "quadratic"
    assert body["sample"]["n"] == 60
    assert len(body["candidates"][0]["residuals"]) == 60


def test_fit_can_be_restricted_to_named_kinds(client: TestClient):
    x = np.linspace(-4, 4, 40)
    points = [{"x": float(a), "y": float(a**2)} for a in x]

    response = client.post(
        "/api/fit", json={"points": points, "kinds": ["linear", "cubic"]}
    )
    assert response.status_code == 200
    kinds = {c["kind"] for c in response.json()["candidates"]}
    assert kinds <= {"linear", "cubic"}


def test_fit_rejects_too_few_points(client: TestClient):
    response = client.post("/api/fit", json={"points": [{"x": 1, "y": 2}]})
    assert response.status_code == 422


def test_fit_rejects_entirely_unusable_points(client: TestClient):
    points = [{"x": 1.0, "y": 2.0}, {"x": 2.0, "y": 3.0}]
    response = client.post("/api/fit", json={"points": points, "max_results": 99})
    assert response.status_code == 422


def test_extract_endpoint_round_trips_a_screenshot(client: TestClient):
    payload = render_plot(lambda x: 0.5 * x**2 - 2)
    response = client.post(
        "/api/extract",
        files={"file": ("plot.png", payload, "image/png")},
        data={"units_per_cell": "1.0"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["axes"]["detected"] is True
    assert body["curves"]


def test_extract_rejects_a_non_image(client: TestClient):
    response = client.post(
        "/api/extract", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 422


def test_extract_rejects_a_non_positive_scale(client: TestClient):
    payload = render_plot(lambda x: x)
    response = client.post(
        "/api/extract",
        files={"file": ("plot.png", payload, "image/png")},
        data={"units_per_cell": "0"},
    )
    assert response.status_code == 422
