"""The page itself, driven in a real browser.

Everything else in this repository tests arithmetic. This tests the part that
turned out to be far more dangerous: the four hundred lines of interface around
it, which had no test of any kind and shipped two faults that made the whole
thing useless.

The first was that the page could not display anything. `.hidden` in that file is
a CSS class setting display:none, and the script set the `hidden` property, which
removes an attribute those elements never had. The two elements affected were the
progress bar and the error banner - so the page had no way to say what it was
doing and no way to say what had gone wrong. A user added a file and saw nothing,
whatever happened underneath.

The second was that every wait on a video event was a promise with no way out, so
a clip the browser could not decode hung forever without settling, the catch
never ran, and a busy flag stayed set which killed every later attempt too.

Neither is subtle. Both survived because nothing ever opened the page and looked.
So this opens the page and looks: does the progress appear, does the result
appear, does a failure appear, and does the number on the screen match the number
the Python pipeline computes for the same clip.

The pose estimator is replaced by one that replays landmarks the real estimator
produced for the fixture clip. That is the only substitution - it is thirty
megabytes fetched from a CDN, and what is under test here is the page, not
Google's model. Everything downstream of the landmarks is the real code.

The video is generated rather than committed: solid frames at the right rate and
count, a few tens of kilobytes, in a codec the headless browser can open. Its
content does not matter, because the landmarks come from the stub. What matters
is that the page has a real file to step through, since stepping video frame by
frame is where both faults lived.
"""

from __future__ import annotations

import contextlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.events import SwingEvent
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness

HERE = Path(__file__).parent
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"
PAGE = HERE.parent / "out" / "web" / "swing-analysis.html"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"

cv2 = pytest.importorskip("cv2", reason="needs opencv to generate a clip")
sync_playwright = pytest.importorskip(
    "playwright.sync_api", reason="needs playwright to drive a browser"
).sync_playwright

pytestmark = pytest.mark.skipif(
    not PAGE.is_file() or not LANDMARKS.is_file(),
    reason="needs the built page (python scripts/build_web_app.py) and the fixture",
)

CHROMIUM = "/opt/pw-browsers/chromium"

# A stand-in for the MediaPipe module, replaying the landmarks the real estimator
# produced for this clip. Frames are handed out in order, which is what the page
# asks for as it steps through the video.
STUB = """
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = { createFromOptions: async () => {
  const data = window.__LANDMARKS__;
  let i = 0;
  return { detectForVideo() {
    const f = Math.min(i++, data.detected.length - 1);
    if (!data.detected[f]) return { landmarks: [], worldLandmarks: [] };
    return {
      landmarks: [data.xy[f].map((p, k) => (
        { x: p[0], y: p[1], visibility: data.visibility[f][k], presence: 1 }))],
      worldLandmarks: [data.world[f].map((p) => ({ x: p[0], y: p[1], z: p[2] }))],
    };
  } };
} };
"""


@pytest.fixture(scope="module")
def sequence() -> PoseSequence:
    data = np.load(LANDMARKS)
    return PoseSequence(
        xy=data["xy"],
        visibility=data["visibility"],
        timestamps_s=data["timestamps_s"],
        frame_width=int(data["frame_width"]),
        frame_height=int(data["frame_height"]),
        world_xyz=data["world_xyz"],
        detected=data["detected"],
    )


