"""The FastAPI application.

Assembled in a factory so tests can build one against a temporary database
instead of the real one.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from jarvis import __version__
from jarvis.api import ROUTERS
from jarvis.config import Settings, get_settings
from jarvis.context import ContextBuilder
from jarvis.db import create_all, init_engine, session_scope
from jarvis.logging_setup import configure_logging
from jarvis.services.auth import purge_expired
from jarvis.tools import default_registry

log = logging.getLogger("jarvis.app")

# Browsers will not attach a custom header to a cross-origin request without a
# preflight the server never answers. Requiring one on every state-changing call
# is therefore enough to stop a page in another tab from acting as you - which is
# the only realistic attack on a server bound to loopback.
CLIENT_HEADER = "x-jarvis-client"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.ensure_directories()
    configure_logging(settings.log_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        init_engine(settings.db_path)
        create_all()
        with session_scope() as session:
            expired = purge_expired(session)
        if expired:
            log.info("removed %d expired session(s)", expired)
        app.state.settings = settings
        app.state.tool_registry = default_registry()
        app.state.context_builder = ContextBuilder(
            prompt_path=settings.config_dir / "system_prompt.md"
        )
        log.info("JARVIS %s ready on http://%s:%d", __version__, settings.host, settings.port)
        log.info("data directory: %s", settings.data_dir)
        if not settings.anthropic_api_key:
            log.warning(
                "no API key found - set JARVIS_ANTHROPIC_API_KEY in jarvis/.env to enable chat"
            )
        yield

    app = FastAPI(
        title="JARVIS",
        version=__version__,
        description="A private, local-first personal assistant.",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def require_local_client(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if (
            request.method not in SAFE_METHODS
            and request.url.path.startswith("/api/")
            and request.headers.get(CLIENT_HEADER) is None
        ):
            return JSONResponse(
                status_code=403, content={"detail": "Missing X-Jarvis-Client header."}
            )
        return await call_next(request)

    for router in ROUTERS:
        app.include_router(router)

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    frontend = settings.frontend_dir
    if (frontend / "static").is_dir():
        app.mount("/static", StaticFiles(directory=frontend / "static"), name="static")

    if (frontend / "index.html").is_file():

        @app.get("/", include_in_schema=False)
        def index() -> FileResponse:
            # One page. Which panel is showing is the browser's business, so
            # there is no server-side routing to keep in step with the sidebar.
            return FileResponse(frontend / "index.html")

    return app


app = create_app  # a factory, not an instance: `uvicorn jarvis.app:app --factory`
