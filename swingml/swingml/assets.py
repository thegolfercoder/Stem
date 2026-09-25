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
EVENT_MODEL_NUMPY_NAME = "swing_event_net.npz"
"""The same weights for the NumPy network, which the packaged application runs."""
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


def package_data() -> Path:
    """The data shipped inside the package, wherever the package itself is: the
    repository, a pip install, or a packaged desktop application's bundle."""
    return Path(__file__).resolve().parent / "data"


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
            package_data() / POSE_MODEL_NAME,
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
    # PyTorch trains the model and the development install has it; the packaged
    # application does not, and runs the NumPy copy of the same weights.
    names = [EVENT_MODEL_NAME, EVENT_MODEL_NUMPY_NAME] if have_torch() else [EVENT_MODEL_NUMPY_NAME]
    for name in names:
        for path in _search_paths(
            name,
            EVENT_MODEL_ENV_VAR,
            [
                package_data() / name,
                root / "out" / "finetuned" / name,
                root / "out" / "events" / name,
                Path("out") / "finetuned" / name,
                Path("out") / "events" / name,
            ],
        ):
            if path.is_file() and (path.suffix == ".npz" or have_torch()):
                return path
    return None


def have_torch() -> bool:
    """Whether PyTorch can be imported here, without importing it."""
    import importlib.util

    return importlib.util.find_spec("torch") is not None


def find_event_calibrations() -> list[Path]:
    """Every measured error-band table on this machine, most specific first.

    All of them rather than the first one, because path order is the wrong way to
    choose. A machine can easily hold a table for the bundled single model and
    another for an ensemble trained here, and which of the two describes the model
    that got loaded is a question about weights, not directories. The caller picks
    by comparing fingerprints; this only says where to look.

    Deliberately separate from the checkpoint. A table of errors belongs to one
    model measured on one corpus, so it must not be carried along by a checkpoint
    retrained after it was made - an error bar quoted for the wrong model is worse
    than none at all.
    """
    root = _repo_root() / "swingml"
    found: list[Path] = []
    for path in _search_paths(
        EVENT_CALIBRATION_NAME,
        EVENT_CALIBRATION_ENV_VAR,
        [
            root / "out" / "calibration" / EVENT_CALIBRATION_NAME,
            Path("out") / "calibration" / EVENT_CALIBRATION_NAME,
            package_data() / EVENT_CALIBRATION_NAME,
        ],
    ):
        if path.is_file() and path not in found:
            found.append(path)
    return found


def find_event_calibration() -> Path | None:
    """The first table on this machine, for callers that only need somewhere to look.

    Says nothing about whether it describes any particular model; anything about
    to quote it should go through `find_event_calibrations` and check.
    """
    tables = find_event_calibrations()
    return tables[0] if tables else None


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
        members = sorted(root.glob("member_*.pt" if have_torch() else "member_*.npz"))
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
