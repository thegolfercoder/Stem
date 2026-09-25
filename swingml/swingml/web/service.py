"""Running an analysis for the web front end, without making the browser wait.

Analysing a clip takes tens of seconds - most of it the pose estimator, which is
a neural network doing real work on every frame. A request that holds the
connection open for that long looks broken: the browser shows a spinner with no
idea whether anything is happening, and any proxy in between may give up.

So an upload starts a job and returns immediately with an identifier, the work
happens on a background thread, and the page asks how it is getting on. That also
means progress can be reported honestly - frames done out of frames expected -
rather than an animation that conveys nothing.

The model and the pose estimator are expensive to construct and are built once,
on first use, behind a lock. Analysis itself runs one job at a time: MediaPipe
saturates the machine on its own, and letting two run at once makes both slower
while making the memory footprint twice as hard to reason about.
"""

from __future__ import annotations

import contextlib
import json
import shutil
import threading
import traceback
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import IO, TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray

from swingml.analysis import (
    AnalysisConfig,
    ResolvedModel,
    SwingAnalysis,
    analyse_pose_sequence,
    resolve_model,
)
from swingml.assets import (
    home,
)
from swingml.events import SwingEvent
from swingml.labels import save_pose
from swingml.model.calibration import ModelCalibration
from swingml.model.ensemble import (
    SwingEventEnsemble,
)
from swingml.model.numpy_net import NumpyEventNet
from swingml.pose.base import PoseSequence
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.skeleton import Handedness, infer_handedness
from swingml.store import SwingStore
from swingml.video.reader import VideoInfo, VideoReader
from swingml.web.frames import (
    extract_event_frames,
    extract_sequence_frames,
    frames_at,
    strip_frames,
)

if TYPE_CHECKING:
    from swingml.model.tcn import SwingEventNet

POSE_MAX_SIDE = 640
"""Frames are shrunk to this before the pose estimator sees them.

It works at a few hundred pixels whatever it is handed, so a 4K frame is time spent
for nothing, and the event model was trained on landmarks from small video. The
browser app does the same, so the two answer alike.
"""

POSE_MAX_RATE_HZ = 60.0
"""The model looks at sixty frames a second; a 240 fps clip is tracked at this."""

STRIP_LEAD_S = 0.5
STRIP_TAIL_S = 0.25
STRIP_MAX_FRAMES = 240
"""The scrubbing strip: every tracked frame from just before address to just after
the finish. Four seconds at sixty frames a second, which no swing needs."""


class JobState(StrEnum):
    QUEUED = "queued"
    READING = "reading"
    ANALYSING = "analysing"
    RENDERING = "rendering"
    DONE = "done"
    FAILED = "failed"


@dataclass
class Job:
    """One upload on its way through the pipeline."""

    id: str
    filename: str
    state: JobState = JobState.QUEUED
    frames_done: int = 0
    frames_expected: int = 0
    message: str = "waiting to start"
    swing_id: int | None = None
    error: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def progress(self) -> float:
        """Fraction complete, as best it can be known.

        Reading frames is the bulk of the time, so it owns most of the bar. When
        the container does not declare a frame count the fraction stays at zero
        and the interface shows a frame counter instead of a false percentage.
        """
        if self.state is JobState.DONE:
            return 1.0
        if self.state is JobState.FAILED:
            return 0.0
        if self.state is JobState.RENDERING:
            return 0.95
        if self.frames_expected <= 0:
            return 0.0
        return min(0.9, 0.9 * self.frames_done / self.frames_expected)

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "filename": self.filename,
            "state": self.state.value,
            "progress": self.progress,
            "frames_done": self.frames_done,
            "frames_expected": self.frames_expected,
            "message": self.message,
            "swing_id": self.swing_id,
            "error": self.error,
        }


def videos_dir() -> Path:
    path = home() / "videos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def frames_dir() -> Path:
    path = home() / "frames"
    path.mkdir(parents=True, exist_ok=True)
    return path


