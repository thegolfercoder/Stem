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
from jarvis.ai.ollama_provider import OllamaProvider
from jarvis.config import Settings, get_settings
from jarvis.context_manager import ContextManager
from jarvis.context_sources import register_default_sources
from jarvis.db import get_session
from jarvis.learning import versions as version_service
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


def context_manager(request: Request, session: Session = Depends(db_session)) -> ContextManager:
    """One manager per process, with the phase 2 sources attached.

    The `log_context` setting is applied per request rather than at startup, so
    turning the context log on in Settings takes effect on the next message
    instead of the next restart.
    """
    manager = getattr(request.app.state, "context_manager", None)
    if manager is None:  # pragma: no cover - startup always sets it
        settings = get_settings()
        manager = ContextManager(prompt_path=settings.config_dir / "system_prompt.md")
        register_default_sources(manager)
        request.app.state.context_manager = manager
    manager.log_context = get_ai_settings(session).log_context
    # The live persona. Seeded from config/system_prompt.md the first time and
    # from the database every time after that.
    settings = get_settings()
    active = version_service.seed_if_empty(
        session, prompt_path=settings.config_dir / "system_prompt.md"
    )
    manager.prompt_body = active.body
    request.state.prompt_version_id = active.id
    return manager


def chat_provider(
    settings: Settings = Depends(app_settings),
    session: Session = Depends(db_session),
) -> ChatProvider:
    """Whichever model the owner chose, behind one interface.

    Resolved per request rather than once at startup, because the choice lives
    in the database and switching should not need a restart - the whole value
    of having a local option is being able to reach for it the moment the other
    one is unavailable.
    """
    ai = get_ai_settings(session)
    if ai.provider == "ollama":
        return OllamaProvider(ai.local_host, model=ai.local_model)
    return AnthropicProvider(
        settings.anthropic_api_key,
        use_fallbacks=ai.use_refusal_fallback,
    )
