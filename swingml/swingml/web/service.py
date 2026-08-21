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
from typing import IO

import numpy as np
from numpy.typing import NDArray

from swingml.analysis import AnalysisConfig, SwingAnalysis, analyse_pose_sequence, load_model
from swingml.assets import find_event_model, home
from swingml.events import SwingEvent
from swingml.model.tcn import SwingEventNet
from swingml.pose.base import PoseSequence
from swingml.pose.mediapipe_pose import MediaPipePoseEstimator
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from swingml.store import SwingStore
from swingml.video.reader import VideoInfo, VideoReader
from swingml.web.frames import extract_event_frames, extract_sequence_frames


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
        self.model_path = model_path or find_event_model()
        self._jobs: dict[str, Job] = {}
        self._jobs_lock = threading.Lock()
        self._model_lock = threading.Lock()
        self._run_lock = threading.Lock()
        self._model: SwingEventNet | None = None
        self._estimator: MediaPipePoseEstimator | None = None

    # -- readiness ---------------------------------------------------------

    def ready(self) -> tuple[bool, str]:
        """Whether an analysis could run right now, and what is missing if not."""
        if self.model_path is None or not Path(self.model_path).is_file():
            return False, (
                "No trained swing model found. Train one with "
                "'python scripts/train_events.py', or set $SWINGML_EVENT_MODEL."
            )
        return True, "ready"

    def warm_up(self) -> None:
        """Build the model and estimator now rather than on the first upload."""
        self._ensure_loaded()

    def _ensure_loaded(self) -> tuple[SwingEventNet, MediaPipePoseEstimator]:
        with self._model_lock:
            if self._model is None:
                ok, why = self.ready()
                if not ok:
                    raise RuntimeError(why)
                assert self.model_path is not None
                self._model = load_model(Path(self.model_path))
            if self._estimator is None:
                self._estimator = MediaPipePoseEstimator()
        assert self._estimator is not None
        return self._model, self._estimator

    # -- jobs --------------------------------------------------------------

    def submit(
        self,
        upload_path: Path,
        original_name: str,
        handedness: Handedness,
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
        handedness: Handedness,
        club: str | None,
        label: str | None,
    ) -> None:
        try:
            with self._run_lock:
                job.state = JobState.READING
                job.message = "loading the model"
                model, _ = self._ensure_loaded()
                assert isinstance(model, SwingEventNet)

                job.message = "finding the body in each frame"
                sequence, video_info = self._extract_pose(upload_path, job)

                job.state = JobState.ANALYSING
                job.message = "finding the swing"
                analysis = analyse_pose_sequence(
                    sequence,
                    model,
                    AnalysisConfig(handedness=handedness),
                    video=video_info,
                )

                job.state = JobState.RENDERING
                job.message = "saving the key frames"
                swing_id = self.store.add(
                    analysis,
                    source_name=original_name,
                    video_path=upload_path,
                    label=label,
                    club=club,
                )
                if not isinstance(analysis.events, NoReading):
                    # A missing thumbnail is a cosmetic failure; the analysis is
                    # already stored and is the thing that matters.
                    directory = frames_dir() / str(swing_id)
                    with contextlib.suppress(Exception):
                        extract_event_frames(
                            upload_path,
                            sequence,
                            analysis.event_source_frames,
                            directory,
                        )
                    with contextlib.suppress(Exception):
                        events = analysis.event_source_frames
                        manifest = extract_sequence_frames(
                            upload_path,
                            sequence,
                            first_frame=events[0],
                            last_frame=events[-1],
                            destination=directory,
                            crop_frames=list(events),
                        )
                        (directory / "sequence.json").write_text(
                            json.dumps(manifest), encoding="utf-8"
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

    def _extract_pose(self, path: Path, job: Job) -> tuple[PoseSequence, VideoInfo]:
        with VideoReader(path) as reader:
            job.frames_expected = max(0, reader.declared_frames)

            def frames() -> Iterator[tuple[NDArray[np.uint8], float]]:
                yield from reader.frames()

            def progress(done: int) -> None:
                job.frames_done = done

            _, estimator = self._ensure_loaded()
            sequence = estimator.estimate_stream(frames(), on_progress=progress)
            info = reader.describe_stream(sequence.n_frames, sequence.timestamps_s)
        return sequence, info


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
