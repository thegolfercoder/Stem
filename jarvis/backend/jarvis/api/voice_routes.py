"""What this installation can hear and say.

One endpoint, because that is all the architecture needs today: the interface
asks what is available and draws a microphone or does not. When a server-side
backend is registered later, transcription and synthesis endpoints join this
router and the interface keeps working unchanged - it already branches on
`location`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from jarvis import voice
from jarvis.api.deps import current_user, db_session
from jarvis.models import User
from jarvis.services.app_settings import get_ai_settings

router = APIRouter(prefix="/api/voice", tags=["voice"])


@router.get("/profile")
def profile(
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict[str, object]:
    """The backends in use, where each one runs, and whether voice is on."""
    return voice.profile(enabled=get_ai_settings(session).voice_enabled).as_dict()
