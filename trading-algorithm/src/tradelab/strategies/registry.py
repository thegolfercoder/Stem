"""Name-to-class lookup, so a YAML config can name a strategy.

Registration is explicit rather than by import-time scanning: a strategy that
exists but was never registered fails loudly at config load, instead of
silently not being an option.
"""

from __future__ import annotations

from typing import Any, TypeVar

from tradelab.strategies.base import Strategy

_REGISTRY: dict[str, type[Strategy]] = {}

T = TypeVar("T", bound=Strategy)


def register(cls: type[T]) -> type[T]:
    """Class decorator that adds a strategy to the registry under its ``name``."""
    key = cls.name
    if key in _REGISTRY and _REGISTRY[key] is not cls:
        raise ValueError(f"two strategies both registered as {key!r}")
    _REGISTRY[key] = cls
    return cls


def get(name: str) -> type[Strategy]:
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise KeyError(f"unknown strategy {name!r}; registered: {available()}") from exc


def build(name: str, parameters: dict[str, Any] | None = None) -> Strategy:
    """Instantiate a registered strategy from its name and keyword arguments."""
    return get(name)(**(parameters or {}))


def available() -> list[str]:
    return sorted(_REGISTRY)


def registry() -> dict[str, type[Strategy]]:
    return dict(_REGISTRY)


__all__ = ["available", "build", "get", "register", "registry"]
