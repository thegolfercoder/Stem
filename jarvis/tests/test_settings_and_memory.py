"""Settings, status, and deleting memory."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import CLIENT_HEADERS


def test_settings_round_trip(signed_in: TestClient) -> None:
    current = signed_in.get("/api/settings").json()
    # The local model is the default; see tests/test_brain_switch.py for why.
    # The cloud model name is still carried, ready for the switch to select it.
    assert current["provider"] == "ollama"
    assert current["model"].startswith("claude-")

    updated = signed_in.put(
        "/api/settings",
        json={"model": "claude-sonnet-5", "max_tokens": 2048, "show_thinking": True},
        headers=CLIENT_HEADERS,
    )
    assert updated.status_code == 200
    assert updated.json()["model"] == "claude-sonnet-5"
    assert updated.json()["max_tokens"] == 2048
    # Unspecified fields keep their value rather than reverting to a default.
    assert updated.json()["enable_tools"] == current["enable_tools"]
    assert signed_in.get("/api/settings").json()["show_thinking"] is True


def test_the_api_key_is_never_sent_to_the_browser(signed_in: TestClient) -> None:
    """The settings page is told whether a key exists, never what it is."""
    body = signed_in.get("/api/settings").text
    assert "test-key-not-used" not in body
    assert signed_in.get("/api/settings").json()["api_key_present"] is True
    assert signed_in.get("/api/settings").json()["api_key_source"] == "environment"


def test_the_settings_page_cannot_write_a_key(signed_in: TestClient) -> None:
    """There is no field for it, and one sent anyway is ignored rather than stored."""
    response = signed_in.put(
        "/api/settings",
        json={"model": "claude-opus-5", "anthropic_api_key": "sk-smuggled"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 200
    assert "sk-smuggled" not in signed_in.get("/api/settings").text


def test_an_invalid_model_is_refused(signed_in: TestClient) -> None:
    response = signed_in.put("/api/settings", json={"max_tokens": 10}, headers=CLIENT_HEADERS)
    assert response.status_code == 422


def test_status_reports_what_the_dashboard_shows(signed_in: TestClient) -> None:
    signed_in.post("/api/conversations", json={"title": "One"}, headers=CLIENT_HEADERS)
    status = signed_in.get("/api/status").json()
    assert status["conversations"] == 1
    assert status["user"]["display_name"] == "Sam"
    assert status["api_key_present"] is True
    assert "search_conversations" in status["tools"]


def test_erasing_memory_needs_the_exact_phrase(signed_in: TestClient) -> None:
    signed_in.post("/api/conversations", json={"title": "One"}, headers=CLIENT_HEADERS)
    refused = signed_in.post(
        "/api/memory/erase", json={"confirm": "delete my memory"}, headers=CLIENT_HEADERS
    )
    assert refused.status_code == 400
    assert signed_in.get("/api/conversations").json() != []


def test_erasing_memory_actually_deletes_it(signed_in: TestClient) -> None:
    signed_in.post("/api/conversations", json={"title": "One"}, headers=CLIENT_HEADERS)
    signed_in.post("/api/conversations", json={"title": "Two"}, headers=CLIENT_HEADERS)
    response = signed_in.post(
        "/api/memory/erase",
        json={"confirm": "DELETE MY MEMORY", "scope": "conversations"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["conversations_deleted"] == 2
    assert signed_in.get("/api/conversations").json() == []


def test_erase_all_also_resets_settings(signed_in: TestClient) -> None:
    signed_in.put("/api/settings", json={"model": "claude-sonnet-5"}, headers=CLIENT_HEADERS)
    signed_in.post(
        "/api/memory/erase",
        json={"confirm": "DELETE MY MEMORY", "scope": "all"},
        headers=CLIENT_HEADERS,
    )
    assert signed_in.get("/api/settings").json()["model"] == "claude-opus-5"


def test_the_page_and_the_health_check_are_served(client: TestClient) -> None:
    assert client.get("/healthz").json()["status"] == "ok"
    page = client.get("/")
    assert page.status_code == 200
    assert "JARVIS" in page.text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/styles.css").status_code == 200
