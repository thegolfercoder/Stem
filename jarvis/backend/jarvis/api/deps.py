"""FastAPI dependencies.

Every one of these is overridable in tests, which is what lets the whole
application be exercised without a network or an API key.
"""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from jarvis.ai.anthropic_provider import AnthropicProvider
from jarvis.ai.base import ChatProvider
from jarvis.config import Settings, get_settings
from jarvis.context import ContextBuilder
from jarvis.db import get_session
from jarvis.models import User
from jarvis.services import auth as auth_service
from jarvis.services.app_settings import get_ai_settings
from jarvis.tools import ToolRegistry, default_registry


def db_session() -> Iterator[Session]:
    yield from get_session()


def app_settings(request: Request) -> Settings:
    """The settings this application was built with.

    Read from app state rather than the process-wide cache so a test - or a
    second instance pointed at another data directory - is a matter of building
    the app differently, not of clearing a cache.
    """
    settings = getattr(request.app.state, "settings", None)
    return settings if isinstance(settings, Settings) else get_settings()


def current_user(
    session: Session = Depends(db_session),
    jarvis_session: str | None = Cookie(default=None, alias=auth_service.SESSION_COOKIE),
) -> User:
    user = auth_service.resolve_session(session, jarvis_session)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Locked. Sign in to continue."
        )
    return user


def tool_registry(request: Request) -> ToolRegistry:
    """One registry per process, built at startup."""
    registry = getattr(request.app.state, "tool_registry", None)
    if registry is None:  # pragma: no cover - startup always sets it
        registry = default_registry()
        request.app.state.tool_registry = registry
    return registry


def context_builder(request: Request) -> ContextBuilder:
    """One builder per process. Phase 2 registers its retrieval sources on the
    instance held in app state, so every request sees them."""
    builder = getattr(request.app.state, "context_builder", None)
    if builder is None:  # pragma: no cover - startup always sets it
        settings = get_settings()
        builder = ContextBuilder(prompt_path=settings.config_dir / "system_prompt.md")
        request.app.state.context_builder = builder
    return builder


def chat_provider(
    settings: Settings = Depends(app_settings),
    session: Session = Depends(db_session),
) -> ChatProvider:
    ai = get_ai_settings(session)
    return AnthropicProvider(
        settings.anthropic_api_key,
        use_fallbacks=ai.use_refusal_fallback,
    )
