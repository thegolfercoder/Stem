"""The CI lockfile still covers what pyproject.toml asks for.

CI installs from requirements-dev.lock, not from pyproject.toml, so a dependency
added to one and not the other would pass locally and fail only in CI, or pass in
CI against a version pyproject.toml no longer allows.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_every_dependency_is_pinned_in_the_lock_within_its_range() -> None:
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    wanted = [*project["dependencies"], *project["optional-dependencies"]["dev"]]
    pinned = {
        m.group(1).lower().replace("_", "-"): m.group(2)
        for m in re.finditer(
            r"^([A-Za-z0-9_.-]+)==(\S+)", (ROOT / "requirements-dev.lock").read_text(), re.M
        )
    }
    for requirement in wanted:
        name, _, minimum = requirement.partition(">=")
        name = name.strip().lower().replace("_", "-")
        assert name in pinned, f"{name} is in pyproject.toml but not in requirements-dev.lock"
        version = tuple(int(p) for p in re.findall(r"\d+", pinned[name].split("+")[0])[:3])
        floor = tuple(int(p) for p in re.findall(r"\d+", minimum)[:3])
        assert version >= floor, f"{name} is locked at {pinned[name]}, below {minimum}"
