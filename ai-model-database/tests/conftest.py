"""Fixtures.

Most tests run against the *real* database rather than a fixture, because the
data is the product here. A test suite that only exercises a toy three-entry
fixture would pass on a repository whose actual entries were all broken.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
import yaml

from aimodeldb.loader import Database, load

REPO_ROOT = Path(__file__).resolve().parent.parent
TODAY = date(2026, 9, 8)


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture(scope="session")
def database() -> Database:
    """The real database, as shipped."""
    return load(REPO_ROOT / "data")


@pytest.fixture
def minimal_entry() -> dict[str, Any]:
    """The smallest entry that should pass every check."""
    return {
        "slug": "example-model",
        "name": "Example Model",
        "provider": "Example Corp",
        "kind": "model",
        "summary": "A model that exists only inside this test suite, for checking the rules.",
        "categories": [
            {
                "id": "general-reasoning",
                "tier": "recommended",
                "rationale": "It is the only entry in this fixture, which is why it is here.",
            }
        ],
        "weaknesses": ["It is not real"],
        "sources": [
            {
                "id": "example-docs",
                "url": "https://example.com/docs",
                "kind": "official",
                "retrieved": "2026-09-01",
            }
        ],
        "verification": {
            "last_verified": "2026-09-01",
            "method": "official_docs",
            "verified_fields": ["existence"],
        },
    }


@pytest.fixture
def sandbox(tmp_path: Path, minimal_entry: dict[str, Any]) -> Path:
    """A throwaway database with the real taxonomy and one entry."""
    (tmp_path / "entries").mkdir()
    (tmp_path / "taxonomy.yaml").write_text(
        (REPO_ROOT / "data" / "taxonomy.yaml").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (tmp_path / "entries" / "example-model.yaml").write_text(
        yaml.safe_dump(minimal_entry, sort_keys=False), encoding="utf-8"
    )
    return tmp_path


@pytest.fixture
def write_entry(sandbox: Path) -> Any:
    """Write an entry into the sandbox, named after its slug."""

    def writer(entry: dict[str, Any]) -> Path:
        path = sandbox / "entries" / f"{entry['slug']}.yaml"
        path.write_text(yaml.safe_dump(entry, sort_keys=False), encoding="utf-8")
        return path

    return writer