class AnalysisService:
    """Owns the model, the estimator, the job table and the store."""

    def __init__(self, store: SwingStore, model_path: Path | None = None) -> None:
        self.store = store
        self.explicit_model_path = model_path
        self._jobs: dict[str, Job] = {}
        self._jobs_lock = threading.Lock()
        self._model_lock = threading.Lock()
        self._run_lock = threading.Lock()
        # Which model runs, and whether the bands on disk describe it, are decided
        # in one place for the whole program. Resolved at startup so a table that
        # will not parse fails loudly here rather than silently on every upload.
        self._resolved: ResolvedModel | None = resolve_model(model_path)
        self._estimator: MediaPipePoseEstimator | None = None

    @property
    def model_path(self) -> Path | None:
        return self._resolved.paths[0] if self._resolved else None

    @property
    def calibration(self) -> ModelCalibration | None:
        return self._resolved.calibration if self._resolved else None

    # -- readiness ---------------------------------------------------------

    def ready(self) -> tuple[bool, str]:
        """Whether an analysis could run right now, and what is missing if not."""
        if self._resolved is None:
            return False, (
                "No trained swing model found. Train one with "
                "'python scripts/train_events.py', or set $SWINGML_EVENT_MODEL."
            )
        return True, "ready"

    def warm_up(self) -> None:
        """Build the model and estimator now rather than on the first upload."""
        self._ensure_loaded()

    def _ensure_loaded(
        self,
    ) -> tuple[SwingEventNet | NumpyEventNet | SwingEventEnsemble, MediaPipePoseEstimator]:
        with self._model_lock:
            ok, why = self.ready()
            if not ok:
                raise RuntimeError(why)
            if self._estimator is None:
                self._estimator = MediaPipePoseEstimator()
        assert self._resolved is not None
        return self._resolved.model, self._estimator

    # -- jobs --------------------------------------------------------------

    def submit(
        self,
        upload_path: Path,
        original_name: str,
        handedness: Handedness | None,
        club: str | None = None,
        label: str | None = None,
    ) -> Job:
        job = Job(id=uuid.uuid4().hex[:12], filename=original_name)
        with self._jobs_lock:
            self._jobs[job.id] = job
        thread = threading.Thread(
            target=self._run,
            args=(job, upload_path, original_name, handedness, club, label),
            daemon=True,
        )
        thread.start()
        return job

    def job(self, job_id: str) -> Job | None:
        with self._jobs_lock:
            return self._jobs.get(job_id)

    def active_jobs(self) -> list[Job]:
        with self._jobs_lock:
            return [
                j for j in self._jobs.values() if j.state not in (JobState.DONE, JobState.FAILED)
            ]

    def _run(
        self,
        job: Job,
        upload_path: Path,
        original_name: str,
        handedness: Handedness | None,
        club: str | None,
        label: str | None,
    ) -> None:
        try:
            with self._run_lock:
                job.state = JobState.READING
                job.message = "loading the model"
                model, _ = self._ensure_loaded()

                job.message = "finding the body in each frame"
                sequence, video_info = self._extract_pose(upload_path, job)

                job.state = JobState.ANALYSING
                job.message = "finding the swing"
                analysis = self.analyse(sequence, model, handedness, video_info)

                job.state = JobState.RENDERING
                job.message = "saving the key frames"
                swing_id = record_swing(
                    self.store,
                    analysis,
                    sequence,
                    upload_path,
                    source_name=original_name,
                    label=label,
                    club=club,
                )

                job.swing_id = swing_id
                job.state = JobState.DONE
                job.message = (
                    analysis.events.reason if isinstance(analysis.events, NoReading) else "done"
                )
        except Exception as error:
            job.state = JobState.FAILED
            job.error = str(error) or error.__class__.__name__
            job.message = "analysis failed"
            traceback.print_exc()

    def analyse(
        self,
        sequence: PoseSequence,
        model: SwingEventNet | NumpyEventNet | SwingEventEnsemble,
        handedness: Handedness | None,
        video: VideoInfo | None = None,
    ) -> SwingAnalysis:
        """Analyse a tracked clip, working out which way round the golfer stands
        when not told.

        Handedness reaches only a few of the model's inputs, so a first pass either
        way finds the top well enough to ask the body: at the top a right-hander's
        hands are over the right shoulder. If the first pass finds no swing at all,
        the other way round gets its own chance before anything is refused.
        """

        def run(hand: Handedness) -> SwingAnalysis:
            config = AnalysisConfig(handedness=hand, calibration=self.calibration)
            return analyse_pose_sequence(sequence, model, config, video=video)

        if handedness is not None:
            return run(handedness)
        analysis = run(Handedness.RIGHT)
        if isinstance(analysis.events, NoReading):
            other = run(Handedness.LEFT)
            return analysis if isinstance(other.events, NoReading) else other
        top = int(analysis.event_source_frames[int(SwingEvent.TOP)])
        called = infer_handedness(sequence.xy, sequence.visibility, top)
        if called is not None and called[0] is not Handedness.RIGHT:
            other = run(called[0])
            if not isinstance(other.events, NoReading):
                return other
        return analysis

    def _extract_pose(self, path: Path, job: Job) -> tuple[PoseSequence, VideoInfo]:
        with VideoReader(path) as reader:
            job.frames_expected = max(0, reader.declared_frames)

            def frames() -> Iterator[tuple[NDArray[np.uint8], float]]:
                yield from reader.frames(max_side=POSE_MAX_SIDE, max_rate_hz=POSE_MAX_RATE_HZ)

            def progress(done: int) -> None:
                job.frames_done = done

            _, estimator = self._ensure_loaded()
            sequence = estimator.estimate_stream(frames(), on_progress=progress)
            info = reader.describe_stream(sequence.n_frames, sequence.timestamps_s)
        return sequence, info


