"""Where analysed swings live between runs.

A swing analyser that forgets everything when it exits is a demo. The things a
golfer actually wants - is my tempo more consistent than last week, is my head
moving more when I am tired, does the driver sit differently from the seven iron
- are all comparisons across time, and none of them can be answered by a tool
that only ever sees one clip.

SQLite because it is a single file with no server, it ships with Python, and a
user can copy it, back it up, or delete it without ceremony. The schema is
deliberately shallow: a row per swing, the full analysis kept as JSON alongside
the handful of columns worth querying on. Metrics change shape as the analyser
improves, and a schema that has to migrate every time one is added would make
improving it expensive.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict

from swingml.analysis import SwingAnalysis
from swingml.assets import home
from swingml.quantity import NoReading

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS swings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at        TEXT    NOT NULL,
    label             TEXT,
    club              TEXT,
    source_name       TEXT    NOT NULL,
    video_path        TEXT,
    handedness        TEXT    NOT NULL,
    ok                INTEGER NOT NULL,
    refusal           TEXT,
    detection_rate    REAL,
    mean_confidence   REAL,
    tempo_ratio       REAL,
    backswing_ms      REAL,
    downswing_ms      REAL,
    head_movement     REAL,
    pelvis_sway       REAL,
    analysis_json     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS swings_created_at ON swings (created_at);
CREATE INDEX IF NOT EXISTS swings_club ON swings (club);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class StoredSwing(BaseModel):
    """One row, with the analysis rehydrated."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: int
    created_at: datetime
    label: str | None
    club: str | None
    source_name: str
    video_path: str | None
    ok: bool
    refusal: str | None
    detection_rate: float | None
    mean_confidence: float | None
    tempo_ratio: float | None
    backswing_ms: float | None
    downswing_ms: float | None
    analysis: dict[str, Any]


def default_database() -> Path:
    return home() / "swings.db"


def _value(metrics: object, name: str) -> float | None:
    """A metric's number, or None if it was refused or is absent."""
    if metrics is None or isinstance(metrics, NoReading):
        return None
    reading = getattr(metrics, name, None)
    if reading is None or isinstance(reading, NoReading):
        return None
    return float(reading.value)


