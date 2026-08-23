"""Drawing a generated swing as video, to exercise the real pose estimator.

The point is not photorealism, which is out of reach and would not be believed
anyway. The point is that everything between the video file and the metrics -
the reader, the pose estimator, the resampling, the features, the model, the
decoder - can be run end to end on an input whose answer is known exactly, rather
than tested in pieces and hoped to compose.

A pose estimator trained on photographs of people will do worse on a rendered
figure than on a real golfer, so nothing here is evidence about accuracy on real
footage. It is evidence that the pipeline is wired up correctly, which is a
different and much cheaper thing to be sure of, and it is the part that is
usually wrong.
"""

from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict

from swingml.skeleton import Landmark
from synth.camera import CameraConfig
from synth.swing import GeneratedSwing

SKIN = (196, 158, 130)
SHIRT = (188, 196, 204)
TROUSERS = (70, 78, 92)
SHOE = (30, 30, 34)
CLUB = (188, 188, 192)


class RenderConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    grass_colour: tuple[int, int, int] = (86, 122, 62)
    sky_colour: tuple[int, int, int] = (168, 190, 214)
    horizon_fraction: float = 0.42
    draw_club: bool = True
    jpeg_like_noise: float = 3.0


def _project(
    points: NDArray[np.float64], camera: CameraConfig
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    from synth.camera import _look_at

    centre = np.array([0.0, camera.look_at_height_m, 0.0])
    azimuth = np.radians(camera.azimuth_deg)
    elevation = np.radians(camera.elevation_deg)
    offset = np.array(
        [
            -np.sin(azimuth) * np.cos(elevation),
            np.sin(elevation),
            -np.cos(azimuth) * np.cos(elevation),
        ]
    )
    camera_pos = centre + camera.distance_m * offset
    rotation = _look_at(camera_pos, centre, np.radians(camera.roll_deg))
    local = (points - camera_pos) @ rotation.T
    depth = np.maximum(local[..., 2], 1e-3)
    u = camera.focal_px * local[..., 0] / depth + camera.frame_width / 2.0
    v = camera.focal_px * local[..., 1] / depth + camera.frame_height / 2.0
    return np.stack([u, v], axis=-1), depth


def _limb(
    image: NDArray[np.uint8],
    start: NDArray[np.float64],
    end: NDArray[np.float64],
    thickness: int,
    colour: tuple[int, int, int],
) -> None:
    a = (round(start[0]), round(start[1]))
    b = (round(end[0]), round(end[1]))
    cv2.line(image, a, b, colour, thickness, cv2.LINE_AA)
    cv2.circle(image, a, thickness // 2, colour, -1, cv2.LINE_AA)
    cv2.circle(image, b, thickness // 2, colour, -1, cv2.LINE_AA)


def render_swing_video(
    swing: GeneratedSwing,
    camera: CameraConfig | None = None,
    config: RenderConfig | None = None,
    seed: int = 0,
) -> NDArray[np.uint8]:
    """Render the whole swing to a stack of RGB frames."""
    camera = camera or CameraConfig()
    config = config or RenderConfig()
    rng = np.random.default_rng(seed)

    points, depth = _project(swing.pose.landmarks_xyz, camera)
    hands, _ = _project(swing.pose.hands_xyz, camera)
    clubhead, _ = _project(swing.pose.clubhead_xyz, camera)

    width, height = camera.frame_width, camera.frame_height
    horizon = int(height * config.horizon_fraction)
    n_frames = points.shape[0]

    # Limb thickness scales with the figure's size on screen, so the render looks
    # consistent whether the camera is close or far.
    torso_px = np.median(
        np.linalg.norm(points[:, Landmark.LEFT_SHOULDER] - points[:, Landmark.LEFT_HIP], axis=-1)
    )
    unit = max(torso_px / 5.0, 2.0)

    frames = np.empty((n_frames, height, width, 3), dtype=np.uint8)
    for index in range(n_frames):
        image = np.empty((height, width, 3), dtype=np.uint8)
        image[:horizon] = config.sky_colour
        image[horizon:] = config.grass_colour

        p = points[index]
        d = depth[index]

        def draw(
            a: Landmark,
            b: Landmark,
            thickness: float,
            colour: tuple[int, int, int],
            image: NDArray[np.uint8] = image,
            p: NDArray[np.float64] = p,
        ) -> None:
            _limb(image, p[int(a)], p[int(b)], max(int(thickness), 1), colour)

        # Back to front: whichever side is further from the camera is drawn first,
        # so the near arm and leg overlap the far ones as they should.
        left_first = d[Landmark.LEFT_SHOULDER] > d[Landmark.RIGHT_SHOULDER]
        sides = (
            (
                Landmark.LEFT_SHOULDER,
                Landmark.LEFT_ELBOW,
                Landmark.LEFT_WRIST,
                Landmark.LEFT_HIP,
                Landmark.LEFT_KNEE,
                Landmark.LEFT_ANKLE,
                Landmark.LEFT_FOOT_INDEX,
            ),
            (
                Landmark.RIGHT_SHOULDER,
                Landmark.RIGHT_ELBOW,
                Landmark.RIGHT_WRIST,
                Landmark.RIGHT_HIP,
                Landmark.RIGHT_KNEE,
                Landmark.RIGHT_ANKLE,
                Landmark.RIGHT_FOOT_INDEX,
            ),
        )
        order = sides if left_first else sides[::-1]

        for shoulder, elbow, wrist, hip, knee, ankle, toe in order[:1]:
            draw(hip, knee, unit * 1.5, TROUSERS)
            draw(knee, ankle, unit * 1.2, TROUSERS)
            draw(ankle, toe, unit * 1.1, SHOE)
            draw(shoulder, elbow, unit * 1.0, SHIRT)
            draw(elbow, wrist, unit * 0.85, SKIN)

        # Torso as a filled quadrilateral, which reads as a body rather than a stick.
        torso = np.array(
            [
                p[Landmark.LEFT_SHOULDER],
                p[Landmark.RIGHT_SHOULDER],
                p[Landmark.RIGHT_HIP],
                p[Landmark.LEFT_HIP],
            ]
        ).astype(np.int32)
        cv2.fillConvexPoly(image, torso, SHIRT, cv2.LINE_AA)
        draw(Landmark.LEFT_SHOULDER, Landmark.RIGHT_SHOULDER, unit * 1.6, SHIRT)
        draw(Landmark.LEFT_HIP, Landmark.RIGHT_HIP, unit * 1.6, TROUSERS)

        for shoulder, elbow, wrist, hip, knee, ankle, toe in order[1:]:
            draw(hip, knee, unit * 1.5, TROUSERS)
            draw(knee, ankle, unit * 1.2, TROUSERS)
            draw(ankle, toe, unit * 1.1, SHOE)
            draw(shoulder, elbow, unit * 1.0, SHIRT)
            draw(elbow, wrist, unit * 0.85, SKIN)

        neck = 0.5 * (p[Landmark.LEFT_SHOULDER] + p[Landmark.RIGHT_SHOULDER])
        head = 0.5 * (p[Landmark.LEFT_EAR] + p[Landmark.RIGHT_EAR])
        draw_head_radius = max(int(unit * 1.35), 3)
        _limb(image, neck, head, max(int(unit * 0.9), 1), SKIN)
        cv2.circle(
            image,
            (round(head[0]), round(head[1])),
            draw_head_radius,
            SKIN,
            -1,
            cv2.LINE_AA,
        )
        nose = p[Landmark.NOSE]
        cv2.circle(
            image,
            (round(nose[0]), round(nose[1])),
            max(int(unit * 0.3), 1),
            (120, 90, 74),
            -1,
            cv2.LINE_AA,
        )

        if config.draw_club:
            _limb(image, hands[index], clubhead[index], max(int(unit * 0.28), 1), CLUB)

        if config.jpeg_like_noise > 0:
            noise = rng.normal(0.0, config.jpeg_like_noise, image.shape)
            image = np.clip(image.astype(np.float64) + noise, 0, 255).astype(np.uint8)

        frames[index] = image

    return frames


def write_video(frames: NDArray[np.uint8], path: str, fps: float) -> None:
    """Write RGB frames to an mp4."""
    height, width = frames.shape[1], frames.shape[2]
    fourcc = getattr(cv2, "VideoWriter_fourcc", None) or cv2.VideoWriter.fourcc
    writer = cv2.VideoWriter(path, fourcc(*"mp4v"), fps, (width, height))
    try:
        for frame in frames:
            writer.write(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
    finally:
        writer.release()
