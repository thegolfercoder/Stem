"""The swing told in order, from the measurements already made.

The metric cards say what each number is. This says what happened, part by
part, because a person watching their own swing thinks in "the backswing took
this long, then the downswing" rather than in a grid - and the numbers are the
same ones, so nothing is lost by the reordering.

Every sentence is assembled from a stored quantity and carries that quantity's
provenance. A measurement the pipeline refused is left out rather than
described, and nothing is inferred beyond what was measured: no advice, no
diagnosis, because a single camera does not support either and a paragraph that
reads well while claiming more than was measured is the failure this project
exists to avoid.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, NamedTuple

from markupsafe import Markup, escape


class Beat(NamedTuple):
    title: str
    text: Markup
    provenance: str


def _value(metrics: Mapping[str, Any], key: str) -> float | None:
    item = metrics.get(key)
    if isinstance(item, Mapping) and isinstance(item.get("value"), int | float):
        return float(item["value"])
    return None


def _provenance(metrics: Mapping[str, Any], key: str) -> str:
    item = metrics.get(key)
    return str(item.get("provenance", "derived")) if isinstance(item, Mapping) else "derived"


def _b(text: str) -> Markup:
    return Markup("<b>{}</b>").format(text)


def tempo_note(ratio: float) -> str:
    """Where the ratio sits against the figure tour players are usually quoted at."""
    if 2.7 <= ratio <= 3.3:
        return "which sits in the band tour players are usually quoted at, near 3 to 1"
    reference = "than the 3 to 1 usually quoted for tour players"
    if ratio > 3.3:
        return f"a longer backswing relative to the downswing {reference}"
    return f"a quicker backswing relative to the downswing {reference}"


def swing_story(metrics: Mapping[str, Any]) -> list[Beat]:
    """The parts of the swing in order, each built from measured numbers."""
    beats: list[Beat] = []
    back = _value(metrics, "backswing_duration")
    down = _value(metrics, "downswing_duration")
    whole = _value(metrics, "swing_duration")
    ratio = _value(metrics, "tempo_ratio")

    if back is not None:
        beats.append(
            Beat(
                "Address to the top",
                Markup(
                    "The backswing took {} from the last still frame at address to the "
                    "instant the hands changed direction."
                ).format(_b(f"{back / 1000:.2f} s")),
                _provenance(metrics, "backswing_duration"),
            )
        )
    if down is not None:
        text = Markup("The downswing took {}.").format(_b(f"{down / 1000:.2f} s"))
        if ratio is not None:
            text += Markup(" Backswing over downswing gives a tempo of {}, {}.").format(
                _b(f"{ratio:.2f} : 1"), tempo_note(ratio)
            )
        beats.append(Beat("The top to impact", text, _provenance(metrics, "tempo_ratio")))

    peak = _value(metrics, "time_to_peak_hand_speed")
    if peak is not None:
        rounded = round(peak)
        text = (
            Markup("The hands were moving fastest in the impact frame itself.")
            if rounded == 0
            else Markup("The hands were moving fastest {} impact.").format(
                _b(f"{abs(rounded)} ms {'before' if rounded < 0 else 'after'}")
            )
        )
        beats.append(
            Beat("Speed through the ball", text, _provenance(metrics, "time_to_peak_hand_speed"))
        )

    sequence = metrics.get("kinematic_sequence")
    times = metrics.get("kinematic_peak_times_ms")
    if isinstance(sequence, list) and sequence and isinstance(times, Mapping):
        parts = Markup(", then ").join(
            Markup("{} ({})").format(escape(name), f"{float(times[name]):+.0f} ms")
            for name in sequence
            if name in times
        )
        beats.append(
            Beat(
                "The order things peaked",
                Markup(
                    "Rotational speed peaked in this order, relative to impact: {}. "
                    "Coaching texts describe the pelvis first, then the thorax, then the "
                    "arms; this is read from the body's motion in the image, so a frame "
                    "either way is within its resolution."
                ).format(parts),
                str(metrics.get("kinematic_sequence_source", "projected")),
            )
        )

    shoulders = _value(metrics, "shoulder_turn_foreshortened")
    hips = _value(metrics, "hip_turn_foreshortened")
    if shoulders is not None and hips is not None:
        beats.append(
            Beat(
                "The turn at the top",
                Markup(
                    "Shoulders turned {} and hips {} away from square to the camera. These "
                    "come from how much each line foreshortens, read low against reality, and "
                    "compare best with other clips filmed from the same spot."
                ).format(_b(f"{shoulders:.0f}°"), _b(f"{hips:.0f}°")),
                _provenance(metrics, "shoulder_turn_foreshortened"),
            )
        )

    head = _value(metrics, "head_movement")
    sway = _value(metrics, "pelvis_sway")
    if head is not None and sway is not None:
        beats.append(
            Beat(
                "Staying centred",
                Markup(
                    "From address to impact the head moved {} body lengths and the pelvis "
                    "swayed {}, measured against the feet."
                ).format(_b(f"{head:.3f}"), _b(f"{sway:.3f}")),
                _provenance(metrics, "head_movement"),
            )
        )

    if whole is not None and back is not None and down is not None:
        beats.append(
            Beat(
                "Impact to the finish",
                Markup(
                    "The follow-through took {}, and the whole motion {} from address to a "
                    "held finish."
                ).format(_b(f"{(whole - back - down) / 1000:.2f} s"), _b(f"{whole / 1000:.2f} s")),
                _provenance(metrics, "swing_duration"),
            )
        )
    return beats
