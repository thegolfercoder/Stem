"""The strike in the phone's audio track: the camera's own clock reading at impact.

Video frames come every 4 ms at 240 fps and every 33 ms at 30 fps, and the
camera never sees the club meet the ball cleanly in any of them. The phone's
microphone hears it: a ball strike is the sharpest sound of the swing, and the
audio is sampled at 44.1 or 48 kHz on the same clock as the frames. That makes
it the best single reference for placing the video on the shot's timeline.

Two things stand between the sound and the strike, and both are stated rather
than hidden:

* **Sound travel.** At 343 m/s, each metre between ball and phone is 2.9 ms:
  4.1 ms for a phone on the ground unit 1.4 m behind the ball, 8.7 ms for one
  on a tripod 3 m back. Fusion removes it when the distance is known (by
  default the unit's configured distance, `shot.camera_on_the_unit`), and says
  so when it is not.
* **Audio-to-video sync in the file.** Phones keep the two tracks aligned to
  within a few milliseconds, but a phone that does not is not detectable from
  the audio alone. swingml's own impact event is compared against it for that
  reason.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field

from launchmon.quantity import NoReading, Provenance, Quantity, Reading


class AudioImpactConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    envelope_s: float = Field(default=0.0005, description="Smoothing of the transient envelope.")
    snr: float = Field(
        default=20.0,
        description="The strike must stand this far above the clip's median transient level.",
    )
    onset_fraction: float = Field(
        default=0.25,
        description="Onset is where the envelope first reaches this fraction of its peak.",
    )
    search_s: float = Field(
        default=0.25,
        description="Half-width of the search around an expected impact, when one is given.",
    )


def impact_transient_time(
    audio: NDArray[np.floating],
    sample_rate_hz: float,
    config: AudioImpactConfig | None = None,
    expected_s: float | None = None,
) -> Reading:
    """Onset time of the sharpest transient in the clip (or near `expected_s`), in seconds."""
    config = config or AudioImpactConfig()
    x = np.asarray(audio, dtype=np.float64)
    if x.ndim != 1 or x.size < 64:
        return NoReading(reason="no usable audio track", source="camera-audio")
    # First difference emphasises the broadband click of a strike over speech,
    # wind and the low rumble of handling the phone.
    hp = np.abs(np.diff(x))
    n_env = max(1, round(config.envelope_s * sample_rate_hz))
    env = np.convolve(hp, np.ones(n_env) / n_env, mode="same")
    t = (np.arange(env.size) + 0.5) / sample_rate_hz
    if expected_s is not None:
        win = np.flatnonzero(np.abs(t - expected_s) <= config.search_s)
    else:
        win = np.arange(env.size)
    if win.size == 0:
        return NoReading(reason="the search window falls outside the audio", source="camera-audio")
    i_peak = int(win[np.argmax(env[win])])
    peak, floor = float(env[i_peak]), float(np.median(env))
    if floor > 0 and peak < config.snr * floor:
        return NoReading(
            reason="no transient in the audio stands clear enough to be the strike",
            source="camera-audio",
        )
    lead = max(0, i_peak - round(0.02 * sample_rate_hz))
    above = np.flatnonzero(env[lead : i_peak + 1] >= config.onset_fraction * peak)
    onset = lead + int(above[0])
    return Quantity(
        value=float(t[onset]), unit="s", provenance=Provenance.MEASURED, source="camera-audio"
    )


def read_audio(video_path: Path | str, sample_rate_hz: int = 48_000) -> NDArray[np.float64]:
    """The clip's audio as mono floats, decoded by ffmpeg (which must be on PATH)."""
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is needed to read audio from a video file")
    raw = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate_hz),
            "-f",
            "s16le",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
