"""Conversations: created, listed, renamed, deleted, and scoped to their owner."""

from __future__ import annotations

from fastapi.testclient import TestClient
from jarvis.services.conversations import derive_title

from tests.conftest import CLIENT_HEADERS


def test_create_list_and_delete(signed_in: TestClient) -> None:
    created = signed_in.post(
        "/api/conversations", json={"title": "Revision plan"}, headers=CLIENT_HEADERS
    )
    assert created.status_code == 201
    conversation_id = created.json()["id"]

    listed = signed_in.get("/api/conversations").json()
    assert [c["title"] for c in listed] == ["Revision plan"]

    assert (
        signed_in.delete(
            f"/api/conversations/{conversation_id}", headers=CLIENT_HEADERS
        ).status_code
        == 204
    )
    assert signed_in.get("/api/conversations").json() == []
    assert signed_in.get(f"/api/conversations/{conversation_id}").status_code == 404


def test_rename(signed_in: TestClient) -> None:
    conversation_id = signed_in.post(
        "/api/conversations", json={"title": "Untitled"}, headers=CLIENT_HEADERS
    ).json()["id"]
    renamed = signed_in.patch(
        f"/api/conversations/{conversation_id}",
        json={"title": "Chemistry revision"},
        headers=CLIENT_HEADERS,
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Chemistry revision"


def test_a_missing_conversation_is_a_404_not_a_500(signed_in: TestClient) -> None:
    assert signed_in.get("/api/conversations/9999").status_code == 404
    assert signed_in.delete("/api/conversations/9999", headers=CLIENT_HEADERS).status_code == 404
    assert (
        signed_in.post(
            "/api/chat", json={"message": "hi", "conversation_id": 9999}, headers=CLIENT_HEADERS
        ).status_code
        == 404
    )


def test_titles_derived_from_a_first_message() -> None:
    assert derive_title("  What is  due   this week? ") == "What is due this week?"
    assert derive_title("") == "New conversation"
    long_title = derive_title("word " * 40)
    assert len(long_title) <= 63 and long_title.endswith("...")
