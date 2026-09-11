"""Tools for reading the owner's own files.

Searching returns passages, never whole documents and never the file itself.
That is not only a context-budget decision: it means a question about one
paragraph of a bank statement cannot cause the other forty to leave the machine.
"""

from __future__ import annotations

from typing import Any, ClassVar

from jarvis import retrieval
from jarvis.services import documents as document_service
from jarvis.tools.base import ToolContext, ToolResult

MAX_PASSAGE_CHARS = 1_200


class SearchFilesTool:
    """Find passages in indexed documents."""

    name = "search_files"
    description = (
        "Search the user's indexed documents - their notes, study material, project "
        "documentation and personal files - and return the passages that match. Use it "
        "when they refer to their own notes or files ('summarise my chemistry notes', "
        "'what does my syllabus say about...'). Returns passages, not whole files, "
        "each labelled with the document it came from so you can cite it."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to look for."},
            "subject": {
                "type": "string",
                "description": "Optional: restrict to documents filed under this subject.",
            },
            "limit": {"type": "integer", "description": "Maximum passages (1-10, default 5)."},
        },
        "required": ["query"],
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        query = str(arguments.get("query", "")).strip()
        if not query:
            return ToolResult.failure("query is required.")
        try:
            limit = max(1, min(int(arguments.get("limit", 5) or 5), 10))
        except (TypeError, ValueError):
            limit = 5

        results = document_service.search(
            context.session,
            user_id=context.user_id,
            query=query,
            limit=limit,
            subject=(arguments.get("subject") or None),
        )
        return ToolResult.of(
            {
                "query": query,
                "passages": [
                    {
                        "document": result.document.filename,
                        "subject": result.document.subject,
                        "part": f"{result.chunk.ordinal + 1} of {result.document.chunk_count}",
                        "text": retrieval.excerpt(
                            result.chunk.text, query, width=MAX_PASSAGE_CHARS
                        ),
                    }
                    for result in results
                ],
            }
        )


class ListDocumentsTool:
    """See what has been indexed."""

    name = "list_documents"
    description = (
        "List the documents the user has given JARVIS, with their subjects and a short "
        "excerpt of each. Use it to answer 'what notes do you have?' or to find the "
        "right subject to narrow a search_files call with."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "subject": {"type": "string", "description": "Optional subject filter."},
            "limit": {"type": "integer", "description": "Maximum documents (1-50, default 25)."},
        },
        "additionalProperties": False,
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            limit = max(1, min(int(arguments.get("limit", 25) or 25), 50))
        except (TypeError, ValueError):
            limit = 25
        documents = document_service.list_all(
            context.session,
            user_id=context.user_id,
            subject=(arguments.get("subject") or None),
            limit=limit,
        )
        return ToolResult.of(
            {
                "documents": [
                    {
                        "id": document.id,
                        "filename": document.filename,
                        "subject": document.subject,
                        "category": document.category,
                        "tags": document.tag_list,
                        "parts": document.chunk_count,
                        "excerpt": document.excerpt[:200],
                    }
                    for document in documents
                ]
            }
        )
