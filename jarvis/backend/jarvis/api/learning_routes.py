"""The improvement loop, over HTTP.

Two things about the shape of this router are deliberate.

Activation is its own endpoint, separate from evaluation, and it takes an
explicit `force` when the evidence is against it. There is no call here that
evaluates and ships in one step, because that is exactly the call something
automated would make at three in the morning.

And nothing in here is reachable by the model. These are owner endpoints behind
the session cookie; the assistant's tools do not include them. It can be told
its answer was bad - it cannot decide to change itself.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from jarvis.ai.base import ChatProvider
from jarvis.api.deps import chat_provider, current_user, db_session
from jarvis.api.schemas import (
    ActivateRequest,
    EvalCaseIn,
    EvalCaseOut,
    FeedbackIn,
    InteractionOut,
    PromoteRequest,
    PromptVersionIn,
    PromptVersionOut,
)
from jarvis.learning import evaluation, graders, metrics, pipeline, telemetry, versions
from jarvis.models import EvalCase, User
from jarvis.services.app_settings import get_ai_settings

router = APIRouter(prefix="/api/learning", tags=["learning"])


# --- what happened ----------------------------------------------------------


@router.get("/interactions", response_model=list[InteractionOut])
def interactions(
    limit: int = Query(default=50, ge=1, le=500),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[InteractionOut]:
    rows = telemetry.recent(session, user_id=user.id, limit=limit)
    ratings = telemetry.feedback_for(session, [row.id for row in rows])
    return [InteractionOut.of(row, ratings.get(row.id)) for row in rows]


@router.get("/problems", response_model=list[InteractionOut])
def problems(
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[InteractionOut]:
    """Turns that errored, failed a tool, or were rated down."""
    rows = metrics.problem_turns(session, user_id=user.id)
    ratings = telemetry.feedback_for(session, [row.id for row in rows])
    return [InteractionOut.of(row, ratings.get(row.id)) for row in rows]


@router.post("/feedback", status_code=status.HTTP_204_NO_CONTENT)
def leave_feedback(
    body: FeedbackIn,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> None:
    if telemetry.get(session, user_id=user.id, interaction_id=body.interaction_id) is None:
        raise HTTPException(status_code=404, detail="No such interaction.")
    try:
        telemetry.record_feedback(
            session,
            user_id=user.id,
            interaction_id=body.interaction_id,
            rating=body.rating,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/metrics")
def read_metrics(
    days: int = Query(default=30, ge=1, le=365),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> dict[str, object]:
    summary = metrics.summarise(session, user_id=user.id, window_days=days).as_dict()
    summary["focus"] = pipeline.suggest_focus(session, user_id=user.id)
    return summary


# --- the persona, versioned -------------------------------------------------


@router.get("/versions", response_model=list[PromptVersionOut])
def list_versions(
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> list[PromptVersionOut]:
    return [PromptVersionOut.of(v) for v in versions.list_all(session)]


@router.post("/versions", response_model=PromptVersionOut, status_code=status.HTTP_201_CREATED)
def propose_version(
    body: PromptVersionIn,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> PromptVersionOut:
    """Record a proposed prompt. Inert until evaluated and activated."""
    try:
        version = versions.propose(
            session, body=body.body, name=body.name, notes=body.notes, author="human"
        )
    except versions.VersionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PromptVersionOut.of(version)


@router.post("/versions/{version_id}/evaluate")
def evaluate_version(
    version_id: int,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
    provider: ChatProvider = Depends(chat_provider),
) -> dict[str, object]:
    """Run the suite on a candidate and on what is live, and compare.

    Costs one model call per case per version, which is why it is explicit
    rather than automatic.
    """
    version = versions.get(session, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="No such version.")
    ai = get_ai_settings(session)
    try:
        assessment = pipeline.assess(
            session, candidate=version, provider=provider, model=ai.active_model
        )
    except (pipeline.PipelineError, evaluation.EvaluationError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return assessment.as_dict()


@router.post("/versions/{version_id}/activate", response_model=PromptVersionOut)
def activate_version(
    version_id: int,
    body: ActivateRequest,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> PromptVersionOut:
    """Put a version into production. A person's decision, always."""
    version = versions.get(session, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail="No such version.")

    latest = evaluation.latest_run_for(session, version_id)
    if latest is None and not body.force:
        raise HTTPException(
            status_code=400,
            detail="That version has not been evaluated. Run the suite on it first.",
        )
    if latest is not None and latest.regressions and not body.force:
        raise HTTPException(
            status_code=400,
            detail=(
                f"That version breaks {latest.regressions} case(s) that currently pass. "
                "Fix it, or activate with force if you accept the regression."
            ),
        )
    try:
        activated = versions.activate(session, version, force=True)
    except versions.VersionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return PromptVersionOut.of(activated)


