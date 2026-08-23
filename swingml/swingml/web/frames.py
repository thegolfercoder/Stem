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


def extract_event_frames(
    video_path: Path | str,
    sequence: PoseSequence,
    event_frames: tuple[int, ...],
    destination: Path,
    max_height: int = 640,
) -> dict[str, str]:
    """Write one annotated JPEG per event. Returns event name to file name.

    Seeking is attempted first and checked, because seeking in a
    variable-frame-rate clip is not always exact and some builds of OpenCV will
    happily return the wrong frame. If the seek lands somewhere else, the clip is
    read forward from the start instead - slower, but right.
    """
    destination.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise OSError(f"could not reopen {video_path} to extract frames")

    if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
        capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)

    wanted = {int(frame): SwingEvent(index) for index, frame in enumerate(event_frames)}
    written: dict[str, str] = {}
    collected: dict[int, NDArray[np.uint8]] = {}

    seek_works = True
    for frame_index in sorted(wanted):
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        landed = int(capture.get(cv2.CAP_PROP_POS_FRAMES))
        ok, image = capture.read()
        if not ok or abs(landed - frame_index) > 1:
            seek_works = False
            break
        collected[frame_index] = np.asarray(image, dtype=np.uint8)

    if not seek_works:
        collected.clear()
        capture.release()
        capture = cv2.VideoCapture(str(video_path))
        if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
            capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
        index = 0
        while collected.keys() != wanted.keys():
            ok, raw = capture.read()
            if not ok:
                break
            if index in wanted:
                collected[index] = np.asarray(raw, dtype=np.uint8)
            index += 1
    capture.release()

    if not collected:
        return written

    sample = next(iter(collected.values()))
    height, width = sample.shape[:2]
    box = body_crop(sequence, [f for f in collected if f < sequence.n_frames], width, height)
    left, top, box_width, box_height = box

    for frame_index, image in sorted(collected.items()):
        event = wanted[frame_index]
        pose_frame = min(frame_index, sequence.n_frames - 1)
        annotated = draw_pose(image, sequence, pose_frame)
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


def extract_sequence_frames(
    video_path: Path | str,
    sequence: PoseSequence,
    first_frame: int,
    last_frame: int,
    destination: Path,
    max_frames: int = 72,
    max_height: int = 560,
    crop_frames: list[int] | None = None,
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
    first = max(0, first_frame)
    last = min(last_frame, sequence.n_frames - 1)
    if last <= first:
        return []

    span = last - first + 1
    step = max(1, span // max_frames + (1 if span % max_frames else 0))
    wanted = list(range(first, last + 1, step))
    if wanted[-1] != last:
        wanted.append(last)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return []
    if hasattr(cv2, "CAP_PROP_ORIENTATION_AUTO"):
        capture.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)

    # Read forward rather than seeking. The frames wanted are consecutive-ish and
    # seeking a variable-frame-rate clip is not dependable.
    collected: dict[int, NDArray[np.uint8]] = {}
    target = set(wanted)
    index = 0
    while index <= last:
        ok, raw = capture.read()
        if not ok:
            break
        if index in target:
            collected[index] = np.asarray(raw, dtype=np.uint8)
        index += 1
    capture.release()
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