def record_swing(
    store: SwingStore,
    analysis: SwingAnalysis,
    sequence: PoseSequence,
    video_path: Path,
    source_name: str,
    label: str | None = None,
    club: str | None = None,
) -> int:
    """Store an analysis and write the images the interface needs to show it.

    Shared by the web upload and the command line so that a swing analysed either
    way looks the same afterwards. Having the terminal produce a row the interface
    then renders without pictures is the kind of small inconsistency that makes
    software feel unfinished.
    """
    swing_id = store.add(
        analysis, source_name=source_name, video_path=video_path, label=label, club=club
    )
    # The landmarks are kept for every swing, refused or not, so positions the
    # golfer sets can be measured without tracking the clip again.
    with contextlib.suppress(Exception):
        save_pose(sequence, frames_dir() / str(swing_id))
    if isinstance(analysis.events, NoReading):
        return swing_id

    directory = frames_dir() / str(swing_id)
    events = analysis.event_source_frames
    times = sequence.timestamps_s
    # The strip runs from half a second before address to a quarter after the
    # finish, every tracked frame of it, so a position the model placed wrongly
    # can be moved to the right frame - including an address it put too late.
    first = int(np.searchsorted(times, times[events[0]] - STRIP_LEAD_S))
    last = int(np.searchsorted(times, times[events[-1]] + STRIP_TAIL_S, side="right")) - 1
    strip = strip_frames(sequence, first, last, STRIP_MAX_FRAMES)
    # One read of the clip for both sets of pictures.
    images: dict[int, NDArray[np.uint8]] = {}
    with contextlib.suppress(Exception):
        images = frames_at(video_path, sequence, sorted(set(strip) | set(events)))
    with contextlib.suppress(Exception):
        extract_event_frames(video_path, sequence, events, directory, images=images)
    with contextlib.suppress(Exception):
        manifest = extract_sequence_frames(
            video_path,
            sequence,
            first_frame=first,
            last_frame=last,
            destination=directory,
            max_frames=STRIP_MAX_FRAMES,
            crop_frames=list(events),
            images=images,
        )
        (directory / "sequence.json").write_text(json.dumps(manifest), encoding="utf-8")
    return swing_id


def save_upload(stream: IO[bytes], original_name: str) -> Path:
    """Copy an uploaded file somewhere durable, keeping its extension.

    The clip is kept rather than deleted after analysis. Being able to look at the
    swing again, and to re-analyse it when the model improves, is worth more than
    the disk it costs - and re-running the whole archive is how any change to the
    analyser gets checked.
    """
    suffix = Path(original_name).suffix.lower() or ".mp4"
    target = videos_dir() / f"{uuid.uuid4().hex}{suffix}"
    with target.open("wb") as handle:
        shutil.copyfileobj(stream, handle)
    return target


def event_frame_files(swing_id: int) -> dict[str, str]:
    """Which annotated frames exist for a stored swing."""
    directory = frames_dir() / str(swing_id)
    if not directory.is_dir():
        return {}
    found: dict[str, str] = {}
    for event in SwingEvent.ordered():
        name = f"{int(event)}_{event.name.lower()}.jpg"
        if (directory / name).is_file():
            found[event.name] = name
    return found


def sequence_manifest(swing_id: int) -> list[dict[str, object]]:
    """The scrubbable strip for a stored swing, empty if it was never written."""
    path = frames_dir() / str(swing_id) / "sequence.json"
    if not path.is_file():
        return []
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return loaded if isinstance(loaded, list) else []


def analysis_from_row(payload: dict[str, object]) -> SwingAnalysis:
    return SwingAnalysis.model_validate(payload)


def event_pictures_from_strip(swing_id: int, event_frames: tuple[int, ...]) -> None:
    """Point the eight position pictures at the strip's frames after a move.

    The strip already holds every tracked frame around the swing, drawn and
    cropped, so a moved position needs no second read of the clip. A position
    outside the strip loses its picture rather than keeping one of the wrong
    moment.
    """
    directory = frames_dir() / str(swing_id)
    by_frame = {int(str(item["frame"])): str(item["name"]) for item in sequence_manifest(swing_id)}
    for event in SwingEvent.ordered():
        target = directory / f"{int(event)}_{event.name.lower()}.jpg"
        source = by_frame.get(int(event_frames[int(event)]))
        if source is not None and (directory / source).is_file():
            shutil.copyfile(directory / source, target)
        else:
            target.unlink(missing_ok=True)
