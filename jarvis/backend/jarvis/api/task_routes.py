"""The tasks API.

Scoped to the signed-in user by the route, never by anything in the request
body - the same rule as everywhere else.

One deliberate choice: "today" is computed here, from this machine's clock,
rather than accepted from the browser. A deadline is a fact about the owner's
own calendar, and the server is the owner's own computer, so its date is the
right one. Taking it from the request would mean a stale tab could quietly
decide nothing is overdue.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from jarvis.api.deps import current_user, db_session
from jarvis.api.schemas import AgendaOut, TaskIn, TaskOut, TaskUpdate
from jarvis.models import TASK_STATUSES, User
from jarvis.services import tasks as task_service

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/statuses", response_model=list[str])
def statuses() -> list[str]:
    return list(TASK_STATUSES)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status_filter: str | None = Query(default=None, alias="status", max_length=16),
    subject: str = Query(default="", max_length=64),
    project: str = Query(default="", max_length=64),
    include_done: bool = Query(default=False),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[TaskOut]:
    today = date.today()
    try:
        rows = task_service.list_all(
            session,
            user_id=user.id,
            status=status_filter,
            subject=subject,
            project=project,
            include_done=include_done,
        )
    except task_service.TaskValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return [TaskOut.of(task, today) for task in rows]


@router.get("/agenda", response_model=AgendaOut)
def agenda(
    days: int = Query(default=7, ge=0, le=90),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> AgendaOut:
    """What the next few days look like. The dashboard and the Tasks page both
    read this, so they cannot describe the same day differently."""
    today = date.today()
    grouped = task_service.agenda(session, user_id=user.id, today=today, within_days=days)
    return AgendaOut(
        today=today.isoformat(),
        overdue=[TaskOut.of(task, today) for task in grouped.overdue],
        due_today=[TaskOut.of(task, today) for task in grouped.due_today],
        due_soon=[TaskOut.of(task, today) for task in grouped.due_soon],
        undated=[TaskOut.of(task, today) for task in grouped.undated],
        subjects=task_service.subjects(session, user_id=user.id),
    )


@router.get("/search", response_model=list[TaskOut])
def search_tasks(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[TaskOut]:
    today = date.today()
    rows = task_service.search(session, user_id=user.id, query=q, limit=limit)
    return [TaskOut.of(task, today) for task in rows]


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    body: TaskIn,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> TaskOut:
    try:
        task = task_service.add(
            session,
            user_id=user.id,
            title=body.title,
            notes=body.notes,
            status=body.status,
            priority=body.priority,
            due_on=body.due_on,
            due_time=body.due_time,
            subject=body.subject,
            project=body.project,
            tags=body.tags,
            source="manual",
        )
    except task_service.TaskValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return TaskOut.of(task, date.today())


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    body: TaskUpdate,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> TaskOut:
    try:
        task = task_service.update(
            session,
            user_id=user.id,
            task_id=task_id,
            title=body.title,
            notes=body.notes,
            status=body.status,
            priority=body.priority,
            due_on=body.due_on,
            due_time=body.due_time,
            subject=body.subject,
            project=body.project,
            tags=body.tags,
            clear_due=body.clear_due,
        )
    except task_service.TaskValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if task is None:
        raise HTTPException(status_code=404, detail="No such task.")
    session.commit()
    return TaskOut.of(task, date.today())


@router.post("/{task_id}/complete", response_model=TaskOut)
def complete_task(
    task_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> TaskOut:
    task = task_service.complete(session, user_id=user.id, task_id=task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="No such task.")
    session.commit()
    return TaskOut.of(task, date.today())


@router.post("/{task_id}/reopen", response_model=TaskOut)
def reopen_task(
    task_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> TaskOut:
    task = task_service.reopen(session, user_id=user.id, task_id=task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="No such task.")
    session.commit()
    return TaskOut.of(task, date.today())


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> None:
    if not task_service.delete(session, user_id=user.id, task_id=task_id):
        raise HTTPException(status_code=404, detail="No such task.")
    session.commit()


@router.post("/clear-completed")
def clear_completed(
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> dict[str, int]:
    """Throw away what is finished. Open tasks are never touched."""
    removed = task_service.clear_completed(session, user_id=user.id)
    session.commit()
    return {"removed": removed}
