"""Memory: storing, finding, correcting, forgetting.

The realistic cases matter more than the exhaustive ones here. A memory system
that passes unit tests and cannot answer "what are my economics goals?" has not
done its job, so several of these are written as the sentence a person would
actually type.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from jarvis.db import session_scope
from jarvis.models import User
from jarvis.services import memory as memory_service
from sqlalchemy.orm import Session

from tests.conftest import CLIENT_HEADERS


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[Session]:
    """A session with the signed-in owner already created."""
    with session_scope() as session:
        yield session


def owner(session: Session) -> User:
    return session.query(User).one()


def seed(session: Session, user_id: int) -> None:
    """A believable memory set: several subjects, some noise, one clear answer
    for each question the tests ask."""
    facts = [
        ("subjects", "Sam is studying IGCSE Economics and is on the microeconomics unit", 4),
        ("goals", "Sam wants an A* in Economics", 5),
        ("goals", "Sam wants an A in Chemistry", 4),
        ("subjects", "Sam is taking IGCSE Additional Mathematics", 4),
        ("preferences", "Sam prefers concise answers, one question at a time", 5),
        ("projects", "Sam is building a personal assistant called JARVIS in Python", 4),
        ("people", "Sam's chemistry teacher is Mr Adams", 2),
        ("routines", "Sam revises for an hour after dinner on weekdays", 3),
        ("personal", "Sam lives in Manchester", 2),
        ("important_facts", "Sam's mock exams start on the third of October", 5),
    ]
    for category, content, importance in facts:
        memory_service.save(
            session, user_id=user_id, content=content, category=category, importance=importance
        )
    session.commit()


# --- saving ------------------------------------------------------------------


def test_saving_and_reading_back(db: Session) -> None:
    user = owner(db)
    memory = memory_service.save(
        db,
        user_id=user.id,
        content="Sam prefers concise answers",
        category="preferences",
        importance=5,
        tags=["style", "Chat"],
    )
    assert memory.id
    assert memory.category == "preferences"
    assert memory.tag_list == ["style", "chat"], "tags are normalised on the way in"
    assert memory.use_count == 0

    again = memory_service.get(db, user_id=user.id, memory_id=memory.id)
    assert again is not None
    assert again.content == "Sam prefers concise answers"


def test_saving_the_same_fact_twice_updates_rather_than_duplicates(db: Session) -> None:
    """A model that helpfully re-saves a preference every session should not
    fill the retrieval budget with ten copies of one sentence."""
    user = owner(db)
    first = memory_service.save(
        db, user_id=user.id, content="Sam prefers concise answers", category="preferences"
    )
    second = memory_service.save(
        db,
        user_id=user.id,
        content="  sam PREFERS concise   answers  ",
        category="preferences",
        importance=5,
        tags=["style"],
    )
    assert first.id == second.id
    assert second.importance == 5, "the stronger importance wins"
    assert memory_service.count(db, user_id=user.id) == 1


def test_an_unknown_category_is_refused(db: Session) -> None:
    user = owner(db)
    with pytest.raises(memory_service.MemoryValidationError, match="not a memory category"):
        memory_service.save(db, user_id=user.id, content="x", category="feelings")


def test_an_empty_memory_is_refused(db: Session) -> None:
    user = owner(db)
    with pytest.raises(memory_service.MemoryValidationError):
        memory_service.save(db, user_id=user.id, content="   ", category="personal")


def test_an_essay_is_refused_and_points_at_documents(db: Session) -> None:
    user = owner(db)
    with pytest.raises(memory_service.MemoryValidationError, match="document"):
        memory_service.save(db, user_id=user.id, content="x" * 2_000, category="school")


def test_importance_is_clamped_rather_than_rejected(db: Session) -> None:
    """The model sometimes says 9. That is a request to remember it firmly, not
    a reason to fail the turn."""
    user = owner(db)
    high = memory_service.save(db, user_id=user.id, content="a", category="personal", importance=9)
    low = memory_service.save(db, user_id=user.id, content="b", category="personal", importance=-2)
    assert (high.importance, low.importance) == (5, 1)


# --- retrieval ---------------------------------------------------------------


def test_asking_about_economics_goals_finds_the_economics_goal(db: Session) -> None:
    """The spec's own example."""
    user = owner(db)
    seed(db, user.id)

    results = memory_service.search(db, user_id=user.id, query="What are my economics goals?")
    contents = [result.memory.content for result in results]

    assert any("A* in Economics" in c for c in contents)
    assert not any("Manchester" in c for c in contents), "unrelated memories stay behind"


def test_planning_a_maths_session_retrieves_the_right_four_things(db: Session) -> None:
    """The other worked example: what reaches the model when the user says
    "help me plan my maths study session"."""
    user = owner(db)
    seed(db, user.id)

    results = memory_service.search(
        db,
        user_id=user.id,
        query="Help me plan my Additional Mathematics study session",
        boost_categories=("subjects", "school"),
    )
    contents = " | ".join(result.memory.content for result in results)
    assert "Additional Mathematics" in contents
    assert "chemistry teacher" not in contents.lower()


def test_importance_breaks_ties(db: Session) -> None:
    user = owner(db)
    memory_service.save(
        db, user_id=user.id, content="Sam has an economics lesson", category="school", importance=1
    )
    memory_service.save(
        db, user_id=user.id, content="Sam has an economics exam", category="school", importance=5
    )
    db.commit()
    results = memory_service.search(db, user_id=user.id, query="economics")
    assert "exam" in results[0].memory.content


