"""Voice through Google's Gemini API.

This is the first backend in this project where **audio leaves the machine**,
which makes it the first that has to justify itself.

The browser backend is still the default and still costs nothing. This one
exists because it is better: it hears accents and proper nouns the browser's
recogniser mangles, it speaks in something other than a system voice, and it
works in Firefox, which has no Web Speech API at all. The trade is real and it
is the owner's to make, so it is opt-in per direction - you can send speech out
for transcription while keeping playback local, or the reverse - and every
capability says `location="cloud"` so the interface can show what that means
instead of burying it.

Two shapes worth knowing, both discovered by calling the thing rather than
reading about it:

- Synthesis returns **raw PCM**, not a playable file. `audio/l16; rate=24000`
  is signed 16-bit little-endian mono samples with no container, and no browser
  will play that from an `<audio>` element. `to_wav()` puts the 44-byte RIFF
  header on the front, which is the whole difference between silence and sound.
- The transcription model answers in `audioTranscription.text`, not the `text`
  every other Gemini response uses. `_first_text()` accepts either, because a
  model that returns one today may return the other tomorrow and a KeyError is
  a poor way to find that out.

No SDK. Two JSON endpoints over `urllib` is less code than the dependency, and
it keeps the install honest - nothing here is needed unless you turn it on.
"""

from __future__ import annotations

import base64
import json
import struct
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from jarvis.voice.base import (
    Capability,
    Transcript,
    Utterance,
    VoiceUnavailableError,
)

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"

# Verified against the live API rather than assumed. Both are the newest of
# their kind that answer plain `generateContent`; the realtime `bidi` models are
# a websocket protocol and a different design, noted in the README as the next
# step rather than half-built here.
DEFAULT_SPEECH_MODEL = "gemini-3.1-flash-tts-preview"
DEFAULT_TRANSCRIBE_MODEL = "gemini-3.5-transcribe"

# Gemini's prebuilt voices. Named here so the settings page can offer them
# without a network call, and so an unknown name fails locally with a list
# rather than remotely with a 400.
VOICES = (
    "Zephyr",
    "Puck",
    "Charon",
    "Kore",
    "Fenrir",
    "Leda",
    "Orus",
    "Aoede",
    "Callirrhoe",
    "Autonoe",
    "Enceladus",
    "Iapetus",
)

SAMPLE_RATE = 24000
TIMEOUT_SECONDS = 60
# Long enough for a paragraph, short enough that a runaway answer does not turn
# into a minute of synthesis nobody asked for.
MAX_SPEECH_CHARS = 5000
# Gemini takes audio inline as base64. Past a few megabytes that is the wrong
# mechanism (their Files API is the right one), so refuse clearly rather than
# sending a request that will be rejected slowly.
MAX_AUDIO_BYTES = 8 * 1024 * 1024


def to_wav(pcm: bytes, *, rate: int = SAMPLE_RATE, channels: int = 1, bits: int = 16) -> bytes:
    """Wrap raw little-endian PCM in a RIFF header so a browser will play it."""
    block = channels * bits // 8
    header = (
        b"RIFF"
        + struct.pack("<I", 36 + len(pcm))
        + b"WAVEfmt "
        + struct.pack("<IHHIIHH", 16, 1, channels, rate, rate * block, block, bits)
        + b"data"
        + struct.pack("<I", len(pcm))
    )
    return header + pcm


