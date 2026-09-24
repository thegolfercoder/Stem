"""Build the browser app as a page that carries its own pose estimator.

The one-file build fetches MediaPipe and its thirty-megabyte model from the
internet the first time it runs, which is fine on a laptop and impossible
anywhere every request to another host is refused - including the hosted page
people are most likely to be sent. So this build publishes the estimator beside
the page and points the app at it: the bundle and its WebAssembly as they are,
and the model split into chunks, because a host that takes files usually caps
how large one can be and the model is larger than that.

Nothing about the analysis changes. The same four modules are bundled the same
way; only where the estimator comes from differs, and `SWING_ASSETS` is how the
page is told.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from build_web_app import MODULES, bundle, mp4box

from swingml.pose.mediapipe_pose import resolve_model_path

MEDIAPIPE_VERSION = "0.10.14"
"""The tasks-vision release the page was written and tested against."""

MEDIAPIPE_FILES = (
    "vision_bundle.mjs",
    "wasm/vision_wasm_internal.js",
    "wasm/vision_wasm_internal.wasm",
)
"""The SIMD build only. Every current browser has WebAssembly SIMD, and the other
build is nine megabytes the size budget below cannot spare."""

CHUNK_BYTES = 7_500_000
"""Raw bytes per chunk. Base64 grows that by a third, to about ten megabytes of
text, comfortably under what a host will take as one text file."""

WRAPPERS = re.compile(
    r"<!doctype html>\s*|<html[^>]*>\s*|</html>\s*|<head>\s*|</head>\s*|<body>\s*|</body>\s*"
    r"|<meta charset=\"utf-8\">\s*|<meta name=\"viewport\"[^>]*>\s*",
    re.IGNORECASE,
)


def fetch_mediapipe(out: Path) -> list[str]:
    """Copy the estimator's bundle and WebAssembly next to the page."""
    written = []
    for name in MEDIAPIPE_FILES:
        target = out / "mediapipe" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.is_file():
            url = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{MEDIAPIPE_VERSION}/{name}"
            with urllib.request.urlopen(url, timeout=120) as response:
                target.write_bytes(response.read())
        written.append(f"mediapipe/{name}")
    return written


def split_model(out: Path) -> list[str]:
    """The pose model as base64 text, in pieces a host will accept one at a time.

    Text because hosts that serve a page's files serve a fixed list of types and
    an arbitrary binary is not on it, while plain text always is. The page decodes
    the pieces and joins them back into the model.
    """
    data = resolve_model_path(None).read_bytes()
    names = []
    for index, start in enumerate(range(0, len(data), CHUNK_BYTES)):
        name = f"model/pose_landmarker_heavy.part{index}.b64.txt"
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        (out / name).write_bytes(base64.b64encode(data[start : start + CHUNK_BYTES]))
        names.append(name)
    return names


def write_webm(source: Path, target: Path) -> bool:
    """The sample again in VP8, for the browsers that ship without an H.264 decoder."""
    import cv2

    capture = cv2.VideoCapture(str(source))
    size = (int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    writer = cv2.VideoWriter(
        str(target),
        cv2.VideoWriter_fourcc(*"VP80"),  # type: ignore[attr-defined]
        capture.get(cv2.CAP_PROP_FPS),
        size,
    )
    if not writer.isOpened():
        return False
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        writer.write(frame)
    writer.release()
    return target.is_file() and target.stat().st_size > 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("out/web/model.json"))
    parser.add_argument("--source", type=Path, default=Path("webapp"))
    parser.add_argument("--sample", type=Path, default=Path("tests/fixtures/real_swing_01.mov"))
    parser.add_argument("--out", type=Path, default=Path("out/artifact"))
    args = parser.parse_args()

    if not args.model.is_file():
        raise SystemExit(f"{args.model} not found - run scripts/export_web_model.py first")

    args.out.mkdir(parents=True, exist_ok=True)
    fetch_mediapipe(args.out)
    chunks = split_model(args.out)
    sample = None
    if args.sample.is_file():
        (args.out / "sample").mkdir(exist_ok=True)
        shutil.copyfile(args.sample, args.out / "sample/sample-swing.mp4")
        sample = [{"src": "sample/sample-swing.mp4", "type": 'video/mp4; codecs="avc1.42E01E"'}]
        if write_webm(args.sample, args.out / "sample/sample-swing.webm"):
            sample.append({"src": "sample/sample-swing.webm", "type": 'video/webm; codecs="vp8"'})

    html = (args.source / "index.html").read_text(encoding="utf-8")
    for token, name in zip(
        ("/*__ENGINE__*/", "/*__MODEL__*/", "/*__METRICS__*/", "/*__APP__*/"),
        MODULES,
        strict=True,
    ):
        html = html.replace(token, bundle((args.source / name).read_text("utf-8"), name))
    html = html.replace("/*__PAYLOAD__*/", args.model.read_text(encoding="utf-8"))
    html = html.replace("/*__MP4BOX__*/", mp4box(args.source))

    assets = {
        "mediapipe": "mediapipe",
        "model": chunks,
        "sample": sample,
        "copyInsteadOfDownload": True,
    }
    html = html.replace(
        '<script type="module">',
        f'<script>window.SWING_ASSETS = {json.dumps(assets)};</script>\n<script type="module">',
        1,
    )
    html = WRAPPERS.sub("", html).lstrip()

    page = args.out / "index.html"
    page.write_text(html, encoding="utf-8")
    total = sum(f.stat().st_size for f in args.out.rglob("*") if f.is_file())
    print(f"wrote {page} ({page.stat().st_size / 1e6:.1f} MB), {total / 1e6:.1f} MB in all")
    print(f"  model in {len(chunks)} chunks" + (", sample swing included" if sample else ""))


if __name__ == "__main__":
    main()
