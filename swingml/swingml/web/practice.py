"""The practice loop in the local app: one priority, one drill, a retest, a verdict.

The insight shown on a swing's page is computed from the swings up to and
including that one, so a page always says the same thing however many swings
came after it. Plans compare the swings that were current when practice started
against the swings recorded for the plan afterwards, through
`swingml.insights.compare`, which refuses to compare what was filmed differently.

Also here, because they belong to the golfer rather than to any one swing:
exporting everything, erasing everything, and the local event log, which never
leaves the machine and is shown to the golfer on the same page it is kept.
"""

from __future__ import annotations

import json
import shutil
from typing import Any

from flask import Blueprint, Response, abort, jsonify, redirect, render_template, request, url_for

from swingml.insights.compare import (
    CameraSignature,
    Change,
    SwingPoint,
    comparable_set,
    compare,
)
from swingml.insights.drills import BY_FOCUS, BY_ID, Drill
from swingml.insights.engine import TRACKABLE, Insight, RecentSwing, choose
from swingml.store import StoredSwing, SwingStore

HISTORY = 12


def metric_value(stored: StoredSwing, metric: str) -> float | None:
    metrics = stored.analysis.get("metrics")
    if not isinstance(metrics, dict):
        return None
    reading = metrics.get(metric)
    if isinstance(reading, dict) and isinstance(reading.get("value"), (int, float)):
        return float(reading["value"])
    if metric == "detection_rate" and isinstance(reading, (int, float)):
        return float(reading)
    return None


def point_of(stored: StoredSwing, metric: str) -> SwingPoint | None:
    value = metric_value(stored, metric)
    if value is None:
        return None
    camera = stored.analysis.get("camera")
    return SwingPoint(
        swing_id=stored.id,
        value=value,
        handedness=str(stored.analysis.get("handedness", "")),
        club=stored.club,
        camera=CameraSignature.model_validate(camera) if isinstance(camera, dict) else None,
    )


def recent_up_to(store: SwingStore, swing_id: int | None) -> list[StoredSwing]:
    rows = store.recent(limit=200)
    if swing_id is not None:
        rows = [r for r in rows if r.id <= swing_id]
    return rows[:HISTORY]


def insight_for(store: SwingStore, swing_id: int | None) -> Insight:
    recent = [
        RecentSwing(
            swing_id=row.id,
            refused=not row.ok,
            refusal=row.refusal,
            detection_rate=row.detection_rate,
            tempo=row.tempo_ratio,
            point=point_of(row, "tempo_ratio"),
        )
        for row in recent_up_to(store, swing_id)
    ]
    return choose(recent)


def baseline_for(
    store: SwingStore, drill: Drill, up_to: int | None
) -> tuple[list[int], str | None]:
    """The most recent comparable swings with a reading of the drill's metric."""
    points = [(row, point_of(row, drill.metric)) for row in recent_up_to(store, up_to) if row.ok]
    usable = [(row, p) for row, p in points if p is not None]
    if not usable:
        return [], None
    chosen = comparable_set([p for _, p in usable], drill.metric)
    return [usable[i][0].id for i in chosen], usable[0][0].club


def plan_change(store: SwingStore, plan: dict[str, Any]) -> Change | None:
    drill = BY_ID.get(plan["drill_id"])
    if drill is None or drill.focus == "capture":
        return None

    def points(ids: list[int]) -> list[SwingPoint]:
        out = []
        for swing_id in ids:
            row = store.get(swing_id)
            if row is not None and row.ok and (p := point_of(row, drill.metric)) is not None:
                out.append(p)
        return out

    return compare(points(plan["baseline"]), points(plan["retest"]), drill.metric, drill.direction)


def capture_progress(store: SwingStore, plan: dict[str, Any]) -> dict[str, int]:
    rows = [store.get(i) for i in plan["retest"]]
    streak = 0
    for row in sorted((r for r in rows if r is not None), key=lambda r: r.id):
        streak = streak + 1 if row.ok else 0
    return {"recorded": len(plan["retest"]), "clean_in_a_row": streak}


