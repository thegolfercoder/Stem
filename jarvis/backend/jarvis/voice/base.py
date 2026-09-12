"""The shape of speech, decided now so it can be filled in later.

Voice is four separable jobs, and the reason to name them all now is that they
have wildly different costs and failure modes. Wake-word detection runs
continuously and must be cheap and local. Transcription is bursty and can be
either. Speech is optional and can be swapped for a better voice any time. If
the assistant were written against one vendor's SDK, changing any one of them
would mean opening the chat loop again.

So: protocols here, implementations registered in `registry.py`, and the chat
service never imports either.

On cost. The default is `browser` - the Web Speech API that every modern
browser already has. It costs nothing, needs no key, and the audio does not
pass through this machine's backend at all. That is why no paid dependency was
added: the free option was good enough to be the default, and everything else
is a drop-in.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

# Where a capability is performed. The distinction matters for privacy: "browser"
# and "local" keep audio on the owner's machine, "cloud" does not, and the
# interface should make that visible rather than buried in a vendor's docs.
LOCATIONS = ("browser", "local", "cloud", "none")


@dataclass(frozen=True)
class Transcript:
    """What was heard."""

    text: str
    confidence: float = 0.0
    final: bool = True
    language: str = "en"


@dataclass(frozen=True)
class Utterance:
    """What to say, and how."""

    text: str
    voice: str = "default"
    rate: float = 1.0
    pitch: float = 1.0


@dataclass(frozen=True)
class Capability:
    """What one backend is and where it runs, for the interface to show."""

    name: str
    location: str
    available: bool
    detail: str = ""
    # True when a key or a download would be needed before this works.
    needs_setup: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "location": self.location,
            "available": self.available,
            "detail": self.detail,
            "needs_setup": self.needs_setup,
        }


@runtime_checkable
class SpeechToText(Protocol):
    """Audio in, text out."""

    name: str
    location: str

    def capability(self) -> Capability: ...

    def transcribe(self, audio: bytes, *, language: str = "en") -> Transcript:
        """One utterance, transcribed. Raises `VoiceUnavailableError` when this
        backend cannot run here."""
        ...


@runtime_checkable
class TextToSpeech(Protocol):
    """Text in, audio out."""

    name: str
    location: str

    def capability(self) -> Capability: ...

    def speak(self, utterance: Utterance) -> bytes:
        """Audio bytes for one utterance. Empty when the client is expected to
        do the speaking itself, as the browser backend does."""
        ...


@runtime_checkable
class WakeWord(Protocol):
    """Listening for the word that starts everything."""

    name: str
    location: str
    phrase: str

    def capability(self) -> Capability: ...

    def listen(self) -> Iterator[float]:
        """Yields a confidence each time the phrase is heard. Long-running."""
        ...


class VoiceUnavailableError(RuntimeError):
    """This backend cannot run here, with a sentence saying what would fix it."""


# --- the defaults: nothing installed, nothing pretended ----------------------


@dataclass
class NullSpeechToText:
    """No transcription on this machine."""

    name: str = "none"
    location: str = "none"

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=False,
            detail="No transcription backend configured.",
            needs_setup=True,
        )

    def transcribe(self, audio: bytes, *, language: str = "en") -> Transcript:
        raise VoiceUnavailableError(
            "No speech-to-text backend is configured. The browser can do this for "
            "free - enable voice in Settings - or register a local model."
        )


@dataclass
class NullTextToSpeech:
    name: str = "none"
    location: str = "none"

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=False,
            detail="No speech backend configured.",
            needs_setup=True,
        )

    def speak(self, utterance: Utterance) -> bytes:
        raise VoiceUnavailableError("No text-to-speech backend is configured.")


@dataclass
class NullWakeWord:
    name: str = "none"
    location: str = "none"
    phrase: str = ""

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=False,
            detail="Wake word detection is off; press the microphone instead.",
        )

    def listen(self) -> Iterator[float]:
        return iter(())


# --- the free default: the browser already has all of this -------------------


@dataclass
class BrowserSpeechToText:
    """Transcription performed by the browser's own Web Speech API.

    The backend never sees the audio. This class exists to *declare* the
    capability so the interface knows to show a microphone, and so the same
    registry answers "what can this installation hear with?" whichever backend
    is in use. `transcribe` is deliberately unimplemented: by the time text
    reaches the server it has already been transcribed.
    """

    name: str = "browser"
    location: str = "browser"

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=True,
            detail="The browser transcribes; audio never reaches the server.",
        )

    def transcribe(self, audio: bytes, *, language: str = "en") -> Transcript:
        raise VoiceUnavailableError(
            "The browser backend transcribes in the page. Audio is not sent to the "
            "server, so there is nothing here to transcribe."
        )


@dataclass
class BrowserTextToSpeech:
    """Speech performed by the browser's speechSynthesis."""

    name: str = "browser"
    location: str = "browser"

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=True,
            detail="The browser speaks; no audio is generated or stored here.",
        )

    def speak(self, utterance: Utterance) -> bytes:
        # Empty bytes is the contract for "the client does it", not a failure.
        return b""


@dataclass
class PhraseWakeWord:
    """A typed or spoken phrase that starts a session.

    Matching happens wherever the transcript comes from, which for the browser
    backend is the page. Real always-on detection wants a small local model
    (openWakeWord, Porcupine); this keeps the interface honest until then.
    """

    phrase: str = "jarvis"
    name: str = "phrase"
    location: str = "browser"

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=True,
            detail=f"Listens for {self.phrase!r} in what the browser transcribes.",
        )

    def matches(self, text: str) -> bool:
        return self.phrase.lower() in (text or "").lower()

    def listen(self) -> Iterator[float]:
        # Always-on listening needs a local detector; the browser path pushes
        # transcripts instead of being polled.
        return iter(())


@dataclass(frozen=True)
class VoiceProfile:
    """How this installation does voice, as one object for the API to return."""

    stt: Capability
    tts: Capability
    wake: Capability
    enabled: bool = False
    wake_phrase: str = "jarvis"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "wake_phrase": self.wake_phrase,
            "speech_to_text": self.stt.as_dict(),
            "text_to_speech": self.tts.as_dict(),
            "wake_word": self.wake.as_dict(),
            "notes": self.notes,
        }
