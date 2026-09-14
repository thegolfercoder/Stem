"""Running the suite.

A case is a question, a fixture of memories to answer it from, and a list of
checks. Running one means: build a throwaway world containing exactly the
fixture, ask the assistant the question under a given prompt version, and grade
what comes back.

Two properties matter and both are deliberate.

The fixture is the whole world. Cases never read the owner's real memories, so
the suite gives the same answer on a fresh install as on a database with four
years of notes in it - and running the suite never sends personal data to the
model.

The prompt version is an argument. That is what makes a comparison meaningful:
the same cases, the same fixtures, the same model, one thing different.
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from jarvis.ai.base import (
    ChatProvider,
    ChatRequest,
    CompletionEvent,
    ErrorEvent,
    ProviderMessage,
    TextEvent,
)
from jarvis.learning import graders
from jarvis.learning.graders import Outcome
from jarvis.models import EvalCase, EvalResult, EvalRun, PromptVersion
from jarvis.retrieval import Candidate, rank

# Cases are small by construction; this stops a malformed fixture becoming a
# large request.
MAX_FIXTURE_ROWS = 40
MAX_CONTEXT_CHARS = 6_000


class EvaluationError(RuntimeError):
    """The suite could not be run."""


@dataclass
class CaseOutcome:
    case: EvalCase
    passed: bool
    outcome: Outcome
    failures: list[graders.Failure]
    latency_ms: int


def _fixture_context(case: EvalCase, question: str) -> tuple[str, bool]:
    """The context block for one case, retrieved from its own fixture.

    Uses the real ranker over the fixture rows, so a case exercises retrieval
    and not only the prompt: if ranking regresses, cases that depend on the
    right memory surfacing start failing, which is the point.
    """
    try:
        rows = json.loads(case.fixture or "[]")
    except json.JSONDecodeError as exc:
        raise EvaluationError(f"case {case.name!r} has an invalid fixture: {exc}") from exc
    if not isinstance(rows, list):
        raise EvaluationError(f"case {case.name!r} fixture must be a list")

    entries = []
    for row in rows[:MAX_FIXTURE_ROWS]:
        if isinstance(row, str):
            entries.append({"category": "important_facts", "content": row})
        elif isinstance(row, dict) and row.get("content"):
            entries.append(
                {
                    "category": str(row.get("category", "important_facts")),
                    "content": str(row["content"]),
                }
            )
    if not entries:
        return "", False

    ranked = rank(
        question,
        [Candidate(key=i, text=e["content"]) for i, e in enumerate(entries)],
        limit=8,
    )
    kept = [entries[int(str(item.key))] for item in ranked]
    if not kept:
        return "", False

    body = "\n".join(f"[{e['category']}] {e['content']}" for e in kept)[:MAX_CONTEXT_CHARS]
    block = (
        "\n\n<context>\nLocal records retrieved for this message. They are the only part "
        "of the user's data you have been given.\n\n" + body + "\n</context>"
    )
    return block, True


EVAL_USER = "the owner"
EVAL_NOW = "a fixed evaluation time"


def run_case(
    case: EvalCase, *, provider: ChatProvider, version: PromptVersion, model: str
) -> CaseOutcome:
    """One case, one prompt version, one call."""
    checks = graders.parse_checks(case.checks)
    context_block, used_context = _fixture_context(case, case.prompt)

    # Fixed substitutions, not the owner's real name and not the real clock.
    # Evaluation has to be deterministic - a case whose expected answer moves
    # when the date changes, or when the account is renamed, is a case that
    # fails for reasons that have nothing to do with the prompt being judged.
    # It also keeps a person's name out of the source, which is the rule
    # everywhere else in this project.
    system = version.body.replace("{user}", EVAL_USER).replace("{now}", EVAL_NOW)
    request = ChatRequest(
        system=system + context_block,
        messages=[ProviderMessage.text("user", case.prompt)],
        model=model,
        max_tokens=1024,
    )

    started = time.monotonic()
    text: list[str] = []
    tools: list[str] = []
    error: str | None = None

    for event in provider.stream(request):
        if isinstance(event, TextEvent):
            text.append(event.text)
        elif isinstance(event, ErrorEvent):
            error = event.message
            break
        elif isinstance(event, CompletionEvent):
            tools.extend(call.name for call in event.tool_calls)
            if not text and event.text:
                text.append(event.text)
            break

    outcome = Outcome(
        text="".join(text).strip(),
        tools=tuple(tools),
        used_context=used_context,
        error=error,
    )
    failures = graders.grade(outcome, checks)
    return CaseOutcome(
        case=case,
        passed=not failures,
        outcome=outcome,
        failures=failures,
        latency_ms=int((time.monotonic() - started) * 1000),
    )


def list_cases(session: Session, *, enabled_only: bool = True) -> list[EvalCase]:
    statement = select(EvalCase).order_by(EvalCase.id)
    if enabled_only:
        statement = statement.where(EvalCase.enabled == 1)
    return list(session.execute(statement).scalars())


def run_suite(
    session: Session,
    *,
    provider: ChatProvider,
    version: PromptVersion,
    model: str,
    cases: Sequence[EvalCase] | None = None,
    baseline_run_id: int | None = None,
    notes: str = "",
) -> EvalRun:
    """Run every enabled case against one version and store the result."""
    selected = list(cases) if cases is not None else list_cases(session)
    if not selected:
        raise EvaluationError(
            "There are no eval cases yet. Add one, or promote a good answer from the activity log."
        )

    run = EvalRun(prompt_version_id=version.id, baseline_run_id=baseline_run_id, notes=notes)
    session.add(run)
    session.flush()

    baseline_passes = _passing_case_ids(session, baseline_run_id)
    regressions = 0

    for case in selected:
        result = run_case(case, provider=provider, version=version, model=model)
        session.add(
            EvalResult(
                run_id=run.id,
                case_id=case.id,
                passed=1 if result.passed else 0,
                output=result.outcome.text[:4000],
                failures=json.dumps([f.as_dict() for f in result.failures]),
                latency_ms=result.latency_ms,
            )
        )
        if result.passed:
            run.passed += 1
        else:
            run.failed += 1
            if case.id in baseline_passes:
                regressions += 1

    run.regressions = regressions
    session.flush()
    return run


def _passing_case_ids(session: Session, run_id: int | None) -> set[int]:
    if run_id is None:
        return set()
    return set(
        session.execute(
            select(EvalResult.case_id).where(EvalResult.run_id == run_id, EvalResult.passed == 1)
        ).scalars()
    )


def latest_run_for(session: Session, version_id: int) -> EvalRun | None:
    return session.execute(
        select(EvalRun)
        .where(EvalRun.prompt_version_id == version_id)
        .order_by(EvalRun.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def run_results(session: Session, run_id: int) -> list[tuple[EvalResult, EvalCase]]:
    rows = session.execute(
        select(EvalResult, EvalCase)
        .join(EvalCase, EvalResult.case_id == EvalCase.id)
        .where(EvalResult.run_id == run_id)
        .order_by(EvalResult.id)
    ).all()
    return [(result, case) for result, case in rows]
