"""Tools for the things with deadlines.

The same boundary as everywhere else: the model may *request* a write, the local
code performs it, against a user id the model never sees. It cannot name whose
tasks to read, cannot invent a status outside the fixed list, and cannot set a
priority off the scale.

One thing is worth spelling out in the descriptions rather than hoping for.
Dates must arrive as `YYYY-MM-DD`, already resolved - the model is told today's
date in its instructions, so it can turn "Friday" into a real date, and the
storage layer refuses anything else. The alternative is a date parser on this
side that guesses what week "Friday" meant, which is the kind of thing that puts
a deadline on the wrong day and never tells anyone.
"""

from __future__ import annotations

from datetime import date
from typing import Any, ClassVar

from jarvis.models import PRIORITY_LABELS, TASK_STATUSES
from jarvis.services import tasks as task_service
from jarvis.tools.base import ToolContext, ToolResult

STATUS_LIST = ", ".join(TASK_STATUSES)

DATE_HELP = (
    "A date as YYYY-MM-DD. Work out relative dates yourself from the current "
    "date you were given - do not pass words like 'Friday' or 'tomorrow'."
)


def _serialise(task: Any) -> dict[str, Any]:
    payload = {
        "id": task.id,
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "priority_label": PRIORITY_LABELS.get(task.priority, "normal"),
    }
    if task.due_on:
        payload["due"] = task.when()
    if task.subject:
        payload["subject"] = task.subject
    if task.project:
        payload["project"] = task.project
    if task.notes:
        payload["notes"] = task.notes[:400]
    if task.tag_list:
        payload["tags"] = task.tag_list
    return payload


class CreateTaskTool:
    """Write down one thing to do."""

    name = "create_task"
    description = (
        "Add one task to the user's task list. Use it when they say they need to do "
        "something, have been set an assignment, or ask you to remind them of a piece "
        "of work. One task per call - if they mention three things, call this three "
        "times. Do NOT use it for things they have already finished, for facts about "
        "themselves (use save_memory), or for something they merely asked about."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": (
                    "What needs doing, as a short imperative phrase - 'finish the "
                    "chemistry past paper', not 'the user needs to finish...'."
                ),
            },
            "due_on": {"type": "string", "description": f"Optional deadline. {DATE_HELP}"},
            "due_time": {
                "type": "string",
                "description": (
                    "Optional time on that date, as HH:MM. Omit for a whole-day deadline."
                ),
            },
            "priority": {
                "type": "integer",
                "enum": [1, 2, 3, 4],
                "description": (
                    "1 someday, 2 normal, 3 high, 4 urgent. Leave it at 2 unless they "
                    "signalled urgency; everything marked urgent means nothing is."
                ),
            },
            "subject": {
                "type": "string",
                "description": "Optional school subject this belongs to, such as 'chemistry'.",
            },
            "project": {"type": "string", "description": "Optional project name this belongs to."},
            "notes": {
                "type": "string",
                "description": "Optional detail that would not fit in the title.",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional short labels.",
            },
        },
        "required": ["title"],
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            task = task_service.add(
                context.session,
                user_id=context.user_id,
                title=str(arguments.get("title", "")),
                notes=str(arguments.get("notes", "") or ""),
                priority=arguments.get("priority"),
                due_on=arguments.get("due_on"),
                due_time=arguments.get("due_time"),
                subject=str(arguments.get("subject", "") or ""),
                project=str(arguments.get("project", "") or ""),
                tags=arguments.get("tags"),
                source="assistant",
            )
        except task_service.TaskValidationError as exc:
            return ToolResult.failure(str(exc))
        except (TypeError, ValueError) as exc:
            return ToolResult.failure(f"Could not add that task: {exc}")
        return ToolResult.of({"created": _serialise(task)})


