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


def resolve_speech_to_text(choice: str, *, api_key: str | None) -> SpeechToText:
    """The hearing backend named by the settings page.

    Resolution happens per request rather than once at startup, because the
    choice lives in the database and can change while the server is running.
    Asking for a backend whose key is missing gets the Null one, which says what
    is wrong, rather than a silent fall back to the browser - a setting that
    quietly does something other than what it says is worse than one that fails.
    """
    if choice == "gemini":
        if not api_key:
            return NullSpeechToText()
        from jarvis.voice.gemini import GeminiSpeechToText

        return GeminiSpeechToText(api_key=api_key)
    if choice == "browser":
        return BrowserSpeechToText()
    return NullSpeechToText()


def resolve_text_to_speech(
    choice: str, *, api_key: str | None, voice: str = "Kore"
) -> TextToSpeech:
    """The speaking backend named by the settings page."""
    if choice == "gemini":
        if not api_key:
            return NullTextToSpeech()
        from jarvis.voice.gemini import GeminiTextToSpeech

        return GeminiTextToSpeech(api_key=api_key, voice=voice)
    if choice == "browser":
        return BrowserTextToSpeech()
    return NullTextToSpeech()


def profile(
    *,
    enabled: bool = False,
    stt: SpeechToText | None = None,
    tts: TextToSpeech | None = None,
    key_present: bool | None = None,
) -> VoiceProfile:
    """What the interface needs to decide whether to show a microphone.

    Takes the resolved backends when it has them, and falls back to the
    registered globals so the older callers and the tests keep working.
    """
    stt_cap = (stt or _stt).capability()
    tts_cap = (tts or _tts).capability()
    wake = _wake.capability()

    notes: list[str] = []
    if stt_cap.location == "browser":
        notes.append(
            "Speech recognition runs in the browser. Chrome and Edge support it; "
            "Firefox does not, and will hide the microphone."
        )
    if not enabled:
        notes.append("Voice is off. Turn it on in Settings.")
    # Said plainly, because it is the one thing about this feature a person
    # would want to have been told. The provider is named from the capability
    # rather than written in: this module should not have to be edited to stay
    # truthful when a different cloud backend is registered.
    if stt_cap.location == "cloud":
        notes.append(
            f"What you say leaves this machine: audio is uploaded to {stt_cap.name} "
            "to be transcribed."
        )
    if tts_cap.location == "cloud":
        notes.append(
            f"Answers leave this machine to be spoken: the text is sent to {tts_cap.name}."
        )
    if key_present is False and "gemini" in (stt_cap.name + tts_cap.name):
        notes.append("No Gemini API key found. Put JARVIS_GEMINI_API_KEY in .env.")

    return VoiceProfile(
        stt=stt_cap,
        tts=tts_cap,
        wake=wake,
        enabled=enabled,
        wake_phrase=getattr(_wake, "phrase", "jarvis"),
        notes=notes,
    )
