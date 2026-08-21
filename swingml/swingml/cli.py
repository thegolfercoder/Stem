"""The command line: one entry point, no environment variables, no paths to know.

Three things someone actually wants to do.

``swingml ui`` opens the application. This is the one most people want, so it is
what running ``swingml`` with no arguments does.

``swingml analyse`` runs over a file or a folder without a browser, which is what
you want when there are forty clips from a range session and you would rather
have a table than click through them.

``swingml doctor`` says what is installed, what is missing, and where things are
kept. Every piece of software that depends on a model file it downloads needs one
of these, and leaving it out means the first confusing failure has no answer.
"""

from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from pathlib import Path

from swingml.assets import (
    describe_setup,
    ensure_pose_model,
    find_event_calibration,
    find_event_model,
    find_pose_model,
    home,
)
from swingml.skeleton import Handedness

VIDEO_SUFFIXES = {".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"}


def _collect(target: Path) -> list[Path]:
    if target.is_dir():
        return sorted(p for p in target.iterdir() if p.suffix.lower() in VIDEO_SUFFIXES)
    return [target]


def _human_bytes(n: int) -> str:
    return f"{n / 1e6:.1f} MB"


def _download_with_progress() -> Path:
    last = [-1]

    def progress(done: int, total: int) -> None:
        percent = int(100 * done / total) if total else 0
        if percent != last[0] and percent % 5 == 0:
            last[0] = percent
            bar = "#" * (percent // 4)
            sys.stderr.write(f"\r  pose model {bar:<25} {percent:3d}%  {_human_bytes(done)}")
            sys.stderr.flush()

    sys.stderr.write("Downloading the pose model (about 30 MB, once).\n")
    path = ensure_pose_model(on_progress=progress)
    sys.stderr.write("\n  saved to " + str(path) + "\n")
    return path


def command_ui(args: argparse.Namespace) -> int:
    from swingml.store import SwingStore
    from swingml.web.app import create_app

    if find_pose_model() is None:
        _download_with_progress()

    store = SwingStore(args.database)
    app = create_app(store=store, model_path=args.model)

    url = f"http://{args.host}:{args.port}"
    print(f"\n  Swing analysis is running at {url}")
    print(f"  Swings are kept in {store.path}")
    if find_event_model() is None and args.model is None:
        print("\n  Warning: no trained swing model found, so analysis will refuse.")
        print("  Train one with: python scripts/train_events.py")
    print("\n  Press Ctrl+C to stop.\n")

    if args.open:
        webbrowser.open(url)
    app.run(host=args.host, port=args.port, debug=False, threaded=True)
    return 0


def command_analyse(args: argparse.Namespace) -> int:
    from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
    from swingml.model.calibration import load_calibration
    from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
    from swingml.quantity import NoReading
    from swingml.session import summarise_session
    from swingml.store import SwingStore
    from swingml.video.reader import VideoReader
    from swingml.web.service import record_swing

    videos = _collect(args.target)
    if not videos:
        print(f"no videos found at {args.target}", file=sys.stderr)
        return 1

    model_path = args.model or find_event_model()
    if model_path is None:
        print(
            "no trained swing model found. Train one with "
            "'python scripts/train_events.py', or pass --model.",
            file=sys.stderr,
        )
        return 1

    if find_pose_model() is None:
        _download_with_progress()

    model = load_model(Path(model_path))
    estimator = MediaPipePoseEstimator()
    calibration_path = find_event_calibration()
    config = AnalysisConfig(
        handedness=Handedness.LEFT if args.left_handed else Handedness.RIGHT,
        calibration=load_calibration(calibration_path) if calibration_path else None,
    )
    store = SwingStore(args.database) if args.save else None

    analyses = []
    for video in videos:
        width = 0

        def progress(done: int, total: int, name: str = video.name) -> None:
            nonlocal width
            line = f"  {name}: frame {done}" + (f" of {total}" if total else "")
            width = max(width, len(line))
            sys.stderr.write("\r" + line.ljust(width))
            sys.stderr.flush()

        with VideoReader(video) as reader:
            expected = max(0, reader.declared_frames)

            def relay(done: int, total: int = expected) -> None:
                progress(done, total)

            sequence = estimator.estimate_stream(reader.frames(), on_progress=relay)
            info = reader.describe_stream(sequence.n_frames, sequence.timestamps_s)
        sys.stderr.write("\r" + " " * width + "\r")

        analysis = analyse_pose_sequence(sequence, model, config, video=info)
        analyses.append(analysis)
        print(analysis.describe())
        print()
        if store is not None:
            record_swing(
                store,
                analysis,
                sequence,
                video.resolve(),
                source_name=video.name,
                club=args.club,
            )

    readings = [a for a in analyses if not isinstance(a.events, NoReading)]
    if len(readings) > 1:
        print(summarise_session(readings).describe())
    if len(analyses) > 1:
        print(f"\n{len(readings)} of {len(analyses)} clips produced a reading.")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps([a.model_dump(mode="json") for a in analyses], indent=2),
            encoding="utf-8",
        )
        print(f"wrote {args.json}")
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    print(describe_setup())
    print()

    problems = 0
    if find_pose_model() is None:
        if args.fix:
            _download_with_progress()
        else:
            print("  The pose model is missing. Run 'swingml doctor --fix' to fetch it.")
            problems += 1
    if find_event_model() is None:
        print("  No trained swing model. Train one: python scripts/train_events.py")
        problems += 1

    for name in ("cv2", "mediapipe", "torch", "flask"):
        try:
            __import__(name)
            print(f"  {name:<12} ok")
        except ImportError as error:
            print(f"  {name:<12} MISSING ({error})")
            problems += 1

    from swingml.store import SwingStore

    store = SwingStore(args.database)
    total, ok = store.counts()
    print(f"  database     {store.path} ({total} swings, {ok} with a reading)")

    print()
    print("Everything is in order." if problems == 0 else f"{problems} thing(s) need attention.")
    return 0 if problems == 0 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="swingml", description="Golf swing analysis from a single camera."
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=None,
        help=f"where swings are kept (default: {home() / 'swings.db'})",
    )
    subparsers = parser.add_subparsers(dest="command")

    ui = subparsers.add_parser("ui", help="open the application in a browser")
    ui.add_argument("--host", default="127.0.0.1")
    ui.add_argument("--port", type=int, default=8000)
    ui.add_argument("--model", type=Path, default=None)
    ui.add_argument("--no-open", dest="open", action="store_false", help="do not launch a browser")
    ui.set_defaults(func=command_ui, open=True)

    analyse = subparsers.add_parser("analyse", help="analyse a video or a folder of them")
    analyse.add_argument("target", type=Path)
    analyse.add_argument("--model", type=Path, default=None)
    analyse.add_argument("--left-handed", action="store_true")
    analyse.add_argument("--club", default=None)
    analyse.add_argument("--json", type=Path, default=None)
    analyse.add_argument(
        "--save", action="store_true", help="also record the results in the database"
    )
    analyse.set_defaults(func=command_analyse)

    doctor = subparsers.add_parser("doctor", help="check the installation")
    doctor.add_argument("--fix", action="store_true", help="download anything missing")
    doctor.set_defaults(func=command_doctor)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        # Running the program with no arguments should do the obvious thing
        # rather than print usage and quit.
        args = parser.parse_args(["ui", *(argv or [])])
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        print("\nstopped.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
