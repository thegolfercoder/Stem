"""Speech in, speech out - as interfaces, with a free default.

Four jobs kept separate because they have different costs and different privacy
consequences: transcription, speech, wake word, and the conversation loop they
feed (which is `jarvis.services.chat`, unchanged and unaware of any of this).

The default backends are the browser's own Web Speech API, which costs nothing
and keeps audio off the server entirely. Replacing any one of them is a call to
`registry.set_*` at startup.
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
    "set_speech_to_text",
    "set_text_to_speech",
    "set_wake_word",
]
