"""Local tools JARVIS can call.

`default_registry()` is the one place that decides what this installation can do.
Later phases add a line each.
"""

from jarvis.tools.base import Tool, ToolContext, ToolRegistry, ToolResult
from jarvis.tools.conversation_tools import SearchConversationsTool


def default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(SearchConversationsTool())
    # Phase 2: search_memory, save_memory, delete_memory, search_notes, search_files.
    # Phase 3: create_task, update_task, complete_task, list_tasks,
    #          create_project, update_project, get_calendar, add_calendar_event.
    return registry


__all__ = [
    "SearchConversationsTool",
    "Tool",
    "ToolContext",
    "ToolRegistry",
    "ToolResult",
    "default_registry",
]