def test_tags_are_searchable_without_being_in_the_content(db: Session) -> None:
    user = owner(db)
    memory_service.save(
        db,
        user_id=user.id,
        content="Sam is on the microeconomics unit",
        category="subjects",
        tags=["igcse"],
    )
    db.commit()
    assert memory_service.search(db, user_id=user.id, query="igcse")


def test_a_search_that_matches_nothing_returns_nothing(db: Session) -> None:
    """Not "the least bad match". Padding the context is how an assistant ends
    up answering confidently from something irrelevant."""
    user = owner(db)
    seed(db, user.id)
    assert memory_service.search(db, user_id=user.id, query="submarine warfare") == []


def test_search_is_scoped_to_the_owner(db: Session) -> None:
    user = owner(db)
    seed(db, user.id)
    assert memory_service.search(db, user_id=user.id + 999, query="economics") == []


def test_retrieval_records_that_a_memory_was_used(db: Session) -> None:
    user = owner(db)
    memory = memory_service.save(
        db, user_id=user.id, content="Sam wants an A* in Economics", category="goals"
    )
    db.commit()
    assert memory.use_count == 0

    results = memory_service.search(db, user_id=user.id, query="economics")
    memory_service.mark_used(db, [result.memory for result in results])
    db.commit()

    refreshed = memory_service.get(db, user_id=user.id, memory_id=memory.id)
    assert refreshed is not None
    assert refreshed.use_count == 1
    assert refreshed.last_used_at is not None


# --- updating and deleting ---------------------------------------------------


def test_updating_a_memory(db: Session) -> None:
    user = owner(db)
    memory = memory_service.save(
        db,
        user_id=user.id,
        content="Sam's preferred language is JavaScript",
        category="preferences",
    )
    db.commit()

    updated = memory_service.update(
        db,
        user_id=user.id,
        memory_id=memory.id,
        content="Sam's preferred language is Python",
        importance=4,
    )
    assert updated is not None
    assert "Python" in updated.content
    assert updated.importance == 4
    assert memory_service.count(db, user_id=user.id) == 1, "corrected, not duplicated"


def test_updating_someone_elses_memory_finds_nothing(db: Session) -> None:
    user = owner(db)
    memory = memory_service.save(db, user_id=user.id, content="private", category="personal")
    db.commit()
    assert (
        memory_service.update(db, user_id=user.id + 999, memory_id=memory.id, content="x") is None
    )


def test_deleting_a_memory(db: Session) -> None:
    user = owner(db)
    memory = memory_service.save(
        db, user_id=user.id, content="Sam is working on project X", category="projects"
    )
    db.commit()

    assert memory_service.delete(db, user_id=user.id, memory_id=memory.id) is True
    assert memory_service.get(db, user_id=user.id, memory_id=memory.id) is None
    assert memory_service.delete(db, user_id=user.id, memory_id=memory.id) is False


def test_listing_puts_the_important_things_first(db: Session) -> None:
    user = owner(db)
    seed(db, user.id)
    memories = memory_service.list_all(db, user_id=user.id)
    importances = [memory.importance for memory in memories]
    assert importances == sorted(importances, reverse=True)


def test_listing_can_be_filtered_by_category(db: Session) -> None:
    user = owner(db)
    seed(db, user.id)
    goals = memory_service.list_all(db, user_id=user.id, category="goals")
    assert len(goals) == 2
    assert all(memory.category == "goals" for memory in goals)


# --- the HTTP surface --------------------------------------------------------


def test_the_memory_api_round_trip(signed_in: TestClient) -> None:
    created = signed_in.post(
        "/api/memory",
        json={
            "content": "Sam wants an A* in Economics",
            "category": "goals",
            "importance": 5,
            "tags": ["economics"],
        },
        headers=CLIENT_HEADERS,
    )
    assert created.status_code == 201
    memory_id = created.json()["id"]
    assert created.json()["source"] == "manual", "added by hand, and recorded as such"

    listed = signed_in.get("/api/memory").json()
    assert [m["id"] for m in listed] == [memory_id]

    found = signed_in.get("/api/memory/search?q=economics").json()
    assert found[0]["memory"]["id"] == memory_id
    assert found[0]["score"] > 0
    assert "economic" in found[0]["matched"]

    updated = signed_in.put(
        f"/api/memory/{memory_id}",
        json={"content": "Sam wants an A in Economics", "importance": 4},
        headers=CLIENT_HEADERS,
    )
    assert updated.status_code == 200
    assert updated.json()["importance"] == 4

    assert signed_in.delete(f"/api/memory/{memory_id}", headers=CLIENT_HEADERS).status_code == 204
    assert signed_in.get("/api/memory").json() == []


def test_the_memory_api_rejects_a_bad_category(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/memory",
        json={"content": "x", "category": "vibes"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 400
    assert "not a memory category" in response.json()["detail"]


def test_the_memory_api_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/memory").status_code == 401
    assert (
        client.post(
            "/api/memory", json={"content": "x", "category": "personal"}, headers=CLIENT_HEADERS
        ).status_code
        == 401
    )


def test_categories_are_offered_to_the_interface(signed_in: TestClient) -> None:
    categories = signed_in.get("/api/memory/categories").json()
    assert "preferences" in categories and "subjects" in categories
    assert len(categories) == 10
