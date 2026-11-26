"""What the local model is shown and told.

Two jobs. The coach looks at one swing: a contact sheet of its eight key frames
and the numbers measured from them. The chat answers questions about all of them:
it is given a table of every stored swing and the conversation so far.

The rules are the same for both, and they are the analyser's own: say only what a
single camera shows, keep measurements and opinion apart, and never produce a
number for what cannot be measured here. The model is told this, and the guard in
swingml.coach.guard enforces the last part whatever it does.
"""

from __future__ import annotations

import base64
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from swingml.analysis import SwingAnalysis
from swingml.events import SwingEvent
from swingml.quantity import NoReading
from swingml.store import StoredSwing

RULES = (
    "Rules: speak to the golfer as 'you', in plain English. Only say what the pictures "
    "show or the measurements say, and say which one each point comes from. Never state "
    "or estimate club face angle, club path, attack angle, swing plane, spin, launch, ball "
    "speed, swing speed or distance: a single phone camera on a body-pose tracker cannot "
    "measure any of them. Positions and times come from a model and carry the error "
    "ranges given; do not treat a difference smaller than its range as real. If a frame "
    "does not show the position its label says, say so instead of coaching from it."
)

EVENT_LABELS = [e.name.replace("_", " ").title() for e in SwingEvent.ordered()]


def _reading(metrics: object, name: str) -> float | None:
    if metrics is None or isinstance(metrics, NoReading):
        return None
    reading = getattr(metrics, name, None)
    if reading is None or isinstance(reading, NoReading):
        return None
    return float(reading.value)


def measurement_lines(analysis: SwingAnalysis) -> list[str]:
    """The measurements, each with how it was obtained."""
    m = analysis.metrics
    lines = [f"Golfer: {analysis.handedness.value}-handed."]
    tempo = _reading(m, "tempo_ratio")
    if tempo is not None:
        band = analysis.tempo_uncertainty
        spread = (
            f" (measured 80% error range about +/-{100 * band.half_width_fraction:.0f}%)"
            if band is not None
            else ""
        )
        lines.append(
            f"Tempo, backswing time over downswing time: {tempo:.2f}{spread}. The downswing "
            "is always the shorter of the two; good players are usually quoted near 3, and a "
            "higher number means a slower backswing relative to the downswing."
        )
    timing = []
    for name, label in (
        ("backswing_duration", "backswing"),
        ("downswing_duration", "downswing"),
        ("swing_duration", "address to finish"),
    ):
        value = _reading(m, name)
        if value is not None:
            timing.append(f"{label} {value:.0f} ms")
    if timing:
        lines.append("Timing: " + ", ".join(timing) + ".")
    peak = _reading(m, "time_to_peak_hand_speed")
    if peak is not None:
        lines.append(
            f"Hands fastest {abs(peak):.0f} ms {'before' if peak < 0 else 'after'} impact."
        )
    for name, label in (
        (
            "shoulder_turn_foreshortened",
            "Shoulder turn at the top, estimated from how much the shoulders foreshorten "
            "in the picture (reads low; compare only with swings filmed from the same spot)",
        ),
        ("hip_turn_foreshortened", "Hip turn at the top, same method"),
    ):
        value = _reading(m, name)
        if value is not None:
            lines.append(f"{label}: about {value:.0f} degrees.")
    moves = []
    for name, label in (
        ("head_movement", "head moved"),
        ("pelvis_sway", "pelvis swayed"),
        ("pelvis_lift", "pelvis rose or dropped"),
    ):
        value = _reading(m, name)
        if value is not None:
            moves.append(f"{label} {value:.3f}")
    if moves:
        lines.append("Address to impact, in body lengths: " + ", ".join(moves) + ".")
    if not isinstance(m, NoReading) and m.kinematic_sequence:
        lines.append(
            "Order the body segments peaked in: " + " -> ".join(m.kinematic_sequence) + "."
        )
    if not isinstance(analysis.events, NoReading):
        times = analysis.event_times_s
        if times:
            stamps = ", ".join(
                f"{label} {t:.2f}s" for label, t in zip(EVENT_LABELS, times, strict=False)
            )
            lines.append(f"Positions found at: {stamps}.")
    return lines


