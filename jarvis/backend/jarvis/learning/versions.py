"""Versions of the assistant's instructions, and the rules for changing them.

The persona is not a file the program reads at runtime any more - it is a row,
with a number, a status and a parent. That single change is what makes the rest
of the improvement loop possible and safe:

- A proposal is a `draft` row. Nothing reads it.
- Evaluating it promotes it to `candidate`. Still nothing reads it.
- Exactly one row is `active`, and that is the only one the assistant runs on.
- Activating is a deliberate call, made by a person, and it is refused when the
  evidence says the candidate is worse.
- Rolling back is activating an older row, which never stopped existing.

The seed comes from `config/system_prompt.md` on first run, so the file is still
where you edit the persona by hand - it is the starting point rather than the
live value.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from jarvis.models import PromptVersion, utcnow

SEED_NAME = "JARVIS, seed persona"


class VersionError(ValueError):
    """A version could not be created or activated, with a reason."""


@dataclass(frozen=True)
class Comparison:
    """Candidate against the version currently in production."""

    candidate_pass_rate: float
    baseline_pass_rate: float
    regressions: list[str]

    @property
    def improved(self) -> bool:
        return self.candidate_pass_rate > self.baseline_pass_rate

    @property
    def safe(self) -> bool:
        """No case that used to pass now fails. The bar for activation."""
        return not self.regressions


def seed_if_empty(session: Session, *, prompt_path: Path | None) -> PromptVersion:
    """Make sure something is active. Called at startup.

    Reads the persona file the first time and never again: after that the
    database is the source of truth, because otherwise editing the file would
    silently bypass every check in this module.
    """
    active = get_active(session)
    if active is not None:
        return active

    body = ""
    if prompt_path is not None and prompt_path.is_file():
        body = prompt_path.read_text(encoding="utf-8")
    if not body.strip():
        body = "You are JARVIS, {user}'s personal assistant. Be direct and accurate."

    version = PromptVersion(
        number=_next_number(session),
        name=SEED_NAME,
        body=body,
        status="active",
        author="seed",
        notes="Seeded from config/system_prompt.md on first run.",
        activated_at=utcnow().replace(tzinfo=None),
    )
    session.add(version)
    session.flush()
    return version


def _next_number(session: Session) -> int:
    highest = session.execute(
        select(PromptVersion.number).order_by(PromptVersion.number.desc()).limit(1)
    ).scalar_one_or_none()
    return (highest or 0) + 1


def get_active(session: Session) -> PromptVersion | None:
    return session.execute(
        select(PromptVersion).where(PromptVersion.status == "active")
    ).scalar_one_or_none()


def get(session: Session, version_id: int) -> PromptVersion | None:
    return session.get(PromptVersion, version_id)


def list_all(session: Session, *, limit: int = 50) -> list[PromptVersion]:
    return list(
        session.execute(
            select(PromptVersion).order_by(PromptVersion.number.desc()).limit(limit)
        ).scalars()
    )


def propose(
    session: Session,
    *,
    body: str,
    name: str = "",
    notes: str = "",
    author: str = "human",
    parent_id: int | None = None,
) -> PromptVersion:
    """Record a proposed change. Nothing runs on it until it is activated.

    Deliberately cheap and deliberately inert: proposing costs nothing and
    changes nothing, which is what lets the pipeline propose freely.
    """
    body = body.strip()
    if len(body) < 40:
        raise VersionError("A prompt version needs a real body; that one is too short.")
    if "{user}" not in body:
        raise VersionError(
            "The prompt must contain {user} - it is how the assistant learns whose "
            "machine it is on."
        )

    if parent_id is None:
        active = get_active(session)
        parent_id = active.id if active else None

    version = PromptVersion(
        number=_next_number(session),
        name=name.strip()[:120] or f"proposal {utcnow():%Y-%m-%d}",
        body=body,
        status="draft",
        author=author if author in ("human", "pipeline", "seed") else "human",
        notes=notes.strip(),
        parent_id=parent_id,
    )
    session.add(version)
    session.flush()
    return version


def mark_candidate(session: Session, version: PromptVersion) -> PromptVersion:
    """A draft that has been through the suite becomes a candidate."""
    if version.status in ("active", "retired"):
        raise VersionError(f"Version {version.number} is {version.status}, not a draft.")
    version.status = "candidate"
    session.flush()
    return version


def activate(
    session: Session,
    version: PromptVersion,
    *,
    comparison: Comparison | None = None,
    force: bool = False,
) -> PromptVersion:
    """Put a version into production.

    Refused when a comparison shows regressions, unless the caller explicitly
    overrides - and the override is recorded on the row, because "we shipped it
    anyway" is exactly the thing you want written down three months later.
    """
    if version.status == "active":
        return version

    if comparison is not None and not comparison.safe and not force:
        raise VersionError(
            f"Version {version.number} breaks {len(comparison.regressions)} case(s) that "
            f"currently pass: {', '.join(comparison.regressions[:3])}. "
            "Fix it, or activate with force if you accept the regression."
        )

    now = utcnow().replace(tzinfo=None)
    current = get_active(session)
    if current is not None and current.id != version.id:
        current.status = "retired"
        current.retired_at = now

    version.status = "active"
    version.activated_at = now
    if comparison is not None:
        summary = (
            f"Activated at {comparison.candidate_pass_rate:.0%} pass rate "
            f"(previous {comparison.baseline_pass_rate:.0%})."
        )
        if not comparison.safe:
            summary += f" Forced past {len(comparison.regressions)} regression(s)."
        version.notes = (version.notes + "\n" + summary).strip()
    session.flush()
    return version


def rollback(session: Session, session_target: PromptVersion | None = None) -> PromptVersion:
    """Go back to the version that was active before this one.

    Rollback is activation of something that already proved itself, so it skips
    the comparison gate: the point of a rollback is that it is available when
    everything else has gone wrong.
    """
    current = get_active(session)
    target = session_target
    if target is None:
        if current is None or current.parent_id is None:
            raise VersionError("There is no earlier version to roll back to.")
        target = get(session, current.parent_id)
    if target is None:
        raise VersionError("That version no longer exists.")
    if current is not None and target.id == current.id:
        raise VersionError("That version is already active.")

    now = utcnow().replace(tzinfo=None)
    if current is not None:
        current.status = "retired"
        current.retired_at = now
        current.notes = (current.notes + f"\nRolled back to v{target.number}.").strip()
    target.status = "active"
    target.activated_at = now
    session.flush()
    return target
