"""Login, lock, and who can see what."""

from __future__ import annotations

from fastapi.testclient import TestClient
from jarvis.security import hash_password, verify_password

from tests.conftest import CLIENT_HEADERS


def test_first_run_asks_for_setup(client: TestClient) -> None:
    status = client.get("/api/auth/status").json()
    assert status["needs_setup"] is True
    assert status["authenticated"] is False


def test_setup_creates_the_owner_and_signs_them_in(client: TestClient) -> None:
    response = client.post(
        "/api/auth/setup",
        json={"username": "Owner", "password": "correct horse", "display_name": "Sam"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 201
    assert response.json()["username"] == "owner"
    status = client.get("/api/auth/status").json()
    assert status["authenticated"] is True
    assert status["needs_setup"] is False


def test_a_second_owner_is_refused(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/auth/setup",
        json={"username": "intruder", "password": "another password"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 400


def test_short_passwords_are_refused(client: TestClient) -> None:
    response = client.post(
        "/api/auth/setup",
        json={"username": "owner", "password": "short"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 422


def test_wrong_password_is_rejected_without_saying_which_half(signed_in: TestClient) -> None:
    signed_in.post("/api/auth/logout", headers=CLIENT_HEADERS)
    wrong_password = signed_in.post(
        "/api/auth/login", json={"username": "owner", "password": "nope"}, headers=CLIENT_HEADERS
    )
    wrong_user = signed_in.post(
        "/api/auth/login", json={"username": "ghost", "password": "nope"}, headers=CLIENT_HEADERS
    )
    assert wrong_password.status_code == wrong_user.status_code == 401
    assert wrong_password.json()["detail"] == wrong_user.json()["detail"]


def test_locking_ends_the_session(signed_in: TestClient) -> None:
    assert signed_in.get("/api/auth/me").status_code == 200
    assert signed_in.post("/api/auth/logout", headers=CLIENT_HEADERS).status_code == 204
    assert signed_in.get("/api/auth/me").status_code == 401
    # And the data behind it is gone too, not merely hidden.
    assert signed_in.get("/api/conversations").status_code == 401


def test_protected_endpoints_refuse_an_unknown_cookie(client: TestClient) -> None:
    client.cookies.set("jarvis_session", "not-a-real-token")
    assert client.get("/api/status").status_code == 401


def test_state_changing_requests_need_the_client_header(signed_in: TestClient) -> None:
    """Without this, a page in another tab could act as the signed-in user."""
    forged = signed_in.post("/api/conversations", json={"title": "from elsewhere"})
    assert forged.status_code == 403
    allowed = signed_in.post("/api/conversations", json={"title": "ok"}, headers=CLIENT_HEADERS)
    assert allowed.status_code == 201


def test_changing_the_password_signs_everything_out(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/auth/password",
        json={"current_password": "correct horse", "new_password": "a longer password"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 204
    assert signed_in.get("/api/auth/me").status_code == 401
    again = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "a longer password"},
        headers=CLIENT_HEADERS,
    )
    assert again.status_code == 200


def test_password_hashes_are_salted_and_verifiable() -> None:
    first, second = hash_password("same password"), hash_password("same password")
    assert first != second, "a per-password salt is what stops one table breaking both"
    assert verify_password("same password", first)
    assert not verify_password("Same password", first)
    assert not verify_password("anything", "not-a-hash")
