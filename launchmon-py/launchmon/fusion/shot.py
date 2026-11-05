"""One shot from three sensors.

The timeline
------------
Every time in a fused shot is in seconds from impact. Each sensor finds the
strike on its own clock, and that becomes its zero:

* **Radar** - impact from the capture itself (spectral flux and the ball
  band's onset), on the ground unit's clock. When it has one, it defines the
  timeline.
* **Club IMU** - the shock in the accelerometer, searched for near the radar's
  impact as mapped over the Bluetooth clock offset. What is left between the
  two is the residual of that mapping, and is reported.
* **Phone camera** - the strike in the video's sound, corrected for sound
  travel when the distance is known; failing that, swingml's own impact
  event, which is coarser.

If the radar refused, the IMU's shock defines zero; if both did, the camera's.
Which sensor defined it, and how every other sensor was placed, travels with
the result.

Which sensor answers what
-------------------------
| Quantity | First choice | Then | Why |
|---|---|---|---|
| impact | radar | IMU, camera | sub-millisecond onset in the radar's band |
| top | IMU | camera | the shaft's rotation reverses: a sharp minimum at 1.66 kHz |
| takeaway (address) | IMU | camera | the rotation leaves rest |
| the other five events | camera | - | only the camera sees the body and the club's angle |
| ball speed, clubhead speed | radar | - | measured along the radar's line of sight |
| shaft rotation rate | IMU | - | measured; refused if the gyro clipped |

Where two sensors measure the same event they are compared, and a difference
beyond the camera's own frame time (or its measured error band, when swingml
was run with one) is reported as a disagreement. Disagreements do not change
any number; they say which numbers to look at.

What is modelled, and says so
-----------------------------
* **True ball speed** divides the radar's radial speed by the cosine of the
  angle between the ball's path and the radar's line of sight. That needs a
  launch angle. Until the camera measures one, it is the club's prior, and the
  result is MODELLED with that assumption attached.
* **Clubhead speed from the IMU** multiplies the shaft's rotation rate by a
  radius from the IMU's centre of rotation to the clubhead. That radius is a
  calibration, not a property of the club. The ratio of the radar's clubhead
  speed to the IMU's rotation rate measures it, shot by shot, and is reported
  as `effective_clubhead_radius` so it can be fitted.
* **Clubhead speed from a calibrated radius.** `fusion.calibration` keeps those
  measured radii per club. When the radar has no clubhead speed for a shot and
  the caller passes a usable calibration for the club, the IMU's clubhead speed
  uses the calibrated radius instead of the assumed one. It is then DERIVED,
  source `imu+calibration`, not MODELLED: both factors were measured, the rate
  on this shot and the radius on earlier ones. The calibration and the scatter
  it carries into the speed travel with the shot as `imu_speed_calibration`.
  When the radar has a clubhead speed nothing changes: the radar's is the
  primary number and the IMU's stays MODELLED as before.

Spin, face angle, club path, attack angle and swing plane are not outputs.
"""

from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer

from launchmon.config import ClubConfig, RadarGeometryConfig, cosine_correction_factor
from launchmon.dsp.pipeline import RadarResult
from launchmon.fusion.calibration import RadiusCalibration
from launchmon.fusion.camera import ADDRESS, CLUB_DEFINED, EVENT_NAMES, IMPACT, TOP, CameraSwing
from launchmon.imu.swing import ImuSwing, ImuSwingConfig, analyse_imu_swing
from launchmon.imu.trace import ImuTrace
from launchmon.quantity import NoReading, Provenance, Quantity, Reading

SPEED_OF_SOUND_MPS = 343.0


