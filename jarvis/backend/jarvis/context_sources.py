"""The sources the context manager searches before answering.

Phase 1 shipped the registry with nothing in it. This is what goes in it:
memories, and passages of documents. Both implement `ContextSource`, both are
scoped to the user id on the request, and neither knows anything about the
cloud - they answer "what of this person's data is relevant?" and stop there.

Tasks joined them in phase 4 - thirty lines and one more `add_source` call, as
advertised. Calendar entries and school records go the same way.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from datetime import date

from jarvis import retrieval
from jarvis.context_manager import ContextManager, ContextSnippet, RetrievalRequest
from jarvis.models import Task
from jarvis.services import documents as document_service
from jarvis.services import memory as memory_service
from jarvis.services import tasks as task_service

log = logging.getLogger("jarvis.context.sources")

# Memories are one sentence each, so they are cheap; documents are the expensive
# ones and get the smaller share.
MEMORY_LIMIT = 8
DOCUMENT_LIMIT = 4
TASK_LIMIT = 8

# How far ahead "coming up" reaches when a question is about time rather than a
# particular piece of work. A fortnight is long enough to catch next week's
# deadlines and short enough that the list is still readable.
TASK_HORIZON_DAYS = 14


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


class TaskSource:
    """What is outstanding, and what is late.

    This one does not rank, and the difference matters. Memories and documents
    answer "what of this is relevant?", which is a search problem. Tasks answer
    "what is due?", which is a calendar problem - the right answer is the next
    few deadlines in date order, and a task does not become less due because the
    question happened not to contain its words.

    So: a question that is about time gets the agenda, and a question that names
    something specific gets a search over the list. Both are capped, and neither
    is the whole table.
    """

    name = "tasks"

    def retrieve(self, request: RetrievalRequest) -> Sequence[ContextSnippet]:
        today = date.today()
        query = request.intent.subject or request.query

        rows = (
            task_service.due(
                request.session,
                user_id=request.user_id,
                today=today,
                within_days=TASK_HORIZON_DAYS,
                limit=TASK_LIMIT,
            )
            if _about_time(query)
            else task_service.search(
                request.session,
                user_id=request.user_id,
                query=query,
                limit=min(request.limit, TASK_LIMIT),
                include_done=False,
            )
        )
        if not rows:
            return []

        return [
            ContextSnippet(
                source="task",
                title=_task_title(task, today),
                body=_task_body(task),
                # Ordered by urgency rather than by match quality, so the budget
                # spends itself on the soonest deadlines when it runs short.
                score=_task_score(task, today),
                reference=("task", task.id),
            )
            for task in rows
        ]


# Questions where the answer is a date rather than a keyword. Kept as a short
# explicit list: a question about "what is due" is a different shape from a
# question about chemistry, and guessing the difference with a classifier would
# be less predictable than naming the words.
_TIME_WORDS = (
    "due",
    "deadline",
    "overdue",
    "today",
    "tomorrow",
    "tonight",
    "this week",
    "next week",
    "this weekend",
    "coming up",
    "upcoming",
    "schedule",
    "agenda",
    "plan",
    "to do",
    "todo",
    "outstanding",
    "what should i",
    "what do i have",
    "what have i got",
    "priorit",
    "behind on",
)


def _about_time(query: str) -> bool:
    lowered = (query or "").lower()
    return any(word in lowered for word in _TIME_WORDS)


def _task_title(task: Task, today: date) -> str:
    parts = [task.status]
    when = task.when()
    if when:
        parts.append(f"due {when}")
        if task.overdue(today):
            parts.append("OVERDUE")
    else:
        parts.append("no deadline")
    if task.subject:
        parts.append(task.subject)
    return " - ".join(parts)


def _task_body(task: Task) -> str:
    body = task.title
    if task.notes:
        body += f"\n{task.notes[:400]}"
    return body


def _task_score(task: Task, today: date) -> float:
    """Overdue outranks today, today outranks soon, and priority breaks ties."""
    priority = float(task.priority)
    if task.due_on is None:
        return 0.2 + priority / 100
    days = (task.due_on - today).days
    if days < 0:
        return 10.0 + priority / 100
    # Falls away with distance, so next week never outranks tomorrow.
    return max(1.0, 9.0 - days * 0.5) + priority / 100


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
    manager.add_source(TaskSource())
    # Still to come: CalendarSource, SchoolSource.
