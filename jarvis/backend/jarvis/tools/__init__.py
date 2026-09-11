"""Local tools JARVIS can call.

`default_registry()` is the one place that decides what this installation can
do. Reading it tells you the whole of what the model is able to make happen on
this machine - which is a list worth being able to read in ten seconds.
"""

from jarvis.tools.base import Tool, ToolContext, ToolRegistry, ToolResult
from jarvis.tools.conversation_tools import SearchConversationsTool
from jarvis.tools.document_tools import ListDocumentsTool, SearchFilesTool
from jarvis.tools.memory_tools import (
    DeleteMemoryTool,
    ListMemoriesTool,
    SaveMemoryTool,
    SearchMemoryTool,
    UpdateMemoryTool,
)


def default_registry() -> ToolRegistry:
    registry = ToolRegistry()

    # Phase 1: conversations.
    registry.register(SearchConversationsTool())

    # Phase 2: memory and documents.
    registry.register(SaveMemoryTool())
    registry.register(SearchMemoryTool())
    registry.register(UpdateMemoryTool())
    registry.register(DeleteMemoryTool())
    registry.register(ListMemoriesTool())
    registry.register(SearchFilesTool())
    registry.register(ListDocumentsTool())

    # Phase 3: create_task, update_task, complete_task, list_tasks,
    #          create_project, update_project, get_calendar, add_calendar_event.
    return registry


__all__ = [
    "DeleteMemoryTool",
    "ListDocumentsTool",
    "ListMemoriesTool",
    "SaveMemoryTool",
    "SearchConversationsTool",
    "SearchFilesTool",
    "SearchMemoryTool",
    "Tool",
    "ToolContext",
    "ToolRegistry",
    "ToolResult",
    "UpdateMemoryTool",
    "default_registry",
]
