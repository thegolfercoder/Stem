"""The voice seam: interfaces now, backends whenever.

These assert the shape rather than any audio behaviour, because the shape is
the whole deliverable at this stage - and the property worth protecting is that
swapping a backend is one call and touches nothing else.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from jarvis import voice
from jarvis.voice.base import (
    BrowserSpeechToText,
    Capability,
    NullSpeechToText,
    PhraseWakeWord,
    Transcript,
    Utterance,
    VoiceUnavailableError,
)

from tests.conftest import CLIENT_HEADERS


@pytest.fixture(autouse=True)
def restore_registry() -> Iterator[None]:
    """Every test leaves the registry as it found it."""
    stt, tts, wake = voice.get_speech_to_text(), voice.get_text_to_speech(), voice.get_wake_word()
    yield
    voice.set_speech_to_text(stt)
    voice.set_text_to_speech(tts)
    voice.set_wake_word(wake)


def test_the_default_is_free_and_keeps_audio_off_the_server() -> None:
    """No paid dependency was added because the free option is the default."""
    profile = voice.profile(enabled=True)
    assert profile.stt.location == "browser"
    assert profile.tts.location == "browser"
    assert profile.stt.available and profile.tts.available
    assert not profile.stt.needs_setup


def test_the_browser_backend_refuses_server_side_transcription() -> None:
    """It declares the capability; it does not pretend to perform it."""
    with pytest.raises(VoiceUnavailableError, match="not sent to the server"):
        BrowserSpeechToText().transcribe(b"audio")


def test_speaking_returns_empty_bytes_when_the_client_does_it() -> None:
    """Empty is the contract for "you say it", not a failure."""
    assert voice.get_text_to_speech().speak(Utterance(text="hello")) == b""


def test_a_missing_backend_explains_what_would_fix_it() -> None:
    voice.set_speech_to_text(NullSpeechToText())
    with pytest.raises(VoiceUnavailableError, match="browser can do this for free"):
        voice.get_speech_to_text().transcribe(b"audio")
    assert voice.profile().stt.available is False


def test_swapping_a_backend_is_one_call() -> None:
    """The point of the seam: a local or cloud backend drops in here and the
    chat loop never learns about it."""

    class LocalWhisper:
        name = "whisper-local"
        location = "local"

        def capability(self) -> Capability:
            return Capability(name=self.name, location=self.location, available=True)

        def transcribe(
            self, audio: bytes, *, language: str = "en", mime_type: str = "audio/wav"
        ) -> Transcript:
            return Transcript(text="transcribed locally", confidence=0.9)

    voice.set_speech_to_text(LocalWhisper())
    profile = voice.profile(enabled=True)
    assert profile.stt.name == "whisper-local"
    assert profile.stt.location == "local"
    assert voice.get_speech_to_text().transcribe(b"x").text == "transcribed locally"


def test_a_cloud_backend_is_called_out_in_the_profile() -> None:
    """Where audio goes is a fact the interface should state, not bury."""

    class CloudEars:
        name = "someone-elses-computer"
        location = "cloud"

        def capability(self) -> Capability:
            return Capability(name=self.name, location=self.location, available=True)

        def transcribe(
            self, audio: bytes, *, language: str = "en", mime_type: str = "audio/wav"
        ) -> Transcript:
            return Transcript(text="")

    voice.set_speech_to_text(CloudEars())
    notes = " ".join(voice.profile(enabled=True).notes)
    assert "leaves this machine" in notes


def test_the_wake_phrase_matches_case_insensitively() -> None:
    wake = PhraseWakeWord(phrase="jarvis")
    assert wake.matches("Jarvis, what is due today?")
    assert wake.matches("hey JARVIS")
    assert not wake.matches("what is due today?")


def test_voice_is_off_until_it_is_turned_on(signed_in: TestClient) -> None:
    profile = signed_in.get("/api/voice/profile").json()
    assert profile["enabled"] is False
    assert "Voice is off" in " ".join(profile["notes"])

    signed_in.put("/api/settings", json={"voice_enabled": True}, headers=CLIENT_HEADERS)
    profile = signed_in.get("/api/voice/profile").json()
    assert profile["enabled"] is True
    assert profile["speech_to_text"]["location"] == "browser"


def test_the_voice_profile_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/voice/profile").status_code == 401
