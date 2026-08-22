"""Pack a trained model into something a browser can run without a server.

The whole analyser is a few hundred kilobytes of arithmetic and two and a half
megabytes of weights. There is no reason it needs Python installed, a virtual
environment, or a local server - the pose estimator already has a WebAssembly
build, and the rest is dilated convolutions and some geometry, all of which a
browser does perfectly well.

Weights go out as one contiguous float32 buffer with a manifest saying where each
tensor starts. Base64 costs a third in size and buys the thing that matters: the
result is one file that can be emailed, put on a memory stick, and opened by
double-clicking it.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swingml.analysis import AnalysisConfig, load_model, model_fingerprint
from swingml.assets import find_event_calibrations, find_event_model
from swingml.features import FeatureConfig, feature_layout
from swingml.model.calibration import load_calibration
from swingml.model.tcn import SwingEventNet


def pack(model: SwingEventNet) -> tuple[bytes, list[dict[str, object]]]:
    """Every tensor end to end, and an index into it."""
    buffers: list[np.ndarray] = []
    manifest: list[dict[str, object]] = []
    offset = 0
    for name, tensor in model.state_dict().items():
        values = tensor.detach().cpu().numpy().astype(np.float32).ravel()
        manifest.append(
            {
                "name": name,
                "shape": list(tensor.shape),
                "offset": offset,
                "count": int(values.size),
            }
        )
        buffers.append(values)
        offset += int(values.size)
    return np.concatenate(buffers).tobytes(), manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=Path("out/web/model.json"))
    parser.add_argument("--calibration", type=Path, default=None)
    args = parser.parse_args()

    path = args.model or find_event_model()
    if path is None:
        raise SystemExit("no trained model found")

    model = load_model(path)
    raw, manifest = pack(model)
    layout = feature_layout()
    analysis = AnalysisConfig()
    features = FeatureConfig()

    payload = {
        "architecture": {
            "in_features": int(model.input_projection.in_channels),
            "channels": int(model.channels),
            "dilations": list(model.dilations),
            "kernel_size": int(model.kernel_size),
            # What the convolutions read beyond the ends of the clip. A property
            # of the trained weights, not a choice the browser gets to make: a
            # model trained against one boundary and served against the other is
            # a different model, and the difference is largest at address and the
            # finish, which sit closest to the ends.
            "padding_mode": str(model.padding_mode),
            "groups": 8,
            "classes": 9,
        },
        "tensors": manifest,
        "weights_base64": base64.b64encode(raw).decode("ascii"),
        # Everything the browser needs so that its answers match this one's, rather
        # than being re-guessed on the other side and quietly drifting.
        "features": {
            "canonical_rate_hz": features.canonical_rate_hz,
            "min_visibility": features.min_visibility,
            "normalise_roll": features.normalise_roll,
            "layout": {
                "positions": list(layout.positions),
                "velocities": list(layout.velocities),
                "speeds": list(layout.speeds),
                "visibility": list(layout.visibility),
                "angles": list(layout.angles),
                "hands_relative": list(layout.hands_relative),
                "hand_velocity": list(layout.hand_velocity),
                "hand_speed": list(layout.hand_speed),
                "widths": list(layout.widths),
                "total": layout.total,
            },
        },
        "thresholds": {
            "min_mean_confidence": analysis.min_mean_confidence,
            "min_detection_rate": analysis.min_detection_rate,
            "plausible_backswing_s": list(analysis.plausible_backswing_s),
            "plausible_downswing_s": list(analysis.plausible_downswing_s),
            "plausible_tempo": list(analysis.plausible_tempo),
        },
        "source_model": str(path),
    }

    # The page runs this one exported network, so it may only carry bands that
    # were measured through this one exported network. The desktop app usually
    # runs an ensemble and has an ensemble's table sitting on disk beside it; that
    # table describes a different set of predictions and embedding it here would
    # print error bars the page cannot keep. Checked rather than trusted, because
    # the tables are found by searching a path and nothing about finding one says
    # it belongs to what is being exported.
    digest = model_fingerprint(model)
    candidates = [args.calibration] if args.calibration else find_event_calibrations()
    for candidate_path in candidates:
        candidate = load_calibration(candidate_path)
        if candidate.matches(digest):
            payload["calibration"] = candidate.model_dump()
            print(f"including error bands measured through these weights: {candidate_path}")
            break
    else:
        if candidates:
            print(
                f"none of the {len(candidates)} calibration table(s) on this machine were "
                "measured through these weights, so the page will report no error bands. "
                "Measure one with scripts/calibrate_events.py --checkpoint "
                f"{path}",
                file=sys.stderr,
            )
        else:
            print("no calibration found; the page will report frames with no error band")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload), encoding="utf-8")
    size = args.out.stat().st_size
    print(f"wrote {args.out}  ({size / 1e6:.2f} MB, {len(manifest)} tensors)")


if __name__ == "__main__":
    main()
