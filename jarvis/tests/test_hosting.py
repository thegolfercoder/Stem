"""What changes when it is not on loopback any more.

On this machine the login form could only be reached by whoever was already at
the keyboard. Hosted, it is reachable by anyone who finds the address, and two
things that were reasonable become wrong: unlimited password attempts, and a
session cookie without its `secure` flag.

These are the tests for both. The throttle ones use a fresh `Throttle` rather
than the shared one wherever they can, so they cannot leak counts into each
other or depend on the order they run in.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from jarvis.services.auth import SESSION_COOKIE
from jarvis.services.throttle import Throttle, login_throttle

from tests.conftest import CLIENT_HEADERS


@pytest.fixture(autouse=True)
def clean_throttle() -> None:
    """The login throttle is process-wide, so every test starts it empty."""
    login_throttle.reset()


# --- the throttle itself -----------------------------------------------------


def test_a_few_typos_cost_nothing() -> None:
    """A person mistyping their own password should never meet this."""
    throttle = Throttle(free_attempts=5)
    for _ in range(5):
        assert throttle.record_failure("user:rian") == 0
    assert throttle.retry_after("user:rian") == 0


def test_the_wait_doubles() -> None:
    throttle = Throttle(free_attempts=2, base_delay=2, max_delay=300)
    throttle.record_failure("k")
    throttle.record_failure("k")
    assert throttle.record_failure("k") == 2
    assert throttle.record_failure("k") == 4
    assert throttle.record_failure("k") == 8


def test_the_wait_has_a_ceiling() -> None:
    """Doubling without a cap would lock the owner out for days after a bad
    afternoon; the point is to make guessing hopeless, not to punish."""
    throttle = Throttle(free_attempts=0, base_delay=2, max_delay=10)
    delays = [throttle.record_failure("k") for _ in range(12)]
    assert max(delays) == 10


def test_getting_it_right_forgives_what_came_before() -> None:
    throttle = Throttle(free_attempts=1, base_delay=60)
    throttle.record_failure("user:rian")
    throttle.record_failure("user:rian")
    assert throttle.retry_after("user:rian") > 0

    throttle.record_success("user:rian")
    assert throttle.retry_after("user:rian") == 0


def test_the_longest_wait_among_the_keys_wins() -> None:
    """A caller is held back if either the account or the address is in
    trouble, so the answer is the worst of them, not the first."""
    throttle = Throttle(free_attempts=0, base_delay=2, max_delay=300)
    throttle.record_failure("ip:1.2.3.4")
    for _ in range(4):
        throttle.record_failure("user:rian")

    account_only = throttle.retry_after("user:rian")
    both = throttle.retry_after("user:rian", "ip:1.2.3.4")
    assert both == account_only > 2


def test_old_failures_are_forgotten() -> None:
    """Yesterday's typo should not count against today."""
    throttle = Throttle(free_attempts=1, base_delay=1, window=0)
    throttle.record_failure("k")
    throttle.record_failure("k")
    time.sleep(1.1)  # let the one-second block lapse
    assert throttle.retry_after("k") == 0


# --- over HTTP ---------------------------------------------------------------


def test_guessing_the_password_gets_slow(signed_in: TestClient) -> None:
    """The behaviour that matters: an online guessing attack should become
    pointless long before it becomes successful."""
    attempts = []
    for _ in range(8):
        response = signed_in.post(
            "/api/auth/login",
            json={"username": "owner", "password": "not the password"},
            headers=CLIENT_HEADERS,
        )
        attempts.append(response.status_code)

    assert attempts[0] == 401, "the first wrong password is simply wrong"
    assert 429 in attempts, "but they do not stay cheap forever"

    blocked = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "not the password"},
        headers=CLIENT_HEADERS,
    )
    assert blocked.status_code == 429
    assert blocked.headers.get("Retry-After"), "a client should be told how long to wait"
    assert "Try again in" in blocked.json()["detail"]


def test_the_throttle_does_not_lock_out_the_right_password(signed_in: TestClient) -> None:
    """A few failures then the real password must still work - otherwise the
    defence is worse than the attack."""
    for _ in range(3):
        signed_in.post(
            "/api/auth/login",
            json={"username": "owner", "password": "wrong"},
            headers=CLIENT_HEADERS,
        )
    good = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers=CLIENT_HEADERS,
    )
    assert good.status_code == 200


