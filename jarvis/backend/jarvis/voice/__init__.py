"""Speech in, speech out - as interfaces, with a free default.

Four jobs kept separate because they have different costs and different privacy
consequences: transcription, speech, wake word, and the conversation loop they
feed (which is `jarvis.services.chat`, unchanged and unaware of any of this).

The default backends are the browser's own Web Speech API, which costs nothing
and keeps audio off the server entirely. A cloud backend (Gemini) can be chosen
per direction on the settings page; `registry.resolve_*` turns that choice into
an object, and `registry.set_*` replaces a default outright.
"""

from jarvis.voice.base import (
    Capability,
    SpeechToText,
    TextToSpeech,
    Transcript,
    Utterance,
    VoiceProfile,
    VoiceUnavailableError,
    WakeWord,
)
from jarvis.voice.registry import (
    disable_all,
    get_speech_to_text,
    get_text_to_speech,
    get_wake_word,
    profile,
    resolve_speech_to_text,
    resolve_text_to_speech,
    set_speech_to_text,
    set_text_to_speech,
    set_wake_word,
)

__all__ = [
    "Capability",
    "SpeechToText",
    "TextToSpeech",
    "Transcript",
    "Utterance",
    "VoiceProfile",
    "VoiceUnavailableError",
    "WakeWord",
    "disable_all",
    "get_speech_to_text",
    "get_text_to_speech",
    "get_wake_word",
    "profile",
    "resolve_speech_to_text",
    "resolve_text_to_speech",
    "set_speech_to_text",
    "set_text_to_speech",
    "set_wake_word",
]
