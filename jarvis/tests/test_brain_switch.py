"""The switch in the top bar, and the default it starts on.

Two decisions are pinned here, and they are the same decision twice.

The default provider is the model on this machine. A fresh install has no API
key; defaulting to the cloud makes the first question fail with "no API key",
which reads as a broken program rather than as a setting nobody has chosen yet.

And moving off that default is one click, not a trip through a settings page,
because the moment you want the cloud model is the moment a question turns out
to be harder than expected - mid-thought, with the question already typed.
"""

from __future__ import annotations

import json
import re

import pytest
from fastapi.testclient import TestClient
from jarvis.config import Settings
from jarvis.services.app_settings import (
    CLOUD_PROVIDER,
    LOCAL_PROVIDER,
    PROVIDERS,
    AISettings,
)

from tests.conftest import CLIENT_HEADERS


def _frontend() -> Settings:
    return Settings()


# --- what it starts on -------------------------------------------------------


def test_nothing_chosen_means_the_local_model() -> None:
    """The default that needs no key, no account and no network."""
    assert AISettings().provider == LOCAL_PROVIDER


def test_a_fresh_install_answers_without_any_key(signed_in: TestClient) -> None:
    """Nobody has opened Settings yet, and the machine is already the brain."""
    status = signed_in.get("/api/status").json()
    assert status["provider"] == LOCAL_PROVIDER
    assert status["model"] == AISettings().local_model


def test_the_two_ends_of_the_switch_are_real_providers() -> None:
    """A typo in either constant would leave a switch that saves a setting the
    server refuses, which is the sort of thing that only shows up in use."""
    assert LOCAL_PROVIDER in PROVIDERS
    assert CLOUD_PROVIDER in PROVIDERS
    assert LOCAL_PROVIDER != CLOUD_PROVIDER


# --- flipping it -------------------------------------------------------------


def test_the_switch_moves_the_answer_off_the_machine_and_back(signed_in: TestClient) -> None:
    """The whole feature, over HTTP: one field, both directions, and the model
    name follows the side it is on."""
    cloud = signed_in.put(
        "/api/settings", json={"provider": CLOUD_PROVIDER}, headers=CLIENT_HEADERS
    )
    assert cloud.status_code == 200, cloud.text
    assert cloud.json()["provider"] == CLOUD_PROVIDER

    status = signed_in.get("/api/status").json()
    assert status["provider"] == CLOUD_PROVIDER
    assert status["model"] == AISettings().model, "the cloud model, not the local one"

    back = signed_in.put("/api/settings", json={"provider": LOCAL_PROVIDER}, headers=CLIENT_HEADERS)
    assert back.status_code == 200
    assert signed_in.get("/api/status").json()["model"] == AISettings().local_model


def test_flipping_keeps_the_model_name_you_had_set_on_the_other_side(
    signed_in: TestClient,
) -> None:
    """Switching is a thing you do several times an hour. If the trip out and
    back lost the model you had chosen, it would be unusable."""
    signed_in.put("/api/settings", json={"local_model": "mistral:7b"}, headers=CLIENT_HEADERS)
    signed_in.put("/api/settings", json={"provider": CLOUD_PROVIDER}, headers=CLIENT_HEADERS)
    back = signed_in.put("/api/settings", json={"provider": LOCAL_PROVIDER}, headers=CLIENT_HEADERS)
    assert back.json()["local_model"] == "mistral:7b"


def test_the_switch_never_writes_a_key_anywhere(signed_in: TestClient) -> None:
    """Choosing the cloud end selects a provider; it does not, and must not,
    give the page any way to supply the secret that provider needs."""
    response = signed_in.put(
        "/api/settings",
        json={"provider": CLOUD_PROVIDER, "anthropic_api_key": "sk-ant-should-be-ignored"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code in (200, 422)
    body = json.dumps(response.json())
    assert "sk-ant-should-be-ignored" not in body


@pytest.mark.parametrize("bad", ["gpt", "", "local", "claude"])
def test_a_provider_nobody_implements_is_refused(signed_in: TestClient, bad: str) -> None:
    response = signed_in.put("/api/settings", json={"provider": bad}, headers=CLIENT_HEADERS)
    assert response.status_code == 400


# --- the control itself ------------------------------------------------------


def test_the_switch_is_in_the_top_bar_where_it_can_be_reached_mid_thought() -> None:
    """Not on the settings page. The point of it is that it is always visible."""
    html = (_frontend().frontend_dir / "index.html").read_text()
    topbar = html.split('<header id="topbar">', 1)[1].split("</header>", 1)[0]
    assert 'id="brain-toggle"' in topbar


def test_the_switch_says_what_it_is_to_a_screen_reader() -> None:
    """A bare knob is a control only if you can see it."""
    html = (_frontend().frontend_dir / "index.html").read_text()
    markup = re.search(r"<button[^>]*id=\"brain-toggle\".*?>", html, re.S)
    assert markup, "the toggle should be a button"
    tag = markup.group(0)
    assert 'role="switch"' in tag
    assert "aria-checked" in tag
    assert "aria-label" in tag


def test_both_ends_are_labelled_in_words() -> None:
    """The knob's position says which side; only the words say what the sides
    are. Someone who has never opened Settings has to be able to read it."""
    html = (_frontend().frontend_dir / "index.html").read_text()
    switch = html.split('id="brainswitch"', 1)[1].split("</div>", 1)[0]
    assert "local" in switch.lower()
    assert "claude" in switch.lower()


def test_the_switch_saves_through_the_same_endpoint_as_the_settings_page() -> None:
    """Two ways to change one setting is fine; two places that store it is not."""
    script = (_frontend().frontend_dir / "static" / "app.js").read_text()
    handler = script.split('$("#brain-toggle").addEventListener', 1)[1].split("\n});", 1)[0]
    assert '"/api/settings"' in handler
    assert "provider" in handler


def test_the_page_draws_the_switch_from_the_server_not_from_the_click() -> None:
    """If the knob moved on click alone, a refused change would leave it lying
    about which model is answering - the one thing this control must not do."""
    script = (_frontend().frontend_dir / "static" / "app.js").read_text()
    handler = script.split('$("#brain-toggle").addEventListener', 1)[1].split("\n});", 1)[0]
    assert "loadDashboard()" in handler

    render = script.split("function renderBrainSwitch", 1)[1].split("\n}", 1)[0]
    assert "status.provider" in render, "position comes from the stored setting"


def test_the_page_and_the_server_agree_on_the_two_ends() -> None:
    script = (_frontend().frontend_dir / "static" / "app.js").read_text()
    assert f'const LOCAL_PROVIDER = "{LOCAL_PROVIDER}"' in script
    assert f'const CLOUD_PROVIDER = "{CLOUD_PROVIDER}"' in script


def test_a_drawer_does_not_cover_the_switch() -> None:
    """The switch is in the top bar so it is always there. A drawer pinned to
    the whole viewport put its own header over it - reachable everywhere except
    the settings page, which is precisely where someone would be when they
    decided to change models."""
    css = (_frontend().frontend_dir / "static" / "styles.css").read_text()
    rule = re.search(r"^\.drawer \{[^}]*\}", css, re.M)
    assert rule, "the drawer should still have a rule"
    assert "inset: 0" not in rule.group(0), "a full-viewport drawer swallows the top bar"
    assert "--topbar-h" in rule.group(0), "it should start where the top bar ends"
