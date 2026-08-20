"""The output boundary is enforced by a test, not only by intention.

The brief forbids reporting spin rate, spin axis, club face angle, club path,
attack angle and swing plane, because a single consumer sensor at this price
cannot measure them and claiming them is how budget devices lose credibility.

Prose in a docstring does not stop anyone adding a field. This test does. It
inspects the data model rather than the source text, because the data model is
where an output has to appear before it can reach a screen or an export: a
forbidden quantity that is never a field of a result can never be reported.

Spin appears in the package as an *input* - the trajectory model needs a value
and takes a per-club prior - and that is not what is prohibited. Anything
computed from it is MODELLED and carries the assumption, which is exactly the
distinction the provenance type exists to make.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
import re

import pytest
from pydantic import BaseModel

import launchmon

FORBIDDEN = re.compile(
    r"spin_(rate|axis)|face_angle|club_path|attack_angle|swing_plane|"
    r"(^|_)(spin_rate|backspin|sidespin)($|_)",
    re.IGNORECASE,
)

# Inputs are not outputs. A prior the trajectory model consumes is permitted;
# a field of a result is not.
PERMITTED_INPUT_FIELDS = {"spin_prior_rpm"}


def _all_models() -> list[type[BaseModel]]:
    models: list[type[BaseModel]] = []
    for module_info in pkgutil.walk_packages(launchmon.__path__, f"{launchmon.__name__}."):
        module = importlib.import_module(module_info.name)
        for _, obj in inspect.getmembers(module, inspect.isclass):
            if issubclass(obj, BaseModel) and obj is not BaseModel:
                models.append(obj)
    return models


def test_the_package_defines_some_models_to_check() -> None:
    # Guards against the scan silently passing because it found nothing.
    assert len(_all_models()) > 5


@pytest.mark.parametrize("model", _all_models(), ids=lambda m: m.__name__)
def test_no_model_exposes_a_forbidden_quantity(model: type[BaseModel]) -> None:
    for name in model.model_fields:
        if name in PERMITTED_INPUT_FIELDS:
            continue
        assert not FORBIDDEN.search(name), (
            f"{model.__name__}.{name} names a quantity this instrument must not report. "
            "A single consumer sensor at this price cannot measure it."
        )


def test_no_public_function_computes_a_forbidden_quantity() -> None:
    offenders: list[str] = []
    for module_info in pkgutil.walk_packages(launchmon.__path__, f"{launchmon.__name__}."):
        module = importlib.import_module(module_info.name)
        for name, obj in inspect.getmembers(module, inspect.isfunction):
            if obj.__module__ != module.__name__ or name.startswith("_"):
                continue
            if FORBIDDEN.search(name):
                offenders.append(f"{module.__name__}.{name}")
    assert not offenders, offenders