class FusionConfig(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    imu: ImuSwingConfig = ImuSwingConfig()
    camera_to_ball_m: float | None = Field(
        default=None,
        description=(
            "Distance from the phone to the ball, measured at setup. Removes sound "
            "travel from the audio impact. None leaves it in, and says so."
        ),
    )
    camera_tolerance_frames: float = Field(
        default=1.5,
        description=(
            "Camera events further than this many frame periods from another "
            "sensor's time for the same event are reported as disagreeing, unless "
            "swingml supplied a measured band, which is used instead."
        ),
    )
    plausible_backswing_s: tuple[float, float] = (0.30, 2.50)
    plausible_downswing_s: tuple[float, float] = (0.10, 1.00)
    plausible_tempo: tuple[float, float] = (1.2, 6.0)


class SensorAlignment(BaseModel):
    """How one sensor was placed on the shot's timeline."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    sensor: str
    method: str
    impact_on_own_clock_s: float
    notes: tuple[str, ...] = ()


class TimedEvent(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    event: str
    time_s: Reading = Field(description="Seconds from impact.")
    source: str
    alternatives: dict[str, float] = Field(
        default_factory=dict, description="Other sensors' times for the same event, s from impact."
    )


class Disagreement(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    event: str
    sensors: tuple[str, str]
    difference_ms: float
    tolerance_ms: float


class CalibratedImuSpeed(BaseModel):
    """The calibration behind a calibrated `clubhead_speed_from_imu`, and its scatter."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    calibration: RadiusCalibration
    speed_spread_mps: float = Field(
        description=(
            "One robust standard deviation of the speed, propagated from the radius: "
            "rate x the calibration's prediction spread. It is the scatter the club's "
            "own radar/IMU samples showed, which includes both sensors' per-shot noise; "
            "it is not an accuracy figure for the instrument."
        )
    )


class FusedShot(BaseModel):
    """One shot. Every number is a Reading: a Quantity with provenance, or a refusal."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    timeline_reference: str = Field(description="The sensor whose impact defines t = 0.")
    alignment: tuple[SensorAlignment, ...]
    events: tuple[TimedEvent, ...]

    ball_speed_radial: Reading
    ball_speed: Reading
    clubhead_speed_radial: Reading
    clubhead_speed_from_imu: Reading
    effective_clubhead_radius: Reading
    smash_factor: Reading
    peak_shaft_rate: Reading
    shaft_rate_at_impact: Reading

    backswing_duration: Reading
    downswing_duration: Reading
    tempo_ratio: Reading

    disagreements: tuple[Disagreement, ...] = ()
    camera_tempo_ratio: float | None = Field(
        default=None, description="swingml's tempo from the camera alone, for comparison."
    )
    imu_speed_calibration: CalibratedImuSpeed | None = Field(
        default=None,
        description=(
            "Present only when clubhead_speed_from_imu used a calibrated radius. Left out "
            "of exports when absent, so shots fused without a calibration export exactly "
            "as they always have."
        ),
    )

    @model_serializer(mode="wrap")
    def _omit_absent_calibration(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if self.imu_speed_calibration is None:
            data.pop("imu_speed_calibration", None)
        return data


def _no(reason: str, source: str = "fusion") -> NoReading:
    return NoReading(reason=reason, source=source)


def _seconds(value: float, source: str, assumptions: tuple[str, ...] = ()) -> Quantity:
    if assumptions:
        return Quantity(
            value=value,
            unit="s",
            provenance=Provenance.MODELLED,
            source=source,
            assumptions=assumptions,
        )
    return Quantity(value=value, unit="s", provenance=Provenance.MEASURED, source=source)


def fuse_shot(
    *,
    club: ClubConfig,
    geometry: RadarGeometryConfig,
    config: FusionConfig | None = None,
    radar: RadarResult | None = None,
    radar_capture_start_s: float | None = None,
    imu_trace: ImuTrace | None = None,
    camera: CameraSwing | None = None,
    camera_audio_impact_s: Reading | None = None,
    measured_launch_angle_deg: Reading | None = None,
    radius_calibration: RadiusCalibration | None = None,
) -> FusedShot:
    """Fuse whatever sensors this shot has. Any of them may be missing.

    Args:
        radar: the radar pipeline's result for the shot's capture.
        radar_capture_start_s: the capture's first sample on the ground unit's
            clock; `imu_trace` must be on that same clock (the ground unit maps
            pod samples onto it as they arrive).
        imu_trace: the pod's samples around the shot.
        camera: swingml's analysis of the phone clip.
        camera_audio_impact_s: the strike in the clip's audio, on the clip's clock.
        measured_launch_angle_deg: a measured launch angle, when one exists. Until
            then the club's prior is used and the true ball speed is MODELLED.
        radius_calibration: this club's calibrated clubhead radius
            (`CalibrationStore.calibration`), when one is usable. Used only when
            the radar has no clubhead speed for the shot; then the IMU's clubhead
            speed is DERIVED from it rather than MODELLED from the club's
            assumed radius.
    """
    config = config or FusionConfig()
    alignment: list[SensorAlignment] = []

    # --- Radar: impact on the ground clock -----------------------------------
    radar_impact: float | None = None
    if (
        radar is not None
        and radar_capture_start_s is not None
        and not isinstance(radar.segments, NoReading)
    ):
        radar_impact = radar_capture_start_s + radar.segments.impact_time_s
        alignment.append(
            SensorAlignment(
                sensor="radar",
                method="impact onset in the radar capture",
                impact_on_own_clock_s=radar_impact,
            )
        )

    # --- IMU: the shock, near the radar's impact when there is one -----------
    imu: ImuSwing | None = None
    imu_impact: float | None = None
    if imu_trace is not None:
        imu = analyse_imu_swing(imu_trace, config.imu, expected_impact_s=radar_impact)
        if isinstance(imu.impact_time_s, Quantity):
            imu_impact = imu.impact_time_s.value
            notes: tuple[str, ...] = ()
            if radar_impact is not None:
                notes = (
                    f"shock found {1000 * (imu_impact - radar_impact):+.1f} ms from the radar's "
                    "impact as mapped over the Bluetooth clock; that residual is the mapping's "
                    "error, removed here",
                )
            alignment.append(
                SensorAlignment(
                    sensor="imu",
                    method="impact shock in the accelerometer",
                    impact_on_own_clock_s=imu_impact,
                    notes=notes,
                )
            )

    # --- Camera: the strike in the audio, else swingml's impact event --------
    cam_impact: float | None = None
    cam_method = ""
    cam_notes: list[str] = []
    cam_times = camera.event_times_s if camera is not None else None
    if camera is not None:
        if isinstance(camera_audio_impact_s, Quantity):
            cam_impact = camera_audio_impact_s.value
            cam_method = "strike in the clip's audio"
            if config.camera_to_ball_m is not None:
                cam_impact -= config.camera_to_ball_m / SPEED_OF_SOUND_MPS
                cam_notes.append(f"sound travel over {config.camera_to_ball_m:.1f} m removed")
            else:
                cam_notes.append(
                    "sound travel not removed (camera distance not recorded): "
                    "about 2.9 ms per metre between ball and phone"
                )
            cam_notes.append("assumes the file's audio and video tracks are in sync")
        elif cam_times is not None:
            cam_impact = cam_times[IMPACT]
            cam_method = "swingml's impact event (frame-resolution)"
        if cam_impact is not None:
            alignment.append(
                SensorAlignment(
                    sensor="camera",
                    method=cam_method,
                    impact_on_own_clock_s=cam_impact,
                    notes=tuple(cam_notes),
                )
            )

    if radar_impact is not None:
        reference = "radar"
    elif imu_impact is not None:
        reference = "imu"
    elif cam_impact is not None:
        reference = "camera"
    else:
        reference = "none"

    # --- Each sensor's view of the events, in seconds from impact ------------
    imu_events: dict[int, float] = {}
    if imu is not None and imu_impact is not None:
        imu_events[IMPACT] = 0.0
        for idx, reading in ((TOP, imu.top_time_s), (ADDRESS, imu.takeaway_time_s)):
            if isinstance(reading, Quantity):
                imu_events[idx] = reading.value - imu_impact
    cam_events: dict[int, float] = {}
    if cam_times is not None and cam_impact is not None:
        cam_events = {i: t - cam_impact for i, t in enumerate(cam_times)}

    def camera_tolerance_ms(idx: int) -> float:
        assert camera is not None
        if camera.event_band_ms and idx < len(camera.event_band_ms):
            band = camera.event_band_ms[idx]
            if band is not None:
                return float(band)
        period = camera.frame_period_s or (1 / 30)
        return 1000.0 * config.camera_tolerance_frames * period

    events: list[TimedEvent] = []
    disagreements: list[Disagreement] = []
    for idx, name in enumerate(EVENT_NAMES):
        candidates: dict[str, float] = {}
        if idx == IMPACT and radar_impact is not None:
            candidates["radar"] = 0.0
        if idx in imu_events:
            candidates["imu"] = imu_events[idx]
        if idx in cam_events:
            candidates["camera"] = cam_events[idx]
        if not candidates:
            events.append(
                TimedEvent(event=name, time_s=_no("no sensor placed this event"), source="none")
            )
            continue
        chosen = next(s for s in ("radar", "imu", "camera") if s in candidates)
        assumptions: tuple[str, ...] = ()
        if chosen == "camera" and idx in CLUB_DEFINED:
            assumptions = (
                "placed by swingml's model from the body's timing; the pose "
                "estimator does not see the club",
            )
        events.append(
            TimedEvent(
                event=name,
                time_s=_seconds(candidates[chosen], chosen, assumptions),
                source=chosen,
                alternatives={k: v for k, v in candidates.items() if k != chosen},
            )
        )
        # Compare the camera against the sensor chosen. At impact the camera was
        # aligned by its own impact, so the comparison there is audio vs event.
        if "camera" in candidates and chosen != "camera" and idx != IMPACT:
            diff = 1000.0 * (candidates["camera"] - candidates[chosen])
            tol = camera_tolerance_ms(idx)
            if abs(diff) > tol:
                disagreements.append(
                    Disagreement(
                        event=name, sensors=(chosen, "camera"), difference_ms=diff, tolerance_ms=tol
                    )
                )
    if (
        camera is not None
        and cam_times is not None
        and cam_impact is not None
        and isinstance(camera_audio_impact_s, Quantity)
    ):
        diff = 1000.0 * (cam_times[IMPACT] - cam_impact)
        tol = camera_tolerance_ms(IMPACT)
        if abs(diff) > tol:
            disagreements.append(
                Disagreement(
                    event="impact",
                    sensors=("camera-audio", "camera"),
                    difference_ms=diff,
                    tolerance_ms=tol,
                )
            )

    # --- Durations and tempo from the chosen events ---------------------------
    def event_time(idx: int) -> float | None:
        r = events[idx].time_s
        return r.value if isinstance(r, Quantity) else None

    t_addr, t_top, t_imp = event_time(ADDRESS), event_time(TOP), event_time(IMPACT)
    sources = "+".join(sorted({events[i].source for i in (ADDRESS, TOP, IMPACT)}))
    backswing: Reading = _no("needs both the takeaway and the top")
    downswing: Reading = _no("needs both the top and impact")
    tempo: Reading = _no("needs the backswing and the downswing")
    if t_addr is not None and t_top is not None:
        b = t_top - t_addr
        lo, hi = config.plausible_backswing_s
        backswing = (
            Quantity(value=1000 * b, unit="ms", provenance=Provenance.MEASURED, source=sources)
            if lo <= b <= hi
            else _no(f"a {b:.2f} s backswing is not plausible")
        )
    if t_top is not None and t_imp is not None:
        d = t_imp - t_top
        lo, hi = config.plausible_downswing_s
        downswing = (
            Quantity(value=1000 * d, unit="ms", provenance=Provenance.MEASURED, source=sources)
            if lo <= d <= hi
            else _no(f"a {d:.2f} s downswing is not plausible")
        )
    if isinstance(backswing, Quantity) and isinstance(downswing, Quantity):
        ratio = backswing.value / downswing.value
        lo, hi = config.plausible_tempo
        tempo = (
            Quantity(value=ratio, unit="", provenance=Provenance.DERIVED, source=sources)
            if lo <= ratio <= hi
            else _no(f"a tempo of {ratio:.1f} is not plausible")
        )

    # --- Speeds ---------------------------------------------------------------
    no_radar = _no("no radar capture for this shot", "radar")
    ball_radial: Reading = radar.ball_launch_speed.reading if radar is not None else no_radar
    club_radial: Reading = radar.clubhead_speed if radar is not None else no_radar
    smash: Reading = radar.smash_factor if radar is not None else no_radar

    ball_speed: Reading
    if isinstance(ball_radial, NoReading):
        ball_speed = ball_radial
    elif isinstance(measured_launch_angle_deg, Quantity):
        factor = cosine_correction_factor(geometry, measured_launch_angle_deg.value, 0.0)
        ball_speed = Quantity(
            value=ball_radial.value / factor,
            unit="m/s",
            provenance=Provenance.DERIVED,
            source="radar+camera",
        )
    else:
        factor = cosine_correction_factor(geometry, club.launch_angle_prior_deg, 0.0)
        ball_speed = Quantity(
            value=ball_radial.value / factor,
            unit="m/s",
            provenance=Provenance.MODELLED,
            source="radar",
            assumptions=(
                f"launch angle {club.launch_angle_prior_deg:.1f} deg, the {club.name} prior, "
                "not a measurement",
                f"radar {geometry.range_from_tee_m:.2f} m behind the ball, phase centre "
                f"{geometry.height_m:.2f} m up, as recorded for the session",
            ),
        )

    rate = imu.shaft_rate_at_impact if imu is not None else _no("no IMU data for this shot", "imu")
    club_imu: Reading
    radius: Reading
    imu_calibration: CalibratedImuSpeed | None = None
    if isinstance(rate, NoReading):
        club_imu = rate
        radius = rate
    elif isinstance(club_radial, NoReading) and radius_calibration is not None:
        omega = math.radians(rate.value)
        cal = radius_calibration
        club_imu = Quantity(
            value=omega * cal.radius_m,
            unit="m/s",
            provenance=Provenance.DERIVED,
            source="imu+calibration",
            assumptions=(
                f"clubhead {cal.radius_m:.3f} m from the centre of rotation: the median of "
                f"{cal.n_samples} radar/IMU measurements for {cal.club!r} (robust spread "
                f"{cal.spread_m:.3f} m), taken to hold for this swing",
            ),
        )
        imu_calibration = CalibratedImuSpeed(
            calibration=cal, speed_spread_mps=omega * cal.prediction_spread_m()
        )
        radius = _no("needs the radar's clubhead speed and the IMU's rate at impact")
    else:
        omega = math.radians(rate.value)
        club_imu = Quantity(
            value=omega * club.clubhead_radius_m,
            unit="m/s",
            provenance=Provenance.MODELLED,
            source="imu",
            assumptions=(
                f"clubhead {club.clubhead_radius_m:.3f} m from the centre of rotation: a "
                "calibration, not a measurement (see effective_clubhead_radius)",
            ),
        )
        radius = (
            Quantity(
                value=club_radial.value / omega,
                unit="m",
                provenance=Provenance.DERIVED,
                source="radar+imu",
            )
            if isinstance(club_radial, Quantity) and omega > 0
            else _no("needs the radar's clubhead speed and the IMU's rate at impact")
        )

    peak = imu.peak_shaft_rate if imu is not None else _no("no IMU data for this shot", "imu")

    return FusedShot(
        timeline_reference=reference,
        alignment=tuple(alignment),
        events=tuple(events),
        ball_speed_radial=ball_radial,
        ball_speed=ball_speed,
        clubhead_speed_radial=club_radial,
        clubhead_speed_from_imu=club_imu,
        effective_clubhead_radius=radius,
        smash_factor=smash,
        peak_shaft_rate=peak,
        shaft_rate_at_impact=rate,
        backswing_duration=backswing,
        downswing_duration=downswing,
        tempo_ratio=tempo,
        disagreements=tuple(disagreements),
        camera_tempo_ratio=camera.tempo_ratio if camera is not None else None,
        imu_speed_calibration=imu_calibration,
    )