@pytest.fixture(scope="module")
def clip(sequence: PoseSequence, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A video with the fixture's frame count and rate, and nothing else.

    The pixels are never looked at - the pose comes from the stub - so this only
    has to decode and hold still for the right number of frames. Written in VP8
    because the headless browser used here has no H.264, which is itself worth
    knowing: it is the same missing-codec failure an iPhone clip hits on a
    desktop, and the reason the page has to explain that case rather than stall.
    """
    path = tmp_path_factory.mktemp("page") / "clip.webm"
    height, width = 426, 240
    rate = 1.0 / float(np.median(np.diff(sequence.timestamps_s)))
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"VP80"), rate, (width, height))
    assert writer.isOpened(), "could not open a VP8 writer"
    for index in range(sequence.n_frames):
        writer.write(np.full((height, width, 3), (index % 11) * 20, np.uint8))
    writer.release()
    return path


@pytest.fixture(scope="module")
def landmark_json(sequence: PoseSequence) -> str:
    world = (
        sequence.world_xyz
        if sequence.world_xyz is not None
        else np.zeros((sequence.n_frames, 33, 3))
    )
    return json.dumps(
        {
            "xy": sequence.xy.tolist(),
            "visibility": sequence.visibility.tolist(),
            "world": world.tolist(),
            "detected": [bool(v) for v in np.asarray(sequence.detected).ravel()],
        }
    )


class Session:
    """One page, opened and driven, with what it did recorded."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.states: list[str] = []
        self.summary = ""
        self.tempo: float | None = None
        self.spread = ""
        self.labels: list[str] = []
        self.bands: list[str] = []
        self.refused = False
        self.refusal_title = ""
        self.refusal_reason = ""
        self.diagnostics = ""
        self.working_appeared = False


def run_page(
    landmark_json: str, clip: Path | None, *, estimator: str = "stub", timeout: int = 300_000
) -> Session:
    """Open the page, hand it a file, and watch what it does."""
    session = Session()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROMIUM)
        page = browser.new_page(viewport={"width": 1180, "height": 900})
        page.on("pageerror", lambda error: session.errors.append(str(error)))
        page.on(
            "console",
            lambda message: (
                session.errors.append(message.text) if message.type == "error" else None
            ),
        )
        if estimator == "stub":
            page.route(
                "**/vision_bundle.mjs",
                lambda route: route.fulfill(status=200, content_type="text/javascript", body=STUB),
            )
        else:
            # Refused outright rather than left to the real network. Whether a CDN
            # is reachable is a property of whoever is running the tests, and a
            # check that passes only on a machine with no internet is not a check.
            page.route("**/vision_bundle.mjs", lambda route: route.abort())
        page.add_init_script(f"window.__LANDMARKS__ = {landmark_json};")
        page.goto(PAGE.resolve().as_uri())

        page.set_input_files("input[type=file]", str(clip))
        # Visibility as the browser computes it, not the presence of an
        # attribute. The fault this is here for was an element that had the
        # attribute removed and stayed invisible because a class still said
        # display:none, so asking about the attribute would have been fooled in
        # exactly the same way the code was.
        try:
            page.wait_for_selector("#working", state="visible", timeout=15_000)
            session.working_appeared = True
        except Exception:
            session.working_appeared = False

        # Whichever comes first, asked as a question about what is on screen.
        #
        # Waiting only for the result meant a run that correctly refused sat here
        # until the timeout expired. Waiting for "#results, #refusal" was worse:
        # a comma selector resolves to the first match in document order, which is
        # the refusal, so a *successful* run then waited out the whole timeout
        # instead - five minutes a suite. offsetParent is null for anything not
        # being rendered, which is the property actually wanted and is immune to
        # which of the two hiding mechanisms is in use.
        with contextlib.suppress(Exception):
            page.wait_for_function(
                """() => {
                    const shown = (id) => {
                        const node = document.getElementById(id);
                        return Boolean(node) && node.offsetParent !== null;
                    };
                    return shown("results") || shown("refusal");
                }""",
                timeout=timeout,
            )

        if page.locator("#refusal").is_visible():
            session.refused = True
            session.refusal_title = page.text_content("#refusal-title") or ""
            session.refusal_reason = page.text_content("#refusal-reason") or ""
            session.diagnostics = page.text_content("#refusal-diagnostics") or ""
        if page.locator("#results").is_visible():
            session.summary = page.text_content("#summary") or ""
            session.labels = [
                (text or "").replace("*", "").strip()
                for text in page.eval_on_selector_all(
                    ".frame-label", "nodes => nodes.map(n => n.textContent)"
                )
            ]
            session.bands = page.eval_on_selector_all(
                ".frame-band", "nodes => nodes.map(n => n.textContent)"
            )
            value = page.eval_on_selector(".metric-value", "node => node.textContent")
            session.tempo = float(value)
            ranges = page.eval_on_selector_all(
                ".metric-range", "nodes => nodes.map(n => n.textContent.trim())"
            )
            session.spread = ranges[0] if ranges else ""
        browser.close()
    return session


@pytest.fixture(scope="module")
def analysed(landmark_json: str, clip: Path) -> Session:
    return run_page(landmark_json, clip)


@pytest.fixture(scope="module")
def python_side(sequence: PoseSequence) -> Any:
    """What the desktop pipeline makes of the same landmarks, same weights."""
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    model = load_model(Path(payload["source_model"]))
    return analyse_pose_sequence(sequence, model, AnalysisConfig(handedness=Handedness.RIGHT))


def test_the_page_says_it_is_working(analysed: Session) -> None:
    """The assertion that the display fault would have failed outright.

    A page that is thinking has to look like a page that is thinking. Whatever
    else goes right, if this is false a user has no way to tell a slow run from a
    dead one.
    """
    assert analysed.working_appeared


def test_the_page_produces_a_result(analysed: Session) -> None:
    assert not analysed.refused, f"{analysed.refusal_title}: {analysed.refusal_reason}"
    assert analysed.summary, "results are showing but the clip summary is empty"


