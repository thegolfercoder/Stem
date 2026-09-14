"""Logging to `logs/jarvis.log` and the console.

Deliberately quiet about content: the log records that a request happened, how
long it took and what it cost, never what was in it. A log file is the easiest
place for personal data to escape a machine, because it is the file people paste
into bug reports.
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

_CONFIGURED = False


def configure_logging(log_dir: Path, level: int = logging.INFO) -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return
    log_dir.mkdir(parents=True, exist_ok=True)

    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")

    file_handler = RotatingFileHandler(
        log_dir / "jarvis.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)

    console = logging.StreamHandler()
    console.setFormatter(fmt)

    root = logging.getLogger("jarvis")
    root.setLevel(level)
    root.addHandler(file_handler)
    root.addHandler(console)
    root.propagate = False
    _CONFIGURED = True