def contact_sheet(frames_directory: Path, max_side: int = 1100) -> str | None:
    """The eight key frames on one JPEG, four across, labelled; base64, or None."""
    import cv2

    tiles = []
    for event, label in zip(SwingEvent.ordered(), EVENT_LABELS, strict=True):
        path = frames_directory / f"{int(event)}_{event.name.lower()}.jpg"
        image = cv2.imread(str(path)) if path.is_file() else None
        if image is None:
            return None
        tiles.append((image, f"{int(event) + 1} {label}"))
    height = 360
    resized = []
    for image, label in tiles:
        width = round(image.shape[1] * height / image.shape[0])
        tile = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
        scale = max(0.5, height / 480)
        (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
        cv2.rectangle(tile, (4, 4), (12 + w, 12 + h + 4), (0, 0, 0), -1)
        cv2.putText(tile, label, (8, 8 + h), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 2)
        resized.append(tile)
    width = max(t.shape[1] for t in resized)
    resized = [
        cv2.copyMakeBorder(t, 0, 0, 0, width - t.shape[1], cv2.BORDER_CONSTANT) for t in resized
    ]
    sheet = np.vstack([np.hstack(resized[:4]), np.hstack(resized[4:])])
    longest = max(sheet.shape[:2])
    if longest > max_side:
        factor = max_side / longest
        sheet = cv2.resize(sheet, (round(sheet.shape[1] * factor), round(sheet.shape[0] * factor)))
    ok, encoded = cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(encoded.tobytes()).decode("ascii") if ok else None


def coach_messages(
    analysis: SwingAnalysis, sheet_b64: str | None, club: str | None = None
) -> list[dict[str, object]]:
    """The coach's request for one swing, in Ollama's message shape."""
    picture = (
        "The image is a contact sheet of eight frames from the video, numbered in order: "
        + ", ".join(f"{i + 1} {label}" for i, label in enumerate(EVENT_LABELS))
        + ". The lines drawn on it are a body tracker's skeleton, not the club.\n\n"
        if sheet_b64
        else "No pictures are available; work from the measurements only.\n\n"
    )
    club_line = f"Club: {club}.\n" if club else ""
    user = (
        "A golfer filmed one swing on a phone and an app measured it from that single "
        "camera.\n\n"
        + picture
        + club_line
        + "What the app measured:\n- "
        + "\n- ".join(measurement_lines(analysis))
        + "\n\nWrite a short coaching read:\n"
        "1. What stands out: two or three observations, each naming the frame or "
        "measurement it comes from.\n"
        "2. The one thing to work on first, and one simple drill for it.\n"
        "3. In one sentence, what this footage cannot tell.\n\n"
        + RULES
        + " Plain text with the three numbered parts, under 230 words."
    )
    message: dict[str, object] = {"role": "user", "content": user}
    if sheet_b64:
        message["images"] = [sheet_b64]
    return [message]


def history_table(swings: Sequence[StoredSwing], limit: int = 60) -> str:
    """Every stored swing as one line each, newest first, for the chat to read."""
    rows = [
        "id | date | club | label | tempo | backswing ms | downswing ms | "
        "shoulder turn | head movement"
    ]
    for swing in list(swings)[:limit]:
        if not swing.ok:
            rows.append(
                f"{swing.id} | {swing.created_at:%Y-%m-%d %H:%M} | {swing.club or '-'} | "
                f"{swing.label or swing.source_name} | no swing found | - | - | - | -"
            )
            continue
        analysis = SwingAnalysis.model_validate(swing.analysis)
        turn = _reading(analysis.metrics, "shoulder_turn_foreshortened")
        head = _reading(analysis.metrics, "head_movement")

        def show(value: float | None, pattern: str) -> str:
            return "-" if value is None else pattern.format(value)

        rows.append(
            " | ".join(
                [
                    str(swing.id),
                    f"{swing.created_at:%Y-%m-%d %H:%M}",
                    swing.club or "-",
                    swing.label or swing.source_name,
                    show(swing.tempo_ratio, "{:.2f}"),
                    show(swing.backswing_ms, "{:.0f}"),
                    show(swing.downswing_ms, "{:.0f}"),
                    show(turn, "{:.0f} deg"),
                    show(head, "{:.3f}"),
                ]
            )
        )
    return "\n".join(rows)


def chat_messages(
    swings: Sequence[StoredSwing],
    conversation: Sequence[dict[str, str]],
    tempo_band: float | None = None,
) -> list[dict[str, object]]:
    """The chat's request: the golfer's history, then the conversation so far."""
    band = (
        f" Tempo readings carry a measured 80% error range of about +/-{100 * tempo_band:.0f}% "
        "each, so a change between two single swings smaller than that is not evidence of "
        "anything; trends over several swings are."
        if tempo_band
        else ""
    )
    context = (
        "You are a golf coach answering questions about one golfer's own swings. Each was "
        "filmed on a phone and measured by an app from that single camera. Here is every "
        "swing on record, newest first:\n\n"
        + history_table(swings)
        + "\n\nTempo is backswing time over downswing time, a ratio with no unit (not "
        "seconds); good players are usually quoted near 3. Shoulder turn is measured in "
        "the 2D picture, so it depends on where the camera stood; compare it only between "
        "swings filmed from the same place. Head movement is in body lengths from address "
        "to impact."
        + band
        + " Refer to swings by their id and date. "
        + RULES
        + " Keep answers short unless asked for detail."
    )
    messages: list[dict[str, object]] = [{"role": "system", "content": context}]
    for turn in conversation[-16:]:
        role = turn.get("role")
        content = str(turn.get("content", "")).strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content[:4000]})
    return messages