@router.post("/versions/rollback", response_model=PromptVersionOut)
def rollback_version(
    to: int | None = None,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> PromptVersionOut:
    """Go back. Available even when everything else has gone wrong."""
    target = versions.get(session, to) if to else None
    if to and target is None:
        raise HTTPException(status_code=404, detail="No such version.")
    try:
        restored = versions.rollback(session, target)
    except versions.VersionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return PromptVersionOut.of(restored)


# --- the suite --------------------------------------------------------------


@router.get("/cases", response_model=list[EvalCaseOut])
def list_eval_cases(
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> list[EvalCaseOut]:
    return [EvalCaseOut.of(c) for c in evaluation.list_cases(session, enabled_only=False)]


@router.post("/cases", response_model=EvalCaseOut, status_code=status.HTTP_201_CREATED)
def create_eval_case(
    body: EvalCaseIn,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> EvalCaseOut:
    import json

    try:
        checks = graders.parse_checks([c.model_dump() for c in body.checks])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not checks:
        raise HTTPException(status_code=400, detail="A case with no checks asserts nothing.")

    case = EvalCase(
        name=body.name.strip()[:160] or body.prompt[:160],
        prompt=body.prompt,
        fixture=json.dumps([f.model_dump() for f in body.fixture]),
        checks=json.dumps(checks),
        source="manual",
        enabled=1,
    )
    session.add(case)
    session.commit()
    return EvalCaseOut.of(case)


@router.delete("/cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_eval_case(
    case_id: int,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> None:
    case = session.get(EvalCase, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="No such case.")
    session.delete(case)
    session.commit()


@router.post("/cases/promote", response_model=EvalCaseOut, status_code=status.HTTP_201_CREATED)
def promote(
    body: PromoteRequest,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> EvalCaseOut:
    """Turn an answer you approved of into a permanent test."""
    interaction = telemetry.get(session, user_id=user.id, interaction_id=body.interaction_id)
    if interaction is None:
        raise HTTPException(status_code=404, detail="No such interaction.")
    try:
        case = pipeline.promote_interaction(
            session,
            interaction=interaction,
            name=body.name,
            checks=[c.model_dump() for c in body.checks] if body.checks else None,
            fixture=[f.model_dump() for f in body.fixture] if body.fixture else None,
        )
    except pipeline.PipelineError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session.commit()
    return EvalCaseOut.of(case)


@router.get("/runs/{run_id}")
def run_detail(
    run_id: int,
    session: Session = Depends(db_session),
    _: User = Depends(current_user),
) -> dict[str, object]:
    import json

    rows = evaluation.run_results(session, run_id)
    if not rows:
        raise HTTPException(status_code=404, detail="No such run.")
    return {
        "run_id": run_id,
        "results": [
            {
                "case": case.name,
                "passed": bool(result.passed),
                "failures": json.loads(result.failures or "[]"),
                "output": result.output,
                "latency_ms": result.latency_ms,
            }
            for result, case in rows
        ],
    }