class ListTasksTool:
    """What is outstanding."""

    name = "list_tasks"
    description = (
        "List the user's tasks, soonest deadline first. Use it whenever the answer "
        "depends on what they have to do - 'what's due this week?', 'what should I "
        "start with?', 'how much chemistry is outstanding?' - and the context you were "
        "given does not already cover it. Returns ids, which complete_task and "
        "update_task need."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "within_days": {
                "type": "integer",
                "description": (
                    "Only tasks due within this many days, overdue ones always "
                    "included. Omit to list everything outstanding."
                ),
            },
            "subject": {"type": "string", "description": "Optional: only this school subject."},
            "project": {"type": "string", "description": "Optional: only this project."},
            "include_done": {
                "type": "boolean",
                "description": "Include finished tasks. Off by default.",
            },
        },
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        today = date.today()
        within = arguments.get("within_days")
        if within is not None:
            try:
                rows = task_service.due(
                    context.session,
                    user_id=context.user_id,
                    today=today,
                    within_days=int(within),
                )
            except (TypeError, ValueError):
                return ToolResult.failure("within_days must be a number of days.")
        else:
            rows = task_service.list_all(
                context.session,
                user_id=context.user_id,
                subject=str(arguments.get("subject", "") or ""),
                project=str(arguments.get("project", "") or ""),
                include_done=bool(arguments.get("include_done", False)),
            )
        return ToolResult.of(
            {
                "today": today.isoformat(),
                "count": len(rows),
                "tasks": [_serialise(task) for task in rows],
            }
        )


class CompleteTaskTool:
    """Tick one off."""

    name = "complete_task"
    description = (
        "Mark one task finished. Use it when the user says they have done something. "
        "Find the id with list_tasks first. If nothing matches what they described, "
        "say so rather than completing something close."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "task_id": {"type": "integer", "description": "The id, from list_tasks."},
        },
        "required": ["task_id"],
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            task_id = int(arguments.get("task_id", 0))
        except (TypeError, ValueError):
            return ToolResult.failure("task_id must be a number.")
        task = task_service.complete(context.session, user_id=context.user_id, task_id=task_id)
        if task is None:
            return ToolResult.failure(f"There is no task {task_id}.")
        return ToolResult.of({"completed": _serialise(task)})


class UpdateTaskTool:
    """Change one that already exists."""

    name = "update_task"
    description = (
        "Change a task that already exists - its deadline, priority, title, subject or "
        "status. Use it when the user moves a deadline or changes what a task is, "
        "rather than adding a second nearly-identical task. Find the id with "
        "list_tasks first. Only the fields you pass are changed."
    )
    input_schema: ClassVar[dict[str, Any]] = {
        "type": "object",
        "properties": {
            "task_id": {"type": "integer", "description": "The id, from list_tasks."},
            "title": {"type": "string", "description": "New title."},
            "due_on": {"type": "string", "description": f"New deadline. {DATE_HELP}"},
            "due_time": {"type": "string", "description": "New time on that date, as HH:MM."},
            "clear_due": {
                "type": "boolean",
                "description": (
                    "Remove the deadline entirely. Use this rather than an empty due_on."
                ),
            },
            "priority": {"type": "integer", "enum": [1, 2, 3, 4], "description": "New priority."},
            "status": {
                "type": "string",
                "enum": list(TASK_STATUSES),
                "description": (
                    f"New status, one of: {STATUS_LIST}. Use 'dropped' for something "
                    "abandoned rather than finished."
                ),
            },
            "subject": {"type": "string", "description": "New school subject."},
            "project": {"type": "string", "description": "New project."},
            "notes": {"type": "string", "description": "New notes, replacing what is there."},
        },
        "required": ["task_id"],
    }

    def run(self, arguments: dict[str, Any], context: ToolContext) -> ToolResult:
        try:
            task_id = int(arguments.get("task_id", 0))
        except (TypeError, ValueError):
            return ToolResult.failure("task_id must be a number.")

        try:
            task = task_service.update(
                context.session,
                user_id=context.user_id,
                task_id=task_id,
                title=arguments.get("title"),
                notes=arguments.get("notes"),
                status=arguments.get("status"),
                priority=arguments.get("priority"),
                due_on=arguments.get("due_on"),
                due_time=arguments.get("due_time"),
                subject=arguments.get("subject"),
                project=arguments.get("project"),
                clear_due=bool(arguments.get("clear_due", False)),
            )
        except task_service.TaskValidationError as exc:
            return ToolResult.failure(str(exc))
        except (TypeError, ValueError) as exc:
            return ToolResult.failure(f"Could not change that task: {exc}")

        if task is None:
            return ToolResult.failure(f"There is no task {task_id}.")
        return ToolResult.of({"updated": _serialise(task)})
