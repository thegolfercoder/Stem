"""Which voice backends this installation uses.

One module decides, everything else asks. Swapping the browser for a local
Whisper build, or for a cloud service, is `set_speech_to_text(...)` at startup
and no other change anywhere.
"""

from __future__ import annotations

from jarvis.voice.base import (
    BrowserSpeechToText,
    BrowserTextToSpeech,
    NullSpeechToText,
    NullTextToSpeech,
    PhraseWakeWord,
    SpeechToText,
    TextToSpeech,
    VoiceProfile,
    WakeWord,
)

# The browser's own Web Speech API: free, keyless, and the audio stays in the
# page. Good enough to be the default, which is why no paid dependency was added.
_stt: SpeechToText = BrowserSpeechToText()
_tts: TextToSpeech = BrowserTextToSpeech()
_wake: WakeWord = PhraseWakeWord()


def get_speech_to_text() -> SpeechToText:
    return _stt


def set_speech_to_text(backend: SpeechToText) -> None:
    global _stt
    _stt = backend


def get_text_to_speech() -> TextToSpeech:
    return _tts


def set_text_to_speech(backend: TextToSpeech) -> None:
    global _tts
    _tts = backend


def get_wake_word() -> WakeWord:
    return _wake


def set_wake_word(backend: WakeWord) -> None:
    global _wake
    _wake = backend


def disable_all() -> None:
    """Back to silence. Used by tests and by anyone who wants voice gone."""
    set_speech_to_text(NullSpeechToText())
    set_text_to_speech(NullTextToSpeech())


def profile(*, enabled: bool = False) -> VoiceProfile:
    """What the interface needs to decide whether to show a microphone."""
    stt = _stt.capability()
    tts = _tts.capability()
    wake = _wake.capability()

    notes: list[str] = []
    if stt.location == "browser":
        notes.append(
            "Speech recognition runs in the browser. Chrome and Edge support it; "
            "Firefox does not, and will hide the microphone."
        )
    if not enabled:
        notes.append("Voice is off. Turn it on in Settings.")
    if stt.location == "cloud" or tts.location == "cloud":
        notes.append("A cloud voice backend is configured: audio leaves this machine.")

    return VoiceProfile(
        stt=stt,
        tts=tts,
        wake=wake,
        enabled=enabled,
        wake_phrase=getattr(_wake, "phrase", "jarvis"),
        notes=notes,
    )
