"""The tool interface.

A tool is a local function the model may ask for by name. The registry owns three
things the model must never own: what exists, what arguments are legal, and who
the caller is. A tool is handed a `ToolContext` carrying the user id and the
database session, and can only ever act on that user's data - the model does not
get to name whose records to read.

Phase 1 ships one tool, over the only data phase 1 has: past conversations. The
tools the brief lists - save_memory, create_task, get_calendar and the rest -
arrive with the phases that create the tables they act on, and register here
without any change to the loop that calls them.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, ClassVar, Protocol, runtime_checkable

from sqlalchemy.orm import Session

from jarvis.ai.base import ToolSpec

log = logging.getLogger("jarvis.tools")


@dataclass(frozen=True)
class ToolContext:
    """Who is asking, and what they are allowed to touch."""

    user_id: int
    session: Session


@dataclass(frozen=True)
class ToolResult:
    content: str
    is_error: bool = False

    @classmethod
    def of(cls, payload: Any) -> ToolResult:
        """JSON for anything structured. Models read JSON reliably and it keeps
        the result parseable if a later phase wants to render it."""
        if isinstance(payload, str):
            return cls(content=payload)
        return cls(content=json.dumps(payload, ensure_ascii=False, default=str))

    @classmethod
    def failure(cls, message: str) -> ToolResult:
        return cls(content=message, is_error=True)


@runtime_checkable
class Tool(Protocol):
    """One callable capability."""

    name: str
    description: str
    input_schema: ClassVar[dict[str, Any]]

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult: ...


class ToolRegistry:
    """The set of tools this installation exposes."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"a tool named {tool.name!r} is already registered")
        self._tools[tool.name] = tool

    def __contains__(self, name: object) -> bool:
        return name in self._tools

    def __len__(self) -> int:
        return len(self._tools)

    def __iter__(self) -> Iterator[Tool]:
        return iter(self._tools.values())

    def specs(self) -> list[ToolSpec]:
        """What the model is told exists."""
        return [
            ToolSpec(name=t.name, description=t.description, input_schema=t.input_schema)
            for t in self._tools.values()
        ]

    def run(self, name: str, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        """Run a tool by name.

        Every failure comes back as a tool result rather than an exception: a
        model that asked for a tool badly should be told so and given the chance
        to correct itself, not have the conversation end in a 500.
        """
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult.failure(f"No tool named {name!r} exists.")
        try:
            return tool.run(arguments, context)
        except Exception as exc:  # deliberate - see the docstring
            log.exception("tool %s failed", name)
            return ToolResult.failure(f"{name} failed: {exc}")
