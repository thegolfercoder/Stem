"""The memory API, and the context inspector.

Everything here is scoped to the signed-in user by the route, never by anything
in the request body. The inspector is the odd one out and the most important:
`GET /api/context/recent` returns exactly what was sent to the cloud for the
last few messages, which is how a privacy claim becomes something checkable.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from jarvis.api.deps import context_manager, current_user, db_session
from jarvis.api.schemas import MemoryIn, MemoryOut, MemorySearchHit, MemoryUpdate
from jarvis.context_manager import (
    MAX_SNIPPET_CHARS,
    ContextManager,
    RetrievalRequest,
    recent_traces,
)
from jarvis.intent import detect
from jarvis.models import MEMORY_CATEGORIES, User
from jarvis.services import memory as memory_service

router = APIRouter(prefix="/api", tags=["memory"])


@router.get("/memory/categories", response_model=list[str])
def categories() -> list[str]:
    return list(MEMORY_CATEGORIES)


@router.get("/memory/search", response_model=list[MemorySearchHit])
def search_memory(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    category: str | None = None,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[MemorySearchHit]:
    try:
        results = memory_service.search(
            session,
            user_id=user.id,
            query=q,
            limit=limit,
            categories=[category] if category else [],
        )
    except memory_service.MemoryValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return [
        MemorySearchHit(
            memory=MemoryOut.of(result.memory),
            score=round(result.score, 4),
            matched=list(result.matched),
        )
        for result in results
    ]


@router.get("/memory", response_model=list[MemoryOut])
def list_memory(
    category: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[MemoryOut]:
    try:
        memories = memory_service.list_all(
            session, user_id=user.id, category=category, limit=limit, offset=offset
        )
    except memory_service.MemoryValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return [MemoryOut.of(memory) for memory in memories]


@router.post("/memory", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
def create_memory(
    body: MemoryIn,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> MemoryOut:
    """Add a memory by hand, from the memory page."""
    try:
        memory = memory_service.save(
            session,
            user_id=user.id,
            content=body.content,
            category=body.category,
            importance=body.importance,
            source="manual",
            tags=body.tags,
        )
    except memory_service.MemoryValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MemoryOut.of(memory)


@router.get("/memory/{memory_id}", response_model=MemoryOut)
def get_memory(
    memory_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> MemoryOut:
    memory = memory_service.get(session, user_id=user.id, memory_id=memory_id)
    if memory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such memory.")
    return MemoryOut.of(memory)


@router.put("/memory/{memory_id}", response_model=MemoryOut)
def update_memory(
    memory_id: int,
    body: MemoryUpdate,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> MemoryOut:
    try:
        memory = memory_service.update(
            session,
            user_id=user.id,
            memory_id=memory_id,
            content=body.content,
            category=body.category,
            importance=body.importance,
            tags=body.tags,
        )
    except memory_service.MemoryValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if memory is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such memory.")
    return MemoryOut.of(memory)


@router.delete("/memory/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(
    memory_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> None:
    if not memory_service.delete(session, user_id=user.id, memory_id=memory_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such memory.")


@router.get("/context/recent")
def context_recent(
    include_system: bool = False,
    _: User = Depends(current_user),
) -> list[dict[str, object]]:
    """What was actually sent to the cloud model, most recent first.

    Held in memory for the last handful of turns and never written to disk:
    a permanent record of the context would be a second copy of the personal
    data, which is the thing this whole design is trying not to make.
    """
    return [trace.as_dict(include_system=include_system) for trace in recent_traces()]


@router.get("/context/preview")
def context_preview(
    q: str = Query(default="", max_length=2000),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
    manager: ContextManager = Depends(context_manager),
) -> dict[str, object]:
    """What *would* be consulted for this question, before it is asked.

    `/context/recent` shows what left the machine after the fact. This is the
    same retrieval run ahead of time, as you type, so the answer to "what will
    it send?" is on screen before the send button is - which is the whole
    privacy claim, moved from a settings page to the moment it matters.

    Nothing about a preview persists. The model is never called, no trace is
    recorded, and the session is rolled back at the end so that retrieval
    marking a memory as *used* does not count keystrokes as uses.
    """
    query = q.strip()
    if not query:
        return {"query": "", "intent": "ask", "snippets": [], "count": 0, "chars": 0}

    intent = detect(query)
    snippets = manager.retrieve(
        RetrievalRequest(
            query=intent.subject or query,
            user_id=user.id,
            session=session,
            intent=intent,
        )
    )
    session.rollback()

    rows = []
    by_source: dict[str, int] = {}
    total = 0
    for snippet in snippets:
        chars = min(len(snippet.body.strip()), MAX_SNIPPET_CHARS) + len(snippet.title)
        total += chars
        by_source[snippet.source] = by_source.get(snippet.source, 0) + 1
        # `title` is written for the model and describes shape ("task todo -
        # due 2026-09-12"); a person scanning "what would leave" needs to know
        # *which* record, so the label is a short excerpt of the body. It never
        # goes anywhere - this is the owner looking at their own data.
        label = " ".join(snippet.body.split())[:70]
        rows.append(
            {
                "source": snippet.source,
                "title": snippet.title,
                "label": label,
                "chars": chars,
                "reference": list(snippet.reference) if snippet.reference else None,
            }
        )
    return {
        "query": query,
        "intent": intent.kind.value,
        "snippets": rows,
        "count": len(rows),
        "chars": total,
        "by_source": by_source,
    }
