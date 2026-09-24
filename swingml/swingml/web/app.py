"""The local web application.

Everything is served from this machine and nothing leaves it. Clips of somebody's
golf swing are personal, and there is no reason for an analyser that runs
perfectly well on a laptop to send them anywhere.

No content is loaded from a content delivery network either - no fonts, no
script libraries, no stylesheets. That is partly privacy and partly that a golf
range is exactly the sort of place where the network is bad or absent, and a page
that goes blank without one is not usable there.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)

from swingml.analysis import SwingAnalysis
from swingml.assets import find_event_model, home
from swingml.events import CLUB_DEFINED_EVENTS, SwingEvent
from swingml.model.calibration import ErrorBand, RelativeBand
from swingml.quantity import NoReading, Quantity
from swingml.session import summarise_session
from swingml.skeleton import Handedness
from swingml.store import StoredSwing, SwingStore
from swingml.web.service import (
    AnalysisService,
    event_frame_files,
    frames_dir,
    save_upload,
    sequence_manifest,
)
from swingml.web.story import swing_story

ALLOWED_SUFFIXES = {".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024


def _reading_to_dict(
    reading: object, label: str, hint: str = "", band: RelativeBand | None = None
) -> dict[str, Any]:
    """Flatten a reading for the template, refusals included.

    A refused metric is rendered as a refusal with its reason rather than being
    dropped. A metric that silently disappears when it cannot be computed makes
    the analyser look more capable than it is.
    """
    if isinstance(reading, NoReading):
        return {
            "label": label,
            "ok": False,
            "reason": reading.reason,
            "hint": hint,
        }
    if isinstance(reading, Quantity):
        low, high = band.interval(reading.value) if band else (None, None)
        return {
            "label": label,
            "ok": True,
            "value": reading.value,
            "unit": reading.unit,
            "provenance": reading.provenance.value,
            "assumptions": list(reading.assumptions),
            "hint": hint,
            # None where nothing was measured. A missing range and a range of
            # zero width say opposite things about how well this is known.
            "range_low": low,
            "range_high": high,
            "range_note": str(band) if band else None,
        }
    return {"label": label, "ok": False, "reason": "not computed", "hint": hint}


def _format_number(value: float, unit: str) -> str:
    if unit == "ms":
        return f"{value:.0f}"
    if unit == "deg":
        return f"{value:.1f}"
    if unit == "":
        return f"{value:.2f}"
    return f"{value:.3f}"


def metric_groups(analysis: SwingAnalysis) -> list[dict[str, Any]]:
    """The metrics arranged the way a person reads them, not the way they are stored."""
    metrics = analysis.metrics
    if isinstance(metrics, NoReading):
        return []

    return [
        {
            "title": "Tempo",
            "blurb": "How long each half of the swing took, straight from the frame times.",
            "items": [
                _reading_to_dict(
                    metrics.tempo_ratio,
                    "Tempo ratio",
                    "backswing ÷ downswing",
                    band=analysis.tempo_uncertainty,
                ),
                _reading_to_dict(metrics.backswing_duration, "Backswing", "address → top"),
                _reading_to_dict(metrics.downswing_duration, "Downswing", "top → impact"),
                _reading_to_dict(metrics.swing_duration, "Total", "address → finish"),
                _reading_to_dict(
                    metrics.time_to_peak_hand_speed,
                    "Peak hand speed",
                    "relative to impact; negative is before",
                ),
            ],
        },
        {
            "title": "Rotation at the top",
            "blurb": (
                "How far the shoulders and hips had turned away from square to the "
                "camera, measured from how much they foreshorten. That is the one "
                "rotation a single uncalibrated camera can honestly support, and it "
                "carries no sign: turning towards the camera and away from it look "
                "identical. Compare these against your own swings from the same "
                "camera position rather than against a number from a magazine."
            ),
            "items": [
                _reading_to_dict(
                    metrics.shoulder_turn_foreshortened, "Shoulder turn", "from foreshortening"
                ),
                _reading_to_dict(metrics.hip_turn_foreshortened, "Hip turn", "from foreshortening"),
                _reading_to_dict(
                    metrics.shoulder_turn_projected, "Shoulder line tilt", "angle on screen"
                ),
                _reading_to_dict(
                    metrics.shoulder_turn_3d, "Shoulder turn", "from the estimator's own depth"
                ),
                _reading_to_dict(
                    metrics.separation_3d, "Separation", "shoulders minus hips, from depth"
                ),
            ],
        },
        {
            "title": "Stability",
            "blurb": (
                "Movement of the head and pelvis, in units of your own body length, "
                "so no camera calibration is needed."
            ),
            "items": [
                _reading_to_dict(metrics.head_movement, "Head movement", "address → impact"),
                _reading_to_dict(metrics.pelvis_sway, "Pelvis sway", "side to side"),
                _reading_to_dict(metrics.pelvis_lift, "Pelvis lift", "up and down"),
            ],
        },
    ]


ADVICE: list[tuple[str, str]] = [
    (
        "body was found in only",
        "Make sure the golfer is fully in shot for the whole clip and reasonably "
        "well lit. Standing further back so the whole body fits is better than "
        "filling the frame and losing the feet at the top of the backswing.",
    ),
    (
        "mean confidence",
        "The model could not find a swing it was sure about. This is most often a "
        "clip that stops before the finish, or one filmed from behind the golfer "
        "where the body hides itself. Filming face on, square to the target line, "
        "is what it handles best.",
    ),
    (
        "backswing would have lasted",
        "The clip probably does not contain a whole swing. Start recording before "
        "the takeaway and keep going until the finish is held.",
    ),
    (
        "tempo of",
        "The two halves of the swing did not come out in a sensible proportion, "
        "which usually means one end of the swing is missing from the clip. Record "
        "from address through to a held finish.",
    ),
    (
        "no complete",
        "The clip is too short to analyse. A second or so either side of the swing is enough.",
    ),
]


def advice_for(reason: str) -> str:
    """What to try next, chosen from the refusal itself.

    A refusal that explains itself is better than a wrong number, and a refusal
    that also says what to do about it is better again. Somebody standing on a
    range with a phone does not want a diagnosis, they want the next clip to work.
    """
    lowered = reason.lower()
    for marker, text in ADVICE:
        if marker in lowered:
            return text
    return (
        "Record from address through to a held finish, with the whole body in shot. "
        "Face on, square to where the ball is going, is the angle this handles best."
    )


def event_rows(analysis: SwingAnalysis, files: dict[str, str]) -> list[dict[str, Any]]:
    if isinstance(analysis.events, NoReading):
        return []
    rows = []
    for event in SwingEvent.ordered():
        index = int(event)
        band = (
            analysis.event_uncertainty[index] if index < len(analysis.event_uncertainty) else None
        )
        rows.append(
            {
                "name": event.name,
                "label": event.label,
                "frame": analysis.event_source_frames[index],
                "time_s": analysis.event_times_s[index],
                "confidence": analysis.events.confidence[index],
                "image": files.get(event.name),
                "club_defined": event in CLUB_DEFINED_EVENTS,
                # None where no calibration was measured, so the template shows
                # nothing rather than an error bar of zero.
                "band_ms": band.half_width_ms if isinstance(band, ErrorBand) else None,
                "band_frames": band.half_width_frames if isinstance(band, ErrorBand) else None,
                "band_note": str(band) if isinstance(band, ErrorBand) else None,
            }
        )
    return rows


PRETTY_NAMES: dict[str, str] = {
    "tempo_ratio": "Tempo ratio",
    "backswing_duration": "Backswing",
    "downswing_duration": "Downswing",
    "swing_duration": "Whole swing",
    "time_to_peak_hand_speed": "Peak hand speed",
    "shoulder_turn_foreshortened": "Shoulder turn",
    "hip_turn_foreshortened": "Hip turn",
    "shoulder_turn_projected": "Shoulder line tilt",
    "hip_turn_projected": "Hip line tilt",
    "separation_projected": "Separation on screen",
    "head_movement": "Head movement",
    "pelvis_sway": "Pelvis sway",
    "pelvis_lift": "Pelvis lift",
}


def pretty_name(name: str) -> str:
    """A label a person would use, falling back to the field name made readable."""
    return PRETTY_NAMES.get(name, name.replace("_", " ").capitalize())


TREND_METRICS: list[tuple[str, str, str]] = [
    ("tempo_ratio", "Tempo ratio", ""),
    ("backswing_ms", "Backswing", "ms"),
    ("downswing_ms", "Downswing", "ms"),
]


def build_trend(
    rows: list[StoredSwing], attribute: str, label: str, unit: str
) -> dict[str, Any] | None:
    """One metric across a session, oldest first, with its mean and spread.

    Spread alone says how repeatable somebody is; it cannot say whether they are
    getting better. Both belong on the page, and the band around the mean is what
    lets a reader see at a glance whether a swing sat inside their normal range or
    outside it.
    """
    usable = [row for row in reversed(rows) if row.ok and getattr(row, attribute) is not None]
    if len(usable) < 2:
        return None

    values: list[float] = [float(getattr(row, attribute)) for row in usable]
    mean = sum(values) / len(values)
    deviation = (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5

    low = min(min(values), mean - deviation)
    high = max(max(values), mean + deviation)
    pad = (high - low) * 0.12 or max(abs(high) * 0.05, 0.5)
    low, high = low - pad, high + pad
    span = high - low

    width, height = 640.0, 132.0
    step = width / max(1, len(values) - 1)

    def to_y(value: float) -> float:
        return float(round(height - (value - low) / span * height, 2))

    points: list[dict[str, Any]] = [
        {
            "value": value,
            "name": row.label or row.source_name,
            "when": row.created_at.strftime("%d %b %H:%M"),
            "x": round(index * step, 2),
            "y": to_y(value),
        }
        for index, (row, value) in enumerate(zip(usable, values, strict=True))
    ]

    return {
        "key": attribute,
        "label": label,
        "unit": unit,
        "points": points,
        "path": " ".join(
            ("M" if i == 0 else "L") + f"{p['x']},{p['y']}" for i, p in enumerate(points)
        ),
        "mean": mean,
        "mean_y": to_y(mean),
        "band_top": to_y(mean + deviation),
        "band_height": abs(to_y(mean - deviation) - to_y(mean + deviation)),
        "deviation": deviation,
        "width": width,
        "height": height,
    }


def create_app(store: SwingStore | None = None, model_path: Path | None = None) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    app.config["JSON_SORT_KEYS"] = False

    swing_store = store or SwingStore()
    service = AnalysisService(swing_store, model_path=model_path)
    app.extensions["swingml"] = {"store": swing_store, "service": service}

    # -- pages -------------------------------------------------------------

    @app.get("/")
    def index() -> str:
        ready, why = service.ready()
        swings = swing_store.recent(limit=24)
        total, ok = swing_store.counts()
        return render_template(
            "index.html",
            ready=ready,
            why=why,
            swings=swings,
            total=total,
            ok_count=ok,
            clubs=swing_store.clubs(),
        )

    @app.get("/swing/<int:swing_id>")
    def swing_page(swing_id: int) -> str:
        stored = swing_store.get(swing_id)
        if stored is None:
            abort(404)
        analysis = SwingAnalysis.model_validate(stored.analysis)
        files = event_frame_files(swing_id)
        refusal = analysis.events.reason if isinstance(analysis.events, NoReading) else None
        advice = advice_for(refusal) if refusal else None
        band = next((b for b in analysis.event_uncertainty if isinstance(b, ErrorBand)), None)
        return render_template(
            "swing.html",
            band_corpus=band.measured_on if band else None,
            band_coverage=round(100 * band.coverage) if band else None,
            swing=stored,
            analysis=analysis,
            sequence=sequence_manifest(swing_id),
            events=event_rows(analysis, files),
            groups=metric_groups(analysis),
            story=swing_story(stored.analysis.get("metrics", {})),
            refusal=refusal,
            advice=advice,
            clubs=swing_store.clubs(),
            format_number=_format_number,
        )

    @app.get("/session")
    def session_page() -> str:
        club = request.args.get("club") or None
        stored = swing_store.recent(limit=200, club=club)
        analyses = [SwingAnalysis.model_validate(s.analysis) for s in stored if s.ok]
        summary = summarise_session(analyses) if analyses else None
        trends = [
            trend
            for attribute, label, unit in TREND_METRICS
            if (trend := build_trend(stored, attribute, label, unit)) is not None
        ]
        return render_template(
            "session.html",
            summary=summary,
            trends=trends,
            pretty=pretty_name,
            swings=stored,
            club=club,
            clubs=swing_store.clubs(),
            n_analysed=len(analyses),
        )

    # -- api ---------------------------------------------------------------

    @app.post("/api/analyse")
    def api_analyse() -> Any:
        upload = request.files.get("video")
        if upload is None or not upload.filename:
            return jsonify({"error": "no file was uploaded"}), 400

        suffix = Path(upload.filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            return jsonify(
                {
                    "error": (
                        f"{suffix or 'that file'} is not a video this can read. "
                        f"Try one of: {', '.join(sorted(ALLOWED_SUFFIXES))}"
                    )
                }
            ), 400

        ready, why = service.ready()
        if not ready:
            return jsonify({"error": why}), 503

        handedness = (
            Handedness.LEFT
            if request.form.get("handedness", "right") == "left"
            else Handedness.RIGHT
        )
        club = (request.form.get("club") or "").strip() or None
        label = (request.form.get("label") or "").strip() or None

        path = save_upload(upload.stream, upload.filename)
        job = service.submit(path, upload.filename, handedness, club=club, label=label)
        return jsonify(job.as_dict()), 202

    @app.get("/api/jobs/<job_id>")
    def api_job(job_id: str) -> Any:
        job = service.job(job_id)
        if job is None:
            return jsonify({"error": "no such job"}), 404
        return jsonify(job.as_dict())

    @app.get("/api/swings")
    def api_swings() -> Any:
        club = request.args.get("club") or None
        limit = min(int(request.args.get("limit", 50)), 500)
        rows = swing_store.recent(limit=limit, club=club)
        return jsonify([_swing_summary(row) for row in rows])

    @app.post("/api/swings/<int:swing_id>")
    def api_update_swing(swing_id: int) -> Any:
        payload = request.get_json(silent=True) or {}
        label = payload.get("label")
        club = payload.get("club")
        if not swing_store.update(swing_id, label=label, club=club):
            return jsonify({"error": "nothing to update"}), 400
        return jsonify({"ok": True})

    @app.delete("/api/swings/<int:swing_id>")
    def api_delete_swing(swing_id: int) -> Any:
        if not swing_store.delete(swing_id):
            return jsonify({"error": "no such swing"}), 404
        return jsonify({"ok": True})

    @app.get("/api/swings/<int:swing_id>/analysis")
    def api_swing_analysis(swing_id: int) -> Any:
        stored = swing_store.get(swing_id)
        if stored is None:
            return jsonify({"error": "no such swing"}), 404
        return app.response_class(
            json.dumps(stored.analysis, indent=2), mimetype="application/json"
        )

    # -- media -------------------------------------------------------------

    @app.get("/media/<int:swing_id>/<path:name>")
    def media_frame(swing_id: int, name: str) -> Any:
        target = (frames_dir() / str(swing_id) / name).resolve()
        root = frames_dir().resolve()
        if root not in target.parents or not target.is_file():
            abort(404)
        return send_file(target, mimetype="image/jpeg")

    @app.get("/video/<int:swing_id>")
    def media_video(swing_id: int) -> Any:
        stored = swing_store.get(swing_id)
        if stored is None or not stored.video_path:
            abort(404)
        path = Path(stored.video_path)
        if not path.is_file():
            abort(404)
        return send_file(path, conditional=True)

    @app.get("/health")
    def health() -> Any:
        ready, why = service.ready()
        total, ok = swing_store.counts()
        return jsonify(
            {
                "ready": ready,
                "detail": why,
                "home": str(home()),
                "event_model": str(find_event_model() or ""),
                "swings": total,
                "with_reading": ok,
            }
        )

    @app.errorhandler(413)
    def too_large(_error: object) -> Any:
        return jsonify({"error": "that video is larger than 2 GB"}), 413

    @app.get("/favicon.ico")
    def favicon() -> Any:
        return redirect(url_for("static", filename="favicon.svg"))

    return app


def _swing_summary(row: StoredSwing) -> dict[str, Any]:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat(),
        "label": row.label,
        "club": row.club,
        "source_name": row.source_name,
        "ok": row.ok,
        "refusal": row.refusal,
        "tempo_ratio": row.tempo_ratio,
        "backswing_ms": row.backswing_ms,
        "downswing_ms": row.downswing_ms,
        "mean_confidence": row.mean_confidence,
    }
