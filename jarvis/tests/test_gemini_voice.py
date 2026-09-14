"""The cloud voice backend, and the promises around it.

No network here. Every test either drives the pure parts (the WAV header, the
response readers, the guards) or replaces `urllib.request.urlopen` with a
recorder, so the suite runs with no key, no quota and no wifi - and so a change
to the request shape shows up as a failing assertion rather than a bill.

The tests that matter most are the last few. They are about the key and about
the audio, which are the two things this backend is trusted with.
"""

from __future__ import annotations

import base64
import io
import json
import struct
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from jarvis.voice import gemini, registry
from jarvis.voice.base import Utterance, VoiceUnavailableError

from tests.conftest import CLIENT_HEADERS

PCM = b"\x01\x02" * 1000


class FakeResponse(io.BytesIO):
    """Just enough of an HTTP response for `urlopen`'s context manager."""

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def audio_reply(pcm: bytes = PCM) -> dict[str, Any]:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "audio/l16; rate=24000",
                                "data": base64.b64encode(pcm).decode(),
                            }
                        }
                    ]
                }
            }
        ]
    }


def transcript_reply(text: str) -> dict[str, Any]:
    """The shape the transcription model actually returns."""
    return {"candidates": [{"content": {"parts": [{"audioTranscription": {"text": text}}]}}]}


