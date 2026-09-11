"""The sources the context manager searches before answering.

Phase 1 shipped the registry with nothing in it. This is what goes in it:
memories, and passages of documents. Both implement `ContextSource`, both are
scoped to the user id on the request, and neither knows anything about the
cloud - they answer "what of this person's data is relevant?" and stop there.

Adding tasks or calendar entries in phase 3 means another thirty lines here and
one more `add_source` call.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from jarvis import retrieval
from jarvis.context_manager import ContextManager, ContextSnippet, RetrievalRequest
from jarvis.services import documents as document_service
from jarvis.services import memory as memory_service

log = logging.getLogger("jarvis.context.sources")

# Memories are one sentence each, so they are cheap; documents are the expensive
# ones and get the smaller share.
MEMORY_LIMIT = 8
DOCUMENT_LIMIT = 4


class MemorySource:
    """Durable facts about the owner."""

    name = "memory"

    def retrieve(self, request: RetrievalRequest) -> Sequence[ContextSnippet]:
        # An explicit "remember that ..." is searched on its subject rather than
        # the whole sentence: the trigger words are not what to look for.
        query = request.intent.subject or request.query
        results = memory_service.search(
            request.session,
            user_id=request.user_id,
            query=query,
            limit=min(request.limit, MEMORY_LIMIT),
            boost_categories=request.intent.categories,
        )
        if not results:
            return []

        # Retrieval is a use. Recording it is what lets the memory page show
        # which memories have earned their place.
        memory_service.mark_used(request.session, [result.memory for result in results])

        return [
            ContextSnippet(
                source="memory",
                title=f"{result.memory.category} (importance {result.memory.importance})",
                body=result.memory.content,
                score=result.score,
                reference=("memory", result.memory.id),
            )
            for result in results
        ]


class DocumentSource:
    """Passages of the owner's own files."""

    name = "documents"

    def retrieve(self, request: RetrievalRequest) -> Sequence[ContextSnippet]:
        query = request.intent.subject or request.query
        results = document_service.search(
            request.session,
            user_id=request.user_id,
            query=query,
            limit=min(request.limit, DOCUMENT_LIMIT),
        )
        return [
            ContextSnippet(
                source="document",
                title=_title(result),
                body=retrieval.excerpt(result.chunk.text, query, width=MAX_BODY_CHARS),
                score=result.score,
                reference=("document", result.document.id),
            )
            for result in results
        ]


MAX_BODY_CHARS = 1_200


def _title(result: document_service.ScoredChunk) -> str:
    parts = [result.document.filename]
    if result.document.subject:
        parts.append(result.document.subject)
    location = f"part {result.chunk.ordinal + 1}"
    if result.document.chunk_count > 1:
        location += f" of {result.document.chunk_count}"
    parts.append(location)
    return " - ".join(parts)


def register_default_sources(manager: ContextManager) -> None:
    """Attach the phase 2 sources to a context manager.

    One place that decides what JARVIS may consult, so the answer to "where
    could this have come from?" is a list you can read in five seconds.
    """
    manager.add_source(MemorySource())
    manager.add_source(DocumentSource())
    # Phase 3: TaskSource, CalendarSource, SchoolSource.
