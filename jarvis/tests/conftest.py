"""Fixtures.

Every test runs against a throwaway data directory and a fake model, so the
suite needs no API key, no network, and leaves nothing behind.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from jarvis.ai.base import ChatRequest, CompletionEvent, ProviderEvent, TextEvent, ToolUseContent
from jarvis.api.deps import chat_provider
from jarvis.app import create_app
from jarvis.config import PROJECT_ROOT, Settings

CLIENT_HEADERS = {"X-Jarvis-Client": "web"}


class FakeProvider:
    """A model that says what it was told to say.

    Scripted rather than random: a test that asserts on a real model's words is
    a test that fails when the model has a better idea.
    """

    name = "fake"

    def __init__(
        self,
        reply: str = "Understood.",
        *,
        tool_calls: list[ToolUseContent] | None = None,
        configured: bool = True,
    ) -> None:
        self.reply = reply
        self.pending_tool_calls = list(tool_calls or [])
        self.requests: list[ChatRequest] = []
        self._configured = configured

    def is_configured(self) -> bool:
        return self._configured

    def stream(self, request: ChatRequest) -> Iterator[ProviderEvent]:
        self.requests.append(request)
        if self.pending_tool_calls:
            calls = self.pending_tool_calls
            self.pending_tool_calls = []
            yield CompletionEvent(
                text="",
                stop_reason="tool_use",
                tool_calls=calls,
                model="fake-1",
                input_tokens=10,
                output_tokens=5,
            )
            return
        for chunk in self.reply.split(" "):
            yield TextEvent(chunk + " ")
        yield CompletionEvent(
            text=self.reply,
            stop_reason="end_turn",
            model="fake-1",
            input_tokens=12,
            output_tokens=7,
        )


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        log_dir=tmp_path / "logs",
        # The real prompt and the real frontend, so a broken template or a
        # missing page is caught here rather than in the browser.
        config_dir=PROJECT_ROOT / "config",
        frontend_dir=PROJECT_ROOT / "frontend",
        anthropic_api_key="test-key-not-used",
    )


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider()


@pytest.fixture
def client(settings: Settings, provider: FakeProvider) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[chat_provider] = lambda: provider
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def signed_in(client: TestClient) -> TestClient:
    """A client that has completed first-run setup and is signed in."""
    response = client.post(
        "/api/auth/setup",
        json={"username": "owner", "password": "correct horse", "display_name": "Sam"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 201, response.text
    return client
