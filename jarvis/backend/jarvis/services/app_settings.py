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
from jarvis.models import AppSetting

AI_SETTINGS_KEY = "ai"


class AISettings(BaseModel):
    """How JARVIS talks to the cloud model."""

    provider: str = "anthropic"
    model: str = DEFAULT_MODEL
    max_tokens: int = Field(default=8192, ge=256, le=64_000)
    # A readable summary of the model's reasoning, shown above the answer.
    show_thinking: bool = False
    # Server-side refusal fallbacks: on a policy decline the request is re-run on
    # another model in the same call instead of the turn stopping. Switchable
    # because it is a beta and not every account has it.
    use_refusal_fallback: bool = True
    # Whether the model may call local tools.
    enable_tools: bool = True

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
