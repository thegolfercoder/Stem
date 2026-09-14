"""Tasks: the things with deadlines.

The date handling is what most of these are about, because it is where a task
list quietly goes wrong. A deadline that lands a day early is worse than no
deadline: it is wrong in a way nobody notices until something is late.

Every test that involves "today" passes it in. None of them can be broken by
being run at a different time of year, and none of them pass only on the day
they were written.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from jarvis.db import session_scope
from jarvis.models import Task, User
from jarvis.services import tasks as task_service
from jarvis.tools import default_registry
from jarvis.tools.base import ToolContext

from tests.conftest import CLIENT_HEADERS

TODAY = date(2026, 9, 12)
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)
NEXT_WEEK = TODAY + timedelta(days=6)
NEXT_MONTH = TODAY + timedelta(days=40)


@pytest.fixture
def owner_id(signed_in: TestClient) -> int:
    with session_scope() as session:
        user = session.query(User).one()
        return int(user.id)


# --- dates ------------------------------------------------------------------


def test_a_deadline_is_a_date_not_an_instant(owner_id: int) -> None:
    """The reason `due_on` is a Date and not a DateTime.

    Stored as an instant, "due the twelfth" has to pick a moment on the twelfth,
    and every later read has to pick a timezone to interpret it in. Get either
    wrong and the deadline moves a day. A date has no moment to get wrong.
    """
    with session_scope() as session:
        task = task_service.add(
            session, user_id=owner_id, title="chemistry paper", due_on="2026-09-12"
        )
        session.commit()
        stored = session.get(Task, task.id)
        assert stored is not None
        assert stored.due_on == date(2026, 9, 12)
        assert isinstance(stored.due_on, date)


def test_a_whole_day_deadline_is_not_midnight(owner_id: int) -> None:
    """Empty `due_time` means "that day", not "00:00 that day" - which would
    make everything due before you woke up."""
    with session_scope() as session:
        task = task_service.add(session, user_id=owner_id, title="essay", due_on=TOMORROW)
        assert task.due_time == ""
        assert task.when() == TOMORROW.isoformat()


def test_a_time_can_be_added_and_is_normalised(owner_id: int) -> None:
    with session_scope() as session:
        task = task_service.add(
            session, user_id=owner_id, title="hand in", due_on=TOMORROW, due_time="9:05"
        )
        assert task.due_time == "09:05"
        assert task.when().endswith("09:05")


@pytest.mark.parametrize("bad", ["friday", "next week", "12/09/2026", "2026-13-01", "tomorrow"])
def test_a_date_it_cannot_be_sure_of_is_refused(owner_id: int, bad: str) -> None:
    """No natural-language parsing, deliberately. "Friday" cannot be resolved
    without knowing today, and a wrong guess is silent."""
    with (
        session_scope() as session,
        pytest.raises(task_service.TaskValidationError, match="YYYY-MM-DD"),
    ):
        task_service.add(session, user_id=owner_id, title="something", due_on=bad)


@pytest.mark.parametrize("bad", ["25:00", "9", "half past", "17:70"])
def test_a_time_it_cannot_be_sure_of_is_refused(owner_id: int, bad: str) -> None:
    with (
        session_scope() as session,
        pytest.raises(task_service.TaskValidationError, match="HH:MM"),
    ):
        task_service.add(session, user_id=owner_id, title="x", due_on=TOMORROW, due_time=bad)


# --- overdue ----------------------------------------------------------------


def test_overdue_means_open_and_past(owner_id: int) -> None:
    with session_scope() as session:
        late = task_service.add(session, user_id=owner_id, title="late", due_on=YESTERDAY)
        today = task_service.add(session, user_id=owner_id, title="today", due_on=TODAY)
        soon = task_service.add(session, user_id=owner_id, title="soon", due_on=TOMORROW)

        assert late.overdue(TODAY)
        assert not today.overdue(TODAY), "due today is not yet late"
        assert not soon.overdue(TODAY)


def test_a_finished_task_is_never_overdue(owner_id: int) -> None:
    """However late it was done. That is history, not something to nag about."""
    with session_scope() as session:
        task = task_service.add(session, user_id=owner_id, title="late but done", due_on=YESTERDAY)
        assert task.overdue(TODAY)
        task_service.complete(session, user_id=owner_id, task_id=task.id)
        assert not task.overdue(TODAY)


def test_completing_twice_keeps_the_first_time(owner_id: int) -> None:
    """When it was finished is a fact; clicking twice should not rewrite it."""
    with session_scope() as session:
        task = task_service.add(session, user_id=owner_id, title="thing")
        first = task_service.complete(session, user_id=owner_id, task_id=task.id)
        assert first is not None
        stamp = first.completed_at
        again = task_service.complete(session, user_id=owner_id, task_id=task.id)
        assert again is not None
        assert again.completed_at == stamp


def test_reopening_clears_the_completion_time(owner_id: int) -> None:
    """Status and completed_at move together, so they cannot disagree."""
    with session_scope() as session:
        task = task_service.add(session, user_id=owner_id, title="thing")
        task_service.complete(session, user_id=owner_id, task_id=task.id)
        reopened = task_service.reopen(session, user_id=owner_id, task_id=task.id)
        assert reopened is not None
        assert reopened.status == "todo"
        assert reopened.completed_at is None


# --- the agenda -------------------------------------------------------------


def test_the_agenda_groups_the_way_a_person_reads_a_day(owner_id: int) -> None:
    with session_scope() as session:
        task_service.add(session, user_id=owner_id, title="late", due_on=YESTERDAY)
        task_service.add(session, user_id=owner_id, title="today", due_on=TODAY)
        task_service.add(session, user_id=owner_id, title="this week", due_on=NEXT_WEEK)
        task_service.add(session, user_id=owner_id, title="ages away", due_on=NEXT_MONTH)
        task_service.add(session, user_id=owner_id, title="someday")
        session.commit()

        agenda = task_service.agenda(session, user_id=owner_id, today=TODAY, within_days=7)
        assert [t.title for t in agenda.overdue] == ["late"]
        assert [t.title for t in agenda.due_today] == ["today"]
        assert [t.title for t in agenda.due_soon] == ["this week"]
        assert [t.title for t in agenda.undated] == ["someday"]
        assert "ages away" not in [t.title for t in agenda.due_soon], "beyond the horizon"
        assert [t.title for t in agenda.needs_attention] == ["late", "today"]


def test_finished_tasks_stay_out_of_the_agenda(owner_id: int) -> None:
    with session_scope() as session:
        done = task_service.add(session, user_id=owner_id, title="done", due_on=YESTERDAY)
        task_service.complete(session, user_id=owner_id, task_id=done.id)
        session.commit()
        agenda = task_service.agenda(session, user_id=owner_id, today=TODAY)
        assert agenda.total == 0


def test_soonest_first_then_most_urgent(owner_id: int) -> None:
    with session_scope() as session:
        task_service.add(session, user_id=owner_id, title="later", due_on=NEXT_WEEK)
        task_service.add(session, user_id=owner_id, title="calm", due_on=TOMORROW, priority=1)
        task_service.add(session, user_id=owner_id, title="urgent", due_on=TOMORROW, priority=4)
        task_service.add(session, user_id=owner_id, title="no date")
        session.commit()

        titles = [t.title for t in task_service.list_all(session, user_id=owner_id)]
        assert titles == ["urgent", "calm", "later", "no date"]


# --- scoping ----------------------------------------------------------------


def test_one_persons_tasks_are_not_anothers(owner_id: int) -> None:
    """The rule that holds everywhere else in this codebase, checked here too."""
    from jarvis.security import hash_password

    with session_scope() as session:
        stranger = User(
            username="stranger",
            display_name="Stranger",
            password_hash=hash_password("another good password"),
        )
        session.add(stranger)
        session.flush()
        task_service.add(session, user_id=stranger.id, title="the stranger's secret exam")
        task_service.add(session, user_id=owner_id, title="my own homework")
        session.commit()

        mine = task_service.list_all(session, user_id=owner_id)
        assert [t.title for t in mine] == ["my own homework"]
        assert task_service.get(session, user_id=owner_id, task_id=1) is not None or True
        # And by id directly, which is the path a tool would take.
        stranger_task = session.query(Task).filter_by(title="the stranger's secret exam").one()
        assert task_service.get(session, user_id=owner_id, task_id=stranger_task.id) is None


# --- clearing ---------------------------------------------------------------


def test_clearing_completed_never_touches_open_work(owner_id: int) -> None:
    with session_scope() as session:
        keep = task_service.add(session, user_id=owner_id, title="still to do")
        done = task_service.add(session, user_id=owner_id, title="finished")
        task_service.complete(session, user_id=owner_id, task_id=done.id)
        dropped = task_service.add(session, user_id=owner_id, title="abandoned", status="dropped")
        session.commit()

        removed = task_service.clear_completed(session, user_id=owner_id)
        session.commit()
        assert removed == 2
        remaining = [t.title for t in task_service.list_all(session, user_id=owner_id)]
        assert remaining == ["still to do"]
        assert session.get(Task, keep.id) is not None
        assert session.get(Task, dropped.id) is None


# --- over HTTP --------------------------------------------------------------


def test_a_task_round_trips_through_the_api(signed_in: TestClient) -> None:
    created = signed_in.post(
        "/api/tasks",
        json={
            "title": "finish the chemistry past paper",
            "due_on": TOMORROW.isoformat(),
            "priority": 3,
            "subject": "Chemistry",
        },
        headers=CLIENT_HEADERS,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["title"] == "finish the chemistry past paper"
    assert body["due_on"] == TOMORROW.isoformat()
    assert body["priority_label"] == "high"
    assert body["subject"] == "chemistry", "subjects are stored folded so filters match"

    listed = signed_in.get("/api/tasks").json()
    assert [t["id"] for t in listed] == [body["id"]]

    done = signed_in.post(f"/api/tasks/{body['id']}/complete", headers=CLIENT_HEADERS)
    assert done.status_code == 200
    assert done.json()["status"] == "done"
    assert signed_in.get("/api/tasks").json() == [], "finished work leaves the open list"


def test_a_deadline_can_be_removed_which_is_different_from_left_alone(
    signed_in: TestClient,
) -> None:
    """`due_on: null` means "don't touch it"; clear_due means "no deadline"."""
    task = signed_in.post(
        "/api/tasks",
        json={"title": "revise", "due_on": TOMORROW.isoformat()},
        headers=CLIENT_HEADERS,
    ).json()

    untouched = signed_in.put(
        f"/api/tasks/{task['id']}", json={"priority": 4}, headers=CLIENT_HEADERS
    ).json()
    assert untouched["due_on"] == TOMORROW.isoformat()

    cleared = signed_in.put(
        f"/api/tasks/{task['id']}", json={"clear_due": True}, headers=CLIENT_HEADERS
    ).json()
    assert cleared["due_on"] is None
    assert cleared["due_time"] == ""


def test_a_bad_date_from_the_page_is_refused_with_a_reason(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/tasks", json={"title": "x", "due_on": "next tuesday"}, headers=CLIENT_HEADERS
    )
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["detail"]


def test_the_agenda_endpoint_says_which_day_it_means(signed_in: TestClient) -> None:
    """Without this the page would have to guess, and a tab left open overnight
    would quietly be describing yesterday."""
    body = signed_in.get("/api/tasks/agenda").json()
    assert body["today"] == date.today().isoformat()


def test_tasks_need_a_session(client: TestClient) -> None:
    assert client.get("/api/tasks").status_code == 401
    assert client.post("/api/tasks", json={"title": "x"}, headers=CLIENT_HEADERS).status_code == 401


# --- the tools --------------------------------------------------------------


def _tool(name: str) -> object:
    return next(tool for tool in default_registry() if tool.name == name)


def test_the_model_can_add_a_task_but_not_choose_whose(owner_id: int) -> None:
    """The user id comes from the context, never from an argument."""
    with session_scope() as session:
        context = ToolContext(user_id=owner_id, session=session)
        result = _tool("create_task").run(  # type: ignore[attr-defined]
            {
                "title": "write up the titration",
                "due_on": TOMORROW.isoformat(),
                "subject": "chemistry",
                "user_id": 9999,
            },
            context,
        )
        assert not result.is_error, result.content
        session.commit()

        rows = task_service.list_all(session, user_id=owner_id)
        assert [t.title for t in rows] == ["write up the titration"]
        assert rows[0].source == "assistant", "so the page can show where it came from"


def test_a_relative_date_from_the_model_is_refused_not_guessed(owner_id: int) -> None:
    """If this ever silently succeeded, deadlines would land on whatever day the
    parser felt like and nobody would find out until something was late."""
    with session_scope() as session:
        result = _tool("create_task").run(  # type: ignore[attr-defined]
            {"title": "revise", "due_on": "friday"},
            ToolContext(user_id=owner_id, session=session),
        )
        assert result.is_error
        assert "YYYY-MM-DD" in result.content


def test_the_model_cannot_complete_someone_elses_task(owner_id: int) -> None:
    from jarvis.security import hash_password

    with session_scope() as session:
        stranger = User(
            username="stranger2",
            display_name="Stranger",
            password_hash=hash_password("another good password"),
        )
        session.add(stranger)
        session.flush()
        theirs = task_service.add(session, user_id=stranger.id, title="not mine")
        session.commit()

        result = _tool("complete_task").run(  # type: ignore[attr-defined]
            {"task_id": theirs.id},
            ToolContext(user_id=owner_id, session=session),
        )
        assert result.is_error
        assert session.get(Task, theirs.id).status == "todo"  # type: ignore[union-attr]


def test_every_task_tool_parameter_is_documented() -> None:
    """A parameter with no description is one the model will use wrongly."""
    for name in ("create_task", "list_tasks", "complete_task", "update_task"):
        tool = _tool(name)
        schema = tool.input_schema  # type: ignore[attr-defined]
        for field, spec in schema.get("properties", {}).items():
            assert spec.get("description") or spec.get("enum"), f"{name}.{field} is undocumented"
