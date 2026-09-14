"""Tools over conversation history.

The one capability phase 1 can honestly offer: JARVIS can look back through what
was actually said before, scoped to the user who is asking.
"""

from __future__ import annotations

from typing import Any, ClassVar

from sqlalchemy import select

from jarvis.models import Conversation, Message
from jarvis.tools.base import ToolContext, ToolResult

MAX_RESULTS = 20
SNIPPET_CHARS = 400


class SearchConversationsTool:
    """Substring search over past messages.

    Substring rather than semantic, because phase 1 has no embeddings and a
    keyword search that works beats a semantic search that is not there yet.
    Phase 2 puts the vector index behind the same tool name.
    """

    name = "search_conversations"
    description = (
        "Search the user's earlier conversations with JARVIS for a word or phrase. "
        "Use it when the user refers to something discussed before ('what did I say "
        "about the chemistry exam?'). Returns matching messages with their dates."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Word or phrase to look for in past messages.",
            },
            "limit": {
                "type": "integer",
                "description": f"Maximum matches to return (1-{MAX_RESULTS}). Defaults to 5.",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        query = str(arguments.get("query", "")).strip()
        if not query:
            return ToolResult.failure("query is required and must not be empty.")
        limit = arguments.get("limit", 5)
        try:
            limit = max(1, min(int(limit), MAX_RESULTS))
        except (TypeError, ValueError):
            limit = 5

        # The join to Conversation is what scopes this to the caller. A tool that
        # searched messages by id alone would be a tool the model could point at
        # anyone's data.
        statement = (
            select(Message, Conversation.title)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id == context.user_id,
                Message.content.icontains(query),
                Message.role.in_(("user", "assistant")),
            )
            .order_by(Message.id.desc())
            .limit(limit)
        )
        rows = context.session.execute(statement).all()
        if not rows:
            return ToolResult.of({"query": query, "matches": []})

        matches = [
            {
                "conversation": title,
                "role": message.role,
                "when": message.created_at.strftime("%Y-%m-%d %H:%M"),
                "text": _snippet(message.content, query),
            }
            for message, title in rows
        ]
        return ToolResult.of({"query": query, "matches": matches})


def _snippet(content: str, query: str) -> str:
    """The match in context, not the whole message."""
    if len(content) <= SNIPPET_CHARS:
        return content
    position = content.lower().find(query.lower())
    if position < 0:
        return content[:SNIPPET_CHARS].rstrip() + " ..."
    start = max(0, position - SNIPPET_CHARS // 3)
    end = min(len(content), start + SNIPPET_CHARS)
    prefix = "... " if start > 0 else ""
    suffix = " ..." if end < len(content) else ""
    return f"{prefix}{content[start:end].strip()}{suffix}"
