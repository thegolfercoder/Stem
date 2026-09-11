"""HTTP. Translation only - the logic lives in `jarvis.services`."""

from jarvis.api.auth_routes import router as auth_router
from jarvis.api.conversation_routes import router as conversation_router
from jarvis.api.system_routes import router as system_router

ROUTERS = (auth_router, conversation_router, system_router)

__all__ = ["ROUTERS", "auth_router", "conversation_router", "system_router"]
