"""What this installation can hear and say.

The profile endpoint is what the interface asks before drawing a microphone.
The other two exist only for backends that run somewhere other than the page:
the browser does its own hearing and speaking and never calls them, while a
cloud backend needs this server to hold the key and make the request.

That indirection is the point. The API key never reaches the browser, so a page
left open on a shared screen cannot leak it, and every byte of audio that leaves
this machine leaves from one place that can be read in one sitting.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from jarvis import voice
from jarvis.api.deps import current_user, db_session
from jarvis.api.schemas import SpeakRequest
from jarvis.config import get_settings
from jarvis.models import User
from jarvis.services.app_settings import get_ai_settings
from jarvis.voice.base import Utterance, VoiceUnavailableError

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])

# Past this an "utterance" is a recording, and a browser that streams a whole
# meeting at the transcription endpoint should be told no here rather than at
# Google's edge.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@router.get("/profile")
def profile(
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict[str, object]:
    """The backends in use, where each one runs, and whether voice is on."""
    ai = get_ai_settings(session)
    key = get_settings().gemini_api_key
    return voice.profile(
        enabled=ai.voice_enabled,
        stt=voice.resolve_speech_to_text(ai.voice_stt, api_key=key),
        tts=voice.resolve_text_to_speech(ai.voice_tts, api_key=key, voice=ai.voice_name),
        key_present=bool(key),
    ).as_dict()


@router.post("/speak")
def speak(
    body: SpeakRequest,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> Response:
    """Audio for one piece of text, when something other than the page speaks."""
    ai = get_ai_settings(session)
    if not ai.voice_enabled:
        raise HTTPException(status_code=400, detail="Voice is off. Turn it on in Settings.")

    key = get_settings().gemini_api_key
    backend = voice.resolve_text_to_speech(ai.voice_tts, api_key=key, voice=ai.voice_name)
    try:
        audio = backend.speak(Utterance(text=body.text, voice=body.voice or ai.voice_name))
    except VoiceUnavailableError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not audio:
        # The browser backend's contract for "you speak it". Not an error, and
        # not something to invent silence for either.
        raise HTTPException(
            status_code=409,
            detail="This backend speaks in the page; there is no audio to fetch.",
        )
    return Response(
        content=audio,
        media_type="audio/wav",
        # The text was just sent here to be spoken; caching the result would put
        # a copy of it in the browser's disk cache for no benefit.
        headers={"Cache-Control": "no-store"},
    )


@router.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str = Form(default="en"),
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict[str, object]:
    """Text for one recording, when something other than the page listens."""
    ai = get_ai_settings(session)
    if not ai.voice_enabled:
        raise HTTPException(status_code=400, detail="Voice is off. Turn it on in Settings.")

    data = await audio.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too long to send.")

    key = get_settings().gemini_api_key
    backend = voice.resolve_speech_to_text(ai.voice_stt, api_key=key)
    try:
        # The container type travels with the bytes: browsers record webm or
        # ogg depending on which browser, and a transcriber told the wrong one
        # returns nothing rather than failing.
        result = backend.transcribe(
            data,
            language=language,
            mime_type=audio.content_type or "audio/webm",
        )
    except VoiceUnavailableError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Deliberately not logged, at any level: this is the person talking.
    log.info("transcribed %d bytes of audio", len(data))
    return {"text": result.text, "final": result.final, "language": result.language}
