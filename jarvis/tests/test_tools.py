"""The tool registry and the one tool phase 1 ships."""

from __future__ import annotations

from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient
from jarvis.db import session_scope
from jarvis.models import User
from jarvis.services import conversations as convo_service
from jarvis.tools import ToolContext, ToolRegistry, ToolResult, default_registry

from tests.conftest import CLIENT_HEADERS


class Boom:
    name = "boom"
    description = "Always fails."
    input_schema: ClassVar[dict[str, Any]] = {"type": "object"}

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        raise RuntimeError("detonated")


def test_the_registry_describes_its_tools() -> None:
    specs = {spec.name: spec for spec in default_registry().specs()}
    # Phase 1's tool, and the phase 2 ones registered beside it.
    assert "search_conversations" in specs
    assert {"save_memory", "search_memory", "update_memory", "delete_memory"} <= set(specs)
    assert {"search_files", "list_documents"} <= set(specs)
    assert specs["search_conversations"].input_schema["required"] == ["query"]


def test_every_tool_describes_itself_well_enough_to_be_chosen() -> None:
    """A tool the model cannot tell apart from another is a tool it will use
    wrongly, so the description is part of the interface rather than a comment."""
    for spec in default_registry().specs():
        assert len(spec.description) > 80, spec.name
        assert spec.input_schema["type"] == "object"
        for name, field in spec.input_schema.get("properties", {}).items():
            assert field.get("description") or field.get("enum"), f"{spec.name}.{name}"


def test_a_duplicate_name_is_refused() -> None:
    registry = ToolRegistry()
    registry.register(Boom())
    with pytest.raises(ValueError, match="already registered"):
        registry.register(Boom())


def test_an_exploding_tool_becomes_an_error_result(signed_in: TestClient) -> None:
    """A model that calls a tool badly should be told, not crash the turn."""
    registry = ToolRegistry()
    registry.register(Boom())
    with session_scope() as session:
        user = session.query(User).one()
        result = registry.run("boom", {}, ToolContext(user_id=user.id, session=session))
    assert result.is_error
    assert "detonated" in result.content


def test_an_unknown_tool_is_an_error_result() -> None:
    result = default_registry().run(
        "make_coffee",
        {},
        ToolContext(user_id=1, session=None),  # type: ignore[arg-type]
    )
    assert result.is_error


def test_searching_conversations_finds_earlier_messages(signed_in: TestClient) -> None:
    signed_in.post("/api/conversations", json={"title": "Chemistry"}, headers=CLIENT_HEADERS)
    with session_scope() as session:
        user = session.query(User).one()
        conversation = convo_service.list_conversations(session, user_id=user.id)[0]
        convo_service.add_message(
            session,
            conversation=conversation,
            role="user",
            content="The chemistry exam is on the third of October",
        )
        session.commit()

        result = default_registry().run(
            "search_conversations",
            {"query": "chemistry exam"},
            ToolContext(user_id=user.id, session=session),
        )
        assert not result.is_error
        assert "third of October" in result.content

        # And a search scoped to a different owner finds nothing, which is what
        # stops the model naming whose records to read.
        other = default_registry().run(
            "search_conversations",
            {"query": "chemistry exam"},
            ToolContext(user_id=user.id + 999, session=session),
        )
        assert '"matches": []' in other.content


def test_an_empty_query_is_refused(signed_in: TestClient) -> None:
    with session_scope() as session:
        user = session.query(User).one()
        result = default_registry().run(
            "search_conversations", {"query": "  "}, ToolContext(user_id=user.id, session=session)
        )
    assert result.is_error
