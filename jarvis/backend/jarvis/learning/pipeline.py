"""The improvement loop, and the gate across the end of it.

    turns are recorded -> the owner rates some -> the bad ones are read
                       -> a change is proposed -> the suite runs on it
                       -> it is compared against what is live
                       -> a person activates it, or does not

Three rules hold this together, and they are the difference between a system
that improves and a system that drifts:

**Proposals are data.** A candidate prompt is a row. Nothing executes it until
someone activates it. The assistant cannot edit the program it is running -
there is no code path from a model's output to a file on disk.

**Evidence before activation.** A candidate is compared to the version in
production on identical cases. If a case that passes today fails on the
candidate, activation is refused unless a human explicitly overrides, and the
override is written into the row.

**Rollback is always available.** Old versions are retired, never deleted, and
activating one is a single call.

`promote_interaction` is the other half: the suite only means something if it
grows from real use, so an answer the owner approved can become a permanent
case with its context frozen into a fixture.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy.orm import Session

from jarvis.ai.base import ChatProvider
from jarvis.learning import evaluation, metrics, versions
from jarvis.learning.versions import Comparison
from jarvis.models import EvalCase, EvalRun, Interaction, PromptVersion


class PipelineError(RuntimeError):
    """A step of the loop could not be completed, with a reason."""


@dataclass
class Assessment:
    """Everything a person needs to decide whether to ship a candidate."""

    candidate: PromptVersion
    candidate_run: EvalRun
    baseline: PromptVersion | None
    baseline_run: EvalRun | None
    comparison: Comparison

    def as_dict(self) -> dict[str, object]:
        return {
            "candidate": {
                "id": self.candidate.id,
                "number": self.candidate.number,
                "name": self.candidate.name,
                "status": self.candidate.status,
            },
            "baseline": (
                {"id": self.baseline.id, "number": self.baseline.number, "name": self.baseline.name}
                if self.baseline
                else None
            ),
            "candidate_run": _run_dict(self.candidate_run),
            "baseline_run": _run_dict(self.baseline_run) if self.baseline_run else None,
            "pass_rate": round(self.comparison.candidate_pass_rate, 4),
            "baseline_pass_rate": round(self.comparison.baseline_pass_rate, 4),
            "regressions": self.comparison.regressions,
            "safe_to_activate": self.comparison.safe,
            "improved": self.comparison.improved,
        }


def _run_dict(run: EvalRun | None) -> dict[str, object] | None:
    if run is None:
        return None
    total = run.passed + run.failed
    return {
        "id": run.id,
        "passed": run.passed,
        "failed": run.failed,
        "total": total,
        "pass_rate": round(run.passed / total, 4) if total else 0.0,
        "regressions": run.regressions,
        "created_at": run.created_at.isoformat(),
    }


def _rate(run: EvalRun | None) -> float:
    if run is None:
        return 0.0
    total = run.passed + run.failed
    return run.passed / total if total else 0.0


def assess(
    session: Session,
    *,
    candidate: PromptVersion,
    provider: ChatProvider,
    model: str,
) -> Assessment:
    """Run the suite on a candidate and on whatever is live, then compare.

    The baseline is re-run rather than read from history on purpose: a stored
    result from three weeks ago was produced against a different model version
    and possibly a different case list, and comparing against it would quietly
    credit or blame the candidate for someone else's change.
    """
    if candidate.status == "active":
        raise PipelineError("That version is already live; there is nothing to compare it to.")

    cases = evaluation.list_cases(session)
    if not cases:
        raise PipelineError(
            "No eval cases exist, so there is nothing to judge a change by. Add cases "
            "first - promoting a few answers you approved of is the quickest way."
        )

    baseline = versions.get_active(session)
    baseline_run = None
    if baseline is not None:
        baseline_run = evaluation.run_suite(
            session,
            provider=provider,
            version=baseline,
            model=model,
            cases=cases,
            notes=f"baseline for candidate v{candidate.number}",
        )

    candidate_run = evaluation.run_suite(
        session,
        provider=provider,
        version=candidate,
        model=model,
        cases=cases,
        baseline_run_id=baseline_run.id if baseline_run else None,
        notes=f"candidate v{candidate.number}",
    )

    regressions = _regressed_case_names(session, candidate_run, baseline_run)
    comparison = Comparison(
        candidate_pass_rate=_rate(candidate_run),
        baseline_pass_rate=_rate(baseline_run),
        regressions=regressions,
    )

    versions.mark_candidate(session, candidate)
    session.flush()
    return Assessment(
        candidate=candidate,
        candidate_run=candidate_run,
        baseline=baseline,
        baseline_run=baseline_run,
        comparison=comparison,
    )


def _regressed_case_names(
    session: Session, candidate_run: EvalRun, baseline_run: EvalRun | None
) -> list[str]:
    """Cases that pass on what is live and fail on the candidate."""
    if baseline_run is None:
        return []
    baseline = {
        case.id: result.passed for result, case in evaluation.run_results(session, baseline_run.id)
    }
    out = []
    for result, case in evaluation.run_results(session, candidate_run.id):
        if baseline.get(case.id) and not result.passed:
            out.append(case.name)
    return out


def activate(
    session: Session,
    *,
    candidate: PromptVersion,
    assessment: Assessment | None = None,
    force: bool = False,
) -> PromptVersion:
    """Ship a candidate. A person calls this; nothing else does."""
    comparison = assessment.comparison if assessment else None
    if assessment is None and not force:
        raise PipelineError(
            "That version has not been evaluated. Run the suite on it first, or "
            "activate with force if you know what you are doing."
        )
    return versions.activate(session, candidate, comparison=comparison, force=force)


def promote_interaction(
    session: Session,
    *,
    interaction: Interaction,
    name: str = "",
    checks: list[dict[str, object]] | None = None,
    fixture: list[dict[str, str]] | None = None,
) -> EvalCase:
    """Turn a real exchange into a permanent case.

    The context is frozen into the case as a fixture, so the case keeps testing
    the same thing after the underlying memory is edited or deleted. Without
    that, the suite would quietly change meaning every time the owner tidied up.
    """
    if not interaction.query.strip():
        raise PipelineError("That interaction has no question to test with.")

    proposed = checks if checks is not None else _default_checks(interaction)
    if not proposed:
        raise PipelineError(
            "A case needs at least one check, or it asserts nothing. Add what the "
            "answer must contain."
        )

    case = EvalCase(
        name=(name.strip() or interaction.query.strip())[:160],
        prompt=interaction.query,
        fixture=json.dumps(fixture or []),
        checks=json.dumps(proposed),
        source="promoted",
        interaction_id=interaction.id,
        enabled=1,
    )
    session.add(case)
    session.flush()
    return case


def _default_checks(interaction: Interaction) -> list[dict[str, object]]:
    """A starting point a person can edit, not a guess dressed up as a test.

    Only two things can be asserted honestly without a human reading the answer:
    it must not error, and whatever tools ran before should run again.
    """
    checks: list[dict[str, object]] = [{"kind": "no_error", "value": ""}]
    for tool in dict.fromkeys(filter(None, interaction.tools_used.split(","))):
        checks.append({"kind": "uses_tool", "value": tool})
    return checks


def suggest_focus(session: Session, *, user_id: int) -> list[str]:
    """What the evidence says to look at next.

    Reads the numbers and says the plain thing about them. This is the part of
    "self-improving" that is honest: the system can tell you where it is weak;
    deciding what to do about it is yours.
    """
    summary = metrics.summarise(session, user_id=user_id, window_days=30)
    notes: list[str] = []

    def turns(count: int) -> str:
        return f"{count} turn" if count == 1 else f"{count} turns"

    if summary.turns == 0:
        return ["No turns recorded yet - use it for a while and the numbers will mean something."]

    if summary.rated_share < 0.1:
        notes.append(
            f"Only {summary.rated_share:.0%} of turns are rated. Feedback is the one signal "
            "here that is not inferred; a few ratings a day make everything below trustworthy."
        )
    if summary.error_rate > 0.05:
        notes.append(
            f"{summary.error_rate:.0%} of turns errored. Check the failures before tuning "
            "anything else - a prompt change cannot fix a broken request."
        )
    if summary.rated >= 5 and summary.approval_rate < 0.7:
        notes.append(
            f"Approval is {summary.approval_rate:.0%} across {turns(summary.rated)} rated. "
            "Read the rejected ones; they usually share a shape worth writing into the prompt."
        )
    if summary.tool_errors > max(3, summary.turns * 0.05):
        notes.append(
            f"{summary.tool_errors} tool calls failed. That is usually a tool description "
            "problem rather than a model problem."
        )
    if summary.latency_p95_ms > 15_000:
        notes.append(
            f"Slowest answers are taking {summary.latency_p95_ms / 1000:.0f}s. Consider a "
            "smaller model for short questions, or a lower token ceiling."
        )
    if not notes:
        notes.append(
            f"Nothing is obviously wrong: {turns(summary.turns)}, {summary.error_rate:.0%} errors, "
            f"{summary.approval_rate:.0%} approval. Add eval cases while it is healthy - they are "
            "what makes the next change safe."
        )
    return notes