def test_the_page_runs_without_scripting_errors(analysed: Session) -> None:
    assert analysed.errors == []


def test_all_eight_positions_are_drawn_and_named(analysed: Session) -> None:
    assert analysed.labels == [event.label for event in SwingEvent.ordered()]


def test_every_position_carries_its_measured_band(analysed: Session) -> None:
    """The page embeds a calibration, so the bands must actually reach the screen.

    They are looked up per event from the model's confidence, so eight of them
    appearing is also a check that the lookup ran for every event rather than
    falling over silently after the first.
    """
    assert len(analysed.bands) == 8
    assert all("ms" in band for band in analysed.bands)


def test_the_page_and_the_python_pipeline_report_the_same_tempo(
    analysed: Session, python_side: Any
) -> None:
    """The number on the screen against the number the library computes.

    The parity test compares the two implementations directly; this compares what
    a person actually reads. Between the two sits the frame stepping, and a fault
    there once sent the clip down a slower path that returned a tempo a quarter
    out while every other check still passed.
    """
    metrics = python_side.metrics
    assert not isinstance(metrics, NoReading)
    assert not isinstance(metrics.tempo_ratio, NoReading)
    assert analysed.tempo is not None
    # The page rounds to two places, so half a unit of that - 0.005 - is already
    # spent before the two pipelines have disagreed about anything at all. The
    # bound is that plus room for the difference between them, which the parity
    # test pins at about 1e-5. Setting it to exactly 0.005 made a correct pair of
    # values fail whenever the true one landed near a rounding boundary, which
    # this clip does: 2.20489 displays as 2.21 from the browser's own arithmetic.
    assert abs(analysed.tempo - metrics.tempo_ratio.value) <= 0.006, (
        f"page {analysed.tempo}, library {metrics.tempo_ratio.value}"
    )


def test_the_tempo_is_shown_with_its_measured_spread(analysed: Session) -> None:
    assert "measured spread" in analysed.spread


def test_the_fast_frame_path_is_the_one_that_ran(analysed: Session) -> None:
    """Not the seek fallback, which is slower and slightly less accurate.

    The page says which it used. It once fell back on every clip, because pausing
    inside the frame callback rejects the outstanding play() with an AbortError
    and that self-inflicted abort was being treated as a failure. Everything still
    produced numbers, so nothing failed - the numbers were just worse.
    """
    assert "read by seeking" not in analysed.summary


def test_a_page_that_cannot_reach_the_estimator_says_so(landmark_json: str, clip: Path) -> None:
    """The other half of the display fault: a failure has to be visible too.

    With no stub the module request goes to the real CDN, which is unreachable
    from a test environment - the same shape as a firewall, an offline laptop or
    a blocked host. The page must come back with a refusal that names the problem
    and carries the diagnostics line, rather than sitting there.
    """
    session = run_page(landmark_json, clip, estimator="unreachable", timeout=90_000)
    assert session.working_appeared
    assert session.refused, "an unreachable estimator produced no visible error"
    assert "estimator" in session.refusal_reason.lower()
    assert session.refusal_title != "No swing was found in this clip", (
        "a tool failure was reported as a judgement about the swing"
    )
    assert "frame callback" in session.diagnostics


def test_a_file_the_browser_cannot_decode_is_reported_rather_than_hung(
    landmark_json: str, tmp_path: Path
) -> None:
    """The failure that actually happened to somebody, reproduced.

    A clip the browser will not open used to hang the page forever: the wait on
    loadedmetadata was a promise that resolved on that event and had no other way
    out, so when neither it nor an error arrived, nothing settled, the catch never
    ran, and a busy flag stayed set which killed every later attempt as well. The
    report was "I added the file and nothing happened", which was exactly right.

    Bytes that are not a video stand in for the real case, which is an iPhone HEVC
    clip on a desktop without the codec. The page cannot tell those apart and
    should not try: either way it could not open the file, and it has to say so.

    The timeout here is deliberately short. The point is not only that a message
    appears but that it appears promptly, because a page that takes five minutes
    to admit defeat is a page that looks broken.
    """
    path = tmp_path / "not-really-a-video.mov"
    path.write_bytes(b"\x00\x01\x02\x03" * 4096)

    session = run_page(landmark_json, path, timeout=45_000)
    assert session.working_appeared
    assert session.refused, "an undecodable file produced no visible error"
    assert session.refusal_title != "No swing was found in this clip", (
        "a file the browser could not open was reported as a swing that was not found"
    )
    # Names the likely cause and what to do about it, rather than only failing.
    assert "could not open" in session.refusal_reason.lower()
    assert "hevc" in session.refusal_reason.lower()
