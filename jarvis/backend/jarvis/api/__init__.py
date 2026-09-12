"""HTTP. Translation only - the logic lives in `jarvis.services`."""

from jarvis.api.auth_routes import router as auth_router
from jarvis.api.conversation_routes import router as conversation_router
from jarvis.api.document_routes import router as document_router
from jarvis.api.learning_routes import router as learning_router
from jarvis.api.memory_routes import router as memory_router
from jarvis.api.system_routes import router as system_router
from jarvis.api.voice_routes import router as voice_router

ROUTERS = (
    auth_router,
    conversation_router,
    memory_router,
    document_router,
    learning_router,
    voice_router,
    system_router,
)

__all__ = [
    "ROUTERS",
    "auth_router",
    "conversation_router",
    "document_router",
    "learning_router",
    "memory_router",
    "system_router",
    "voice_router",
]
