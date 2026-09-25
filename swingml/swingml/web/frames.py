"""Pulling the eight event frames back out of a clip, with the pose drawn on.

Analysis streams the video and throws every frame away, which is what makes it
work on clips of any length. That leaves nothing to show, so the frames worth
looking at are fetched afterwards in a second pass - eight seeks rather than a
whole decode, and only the frames a person will actually look at.

Drawing is done with OpenCV rather than matplotlib. Matplotlib would mean a
figure, a canvas and a render for each of eight images on every upload; OpenCV
draws onto the array that is already in hand.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from swingml.events import SwingEvent
from swingml.pose.base import PoseSequence
from swingml.skeleton import BONES, Landmark
from swingml.video.reader import VideoReader

BONE_COLOUR = (255, 214, 92)  # BGR
JOINT_COLOUR = (60, 200, 255)
SHADOW_COLOUR = (18, 18, 22)
MIN_VISIBILITY = 0.3


def draw_pose(image: NDArray[np.uint8], sequence: PoseSequence, frame: int) -> NDArray[np.uint8]:
    """Draw the skeleton for one frame onto a copy of the image."""
    canvas = image.copy()
    height, width = canvas.shape[:2]
    points = sequence.xy[frame].astype(np.float64).copy()
    points[:, 0] *= width
    points[:, 1] *= height
    visibility = sequence.visibility[frame]

    thickness = max(3, round(min(width, height) / 190))
    # Draw a dark stroke under every bone first. Without it the skeleton vanishes
    # against light clothing or a bright sky, which is most outdoor golf footage.
    for pass_colour, pass_width in ((SHADOW_COLOUR, thickness + 3), (BONE_COLOUR, thickness)):
        for start, end in BONES:
            if min(visibility[int(start)], visibility[int(end)]) < MIN_VISIBILITY:
                continue
            cv2.line(
                canvas,
                (round(points[int(start), 0]), round(points[int(start), 1])),
                (round(points[int(end), 0]), round(points[int(end), 1])),
                pass_colour,
                pass_width,
                cv2.LINE_AA,
            )
    for index in range(points.shape[0]):
        if visibility[index] < MIN_VISIBILITY:
            continue
        centre = (round(points[index, 0]), round(points[index, 1]))
        cv2.circle(canvas, centre, thickness + 2, SHADOW_COLOUR, -1, cv2.LINE_AA)
        cv2.circle(canvas, centre, thickness, JOINT_COLOUR, -1, cv2.LINE_AA)
    return canvas


def body_crop(
    sequence: PoseSequence, frames: list[int], width: int, height: int, margin: float = 0.16
) -> tuple[int, int, int, int]:
    """A single crop box that contains the golfer across all the given frames.

    One box for all eight rather than one each, so the images can be flicked
    through without the golfer jumping around inside the frame.
    """
    visible_points: list[NDArray[np.float64]] = []
    for frame in frames:
        points = sequence.xy[frame].astype(np.float64)
        visible = sequence.visibility[frame] >= MIN_VISIBILITY
        if visible.any():
            visible_points.append(points[visible])
    if not visible_points:
        return 0, 0, width, height

    stacked = np.concatenate(visible_points, axis=0)
    x0, y0 = stacked.min(axis=0)
    x1, y1 = stacked.max(axis=0)
    pad_x = (x1 - x0) * margin
    pad_y = (y1 - y0) * margin

    left = max(0.0, x0 - pad_x) * width
    right = min(1.0, x1 + pad_x) * width
    top = max(0.0, y0 - pad_y) * height
    bottom = min(1.0, y1 + pad_y) * height

    if right - left < 32 or bottom - top < 32:
        return 0, 0, width, height
    return round(left), round(top), round(right - left), round(bottom - top)


def frames_at(
    video_path: Path | str, sequence: PoseSequence, frames: list[int]
) -> dict[int, NDArray[np.uint8]]:
    """The video frames behind the given frames of the tracked sequence, as BGR.

    Matched by time, not by position. A clip faster than sixty frames a second
    is tracked at sixty, so frame n of the sequence is frame 4n of a 240 fps
    clip; fetching by position showed a slow-motion swing at the wrong moment
    with another moment's skeleton on it. The clip is read with the same reader
    and the same clock the tracker used, forward rather than by seeking, because
    seeking a variable-frame-rate clip is not dependable.
    """
    wanted = sorted({f for f in frames if 0 <= f < sequence.n_frames})
    if not wanted:
        return {}
    times = {f: float(sequence.timestamps_s[f]) for f in wanted}
    last_time = max(times.values())
    best: dict[int, tuple[float, NDArray[np.uint8]]] = {}
    with VideoReader(video_path) as reader:
        for rgb, time_s in reader.frames():
            for frame, target in times.items():
                gap = abs(time_s - target)
                if frame not in best or gap < best[frame][0]:
                    best[frame] = (gap, rgb)
            if time_s > last_time + 0.05:
                break
    return {
        frame: np.asarray(cv2.cvtColor(image, cv2.COLOR_RGB2BGR), dtype=np.uint8)
        for frame, (_, image) in best.items()
    }


def extract_event_frames(
    video_path: Path | str,
    sequence: PoseSequence,
    event_frames: tuple[int, ...],
    destination: Path,
    max_height: int = 640,
    images: dict[int, NDArray[np.uint8]] | None = None,
) -> dict[str, str]:
    """Write one annotated JPEG per event. Returns event name to file name.

    `event_frames` index the tracked sequence; `frames_at` finds the video frames
    behind them, unless `images` already holds them from a shared read.
    """
    destination.mkdir(parents=True, exist_ok=True)
    wanted = {int(frame): SwingEvent(index) for index, frame in enumerate(event_frames)}
    written: dict[str, str] = {}
    collected = (
        {f: images[f] for f in wanted if f in images}
        if images is not None
        else frames_at(video_path, sequence, list(wanted))
    )
    if not collected:
        return written

    sample = next(iter(collected.values()))
    height, width = sample.shape[:2]
    box = body_crop(sequence, [f for f in collected if f < sequence.n_frames], width, height)
    left, top, box_width, box_height = box

    for frame_index, image in sorted(collected.items()):
        event = wanted[frame_index]
        annotated = draw_pose(image, sequence, frame_index)
        cropped: NDArray[np.uint8] = annotated[top : top + box_height, left : left + box_width]
        if cropped.shape[0] > max_height:
            scale = max_height / cropped.shape[0]
            cropped = np.asarray(
                cv2.resize(
                    cropped,
                    (round(cropped.shape[1] * scale), max_height),
                    interpolation=cv2.INTER_AREA,
                ),
                dtype=np.uint8,
            )
        name = f"{int(event)}_{event.name.lower()}.jpg"
        cv2.imwrite(str(destination / name), cropped, [cv2.IMWRITE_JPEG_QUALITY, 88])
        written[event.name] = name

    return written


def strip_frames(
    sequence: PoseSequence, first_frame: int, last_frame: int, max_frames: int
) -> list[int]:
    """Which tracked frames the scrubbing strip shows: all of them, if they fit."""
    first = max(0, first_frame)
    last = min(last_frame, sequence.n_frames - 1)
    if last <= first:
        return []
    span = last - first + 1
    step = max(1, span // max_frames + (1 if span % max_frames else 0))
    wanted = list(range(first, last + 1, step))
    if wanted[-1] != last:
        wanted.append(last)
    return wanted


def extract_sequence_frames(
    video_path: Path | str,
    sequence: PoseSequence,
    first_frame: int,
    last_frame: int,
    destination: Path,
    max_frames: int = 72,
    max_height: int = 560,
    crop_frames: list[int] | None = None,
    images: dict[int, NDArray[np.uint8]] | None = None,
) -> list[dict[str, float | str | int]]:
    """Write the swing itself as a strip of images, for scrubbing through.

    A video element would be the obvious way to show the swing back, and it is the
    wrong one here for two reasons. Browsers cannot play every codec a phone
    produces - HEVC in particular - so the player is a black rectangle often
    enough to matter. And HTML video seeking is not frame accurate, which is
    precisely what somebody looking at a golf swing needs it to be.

    A strip of images has neither problem. It plays anywhere, every step is exactly
    one frame, and the whole swing is a second or two, so the cost is small. The
    original file stays downloadable for anyone who wants it.

    Returns a manifest of what was written, in order.
    """
    destination.mkdir(parents=True, exist_ok=True)
    wanted = strip_frames(sequence, first_frame, last_frame, max_frames)
    if not wanted:
        return []
    collected = (
        {f: images[f] for f in wanted if f in images}
        if images is not None
        else frames_at(video_path, sequence, wanted)
    )
    if not collected:
        return []

    sample = next(iter(collected.values()))
    height, width = sample.shape[:2]
    box_source = crop_frames if crop_frames else list(collected)
    left, top, box_width, box_height = body_crop(
        sequence, [f for f in box_source if f < sequence.n_frames], width, height
    )

    manifest: list[dict[str, float | str | int]] = []
    for order, frame_index in enumerate(sorted(collected)):
        annotated = draw_pose(collected[frame_index], sequence, frame_index)
        cropped: NDArray[np.uint8] = annotated[top : top + box_height, left : left + box_width]
        if cropped.shape[0] > max_height:
            scale = max_height / cropped.shape[0]
            cropped = np.asarray(
                cv2.resize(
                    cropped,
                    (round(cropped.shape[1] * scale), max_height),
                    interpolation=cv2.INTER_AREA,
                ),
                dtype=np.uint8,
            )
        name = f"seq_{order:03d}.jpg"
        cv2.imwrite(str(destination / name), cropped, [cv2.IMWRITE_JPEG_QUALITY, 82])
        manifest.append(
            {
                "name": name,
                "frame": int(frame_index),
                "time_s": float(sequence.timestamps_s[frame_index]),
            }
        )
    return manifest


def hand_path_overlay(
    sequence: PoseSequence, handedness_wrist: Landmark, start: int, end: int
) -> list[tuple[float, float]]:
    """The lead hand's path across the swing, in normalised image coordinates.

    Drawn over the impact frame in the interface. It is the one part of a swing a
    still image cannot show and a golfer immediately recognises.
    """
    path: list[tuple[float, float]] = []
    for frame in range(max(0, start), min(end + 1, sequence.n_frames)):
        if sequence.visibility[frame, int(handedness_wrist)] < MIN_VISIBILITY:
            continue
        x, y = sequence.xy[frame, int(handedness_wrist)]
        path.append((float(x), float(y)))
    return path
