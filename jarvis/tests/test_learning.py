"""The improvement loop, and the rules that keep it safe.

Most of these are about what the system refuses to do. A loop that can change
the assistant is only worth having if it cannot change it *quietly*, so the
tests that matter are the ones asserting a proposal does nothing, a regression
blocks a release, and a rollback always works.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from jarvis.db import session_scope
from jarvis.learning import evaluation, graders, metrics, pipeline, telemetry, versions
from jarvis.models import EvalCase, Interaction, PromptVersion, User
from sqlalchemy.orm import Session

from tests.conftest import CLIENT_HEADERS, FakeProvider

SEED_BODY = "You are JARVIS, {user}'s assistant. Be direct, accurate and brief in every answer."


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[Session]:
    with session_scope() as session:
        yield session


def owner(session: Session) -> User:
    return session.query(User).one()


def seed_version(session: Session) -> PromptVersion:
    return versions.seed_if_empty(session, prompt_path=None)


def active(session: Session) -> PromptVersion:
    """The live version, asserted to exist - every test here seeds one first."""
    version = versions.get_active(session)
    assert version is not None
    return version


def a_case(session: Session, *, name: str, checks: list[dict[str, object]]) -> EvalCase:
    case = EvalCase(
        name=name,
        prompt="when are my mocks?",
        fixture=json.dumps(
            [{"category": "school", "content": "Mocks start on the third of October"}]
        ),
        checks=json.dumps(checks),
        enabled=1,
    )
    session.add(case)
    session.flush()
    return case


# --- versions ---------------------------------------------------------------


def test_the_first_version_is_seeded_and_active(db: Session) -> None:
    version = seed_version(db)
    assert version.status == "active"
    assert version.number == 1
    # Seeding twice does not make a second one.
    assert seed_version(db).id == version.id


def test_a_proposal_changes_nothing(db: Session) -> None:
    """The safety property the whole design rests on."""
    live = seed_version(db)
    proposed = versions.propose(db, body=SEED_BODY, name="shorter answers")

    assert proposed.status == "draft"
    assert active(db).id == live.id, "the live version is untouched"
    assert proposed.parent_id == live.id, "lineage is recorded"


def test_a_prompt_without_the_user_placeholder_is_refused(db: Session) -> None:
    seed_version(db)
    with pytest.raises(versions.VersionError, match=r"\{user\}"):
        versions.propose(db, body="You are a helpful assistant. " * 5)


def test_a_trivially_short_prompt_is_refused(db: Session) -> None:
    seed_version(db)
    with pytest.raises(versions.VersionError):
        versions.propose(db, body="{user} hi")


def test_activation_retires_the_previous_version_rather_than_deleting_it(db: Session) -> None:
    first = seed_version(db)
    second = versions.propose(db, body=SEED_BODY, name="second")

    versions.activate(db, second, force=True)

    assert second.status == "active"
    assert first.status == "retired"
    assert versions.get(db, first.id) is not None, "rollback needs it to still exist"


def test_activation_is_refused_when_a_case_would_regress(db: Session) -> None:
    seed_version(db)
    candidate = versions.propose(db, body=SEED_BODY, name="risky")
    comparison = versions.Comparison(
        candidate_pass_rate=0.9, baseline_pass_rate=0.8, regressions=["states the date"]
    )

    with pytest.raises(versions.VersionError, match="states the date"):
        versions.activate(db, candidate, comparison=comparison)

    assert candidate.status != "active", "a refused activation must not half-apply"


def test_a_regression_can_be_accepted_deliberately_and_is_recorded(db: Session) -> None:
    """Shipping past a known regression is allowed, and written down."""
    seed_version(db)
    candidate = versions.propose(db, body=SEED_BODY, name="risky")
    comparison = versions.Comparison(
        candidate_pass_rate=0.9, baseline_pass_rate=0.8, regressions=["states the date"]
    )

    versions.activate(db, candidate, comparison=comparison, force=True)

    assert candidate.status == "active"
    assert "Forced past 1 regression" in candidate.notes


def test_rollback_restores_the_previous_version(db: Session) -> None:
    first = seed_version(db)
    second = versions.propose(db, body=SEED_BODY, name="second")
    versions.activate(db, second, force=True)

    restored = versions.rollback(db)

    assert restored.id == first.id
    assert restored.status == "active"
    assert second.status == "retired"


def test_rollback_with_nowhere_to_go_says_so(db: Session) -> None:
    seed_version(db)
    with pytest.raises(versions.VersionError, match="no earlier version"):
        versions.rollback(db)


# --- telemetry and metrics --------------------------------------------------


def record(session: Session, user_id: int, **kwargs: object) -> Interaction:
    defaults: dict[str, object] = {
        "query": "what is due?",
        "answer": "Nothing today.",
        "intent": "ask",
        "latency_ms": 900,
        "context_chars": 1200,
        "input_tokens": 100,
        "output_tokens": 40,
    }
    defaults.update(kwargs)
    row = Interaction(user_id=user_id, **defaults)
    session.add(row)
    session.flush()
    return row


def test_metrics_over_an_empty_history_are_zero_not_an_error(db: Session) -> None:
    summary = metrics.summarise(db, user_id=owner(db).id)
    assert summary.turns == 0
    assert summary.approval_rate == 0.0
    assert summary.error_rate == 0.0


def test_metrics_count_what_happened(db: Session) -> None:
    user = owner(db)
    for latency in (500, 900, 1500, 30_000):
        record(db, user.id, latency_ms=latency)
    record(db, user.id, error="the API key was rejected")
    db.commit()

    summary = metrics.summarise(db, user_id=user.id)
    assert summary.turns == 5
    assert summary.errors == 1
    assert summary.error_rate == pytest.approx(0.2)
    assert summary.latency_p50_ms in (900, 1500)
    assert summary.latency_p95_ms == 30_000


def test_unrated_turns_are_not_counted_as_approval(db: Session) -> None:
    """Silence is not a compliment; approval is measured over rated turns only."""
    user = owner(db)
    good = record(db, user.id)
    for _ in range(9):
        record(db, user.id)
    telemetry.record_feedback(db, user_id=user.id, interaction_id=good.id, rating="up")
    db.commit()

    summary = metrics.summarise(db, user_id=user.id)
    assert summary.rated == 1
    assert summary.approval_rate == 1.0
    assert summary.rated_share == pytest.approx(0.1)


def test_rating_twice_replaces_rather_than_accumulates(db: Session) -> None:
    user = owner(db)
    row = record(db, user.id)
    telemetry.record_feedback(db, user_id=user.id, interaction_id=row.id, rating="up")
    telemetry.record_feedback(
        db, user_id=user.id, interaction_id=row.id, rating="down", note="wrong date"
    )
    db.commit()

    summary = metrics.summarise(db, user_id=user.id)
    assert summary.rated == 1
    assert summary.rejected == 1


def test_problem_turns_finds_failures_and_rejections(db: Session) -> None:
    user = owner(db)
    record(db, user.id)
    broken = record(db, user.id, error="timed out")
    disliked = record(db, user.id)
    tooling = record(db, user.id, tool_errors=2)
    telemetry.record_feedback(db, user_id=user.id, interaction_id=disliked.id, rating="down")
    db.commit()

    ids = {row.id for row in metrics.problem_turns(db, user_id=user.id)}
    assert ids == {broken.id, disliked.id, tooling.id}


# --- the suite --------------------------------------------------------------


def test_a_case_is_graded_against_a_fixture_not_real_memories(db: Session) -> None:
    """Cases must not read the owner's data, or the suite changes meaning every
    time they tidy up - and personal data would go to the model on every run."""
    version = seed_version(db)
    case = a_case(db, name="states the date", checks=[{"kind": "contains", "value": "October"}])
    db.commit()

    provider = FakeProvider(reply="Your mocks start on the third of October.")
    result = evaluation.run_case(case, provider=provider, version=version, model="test-model")

    assert result.passed
    sent = provider.requests[-1].system
    assert "third of October" in sent, "the fixture reached the model"
    assert "<context>" in sent


def test_a_failing_case_reports_every_failure(db: Session) -> None:
    version = seed_version(db)
    case = a_case(
        db,
        name="strict",
        checks=[
            {"kind": "contains", "value": "October"},
            {"kind": "max_chars", "value": 10},
            {"kind": "uses_tool", "value": "search_memory"},
        ],
    )
    db.commit()

    provider = FakeProvider(reply="I have nothing about that in your notes at all.")
    result = evaluation.run_case(case, provider=provider, version=version, model="test-model")

    assert not result.passed
    assert {f.kind for f in result.failures} == {"contains", "max_chars", "uses_tool"}


def test_running_the_suite_with_no_cases_says_so(db: Session) -> None:
    version = seed_version(db)
    db.commit()
    with pytest.raises(evaluation.EvaluationError, match="no eval cases"):
        evaluation.run_suite(db, provider=FakeProvider(), version=version, model="m")


def test_the_suite_counts_regressions_against_a_baseline(db: Session) -> None:
    version = seed_version(db)
    passing = a_case(db, name="easy", checks=[{"kind": "contains", "value": "October"}])
    db.commit()

    good = FakeProvider(reply="The third of October.")
    baseline = evaluation.run_suite(db, provider=good, version=version, model="m")
    assert baseline.passed == 1

    bad = FakeProvider(reply="I could not say.")
    candidate = versions.propose(db, body=SEED_BODY, name="worse")
    run = evaluation.run_suite(
        db, provider=bad, version=candidate, model="m", baseline_run_id=baseline.id
    )
    assert run.failed == 1
    assert run.regressions == 1, f"case {passing.name} used to pass"


# --- the pipeline -----------------------------------------------------------


def test_assessment_compares_candidate_against_what_is_live(db: Session) -> None:
    seed_version(db)
    a_case(db, name="states the date", checks=[{"kind": "contains", "value": "October"}])
    candidate = versions.propose(db, body=SEED_BODY, name="candidate")
    db.commit()

    provider = FakeProvider(reply="The third of October.")
    assessment = pipeline.assess(db, candidate=candidate, provider=provider, model="m")

    assert assessment.comparison.candidate_pass_rate == 1.0
    assert assessment.comparison.baseline_pass_rate == 1.0
    assert assessment.comparison.safe
    assert candidate.status == "candidate", "evaluated, but not live"
    assert active(db).id != candidate.id


def test_a_candidate_cannot_be_assessed_against_itself(db: Session) -> None:
    live = seed_version(db)
    a_case(db, name="c", checks=[{"kind": "no_error", "value": ""}])
    db.commit()
    with pytest.raises(pipeline.PipelineError, match="already live"):
        pipeline.assess(db, candidate=live, provider=FakeProvider(), model="m")


def test_assessment_without_cases_refuses_rather_than_passing_everything(db: Session) -> None:
    """The dangerous failure mode: no cases means no evidence, and a system that
    returned "100% pass" here would wave every change through."""
    seed_version(db)
    candidate = versions.propose(db, body=SEED_BODY, name="candidate")
    db.commit()
    with pytest.raises(pipeline.PipelineError, match="No eval cases"):
        pipeline.assess(db, candidate=candidate, provider=FakeProvider(), model="m")


def test_promoting_an_interaction_freezes_its_context(db: Session) -> None:
    user = owner(db)
    row = record(db, user.id, query="when are my mocks?", tools_used="search_memory")
    db.commit()

    case = pipeline.promote_interaction(
        db,
        interaction=row,
        fixture=[{"category": "school", "content": "Mocks start on the third of October"}],
    )

    assert case.source == "promoted"
    assert case.prompt == "when are my mocks?"
    assert "third of October" in case.fixture
    kinds = {c["kind"] for c in json.loads(case.checks)}
    assert "no_error" in kinds
    assert "uses_tool" in kinds, "the tools it used before should still run"


def test_focus_notes_say_something_useful_at_every_stage(db: Session) -> None:
    user = owner(db)
    assert "No turns recorded" in pipeline.suggest_focus(db, user_id=user.id)[0]

    for _ in range(20):
        record(db, user.id)
    db.commit()
    notes = " ".join(pipeline.suggest_focus(db, user_id=user.id))
    assert "rated" in notes.lower()


# --- the HTTP surface -------------------------------------------------------


def test_the_loop_over_http(signed_in: TestClient) -> None:
    """Propose, fail to ship it blind, add a case, evaluate, activate."""
    versions_list = signed_in.get("/api/learning/versions").json()
    assert len(versions_list) == 1 and versions_list[0]["status"] == "active"

    created = signed_in.post(
        "/api/learning/versions",
        json={"body": SEED_BODY, "name": "terser", "notes": "answers were padded"},
        headers=CLIENT_HEADERS,
    )
    assert created.status_code == 201
    version_id = created.json()["id"]
    assert created.json()["status"] == "draft"

    # Shipping something unevaluated is refused.
    blind = signed_in.post(
        f"/api/learning/versions/{version_id}/activate",
        json={"force": False},
        headers=CLIENT_HEADERS,
    )
    assert blind.status_code == 400
    assert "not been evaluated" in blind.json()["detail"]

    case = signed_in.post(
        "/api/learning/cases",
        json={
            "name": "states the date",
            "prompt": "when are my mocks?",
            "fixture": [{"category": "school", "content": "Mocks start on the third of October"}],
            "checks": [{"kind": "no_error", "value": ""}],
        },
        headers=CLIENT_HEADERS,
    )
    assert case.status_code == 201

    assessed = signed_in.post(
        f"/api/learning/versions/{version_id}/evaluate", headers=CLIENT_HEADERS
    )
    assert assessed.status_code == 200, assessed.text
    assert assessed.json()["safe_to_activate"] is True

    shipped = signed_in.post(
        f"/api/learning/versions/{version_id}/activate",
        json={"force": False},
        headers=CLIENT_HEADERS,
    )
    assert shipped.status_code == 200
    assert shipped.json()["status"] == "active"

    rolled = signed_in.post("/api/learning/versions/rollback", headers=CLIENT_HEADERS)
    assert rolled.status_code == 200
    assert rolled.json()["number"] == 1


def test_a_case_with_an_unknown_check_is_refused(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/learning/cases",
        json={"name": "x", "prompt": "hi", "checks": [{"kind": "vibes", "value": "good"}]},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 400
    assert "unknown check kind" in response.json()["detail"]


def test_a_case_with_no_checks_is_refused(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/learning/cases",
        json={"name": "x", "prompt": "hi", "checks": []},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 400


def test_the_learning_api_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/learning/metrics").status_code == 401
    assert client.get("/api/learning/versions").status_code == 401
    assert (
        client.post(
            "/api/learning/feedback",
            json={"interaction_id": 1, "rating": "up"},
            headers=CLIENT_HEADERS,
        ).status_code
        == 401
    )


def test_feedback_on_someone_elses_interaction_is_refused(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/learning/feedback",
        json={"interaction_id": 9999, "rating": "up"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 404


def test_graders_reject_an_unknown_kind_rather_than_passing_it() -> None:
    """A typo in a check that silently always passes is worse than no check."""
    with pytest.raises(ValueError, match="unknown check kind"):
        graders.parse_checks([{"kind": "sounds_nice", "value": "x"}])


# --- the boundary the whole design exists to hold ---------------------------


def test_the_model_has_no_tool_that_touches_its_own_instructions() -> None:
    """The assistant may be told its answer was bad. It may not act on that by
    changing what it is. Nothing in the tool registry reaches the persona, the
    versions, or the evaluation suite."""
    from jarvis.tools import default_registry

    names = {spec.name for spec in default_registry().specs()}
    forbidden = {"activate_version", "propose_version", "update_prompt", "set_persona", "evaluate"}
    assert not (names & forbidden)
    for name in names:
        assert "prompt" not in name and "version" not in name


def test_activation_is_never_a_side_effect_of_evaluation(db: Session) -> None:
    """Evaluating is reading; it must not ship anything. If these two ever
    merge, the human gate is gone."""
    live = seed_version(db)
    a_case(db, name="c", checks=[{"kind": "no_error", "value": ""}])
    candidate = versions.propose(db, body=SEED_BODY, name="candidate")
    db.commit()

    pipeline.assess(db, candidate=candidate, provider=FakeProvider(), model="m")

    assert active(db).id == live.id, "evaluation shipped something"
    assert candidate.status == "candidate"


def test_the_pipeline_refuses_to_ship_something_it_never_measured(db: Session) -> None:
    seed_version(db)
    candidate = versions.propose(db, body=SEED_BODY, name="untested")
    db.commit()
    with pytest.raises(pipeline.PipelineError, match="not been evaluated"):
        pipeline.activate(db, candidate=candidate)
