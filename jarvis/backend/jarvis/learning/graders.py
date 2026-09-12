"""How an eval case decides whether an answer was right.

Deterministic checks only. The temptation is to have a model grade the output,
and for a personal assistant that is the wrong trade: a suite graded by a model
has its own drift, its own cost per run, and no way to tell "the assistant got
worse" from "the judge changed its mind". These checks are dull, instant, free,
and they mean exactly what they say.

A check is `{"kind": ..., "value": ...}`. Unknown kinds fail loudly rather than
passing silently, because a typo in a check that quietly always passes is worse
than no check at all.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

KINDS = (
    "contains",
    "not_contains",
    "matches",
    "max_chars",
    "min_chars",
    "uses_tool",
    "no_tool",
    "cites_context",
    "no_error",
)


@dataclass(frozen=True)
class Outcome:
    """One answer, as the graders saw it."""

    text: str
    tools: tuple[str, ...] = ()
    used_context: bool = False
    error: str | None = None


@dataclass(frozen=True)
class Failure:
    kind: str
    value: str
    detail: str

    def as_dict(self) -> dict[str, str]:
        return {"kind": self.kind, "value": self.value, "detail": self.detail}


def parse_checks(raw: str | list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Checks as stored are JSON text; as written they are a list."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw or "[]")
        except json.JSONDecodeError as exc:
            raise ValueError(f"checks are not valid JSON: {exc}") from exc
    else:
        parsed = raw
    if not isinstance(parsed, list):
        raise ValueError("checks must be a list")
    for check in parsed:
        if not isinstance(check, dict) or "kind" not in check:
            raise ValueError("each check needs a 'kind'")
        if check["kind"] not in KINDS:
            raise ValueError(f"unknown check kind {check['kind']!r}; use one of {', '.join(KINDS)}")
    return parsed


def grade(outcome: Outcome, checks: list[dict[str, Any]]) -> list[Failure]:
    """Every failure, not just the first - one run should tell you everything
    that is wrong with an answer, not send you round the loop again."""
    failures: list[Failure] = []
    text = outcome.text or ""
    lowered = text.lower()

    for check in checks:
        kind = str(check.get("kind"))
        value = check.get("value", "")
        text_value = str(value)

        if kind == "contains":
            if text_value.lower() not in lowered:
                failures.append(Failure(kind, text_value, "not present in the answer"))

        elif kind == "not_contains" and text_value.lower() in lowered:
            failures.append(Failure(kind, text_value, "present when it should not be"))

        elif kind == "matches":
            try:
                if not re.search(text_value, text, re.IGNORECASE | re.DOTALL):
                    failures.append(Failure(kind, text_value, "pattern did not match"))
            except re.error as exc:
                failures.append(Failure(kind, text_value, f"bad pattern: {exc}"))

        elif kind == "max_chars":
            limit = _as_int(value, 0)
            if len(text) > limit:
                failures.append(Failure(kind, text_value, f"answer was {len(text)} characters"))

        elif kind == "min_chars":
            limit = _as_int(value, 0)
            if len(text) < limit:
                failures.append(Failure(kind, text_value, f"answer was {len(text)} characters"))

        elif kind == "uses_tool":
            if text_value not in outcome.tools:
                ran = ", ".join(outcome.tools) or "none"
                failures.append(Failure(kind, text_value, f"tools that ran: {ran}"))

        elif kind == "no_tool":
            if outcome.tools:
                failures.append(Failure(kind, text_value, f"ran {', '.join(outcome.tools)}"))

        elif kind == "cites_context":
            if not outcome.used_context:
                failures.append(Failure(kind, text_value, "no local context reached the model"))

        elif kind == "no_error" and outcome.error:
            failures.append(Failure(kind, text_value, outcome.error))

    return failures


def _as_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def describe(checks: list[dict[str, Any]]) -> str:
    """A one-line human summary, for the interface."""
    if not checks:
        return "no checks"
    parts = []
    for check in checks[:4]:
        value = str(check.get("value", ""))
        parts.append(f"{check['kind']}({value[:24]})" if value else str(check["kind"]))
    if len(checks) > 4:
        parts.append(f"+{len(checks) - 4} more")
    return ", ".join(parts)
