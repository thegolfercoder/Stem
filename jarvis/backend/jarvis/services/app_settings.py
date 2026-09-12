"""Settings the user can change, and the one they cannot.

The AI configuration lives in the database so the settings page can change it
without a restart. The API key does not: it is read from the environment on every
request and never written here, so exporting or backing up `data/` cannot carry
the secret with it.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from jarvis.ai.anthropic_provider import DEFAULT_MODEL
from jarvis.ai.ollama_provider import DEFAULT_HOST as OLLAMA_DEFAULT_HOST
from jarvis.ai.ollama_provider import DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL
from jarvis.ai.openai_provider import DEFAULT_MODEL as OPENAI_DEFAULT_MODEL
from jarvis.models import AppSetting

AI_SETTINGS_KEY = "ai"

# Where the intelligence comes from. Two, because the point of the second is
# that the assistant keeps working when the first is unavailable, unaffordable,
# or simply not something you want to depend on.
PROVIDERS = ("anthropic", "openai", "ollama")

# Where each half of voice runs. "off" is distinct from voice_enabled=False:
# it turns off one direction while leaving the other working.
VOICE_BACKENDS = ("browser", "gemini", "off")


class AISettings(BaseModel):
    """How JARVIS talks to the cloud model."""

    # Which model answers. "anthropic" is the better reasoner; "ollama" is a
    # model running on this machine, which needs no key and sends nothing
    # anywhere. Switching is a dropdown, so the trade is made per-need rather
    # than once at install.
    provider: str = "anthropic"
    model: str = DEFAULT_MODEL
    # Used only when provider is "ollama". Kept separate from `model` so that
    # switching back and forth does not lose whichever name you had set.
    local_model: str = OLLAMA_DEFAULT_MODEL
    local_host: str = OLLAMA_DEFAULT_HOST
    # Used only when provider is "openai". Kept separate from `model` for the
    # same reason as `local_model`: switching should not lose the other name.
    openai_model: str = OPENAI_DEFAULT_MODEL
    max_tokens: int = Field(default=8192, ge=256, le=64_000)
    # A readable summary of the model's reasoning, shown above the answer.
    show_thinking: bool = False
    # Server-side refusal fallbacks: on a policy decline the request is re-run on
    # another model in the same call instead of the turn stopping. Switchable
    # because it is a beta and not every account has it.
    use_refusal_fallback: bool = True
    # Whether the model may call local tools.
    enable_tools: bool = True
    # Write a line to the log for every request, saying how much context went and
    # where it came from. Off by default: on, it puts personal context in a file
    # that people paste into bug reports.
    log_context: bool = False
    # Let the model store a memory it judged worth keeping, without being asked
    # in so many words. Off means memory is only ever written when you ask for
    # it, or by hand on the memory page.
    allow_assistant_memories: bool = True
    # Whether the interface offers a microphone. Off by default: voice is a
    # thing you turn on deliberately, not a thing that appears.
    voice_enabled: bool = False
    # Which backend does the hearing and which does the speaking, chosen
    # separately because they are separate decisions: sending a recording out to
    # be transcribed accurately is a different trade from having an answer read
    # back in a better voice, and someone may want one and not the other.
    # "browser" keeps the audio in the page; "gemini" sends it to Google.
    voice_stt: str = "browser"
    voice_tts: str = "browser"
    # Which of Gemini's prebuilt voices, when Gemini is doing the speaking.
    voice_name: str = "Kore"

    @field_validator("voice_stt", "voice_tts")
    @classmethod
    def _known_backend(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in VOICE_BACKENDS:
            raise ValueError(f"voice backend must be one of {', '.join(VOICE_BACKENDS)}")
        return value

    @field_validator("voice_name")
    @classmethod
    def _known_voice(cls, value: str) -> str:
        from jarvis.voice.gemini import VOICES

        value = value.strip()
        if value not in VOICES:
            raise ValueError(f"voice must be one of {', '.join(VOICES)}")
        return value

    @property
    def active_model(self) -> str:
        """The model name that belongs to the provider in use.

        Kept as one property rather than a branch at each call site, because
        a request built with the cloud model's name and sent to the local one
        fails with a confusing 404 about a model nobody chose.
        """
        if self.provider == "ollama":
            return self.local_model
        if self.provider == "openai":
            return self.openai_model
        return self.model

    @field_validator("provider")
    @classmethod
    def _known_provider(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in PROVIDERS:
            raise ValueError(f"provider must be one of {', '.join(PROVIDERS)}")
        return value

    @field_validator("model")
    @classmethod
    def _model_not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("model must not be empty")
        return value


def get_ai_settings(session: Session) -> AISettings:
    """The stored configuration, or the defaults. A row that has gone bad falls
    back to defaults rather than locking the user out of the settings page."""
    row = session.execute(
        select(AppSetting).where(AppSetting.key == AI_SETTINGS_KEY)
    ).scalar_one_or_none()
    if row is None:
        return AISettings()
    try:
        return AISettings.model_validate(json.loads(row.value))
    except (ValueError, TypeError):
        return AISettings()


def save_ai_settings(session: Session, settings: AISettings) -> AISettings:
    row = session.execute(
        select(AppSetting).where(AppSetting.key == AI_SETTINGS_KEY)
    ).scalar_one_or_none()
    payload = settings.model_dump_json()
    if row is None:
        session.add(AppSetting(key=AI_SETTINGS_KEY, value=payload))
    else:
        row.value = payload
    session.flush()
    return settings