def test_a_wrong_password_never_says_which_half_was_wrong(signed_in: TestClient) -> None:
    """Naming the username as the problem tells an attacker which accounts exist."""
    unknown = signed_in.post(
        "/api/auth/login",
        json={"username": "nobody", "password": "whatever"},
        headers=CLIENT_HEADERS,
    ).json()["detail"]
    wrong = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "whatever"},
        headers=CLIENT_HEADERS,
    ).json()["detail"]
    assert unknown.split(" Too many")[0] == wrong.split(" Too many")[0]


# --- the cookie --------------------------------------------------------------


def test_the_session_cookie_is_not_readable_by_script(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers=CLIENT_HEADERS,
    )
    header = response.headers["set-cookie"]
    assert SESSION_COOKIE in header
    assert "HttpOnly" in header
    assert "SameSite=lax" in header.replace("Lax", "lax")


def test_the_cookie_goes_secure_when_the_proxy_says_https(signed_in: TestClient) -> None:
    """Hosted, the cookie must never travel over plain http. Behind a proxy the
    app itself speaks http, so the forwarded header is the only thing that knows."""
    plain = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers=CLIENT_HEADERS,
    )
    assert "Secure" not in plain.headers["set-cookie"], "loopback http would refuse it"

    login_throttle.reset()
    behind_proxy = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers={**CLIENT_HEADERS, "X-Forwarded-Proto": "https"},
    )
    assert "Secure" in behind_proxy.headers["set-cookie"]


def test_a_proxy_list_is_read_from_the_left(signed_in: TestClient) -> None:
    """`x-forwarded-proto` can be a list when there are several hops; the
    client's own scheme is the first one."""
    response = signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers={**CLIENT_HEADERS, "X-Forwarded-Proto": "https, http"},
    )
    assert "Secure" in response.headers["set-cookie"]


# --- the packaging -----------------------------------------------------------


def test_no_secret_is_baked_into_the_image() -> None:
    """The image is rebuildable and disposable precisely because it holds
    nothing personal. A key copied into a layer is in the registry forever."""
    from jarvis.config import Settings

    root = Settings().frontend_dir.parent
    dockerfile = (root / "Dockerfile").read_text()

    for forbidden in ("API_KEY=", "PASSWORD=", "sk-ant-", "AIza"):
        assert forbidden not in dockerfile, f"{forbidden} has no business in an image"

    assert "COPY .env" not in dockerfile, "the one file that must never be copied in"
    assert "USER jarvis" in dockerfile, "it should not run as root"
    assert "VOLUME" in dockerfile, "data belongs outside the image"


def test_the_data_directory_is_the_only_thing_that_persists() -> None:
    from jarvis.config import Settings

    root = Settings().frontend_dir.parent
    compose = (root / "compose.yaml").read_text()

    assert "jarvis-data:/data" in compose
    assert "env_file" in compose, "the key comes from a file that is not committed"
    # The app must not be reachable except through the proxy that terminates
    # TLS, or a plain-http route around it would exist.
    assert "expose:" in compose
    assert '- "8765:8765"' not in compose, "publishing it would bypass the proxy"


def test_logging_out_actually_clears_the_cookie(signed_in: TestClient) -> None:
    """Not just the row - the cookie too.

    An earlier version cleared it on the injected response and then returned a
    freshly built one, which threw the header away. The token was already dead
    server-side, so nothing was reachable with it; but a dead cookie left in a
    browser is exactly what you do not want on a machine someone else may use.
    """
    signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers=CLIENT_HEADERS,
    )
    response = signed_in.post("/api/auth/logout", headers=CLIENT_HEADERS)

    assert response.status_code == 204
    header = response.headers.get("set-cookie", "")
    assert SESSION_COOKIE in header, "logout must tell the browser to drop it"
    assert "Max-Age=0" in header or "expires=" in header.lower()


def test_a_dead_session_is_dead_server_side_too(signed_in: TestClient) -> None:
    """The belt to the cookie's braces: even replayed, the token is worthless."""
    signed_in.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse"},
        headers=CLIENT_HEADERS,
    )
    token = signed_in.cookies.get(SESSION_COOKIE)
    assert token

    signed_in.post("/api/auth/logout", headers=CLIENT_HEADERS)
    signed_in.cookies.set(SESSION_COOKIE, token)  # replay it deliberately
    assert signed_in.get("/api/auth/me").status_code == 401


def test_a_username_with_a_space_matches_however_it_is_typed() -> None:
    """Owners give themselves full names, and a login that fails because of an
    extra space is a login that fails for no visible reason."""
    from jarvis.services.auth import normalise_username

    canonical = normalise_username("Ada Lovelace")
    for typed in ("Ada Lovelace", "  ADA   Lovelace  ", "ada lovelace", "ada  LOVELACE"):
        assert normalise_username(typed) == canonical
