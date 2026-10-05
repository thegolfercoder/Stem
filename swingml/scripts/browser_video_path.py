"""Does the browser page place events as well as the archived path does? (#47)

`scripts/video_path_check.py` (#40) measured the desktop app's video path on the
81 real-time clips of `golfdb-validation-v2` against the archived features every
quoted figure comes through. `failure-inventory.md` row 23 said the browser read
each frame's own time and was not affected; this measures it instead.

Each clip goes through the browser page itself, built as the hosted page is
(`build_artifact.py`, the pose estimator bundled with it), served on this machine
and driven by headless Chromium: the page's own decode, its own pose estimator
(MediaPipe in the browser, on the processor), its own analysis. The golfer's hand
is set to the clip's, as the desktop measurement does. The page's run report gives
the event times; on the 60 Hz grid they are compared with the labels and with the
archive's reads, exactly as `video_path_check.py score` does.

One difference from a golfer's browser: this Chromium has no H.264, so each clip
is transcoded to VP9 in MP4 first, every frame kept at its original time
(`build_artifact.write_vp9`, the same as the hosted sample). The page decodes MP4
frame by frame (WebCodecs), as it does an iPhone clip.

    python scripts/build_artifact.py --out <site>
    python scripts/browser_video_path.py run --site <site> --videos <GolfDB videos_160>
    python scripts/browser_video_path.py score --out ../docs/audit/video-path-check.json

The holdout is not read.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import sys
import threading
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from build_artifact import write_vp9
from video_path_check import CORE, EVENTS, clips, interval

from swingml.analysis import AnalysisConfig, load_model
from swingml.assets import find_event_model
from swingml.model.release_gate import decide
from swingml.skeleton import Handedness

RATE = 60.0
"""The grid every read is placed on (AnalysisConfig().features.canonical_rate_hz)."""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return


def _note(errors: list[str], error: Any) -> None:
    errors.append(str(error))


def serve(root: Path) -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(_Quiet, directory=str(root))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/index.html"


def cmd_run(args: argparse.Namespace) -> None:
    from playwright.sync_api import sync_playwright

    from tests.browser import chromium_path

    out = args.cache
    out.mkdir(parents=True, exist_ok=True)
    transcoded = out / "vp9"
    transcoded.mkdir(exist_ok=True)
    todo = [c for c in clips(args.root) if not (out / f"{c['clip']}.json").exists()]
    if args.limit:
        todo = todo[: args.limit]
    server, url = serve(args.site)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium_path())
            for done, clip in enumerate(todo, start=1):
                video = transcoded / f"{clip['clip']}.mp4"
                if not video.exists() and not write_vp9(args.videos / f"{clip['clip']}.mp4", video):
                    raise SystemExit(f"could not transcode clip {clip['clip']}")
                page = browser.new_context(viewport={"width": 1180, "height": 900}).new_page()
                errors: list[str] = []
                page.on("pageerror", functools.partial(_note, errors))
                # The processor: there is no real GPU here, and the page offers it.
                page.add_init_script("window.__swingForceCpu = true;")
                page.goto(url)
                page.click(f"#handedness [data-value={'left' if clip['left'] else 'right'}]")
                page.set_input_files("input[type=file]", str(video))
                page.wait_for_function(
                    "() => window.__swingRun && window.__swingRun.outcome !== 'running'",
                    timeout=args.timeout * 1000,
                )
                report = page.evaluate("() => window.__swingRun")
                (out / f"{clip['clip']}.json").write_text(
                    json.dumps({"clip": clip["clip"], "report": report, "errors": errors}) + "\n"
                )
                page.context.close()
                print(f"  {done}/{len(todo)} clip {clip['clip']}: {report.get('outcome')}",
                      flush=True)  # fmt: skip
            browser.close()
    finally:
        server.shutdown()


def cmd_score(args: argparse.Namespace) -> None:
    path = find_event_model()
    if path is None:
        raise SystemExit("no shipped event model found")
    model = load_model(path)
    rows = []
    for clip in clips(args.root):
        hand = Handedness.LEFT if clip["left"] else Handedness.RIGHT
        decision = decide(model, clip["features"], AnalysisConfig(handedness=hand))
        saved = args.cache / f"{clip['clip']}.json"
        if not saved.exists():
            raise SystemExit(f"clip {clip['clip']} has not been run through the page")
        report = json.loads(saved.read_text())["report"]
        times = report.get("eventTimes") if report.get("outcome") == "analysed" else None
        rows.append({
            "clip": clip["clip"], "group": clip["group"], "face_on": clip["face_on"],
            "labels": clip["events"].tolist(),
            "archive": None if decision.positions is None
            else [round(float(x), 3) for x in decision.positions],
            "browser": None if times is None else [round(float(t) * RATE, 3) for t in times],
            "browser_outcome": report.get("outcome"),
            "browser_handedness": report.get("notes", {}).get("handedness"),
        })  # fmt: skip
    audit = json.loads(args.out.read_text()) if args.out and args.out.exists() else {}
    audit["browser"] = {
        "source": "the browser page (hosted build, pose estimator bundled, processor delegate) "
        "in headless Chromium on the same real-time clips of golfdb-validation-v2, each "
        "transcoded to VP9 in MP4 with every frame at its original time; holdout not read",
        "all_real_time": summarise(rows, args.resamples, args.seed),
        "face_on": summarise([r for r in rows if r["face_on"]], args.resamples, args.seed),
        "clips": rows,
    }
    for name in ("all_real_time", "face_on"):
        part = audit["browser"][name]
        print(f"{name}: n={part['n']} ({part['n_groups']} groups); "
              f"browser refused {part['refused_by_browser_only']}, "
              f"archive refused {part['refused_by_archive_only']}")  # fmt: skip
        for p in ("archive", "browser"):
            s = part[p]
            print(f"  {p:8s} within 1 (gate) {s['within_1_core4']['share']:.3f} "
                  f"{s['within_1_core4']['ci95']}  offsets "
                  f"{[s['offset_vs_labels'][e]['median'] for e in EVENTS]}")  # fmt: skip
        print(f"  browser - archive, per event: {part['browser']['offset_vs_archive']}")
    if args.out is not None:
        args.out.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")


def summarise(rows: list[dict[str, Any]], resamples: int, seed: int) -> dict[str, Any]:
    """Archive and browser on the clips both answered, as video_path_check scores them."""
    both = [r for r in rows if r["archive"] is not None and r["browser"] is not None]
    groups = [r["group"] for r in both]
    labels = np.array([r["labels"] for r in both], dtype=np.float64)
    archive = np.array([r["archive"] for r in both])
    out: dict[str, Any] = {
        "n": len(both),
        "n_groups": len(set(groups)),
        "refused_by_browser_only": [r["clip"] for r in rows
                                    if r["archive"] is not None and r["browser"] is None],
        "refused_by_archive_only": [r["clip"] for r in rows
                                    if r["archive"] is None and r["browser"] is not None],
    }  # fmt: skip
    for p in ("archive", "browser"):
        read = np.array([r[p] for r in both])
        per_swing = (np.abs(np.rint(read) - labels)[:, list(CORE)] <= 1).mean(axis=1)
        signed = read - labels
        out[p] = {
            "answered": sum(r[p] is not None for r in rows),
            "within_1_core4": {
                "share": round(float(per_swing.mean()), 4),
                "ci95": interval(per_swing, groups, np.mean, resamples, seed),
            },
            "offset_vs_labels": {
                name: {
                    "median": round(float(np.median(signed[:, k])), 3),
                    "ci95": interval(signed[:, k], groups, np.median, resamples, seed),
                }
                for k, name in enumerate(EVENTS)
            },
            "offset_vs_archive": {
                name: round(float(np.median((read - archive)[:, k])), 3)
                for k, name in enumerate(EVENTS)
            },
        }
    diff = np.array([r["browser"] for r in both]) - archive
    out["browser"]["paired_within_1_difference"] = {
        "share": round(out["browser"]["within_1_core4"]["share"]
                       - out["archive"]["within_1_core4"]["share"], 4),
        "ci95": interval(
            (np.abs(np.rint(np.array([r["browser"] for r in both])) - labels)[:, list(CORE)] <= 1
             ).mean(axis=1)
            - (np.abs(np.rint(archive) - labels)[:, list(CORE)] <= 1).mean(axis=1),
            groups, np.mean, resamples, seed),
    }  # fmt: skip
    out["browser"]["share_of_events_within_half_a_grid_step_of_archive"] = round(
        float((np.abs(diff) <= 0.5).mean()), 4
    )
    return out


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "score"):
        p = sub.add_parser(name)
        p.add_argument("--root", type=Path, default=Path("."))
        p.add_argument("--cache", type=Path, default=Path("out/videopath/browser"))
        if name == "run":
            p.add_argument("--site", type=Path, required=True)
            p.add_argument("--videos", type=Path, required=True)
            p.add_argument("--limit", type=int, default=0)
            p.add_argument("--timeout", type=int, default=600, help="seconds per clip")
        else:
            p.add_argument("--out", type=Path, default=None)
            p.add_argument("--resamples", type=int, default=2000)
            p.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    {"run": cmd_run, "score": cmd_score}[args.command](args)


if __name__ == "__main__":
    main()
