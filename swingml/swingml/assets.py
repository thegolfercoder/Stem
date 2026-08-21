"""Finding, and if necessary fetching, the files the analyser needs to run.

Two binaries stand between a fresh checkout and a working analysis: the pose
landmarker, which is thirty megabytes and belongs to Google rather than in this
repository, and the trained event model, which is built here. Requiring someone
to locate both by hand before anything works is the difference between software
and a pile of scripts, so this resolves them, and downloads the one that can be
downloaded.

Everything lands in one place - ``~/.swingml`` by default, overridable - so a
user can delete a single directory and be back to a clean state.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)
POSE_MODEL_NAME = "pose_landmarker_heavy.task"
EVENT_MODEL_NAME = "swing_event_net.pt"
EVENT_CALIBRATION_NAME = "event_calibration.json"

HOME_ENV_VAR = "SWINGML_HOME"
POSE_MODEL_ENV_VAR = "SWINGML_POSE_MODEL"
EVENT_MODEL_ENV_VAR = "SWINGML_EVENT_MODEL"
ENSEMBLE_ENV_VAR = "SWINGML_EVENT_ENSEMBLE"
EVENT_CALIBRATION_ENV_VAR = "SWINGML_EVENT_CALIBRATION"


def home() -> Path:
    """Where downloaded models, the swing database and uploads live."""
    configured = os.environ.get(HOME_ENV_VAR)
    return Path(configured).expanduser() if configured else Path.home() / ".swingml"


def models_dir() -> Path:
    path = home() / "models"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _search_paths(name: str, env_var: str, extra: list[Path]) -> list[Path]:
    configured = os.environ.get(env_var)
    paths = [Path(configured).expanduser()] if configured else []
    paths.append(home() / "models" / name)
    paths.extend(extra)
    return paths


def find_pose_model() -> Path | None:
    """The landmarker bundle if it is already somewhere we know to look."""
    root = _repo_root()
    for path in _search_paths(
        POSE_MODEL_NAME,
        POSE_MODEL_ENV_VAR,
        [
            root / "models" / POSE_MODEL_NAME,
            Path("models") / POSE_MODEL_NAME,
        ],
    ):
        if path.is_file():
            return path
    return None


def find_event_model() -> Path | None:
    """The trained swing event model, wherever it happens to be.

    Searched in order of specificity: an explicit environment variable, the
    user's own directory, then the copies a developer working in the repository
    would have. The fine-tuned model is preferred over the one trained purely on
    synthetic landmarks, because it is measurably better on real video.
    """
    root = _repo_root() / "swingml"
    for path in _search_paths(
        EVENT_MODEL_NAME,
        EVENT_MODEL_ENV_VAR,
        [
            root / "swingml" / "data" / EVENT_MODEL_NAME,
            root / "out" / "finetuned" / EVENT_MODEL_NAME,
            root / "out" / "events" / EVENT_MODEL_NAME,
            Path("out") / "finetuned" / EVENT_MODEL_NAME,
            Path("out") / "events" / EVENT_MODEL_NAME,
        ],
    ):
        if path.is_file():
            return path
    return None


def find_event_calibration() -> Path | None:
    """The measured error bands for the model in use, if they have been measured.

    Deliberately optional and deliberately separate from the checkpoint. A table
    of errors belongs to one model measured on one corpus, so it must not be
    carried along by a checkpoint that was retrained after it was made - an error
    bar quoted for the wrong model is worse than none at all. Absent, the analysis
    reports frames with no band and says why.
    """
    root = _repo_root() / "swingml"
    for path in _search_paths(
        EVENT_CALIBRATION_NAME,
        EVENT_CALIBRATION_ENV_VAR,
        [
            root / "swingml" / "data" / EVENT_CALIBRATION_NAME,
            root / "out" / "calibration" / EVENT_CALIBRATION_NAME,
            Path("out") / "calibration" / EVENT_CALIBRATION_NAME,
        ],
    ):
        if path.is_file():
            return path
    return None


def find_event_ensemble() -> list[Path]:
    """Every member of a trained ensemble, or an empty list if there is not one.

    Preferred over a single model wherever both exist. Members disagree in
    different places and averaging them removes error that no single one of them
    could remove on its own, at a cost of a few milliseconds per clip.
    """
    roots = [
        home() / "models" / "ensemble",
        _repo_root() / "swingml" / "swingml" / "data" / "ensemble",
        _repo_root() / "swingml" / "out" / "ensemble",
        Path("out") / "ensemble",
    ]
    configured = os.environ.get(ENSEMBLE_ENV_VAR)
    if configured:
        roots.insert(0, Path(configured).expanduser())

    for root in roots:
        if not root.is_dir():
            continue
        members = sorted(root.glob("member_*.pt"))
        if members:
            return members
    return []


def download_pose_model(
    destination: Path | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Fetch the landmarker bundle. Returns where it landed.

    Downloads to a temporary file and moves it into place only once complete, so
    an interrupted download cannot leave a truncated model that fails later in a
    confusing way.
    """
    target = destination or (models_dir() / POSE_MODEL_NAME)
    target.parent.mkdir(parents=True, exist_ok=True)

    try:
        with urllib.request.urlopen(POSE_MODEL_URL) as response:
            total = int(response.headers.get("Content-Length", 0))
            downloaded = 0
            with tempfile.NamedTemporaryFile(
                dir=target.parent, suffix=".partial", delete=False
            ) as handle:
                partial = Path(handle.name)
                while True:
                    chunk = response.read(1 << 16)
                    if not chunk:
                        break
                    handle.write(chunk)
                    downloaded += len(chunk)
                    if on_progress is not None:
                        on_progress(downloaded, total)
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"could not download the pose model from {POSE_MODEL_URL}: {error}. "
            "Download it by hand and point $SWINGML_POSE_MODEL at it."
        ) from error

    shutil.move(str(partial), str(target))
    return target


def ensure_pose_model(on_progress: Callable[[int, int], None] | None = None) -> Path:
    """The landmarker bundle, downloading it if this is the first run."""
    existing = find_pose_model()
    if existing is not None:
        return existing
    return download_pose_model(on_progress=on_progress)


def describe_setup() -> str:
    """A short report on what is present and what is missing."""
    pose = find_pose_model()
    event = find_event_model()
    ensemble = find_event_ensemble()
    lines = [
        f"swingml home       {home()}",
        f"pose model         {pose if pose else 'MISSING (will download on first run)'}",
        f"swing event model  {event if event else 'MISSING'}",
    ]
    if ensemble:
        lines.append(f"ensemble           {len(ensemble)} members in {ensemble[0].parent}")
    return "\n".join(lines)
