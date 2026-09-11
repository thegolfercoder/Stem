"""Settings, read from the environment.

Two rules are enforced here rather than left to habit. The API key is read from
the environment and is never written back to disk by the application, so no
export of `data/` can carry it. And the data directory is resolved once, at
import, so every module that stores something agrees on where "local" is.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# `.../jarvis/backend/jarvis/config.py` -> `.../jarvis`.
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Configuration for one JARVIS installation."""

    model_config = SettingsConfigDict(
        env_prefix="JARVIS_",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Loopback by default. JARVIS holds everything personal you give it, and
    # binding anywhere else publishes that to the network.
    host: str = "127.0.0.1"
    port: int = 8765

    data_dir: Path = PROJECT_ROOT / "data"
    log_dir: Path = PROJECT_ROOT / "logs"
    config_dir: Path = PROJECT_ROOT / "config"
    frontend_dir: Path = PROJECT_ROOT / "frontend"

    session_ttl_hours: int = 72

    # Accepts the JARVIS-prefixed name and the SDK's own, so a machine that
    # already exports ANTHROPIC_API_KEY needs no second copy of the secret.
    anthropic_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("JARVIS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jarvis.db"

    @property
    def memory_dir(self) -> Path:
        """Extracted memory and, from phase 2, the vector index."""
        return self.data_dir / "memory"

    @property
    def documents_dir(self) -> Path:
        """Documents JARVIS is allowed to read and index."""
        return self.data_dir / "documents"

    @property
    def uploads_dir(self) -> Path:
        """Raw files as they arrived, before any processing."""
        return self.data_dir / "uploads"

    def ensure_directories(self) -> None:
        """Create the local tree. Called on startup; safe to call repeatedly."""
        for directory in (
            self.data_dir,
            self.memory_dir,
            self.documents_dir,
            self.uploads_dir,
            self.log_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The settings for this process. Cached: reading them is not free, and a
    process that disagreed with itself about the data directory would be worse."""
    return Settings()
