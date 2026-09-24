"""The local coach and the chat, served next to the analysis they talk about.

Both stream: a small model on a laptop writes a few words a second, and a reply
that appears all at once after half a minute looks like a hang. Replies pass
through the guard sentence by sentence on the way out, so nothing about face
angle, path, plane or spin reaches the page even for a moment.

Everything is optional. With Ollama absent or holding no suitable model, the
endpoints say exactly that and what to do about it, and the rest of the
application carries on as before.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from flask import Blueprint, Response, jsonify, render_template, request, stream_with_context

from swingml.analysis import SwingAnalysis
from swingml.coach.guard import StreamGuard, guarded
from swingml.coach.ollama import OllamaClient, OllamaError
from swingml.coach.prompts import chat_messages, coach_messages, contact_sheet
from swingml.quantity import NoReading
from swingml.store import SwingStore


def _frames_dir(swing_id: int) -> Path:
    from swingml.web.service import frames_dir

    return frames_dir() / str(swing_id)


def saved_read(swing_id: int) -> dict[str, Any] | None:
    path = _frames_dir(swing_id) / "coach.json"
    if not path.is_file():
        return None
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return loaded if isinstance(loaded, dict) else None


def _save_read(swing_id: int, record: dict[str, Any]) -> None:
    directory = _frames_dir(swing_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "coach.json").write_text(json.dumps(record), encoding="utf-8")


def _setup_advice(status: dict[str, Any], need_vision: bool) -> str:
    if not status["running"]:
        return (
            "Ollama is not running on this computer. Install it from ollama.com, open it, "
            f"then run: ollama pull {status['suggested_pull']}"
        )
    if need_vision and not status["vision_model"]:
        return (
            "Ollama is running but has no model that can look at pictures. Run: "
            f"ollama pull {status['suggested_pull']}"
        )
    if not status["chat_model"]:
        return (
            f"Ollama is running but has no models yet. Run: ollama pull {status['suggested_pull']}"
        )
    return ""


def create_blueprint(store: SwingStore, client: OllamaClient | None = None) -> Blueprint:
    blueprint = Blueprint("coach", __name__)
    ollama = client or OllamaClient()

    def status() -> dict[str, Any]:
        return ollama.status().as_dict()

    @blueprint.get("/api/ai")
    def api_ai() -> Any:
        found = status()
        found["advice"] = _setup_advice(found, need_vision=False)
        found["coach_advice"] = _setup_advice(found, need_vision=True)
        return jsonify(found)

    @blueprint.get("/api/swings/<int:swing_id>/coach")
    def api_saved_read(swing_id: int) -> Any:
        return jsonify(saved_read(swing_id) or {})

    @blueprint.post("/api/swings/<int:swing_id>/coach")
    def api_coach(swing_id: int) -> Any:
        stored = store.get(swing_id)
        if stored is None:
            return jsonify({"error": "no such swing"}), 404
        analysis = SwingAnalysis.model_validate(stored.analysis)
        if isinstance(analysis.events, NoReading):
            return jsonify({"error": "there is no swing in this clip to coach"}), 400
        found = status()
        advice = _setup_advice(found, need_vision=False)
        if advice:
            return jsonify({"error": advice}), 503
        # Pictures when a model can see them; the numbers alone otherwise, and the
        # page says which.
        model = found["vision_model"] or found["chat_model"]
        requested = (request.get_json(silent=True) or {}).get("model")
        names = {m["name"] for m in found["models"]}
        if isinstance(requested, str) and requested in names:
            model = requested
        sees = any(m["name"] == model and m["vision"] for m in found["models"])
        sheet = contact_sheet(_frames_dir(swing_id)) if sees else None
        messages = coach_messages(analysis, sheet, club=stored.club)
        guard = StreamGuard()

        def generate() -> Iterator[str]:
            written: list[str] = []
            try:
                for piece in guarded(ollama.chat(model, messages), guard):
                    written.append(piece)
                    yield piece
            except OllamaError as error:
                yield f"\n\n[The local model stopped: {error}]"
                return
            text = "".join(written).strip()
            if guard.dropped:
                note = (
                    f"\n\n({guard.dropped} sentence{'s' if guard.dropped > 1 else ''} about "
                    "things one camera cannot measure - club face, path, plane or spin - "
                    "were left out.)"
                )
                yield note
                text += note
            _save_read(
                swing_id,
                {
                    "model": model,
                    "saw_pictures": sheet is not None,
                    "text": text,
                    "at": datetime.now(UTC).isoformat(),
                },
            )

        response = Response(stream_with_context(generate()), mimetype="text/plain")
        response.headers["X-Model"] = model
        response.headers["X-Saw-Pictures"] = "yes" if sheet else "no"
        response.headers["Cache-Control"] = "no-store"
        return response

    @blueprint.get("/chat")
    def chat_page() -> str:
        total, ok = store.counts()
        return render_template("chat.html", total=total, ok_count=ok)

    @blueprint.post("/api/chat")
    def api_chat() -> Any:
        body = request.get_json(silent=True) or {}
        conversation = body.get("messages")
        if not isinstance(conversation, list) or not conversation:
            return jsonify({"error": "send the conversation as a list of messages"}), 400
        found = status()
        advice = _setup_advice(found, need_vision=False)
        if advice:
            return jsonify({"error": advice}), 503
        model = found["chat_model"]
        requested = body.get("model")
        if isinstance(requested, str) and requested in {m["name"] for m in found["models"]}:
            model = requested
        swings = store.recent(limit=60)
        band = None
        for swing in swings:
            if swing.ok:
                analysis = SwingAnalysis.model_validate(swing.analysis)
                if analysis.tempo_uncertainty is not None:
                    band = analysis.tempo_uncertainty.half_width_fraction
                    break
        messages = chat_messages(swings, conversation, tempo_band=band)
        guard = StreamGuard()

        def generate() -> Iterator[str]:
            try:
                yield from guarded(ollama.chat(model, messages, temperature=0.3), guard)
            except OllamaError as error:
                yield f"\n\n[The local model stopped: {error}]"
                return
            if guard.dropped:
                yield (
                    f"\n\n({guard.dropped} sentence{'s' if guard.dropped > 1 else ''} about "
                    "club face, path, plane or spin were left out: one camera cannot "
                    "measure them.)"
                )

        response = Response(stream_with_context(generate()), mimetype="text/plain")
        response.headers["X-Model"] = model
        response.headers["Cache-Control"] = "no-store"
        return response

    return blueprint