class SwingStore:
    """A file of swings. Safe to open from more than one place at once."""

    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path is not None else default_database()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(SCHEMA)
            connection.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10.0)
        connection.row_factory = sqlite3.Row
        try:
            # Write-ahead logging so a long analysis writing a row cannot block a
            # browser tab reading the list.
            connection.execute("PRAGMA journal_mode=WAL")
            yield connection
            connection.commit()
        finally:
            connection.close()

    def add(
        self,
        analysis: SwingAnalysis,
        source_name: str,
        video_path: Path | str | None = None,
        label: str | None = None,
        club: str | None = None,
    ) -> int:
        """Record one analysis, successful or refused, and return its id.

        Refusals are stored too. The share of clips that produced no reading is
        one of the few honest measures of how well this works in the field, and
        it cannot be computed from a table that only contains the successes.
        """
        metrics = None if isinstance(analysis.metrics, NoReading) else analysis.metrics
        ok = not isinstance(analysis.events, NoReading)
        refusal = analysis.events.reason if isinstance(analysis.events, NoReading) else None
        confidence = (
            None
            if isinstance(analysis.events, NoReading)
            else float(sum(analysis.events.confidence) / len(analysis.events.confidence))
        )

        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO swings (
                    created_at, label, club, source_name, video_path, handedness,
                    ok, refusal, detection_rate, mean_confidence, tempo_ratio,
                    backswing_ms, downswing_ms, head_movement, pelvis_sway, analysis_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    label,
                    club,
                    source_name,
                    str(video_path) if video_path is not None else None,
                    analysis.handedness.value,
                    int(ok),
                    refusal,
                    analysis.detection_rate,
                    confidence,
                    _value(metrics, "tempo_ratio"),
                    _value(metrics, "backswing_duration"),
                    _value(metrics, "downswing_duration"),
                    _value(metrics, "head_movement"),
                    _value(metrics, "pelvis_sway"),
                    json.dumps(analysis.model_dump(mode="json")),
                ),
            )
        return int(cursor.lastrowid or 0)

    def get(self, swing_id: int) -> StoredSwing | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM swings WHERE id = ?", (swing_id,)).fetchone()
        return _row_to_swing(row) if row is not None else None

    def recent(self, limit: int = 50, club: str | None = None) -> list[StoredSwing]:
        query = "SELECT * FROM swings"
        params: list[object] = []
        if club:
            query += " WHERE club = ?"
            params.append(club)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [_row_to_swing(row) for row in rows]

    def clubs(self) -> list[str]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT DISTINCT club FROM swings WHERE club IS NOT NULL AND club != '' "
                "ORDER BY club"
            ).fetchall()
        return [row["club"] for row in rows]

    def delete(self, swing_id: int) -> bool:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM swings WHERE id = ?", (swing_id,))
        return cursor.rowcount > 0

    def update(self, swing_id: int, label: str | None = None, club: str | None = None) -> bool:
        sets: list[str] = []
        params: list[object] = []
        if label is not None:
            sets.append("label = ?")
            params.append(label)
        if club is not None:
            sets.append("club = ?")
            params.append(club)
        if not sets:
            return False
        params.append(swing_id)
        with self._connect() as connection:
            cursor = connection.execute(f"UPDATE swings SET {', '.join(sets)} WHERE id = ?", params)
        return cursor.rowcount > 0

    def replace_analysis(self, swing_id: int, analysis: SwingAnalysis) -> bool:
        """Swap in a re-measured analysis, such as one from the golfer's positions.

        The queryable columns move with it, so trends and the session summary
        read the swing as it now stands. Confidence is the model's, so it is
        cleared when the golfer placed the positions rather than set to a figure
        nobody measured.
        """
        metrics = None if isinstance(analysis.metrics, NoReading) else analysis.metrics
        ok = not isinstance(analysis.events, NoReading)
        confidence = (
            None
            if isinstance(analysis.events, NoReading) or analysis.positions_set_by != "model"
            else float(sum(analysis.events.confidence) / len(analysis.events.confidence))
        )
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE swings SET
                    ok = ?, refusal = ?, mean_confidence = ?, tempo_ratio = ?,
                    backswing_ms = ?, downswing_ms = ?, head_movement = ?, pelvis_sway = ?,
                    analysis_json = ?
                WHERE id = ?
                """,
                (
                    int(ok),
                    analysis.events.reason if isinstance(analysis.events, NoReading) else None,
                    confidence,
                    _value(metrics, "tempo_ratio"),
                    _value(metrics, "backswing_duration"),
                    _value(metrics, "downswing_duration"),
                    _value(metrics, "head_movement"),
                    _value(metrics, "pelvis_sway"),
                    json.dumps(analysis.model_dump(mode="json")),
                    swing_id,
                ),
            )
        return cursor.rowcount > 0

    def counts(self) -> tuple[int, int]:
        """How many swings are stored, and how many of those produced a reading."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS total, COALESCE(SUM(ok), 0) AS ok FROM swings"
            ).fetchone()
        return int(row["total"]), int(row["ok"])


def _row_to_swing(row: sqlite3.Row) -> StoredSwing:
    return StoredSwing(
        id=row["id"],
        created_at=datetime.fromisoformat(row["created_at"]),
        label=row["label"],
        club=row["club"],
        source_name=row["source_name"],
        video_path=row["video_path"],
        ok=bool(row["ok"]),
        refusal=row["refusal"],
        detection_rate=row["detection_rate"],
        mean_confidence=row["mean_confidence"],
        tempo_ratio=row["tempo_ratio"],
        backswing_ms=row["backswing_ms"],
        downswing_ms=row["downswing_ms"],
        analysis=json.loads(row["analysis_json"]),
    )