class Recorder:
    """Stands in for the network: remembers every request, answers from a queue."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.replies: list[dict[str, Any]] = []

    def __len__(self) -> int:
        return len(self.sent)

    def one(self) -> dict[str, Any]:
        assert len(self.sent) == 1, f"expected exactly one request, got {len(self.sent)}"
        return self.sent[0]

    def __call__(self, request: Any, timeout: float = 0) -> FakeResponse:
        self.sent.append(
            {
                "url": request.full_url,
                "headers": {k.lower(): v for k, v in request.headers.items()},
                "body": json.loads(request.data),
            }
        )
        reply = self.replies.pop(0) if self.replies else audio_reply()
        return FakeResponse(json.dumps(reply).encode())


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> Recorder:
    """Record every request instead of sending it."""
    recorder = Recorder()
    monkeypatch.setattr("urllib.request.urlopen", recorder)
    return recorder


# --- the WAV header ---------------------------------------------------------


def test_raw_pcm_is_wrapped_into_something_a_browser_will_play() -> None:
    """Gemini returns headerless samples; without this nothing plays at all."""
    wav = gemini.to_wav(PCM)
    assert wav[:4] == b"RIFF"
    assert wav[8:12] == b"WAVE"
    assert wav.endswith(PCM)

    (size,) = struct.unpack("<I", wav[4:8])
    assert size == 36 + len(PCM), "RIFF size must cover everything after the first 8 bytes"
    channels, rate = struct.unpack("<HI", wav[22:28])
    assert (channels, rate) == (1, gemini.SAMPLE_RATE)
    (data_size,) = struct.unpack("<I", wav[40:44])
    assert data_size == len(PCM)


# --- reading what comes back ------------------------------------------------


def test_a_transcript_is_found_in_either_shape() -> None:
    """The transcribe model answers in `audioTranscription`; everything else in
    `text`. Accepting both means a model swap is a config change, not a bug."""
    assert (
        gemini._first_text(transcript_reply("mocks start on Tuesday")) == "mocks start on Tuesday"
    )
    assert (
        gemini._first_text({"candidates": [{"content": {"parts": [{"text": " hello "}]}}]})
        == "hello"
    )


def test_a_blocked_response_says_so_rather_than_raising_index_error() -> None:
    with pytest.raises(VoiceUnavailableError) as caught:
        gemini._first_text({"promptFeedback": {"blockReason": "SAFETY"}})
    assert "SAFETY" in str(caught.value)


def test_silence_transcribes_to_nothing_rather_than_failing(calls: Recorder) -> None:
    """Pressing the microphone and saying nothing is a normal thing to do."""
    calls.replies.append({"candidates": [{"content": {"parts": []}}]})
    result = gemini.GeminiSpeechToText(api_key="k").transcribe(b"audio", mime_type="audio/webm")
    assert result.text == ""


# --- the requests themselves ------------------------------------------------


def test_speaking_asks_for_audio_in_the_chosen_voice(calls: Recorder) -> None:
    backend = gemini.GeminiTextToSpeech(api_key="k", voice="Charon")
    wav = backend.speak(Utterance(text="Evening."))

    assert wav[:4] == b"RIFF"
    call = calls.one()
    assert gemini.DEFAULT_SPEECH_MODEL in call["url"]
    config = call["body"]["generationConfig"]
    assert config["responseModalities"] == ["AUDIO"]
    assert config["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Charon"


def test_transcribing_sends_the_container_type_it_was_given(
    calls: Recorder,
) -> None:
    """A webm recording announced as wav transcribes to nothing, silently - the
    worst failure mode there is, because it looks like the microphone is broken."""
    calls.replies.append(transcript_reply("when are my mocks"))
    gemini.GeminiSpeechToText(api_key="k").transcribe(b"recording", mime_type="audio/webm")

    call = calls.one()
    parts = call["body"]["contents"][0]["parts"]
    inline = next(p["inline_data"] for p in parts if "inline_data" in p)
    assert inline["mime_type"] == "audio/webm"
    assert base64.b64decode(inline["data"]) == b"recording"


def test_an_empty_utterance_costs_nothing(calls: Recorder) -> None:
    assert gemini.GeminiTextToSpeech(api_key="k").speak(Utterance(text="   ")) == b""
    assert len(calls) == 0, "whitespace should not become a billable request"


def test_an_unknown_voice_fails_here_rather_than_at_google() -> None:
    with pytest.raises(ValueError, match="Unknown Gemini voice"):
        gemini.GeminiTextToSpeech(api_key="k", voice="Gandalf")


def test_a_recording_too_large_to_send_is_refused_locally(calls: Recorder) -> None:
    oversized = b"\x00" * (gemini.MAX_AUDIO_BYTES + 1)
    with pytest.raises(VoiceUnavailableError, match="shorter"):
        gemini.GeminiSpeechToText(api_key="k").transcribe(oversized)
    assert len(calls) == 0


# --- what this backend is trusted with --------------------------------------


def test_the_key_travels_in_a_header_and_never_in_the_url(calls: Recorder) -> None:
    """`?key=` is what every example shows, and it puts the secret into anything
    that logs a URL - a proxy, a crash report, a shell history."""
    gemini.GeminiTextToSpeech(api_key="sk-secret-value").speak(Utterance(text="hello"))

    call = calls.one()
    assert "sk-secret-value" not in call["url"]
    assert "key=" not in call["url"]
    assert call["headers"]["x-goog-api-key"] == "sk-secret-value"


def test_without_a_key_it_says_what_to_do_instead_of_calling_out(
    calls: Recorder,
) -> None:
    with pytest.raises(VoiceUnavailableError) as caught:
        gemini.GeminiTextToSpeech(api_key="").speak(Utterance(text="hello"))
    message = str(caught.value)
    assert "JARVIS_GEMINI_API_KEY" in message
    assert "browser" in message, "the free way out should be part of the error"
    assert len(calls) == 0, "a missing key must not become a request"


def test_choosing_gemini_without_a_key_does_not_quietly_use_the_browser() -> None:
    """A setting that does something other than what it says is worse than one
    that fails: the person would believe audio was staying local."""
    stt = registry.resolve_speech_to_text("gemini", api_key=None)
    assert stt.capability().location != "browser"
    assert not stt.capability().available
    assert stt.capability().needs_setup


def test_the_two_directions_are_chosen_independently() -> None:
    """Hearing and speaking are different trades, so wanting one is not
    consenting to the other."""
    stt = registry.resolve_speech_to_text("browser", api_key="k")
    tts = registry.resolve_text_to_speech("gemini", api_key="k", voice="Kore")
    assert stt.capability().location == "browser"
    assert tts.capability().location == "cloud"

    profile = registry.profile(enabled=True, stt=stt, tts=tts, key_present=True)
    notes = " ".join(profile.notes)
    assert "Answers leave this machine" in notes
    assert "What you say leaves this machine" not in notes


def test_a_cloud_choice_is_stated_in_the_profile_the_page_reads() -> None:
    stt = registry.resolve_speech_to_text("gemini", api_key="k")
    tts = registry.resolve_text_to_speech("gemini", api_key="k")
    payload = registry.profile(enabled=True, stt=stt, tts=tts, key_present=True).as_dict()

    stt_payload = cast(dict[str, Any], payload["speech_to_text"])
    tts_payload = cast(dict[str, Any], payload["text_to_speech"])
    notes = cast(list[str], payload["notes"])
    assert stt_payload["location"] == "cloud"
    assert tts_payload["location"] == "cloud"
    assert any("leaves this machine" in note for note in notes)


# --- over HTTP --------------------------------------------------------------


def test_the_settings_page_is_never_told_the_key(signed_in: TestClient) -> None:
    """Presence, yes. The value, never - there is no endpoint that returns it."""
    body = signed_in.get("/api/settings").json()
    assert "gemini_key_present" in body
    assert not any(isinstance(value, str) and value.startswith("AIza") for value in body.values())
    assert "gemini_api_key" not in body


def test_an_unknown_voice_backend_is_refused_by_the_api(signed_in: TestClient) -> None:
    """`model_copy` would have written this through without a murmur; the handler
    re-validates so a bad backend never reaches the database."""
    response = signed_in.put("/api/settings", json={"voice_stt": "azure"}, headers=CLIENT_HEADERS)
    assert response.status_code == 400
    assert "voice backend" in response.json()["detail"]

    # And the stored value is untouched, rather than half-applied.
    assert signed_in.get("/api/settings").json()["voice_stt"] == "browser"


def test_an_unknown_gemini_voice_is_refused_by_the_api(signed_in: TestClient) -> None:
    response = signed_in.put(
        "/api/settings", json={"voice_name": "Gandalf"}, headers=CLIENT_HEADERS
    )
    assert response.status_code == 400
    assert "voice must be one of" in response.json()["detail"]


def test_a_valid_voice_choice_is_stored(signed_in: TestClient) -> None:
    response = signed_in.put(
        "/api/settings",
        json={"voice_stt": "gemini", "voice_tts": "gemini", "voice_name": "Charon"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["voice_stt"], body["voice_tts"], body["voice_name"]) == (
        "gemini",
        "gemini",
        "Charon",
    )


def test_speaking_is_refused_while_voice_is_off(signed_in: TestClient) -> None:
    response = signed_in.post("/api/voice/speak", json={"text": "hello"}, headers=CLIENT_HEADERS)
    assert response.status_code == 400
    assert "Voice is off" in response.json()["detail"]


def test_the_browser_backend_has_no_audio_to_fetch(signed_in: TestClient) -> None:
    """A page that does its own speaking should not be handed silence and left
    wondering; 409 says "you already have what you need"."""
    signed_in.put(
        "/api/settings",
        json={"voice_enabled": True, "voice_tts": "browser"},
        headers=CLIENT_HEADERS,
    )
    response = signed_in.post("/api/voice/speak", json={"text": "hello"}, headers=CLIENT_HEADERS)
    assert response.status_code == 409