def create_blueprint(store: SwingStore) -> Blueprint:
    bp = Blueprint("practice", __name__)

    @bp.post("/api/plans")
    def start_plan() -> Any:
        payload = request.get_json(silent=True) or {}
        focus = str(payload.get("focus", ""))
        drill = BY_FOCUS.get(focus)
        if drill is None:
            return jsonify({"error": f"no drill for {focus!r}"}), 400
        from_swing = payload.get("from_swing")
        up_to = int(from_swing) if isinstance(from_swing, int) else None
        baseline, club = baseline_for(store, drill, up_to) if focus != "capture" else ([], None)
        insight = insight_for(store, up_to)
        plan_id = store.create_plan(
            focus=focus,
            drill_id=drill.id,
            metric=drill.metric,
            direction=drill.direction,
            club=club,
            baseline=baseline,
            insight=insight.model_dump(mode="json"),
        )
        store.log_event("plan_started", focus=focus, baseline=len(baseline))
        return jsonify({"plan_id": plan_id, "baseline": baseline}), 201

    @bp.post("/api/plans/<int:plan_id>/close")
    def close_plan(plan_id: int) -> Any:
        status = str((request.get_json(silent=True) or {}).get("status", "completed"))
        try:
            closed = store.close_plan(plan_id, status)
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if not closed:
            return jsonify({"error": "no active plan with that id"}), 404
        store.log_event("plan_closed", status=status)
        return jsonify({"ok": True})

    @bp.post("/api/plans/<int:plan_id>/feedback")
    def feedback(plan_id: int) -> Any:
        payload = request.get_json(silent=True) or {}
        useful = payload.get("useful")
        feel = payload.get("feel")
        try:
            store.add_feedback(
                plan_id,
                payload.get("swing_id") if isinstance(payload.get("swing_id"), int) else None,
                int(useful) if isinstance(useful, (int, str)) and str(useful).isdigit() else None,
                str(feel)[:1000] if feel else None,
            )
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        store.log_event("feedback_given", useful=useful)
        return jsonify({"ok": True}), 201

    @bp.get("/practice")
    def practice_page() -> Any:
        plan = store.active_plan()
        change = plan_change(store, plan) if plan is not None else None
        if plan is not None:
            store.log_event("practice_viewed", verdict=change.verdict if change else None)
        drill = BY_ID.get(plan["drill_id"]) if plan is not None else None

        def rows(ids: list[int]) -> list[dict[str, Any]]:
            out = []
            for swing_id in ids:
                row = store.get(swing_id)
                if row is None:
                    continue
                value = metric_value(row, drill.metric) if drill is not None else None
                out.append({"swing": row, "value": value})
            return out

        return render_template(
            "practice.html",
            plan=plan,
            drill=drill,
            change=change,
            baseline=rows(plan["baseline"]) if plan else [],
            retest=rows(plan["retest"]) if plan else [],
            capture=capture_progress(store, plan)
            if plan and drill and drill.focus == "capture"
            else None,
            feedback=store.feedback(plan["id"]) if plan else [],
            history=[p for p in store.plans() if p["status"] != "active"][:10],
            drills=BY_ID,
            choices=TRACKABLE,
        )

    @bp.get("/data")
    def data_page() -> str:
        total, ok = store.counts()
        return render_template("data.html", total=total, ok_count=ok, events=store.event_counts())

    @bp.get("/api/export")
    def export() -> Response:
        store.log_event("data_exported")
        body = json.dumps(store.export_all(), indent=2, default=str)
        return Response(
            body,
            mimetype="application/json",
            headers={"Content-Disposition": "attachment; filename=swing-studio-export.json"},
        )

    @bp.post("/api/erase")
    def erase() -> Any:
        from swingml.web.service import frames_dir, videos_dir

        payload = request.get_json(silent=True) or {}
        if payload.get("confirm") != "ERASE":
            return jsonify({"error": 'send {"confirm": "ERASE"} to delete everything'}), 400
        swings = store.erase_all()
        for directory in (frames_dir(), videos_dir()):
            shutil.rmtree(directory, ignore_errors=True)
            directory.mkdir(parents=True, exist_ok=True)
        return jsonify({"ok": True, "swings_deleted": swings})

    @bp.get("/plan/<int:plan_id>")
    def plan_redirect(plan_id: int) -> Any:
        if store.plan(plan_id) is None:
            abort(404)
        return redirect(url_for("practice.practice_page"))

    return bp
