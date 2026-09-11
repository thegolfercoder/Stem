"""Tools for remembering, and for being told to stop remembering.

These are how the model acts on memory, and the boundary is deliberate: the
model may *request* a write, the local code performs it, against a user id the
model never sees. It cannot name whose memory to read, cannot exceed the size
limit, and cannot invent a category outside the fixed list.

Note what is missing: nothing here runs on its own. A conversation does not
produce memories as a side effect. A row appears because the owner asked for it,
or because the model judged a fact worth keeping and said so in the open, where
it shows in the transcript as a tool call and in the memory page as a row with
source "assistant".
"""

from __future__ import annotations

from typing import Any, ClassVar

from jarvis.models import MEMORY_CATEGORIES
from jarvis.services import memory as memory_service
from jarvis.tools.base import ToolContext, ToolResult

CATEGORY_LIST = ", ".join(MEMORY_CATEGORIES)


def _serialise(memory: Any) -> dict[str, Any]:
    return {
        "id": memory.id,
        "category": memory.category,
        "content": memory.content,
        "importance": memory.importance,
        "tags": memory.tag_list,
        "updated_at": memory.updated_at.strftime("%Y-%m-%d"),
    }


class SaveMemoryTool:
    """Write one durable fact."""

    name = "save_memory"
    description = (
        "Store one durable fact about the user so it is available in every future "
        "conversation. Use it when the user asks you to remember something, or when "
        "they state a lasting fact about themselves, their studies, their projects or "
        "their preferences. Do NOT use it for passing details of the current "
        "conversation, for things they asked about rather than stated, or for anything "
        "they would be surprised to find written down. Write the fact as a short "
        "standalone sentence in the third person ('Sam prefers concise answers'), "
        "because it will be read years from now without this conversation around it."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The fact, as one or two plain sentences.",
            },
            "category": {
                "type": "string",
                "enum": list(MEMORY_CATEGORIES),
                "description": f"Which category it belongs to. One of: {CATEGORY_LIST}.",
            },
            "importance": {
                "type": "integer",
                "description": (
                    "1 to 5. 5 means never get this wrong (a standing instruction, an "
                    "exam date); 3 is the sensible default; 1 is trivia."
                ),
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional short keywords, e.g. ['chemistry', 'igcse'].",
            },
        },
        "required": ["content", "category"],
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            memory = memory_service.save(
                context.session,
                user_id=context.user_id,
                content=str(arguments.get("content", "")),
                category=arguments.get("category"),
                importance=int(arguments.get("importance", 3) or 3),
                source="assistant",
                tags=arguments.get("tags"),
            )
        except memory_service.MemoryValidationError as exc:
            return ToolResult.failure(str(exc))
        except (TypeError, ValueError) as exc:
            return ToolResult.failure(f"Could not save that: {exc}")
        return ToolResult.of({"saved": _serialise(memory)})


class SearchMemoryTool:
    """Find what is already known."""

    name = "search_memory"
    description = (
        "Search the user's stored memories. Use it whenever the answer depends on "
        "something about them personally - their subjects, goals, preferences, "
        "projects or people - and the context you were given does not already cover "
        "it. Returns matching memories with their ids, which update_memory and "
        "delete_memory need."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to look for."},
            "category": {
                "type": "string",
                "enum": list(MEMORY_CATEGORIES),
                "description": "Optional: restrict the search to one category.",
            },
            "limit": {"type": "integer", "description": "Maximum results (1-20, default 8)."},
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        query = str(arguments.get("query", "")).strip()
        if not query:
            return ToolResult.failure("query is required.")
        try:
            limit = max(1, min(int(arguments.get("limit", 8) or 8), 20))
        except (TypeError, ValueError):
            limit = 8
        category = arguments.get("category")
        try:
            categories = [category] if category else []
            results = memory_service.search(
                context.session,
                user_id=context.user_id,
                query=query,
                limit=limit,
                categories=categories,
            )
        except memory_service.MemoryValidationError as exc:
            return ToolResult.failure(str(exc))
        return ToolResult.of(
            {
                "query": query,
                "matches": [_serialise(result.memory) for result in results],
            }
        )


class UpdateMemoryTool:
    """Correct something already stored."""

    name = "update_memory"
    description = (
        "Change a memory that is now out of date or wrong. Find its id with "
        "search_memory first. Prefer this over saving a second memory that "
        "contradicts the first."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "The memory's id."},
            "content": {"type": "string", "description": "The corrected fact."},
            "category": {
                "type": "string",
                "enum": list(MEMORY_CATEGORIES),
                "description": f"Move it to a different category. One of: {CATEGORY_LIST}.",
            },
            "importance": {"type": "integer", "description": "1 to 5."},
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Replace the keywords entirely, e.g. ['physics', 'mocks'].",
            },
        },
        "required": ["id"],
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            memory_id = int(arguments.get("id", 0))
        except (TypeError, ValueError):
            return ToolResult.failure("id must be a number.")
        try:
            memory = memory_service.update(
                context.session,
                user_id=context.user_id,
                memory_id=memory_id,
                content=arguments.get("content"),
                category=arguments.get("category"),
                importance=arguments.get("importance"),
                tags=arguments.get("tags"),
            )
        except memory_service.MemoryValidationError as exc:
            return ToolResult.failure(str(exc))
        if memory is None:
            return ToolResult.failure(f"No memory with id {memory_id}.")
        return ToolResult.of({"updated": _serialise(memory)})


class DeleteMemoryTool:
    """Forget something, permanently."""

    name = "delete_memory"
    description = (
        "Permanently delete one memory. Find its id with search_memory first, and be "
        "sure it is the one meant - this cannot be undone. If nothing clearly matches "
        "what the user asked you to forget, say so instead of deleting the nearest "
        "thing."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {"id": {"type": "integer", "description": "The memory's id."}},
        "required": ["id"],
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            memory_id = int(arguments.get("id", 0))
        except (TypeError, ValueError):
            return ToolResult.failure("id must be a number.")
        memory = memory_service.get(context.session, user_id=context.user_id, memory_id=memory_id)
        if memory is None:
            return ToolResult.failure(f"No memory with id {memory_id}.")
        removed = _serialise(memory)
        memory_service.delete(context.session, user_id=context.user_id, memory_id=memory_id)
        return ToolResult.of({"deleted": removed})


class ListMemoriesTool:
    """See everything in one category."""

    name = "list_memories"
    description = (
        "List stored memories, most important first, optionally filtered to one "
        "category. Use it for questions like 'what do you know about me?' or 'what "
        "are my goals?', where searching for particular words would miss things."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "enum": list(MEMORY_CATEGORIES),
                "description": f"Optional category. One of: {CATEGORY_LIST}.",
            },
            "limit": {"type": "integer", "description": "Maximum results (1-50, default 20)."},
        },
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            limit = max(1, min(int(arguments.get("limit", 20) or 20), 50))
        except (TypeError, ValueError):
            limit = 20
        try:
            memories = memory_service.list_all(
                context.session,
                user_id=context.user_id,
                category=arguments.get("category"),
                limit=limit,
            )
        except memory_service.MemoryValidationError as exc:
            return ToolResult.failure(str(exc))
        return ToolResult.of({"memories": [_serialise(memory) for memory in memories]})
