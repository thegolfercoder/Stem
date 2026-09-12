"""Tasks: the things with deadlines.

Imported as `from jarvis.services import tasks`, so call sites read
`tasks.add(...)`, `tasks.due(...)`, `tasks.complete(...)`.

Two rules carry over from memory, for the same reasons. Every read is scoped to
a user id the caller supplies, never one that arrived in an argument from the
model. And nothing is written as a side effect of a conversation happening - a
row appears because someone asked for it, in the open, where it shows as a tool
call in the transcript and a row on the Tasks page.

The interesting decision here is `today`. Everything that asks "what is
overdue?" or "what is due this week?" takes the date as an argument rather than
calling `date.today()` in the middle of a query. That is what makes any of this
testable: a function that reads the clock internally can only be tested on the
day it happens to be.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from jarvis.db import deleted_rows
from jarvis.models import TASK_PRIORITIES, TASK_STATUSES, Task, utcnow

MAX_TITLE_CHARS = 200
MAX_NOTES_CHARS = 4_000
DEFAULT_PRIORITY = 2
OPEN_STATUSES = ("todo", "doing")

# A personal task list will not come close. The cap is here so that a query
# cannot load the table if one ever does.
MAX_ROWS = 500

_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


class TaskValidationError(ValueError):
    """A task could not be saved or changed, with a sentence saying why."""


@dataclass(frozen=True)
class Agenda:
    """What the next few days look like, already grouped.

    Built in one pass so the dashboard, the Tasks page and the assistant's
    context all describe the same day the same way - three separate "what is
    due?" queries would eventually disagree with each other.
    """

    today: date
    overdue: list[Task]
    due_today: list[Task]
    due_soon: list[Task]
    undated: list[Task]

    @property
    def total(self) -> int:
        return len(self.overdue) + len(self.due_today) + len(self.due_soon) + len(self.undated)

    @property
    def needs_attention(self) -> list[Task]:
        """What a person should look at now, worst first."""
        return self.overdue + self.due_today


# --- validation --------------------------------------------------------------


def normalise_status(status: str | None) -> str:
    value = (status or "").strip().lower()
    if not value:
        return "todo"
    if value not in TASK_STATUSES:
        raise TaskValidationError(
            f"{status!r} is not a task status. Use one of: {', '.join(TASK_STATUSES)}."
        )
    return value


def normalise_priority(priority: int | str | None) -> int:
    if priority is None or priority == "":
        return DEFAULT_PRIORITY
    try:
        value = int(priority)
    except (TypeError, ValueError) as exc:
        raise TaskValidationError("Priority must be a number from 1 to 4.") from exc
    if value not in TASK_PRIORITIES:
        raise TaskValidationError("Priority must be 1 (someday) to 4 (urgent).")
    return value


def normalise_due(due_on: date | str | None) -> date | None:
    """A date, or nothing. Deliberately strict: ISO in, or an error.

    There is no natural-language parsing here on purpose. "Friday" cannot be
    resolved without knowing today, and guessing wrong puts a deadline on the
    wrong day silently. The model resolves relative dates - it is told the
    current date - and this layer only accepts the answer.
    """
    if due_on is None or due_on == "":
        return None
    if isinstance(due_on, datetime):
        return due_on.date()
    if isinstance(due_on, date):
        return due_on
    try:
        return date.fromisoformat(str(due_on).strip())
    except ValueError as exc:
        raise TaskValidationError(
            f"{due_on!r} is not a date I can use. Give it as YYYY-MM-DD."
        ) from exc


def normalise_time(due_time: str | None) -> str:
    if not due_time:
        return ""
    value = str(due_time).strip()
    if not _TIME.match(value):
        raise TaskValidationError(f"{due_time!r} is not a time. Give it as HH:MM, like 17:00.")
    hours, minutes = value.split(":")
    return f"{int(hours):02d}:{minutes}"


def normalise_tags(tags: Sequence[str] | str | None) -> str:
    if tags is None:
        return ""
    parts = tags.split(",") if isinstance(tags, str) else list(tags)
    seen: list[str] = []
    for part in parts:
        tag = re.sub(r"\s+", "-", str(part).strip().lower())
        if tag and tag not in seen:
            seen.append(tag)
    return ",".join(seen)[:256]


def _clean_title(title: str) -> str:
    value = " ".join((title or "").split())
    if not value:
        raise TaskValidationError("A task needs a title.")
    return value[:MAX_TITLE_CHARS]


# --- writing -----------------------------------------------------------------


def add(
    session: Session,
    *,
    user_id: int,
    title: str,
    notes: str = "",
    status: str | None = None,
    priority: int | str | None = None,
    due_on: date | str | None = None,
    due_time: str | None = None,
    subject: str = "",
    project: str = "",
    tags: Sequence[str] | str | None = None,
    source: str = "user",
) -> Task:
    task = Task(
        user_id=user_id,
        title=_clean_title(title),
        notes=(notes or "").strip()[:MAX_NOTES_CHARS],
        status=normalise_status(status),
        priority=normalise_priority(priority),
        due_on=normalise_due(due_on),
        due_time=normalise_time(due_time),
        subject=(subject or "").strip().lower()[:64],
        project=(project or "").strip().lower()[:64],
        tags=normalise_tags(tags),
        source=source,
    )
    if task.status == "done":
        task.completed_at = utcnow().replace(tzinfo=None)
    session.add(task)
    session.flush()
    return task


def get(session: Session, *, user_id: int, task_id: int) -> Task | None:
    return session.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user_id)
    ).scalar_one_or_none()


def update(
    session: Session,
    *,
    user_id: int,
    task_id: int,
    title: str | None = None,
    notes: str | None = None,
    status: str | None = None,
    priority: int | str | None = None,
    due_on: date | str | None = None,
    due_time: str | None = None,
    subject: str | None = None,
    project: str | None = None,
    tags: Sequence[str] | str | None = None,
    clear_due: bool = False,
) -> Task | None:
    """Change one task. Only the fields given are touched.

    `clear_due` exists because `due_on=None` already means "leave it alone" -
    without a separate flag there would be no way to say "actually, no
    deadline", and removing a date is a thing people legitimately do.
    """
    task = get(session, user_id=user_id, task_id=task_id)
    if task is None:
        return None

    if title is not None:
        task.title = _clean_title(title)
    if notes is not None:
        task.notes = notes.strip()[:MAX_NOTES_CHARS]
    if priority is not None:
        task.priority = normalise_priority(priority)
    if subject is not None:
        task.subject = subject.strip().lower()[:64]
    if project is not None:
        task.project = project.strip().lower()[:64]
    if tags is not None:
        task.tags = normalise_tags(tags)
    if clear_due:
        task.due_on = None
        task.due_time = ""
    else:
        if due_on is not None:
            task.due_on = normalise_due(due_on)
        if due_time is not None:
            task.due_time = normalise_time(due_time)

    if status is not None:
        _set_status(task, normalise_status(status))

    session.flush()
    return task


def _set_status(task: Task, status: str) -> None:
    """Status and `completed_at` move together, so they cannot disagree."""
    task.status = status
    if status == "done":
        # Re-completing an already-done task keeps the original time: when it
        # was finished is a fact, and clicking twice should not rewrite it.
        if task.completed_at is None:
            task.completed_at = utcnow().replace(tzinfo=None)
    else:
        task.completed_at = None


def complete(session: Session, *, user_id: int, task_id: int) -> Task | None:
    task = get(session, user_id=user_id, task_id=task_id)
    if task is None:
        return None
    _set_status(task, "done")
    session.flush()
    return task


def reopen(session: Session, *, user_id: int, task_id: int) -> Task | None:
    task = get(session, user_id=user_id, task_id=task_id)
    if task is None:
        return None
    _set_status(task, "todo")
    session.flush()
    return task


def delete(session: Session, *, user_id: int, task_id: int) -> bool:
    task = get(session, user_id=user_id, task_id=task_id)
    if task is None:
        return False
    session.delete(task)
    session.flush()
    return True


def clear_completed(session: Session, *, user_id: int) -> int:
    """Throw away what is finished. Open tasks are never touched."""
    from sqlalchemy import delete as sql_delete

    result = session.execute(
        sql_delete(Task).where(Task.user_id == user_id, Task.status.in_(("done", "dropped")))
    )
    return deleted_rows(result)


# --- reading -----------------------------------------------------------------


def _ordered(statement: Select[tuple[Task]]) -> Select[tuple[Task]]:
    """Soonest first, then most urgent, then oldest. Undated tasks sort last,
    because a task with a deadline is the one competing for today."""
    return statement.order_by(
        Task.due_on.is_(None),
        Task.due_on,
        Task.priority.desc(),
        Task.id,
    )


def list_all(
    session: Session,
    *,
    user_id: int,
    status: str | None = None,
    subject: str = "",
    project: str = "",
    include_done: bool = False,
    limit: int = MAX_ROWS,
) -> list[Task]:
    statement = select(Task).where(Task.user_id == user_id)
    if status:
        statement = statement.where(Task.status == normalise_status(status))
    elif not include_done:
        statement = statement.where(Task.status.in_(OPEN_STATUSES))
    if subject:
        statement = statement.where(Task.subject == subject.strip().lower())
    if project:
        statement = statement.where(Task.project == project.strip().lower())
    statement = _ordered(statement).limit(max(1, min(limit, MAX_ROWS)))
    return list(session.execute(statement).scalars())


def due(
    session: Session,
    *,
    user_id: int,
    today: date,
    within_days: int = 7,
    limit: int = MAX_ROWS,
) -> list[Task]:
    """Open tasks dated on or before `today + within_days`, overdue included."""
    horizon = today + timedelta(days=max(0, within_days))
    statement = (
        select(Task)
        .where(
            Task.user_id == user_id,
            Task.status.in_(OPEN_STATUSES),
            Task.due_on.is_not(None),
            Task.due_on <= horizon,
        )
        .limit(max(1, min(limit, MAX_ROWS)))
    )
    return list(session.execute(_ordered(statement)).scalars())


def agenda(session: Session, *, user_id: int, today: date, within_days: int = 7) -> Agenda:
    """One pass over the open tasks, grouped the way a person reads them."""
    rows = list_all(session, user_id=user_id, include_done=False)
    horizon = today + timedelta(days=max(0, within_days))

    overdue: list[Task] = []
    due_today: list[Task] = []
    due_soon: list[Task] = []
    undated: list[Task] = []

    for task in rows:
        if task.due_on is None:
            undated.append(task)
        elif task.due_on < today:
            overdue.append(task)
        elif task.due_on == today:
            due_today.append(task)
        elif task.due_on <= horizon:
            due_soon.append(task)

    return Agenda(
        today=today,
        overdue=overdue,
        due_today=due_today,
        due_soon=due_soon,
        undated=undated,
    )


def search(
    session: Session,
    *,
    user_id: int,
    query: str,
    limit: int = 10,
    include_done: bool = True,
) -> list[Task]:
    """Plain substring matching over title, notes, subject and project.

    Not BM25, on purpose. Ranking earns its keep over paragraphs of prose; a
    task list is a few hundred short titles, where "does it contain the word"
    is both what people expect and what they can predict.
    """
    words = [word for word in re.split(r"\W+", query.lower()) if len(word) > 1]
    if not words:
        return []

    statement = select(Task).where(Task.user_id == user_id)
    if not include_done:
        statement = statement.where(Task.status.in_(OPEN_STATUSES))
    clauses = []
    for word in words[:6]:
        like = f"%{word}%"
        clauses.append(
            or_(
                Task.title.ilike(like),
                Task.notes.ilike(like),
                Task.subject.ilike(like),
                Task.project.ilike(like),
                Task.tags.ilike(like),
            )
        )
    statement = statement.where(or_(*clauses))
    rows = list(session.execute(_ordered(statement)).scalars())

    # Open tasks first: when someone searches "chemistry", the one still to do
    # matters more than the six finished last term.
    rows.sort(key=lambda task: not task.open)
    return rows[: max(1, limit)]


def counts(session: Session, *, user_id: int, today: date) -> dict[str, int]:
    """Small numbers for the dashboard."""
    rows = list_all(session, user_id=user_id, include_done=True, limit=MAX_ROWS)
    open_rows = [task for task in rows if task.open]
    return {
        "open": len(open_rows),
        "overdue": sum(1 for task in open_rows if task.overdue(today)),
        "due_today": sum(1 for task in open_rows if task.due_on == today),
        "done": sum(1 for task in rows if task.status == "done"),
    }


def subjects(session: Session, *, user_id: int) -> list[str]:
    """Subjects actually in use, for the filter on the Tasks page."""
    rows = session.execute(
        select(Task.subject).where(Task.user_id == user_id, Task.subject != "").distinct()
    ).scalars()
    return sorted(rows)