def _post(model: str, payload: dict[str, Any], *, api_key: str) -> dict[str, Any]:
    """One call, with the key in a header rather than the query string.

    `?key=` works and is what most examples show, but it puts the secret in
    anything that logs a URL - proxies, crash reports, a shell's history. The
    header is the same request without that.
    """
    request = urllib.request.Request(
        f"{API_ROOT}/{model}:generateContent",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body: dict[str, Any] = json.loads(response.read())
            return body
    except urllib.error.HTTPError as exc:
        raise VoiceUnavailableError(_describe(exc)) from exc
    except urllib.error.URLError as exc:
        raise VoiceUnavailableError(
            f"Could not reach the Gemini API ({exc.reason}). Voice needs a network "
            "connection; the browser backend does not."
        ) from exc


def _describe(exc: urllib.error.HTTPError) -> str:
    """Turn Google's error body into one sentence that says what to do."""
    detail = ""
    try:
        payload = json.loads(exc.read())
        detail = str(payload.get("error", {}).get("message", ""))
    except Exception:
        # A broken error body must not replace the error it describes.
        pass

    if exc.code in (401, 403):
        return (
            "Gemini rejected the API key. Check JARVIS_GEMINI_API_KEY in .env, and "
            "that the key is enabled for the Generative Language API. " + detail
        ).strip()
    if exc.code == 429:
        return (
            "Gemini is rate-limiting this key. Wait a moment, or switch voice back "
            "to the browser, which has no quota. " + detail
        ).strip()
    if exc.code == 400:
        return f"Gemini refused the request: {detail or 'bad request'}"
    return f"Gemini returned {exc.code}. {detail}".strip()


def _parts(body: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = body.get("candidates") or []
    if not candidates:
        # A prompt blocked by safety filters comes back with no candidates at
        # all, so say that rather than raising IndexError.
        reason = (body.get("promptFeedback") or {}).get("blockReason")
        raise VoiceUnavailableError(f"Gemini returned nothing{f' ({reason})' if reason else ''}.")
    parts: list[dict[str, Any]] = (candidates[0].get("content") or {}).get("parts") or []
    return parts


def _first_audio(body: dict[str, Any]) -> bytes:
    for part in _parts(body):
        inline = part.get("inlineData") or part.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
    raise VoiceUnavailableError("Gemini returned no audio for that text.")


def _first_text(body: dict[str, Any]) -> str:
    """The transcript, wherever this model decided to put it."""
    for part in _parts(body):
        transcription = part.get("audioTranscription") or part.get("audio_transcription")
        if isinstance(transcription, dict) and transcription.get("text"):
            return str(transcription["text"]).strip()
        if part.get("text"):
            return str(part["text"]).strip()
    return ""


@dataclass
class GeminiTextToSpeech:
    """Gemini speaks; this machine relays the audio to the page."""

    api_key: str
    model: str = DEFAULT_SPEECH_MODEL
    voice: str = "Kore"
    name: str = field(default="gemini", init=False)
    location: str = field(default="cloud", init=False)

    def __post_init__(self) -> None:
        if self.voice not in VOICES:
            raise ValueError(f"Unknown Gemini voice {self.voice!r}. One of: {', '.join(VOICES)}")

    def capability(self) -> Capability:
        return Capability(
            name=f"{self.name} ({self.voice})",
            location=self.location,
            available=bool(self.api_key),
            detail=(
                "Answers are sent to Google to be spoken, and the audio comes back here."
                if self.api_key
                else "Set JARVIS_GEMINI_API_KEY in .env to use this."
            ),
            needs_setup=not self.api_key,
        )

    def speak(self, utterance: Utterance) -> bytes:
        """Playable WAV bytes for one utterance."""
        text = (utterance.text or "").strip()
        if not text:
            return b""
        if not self.api_key:
            raise VoiceUnavailableError(
                "No Gemini API key. Put JARVIS_GEMINI_API_KEY in .env, or set voice "
                "back to the browser, which needs no key."
            )

        voice_name = utterance.voice if utterance.voice in VOICES else self.voice
        body = _post(
            self.model,
            {
                "contents": [{"parts": [{"text": text[:MAX_SPEECH_CHARS]}]}],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice_name}}
                    },
                },
            },
            api_key=self.api_key,
        )
        return to_wav(_first_audio(body))


@dataclass
class GeminiSpeechToText:
    """Gemini listens. The audio is uploaded; nothing is kept here."""

    api_key: str
    model: str = DEFAULT_TRANSCRIBE_MODEL
    name: str = field(default="gemini", init=False)
    location: str = field(default="cloud", init=False)

    def capability(self) -> Capability:
        return Capability(
            name=self.name,
            location=self.location,
            available=bool(self.api_key),
            detail=(
                "Recorded audio is uploaded to Google and comes back as text. "
                "Works in every browser, including Firefox."
                if self.api_key
                else "Set JARVIS_GEMINI_API_KEY in .env to use this."
            ),
            needs_setup=not self.api_key,
        )

    def transcribe(
        self, audio: bytes, *, language: str = "en", mime_type: str = "audio/wav"
    ) -> Transcript:
        if not audio:
            raise VoiceUnavailableError("There was no audio to transcribe.")
        if len(audio) > MAX_AUDIO_BYTES:
            raise VoiceUnavailableError(
                f"That recording is {len(audio) // 1024 // 1024} MB, which is past what "
                "can be sent inline. Record something shorter."
            )
        if not self.api_key:
            raise VoiceUnavailableError(
                "No Gemini API key. Put JARVIS_GEMINI_API_KEY in .env, or set voice "
                "back to the browser, which needs no key."
            )

        body = _post(
            self.model,
            {
                "contents": [
                    {
                        "parts": [
                            {
                                "text": (
                                    "Transcribe this audio exactly. Return only the words "
                                    "spoken, with no commentary and no formatting."
                                )
                            },
                            {
                                "inline_data": {
                                    "mime_type": mime_type,
                                    "data": base64.b64encode(audio).decode(),
                                }
                            },
                        ]
                    }
                ]
            },
            api_key=self.api_key,
        )
        text = _first_text(body)
        if not text:
            # Silence is a legitimate outcome, not an error: the person pressed
            # the microphone and said nothing.
            return Transcript(text="", confidence=0.0, final=True, language=language)
        return Transcript(text=text, confidence=1.0, final=True, language=language)
