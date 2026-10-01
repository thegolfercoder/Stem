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

The page is built from `webapp/` when this module loads, into a directory of its
own. Driving `out/web/swing-analysis.html` instead tested whatever was last built
there: stale, it failed correct code and could pass old code (#24).
"""

from __future__ import annotations

import atexit
import base64
import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.events import SwingEvent
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading
from swingml.skeleton import Handedness
from tests.browser import chromium_path
from tests.mirror import mirrored

HERE = Path(__file__).parent
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"
PAYLOAD = HERE.parent / "out" / "web" / "model.json"

cv2 = pytest.importorskip("cv2", reason="needs opencv to generate a clip")
CHROMIUM = chromium_path()


def _missing() -> str | None:
    if CHROMIUM is None:
        return "needs playwright and a Chromium (python -m tests.browser says which)"
    if not PAYLOAD.is_file():
        return "needs the exported weights (python scripts/export_web_model.py)"
    if not LANDMARKS.is_file():
        return "needs the fixture tests/fixtures/real_swing_01.npz"
    return None


def _build_page() -> Path:
    """The page as the tree builds it now (about a tenth of a second)."""
    where = Path(tempfile.mkdtemp(prefix="stem-page-"))
    atexit.register(shutil.rmtree, where, ignore_errors=True)
    page = where / "swing-analysis.html"
    subprocess.run(
        [sys.executable, str(HERE.parent / "scripts" / "build_web_app.py"),
         "--model", str(PAYLOAD), "--source", str(HERE.parent / "webapp"), "--out", str(page)],
        check=True, capture_output=True,
    )  # fmt: skip
    return page


MISSING = _missing()
PAGE = _build_page() if MISSING is None else HERE / "no-page.html"
# CI and agents/check.sh set this where a browser is installed, so a page test that
# cannot run there fails the run instead of skipping unseen.
if MISSING and os.environ.get("STEM_PAGE_TESTS") == "required":
    raise RuntimeError(f"the page tests are required here but cannot run: {MISSING}")
pytestmark = pytest.mark.skipif(MISSING is not None, reason=MISSING or "")
if MISSING is None:
    from playwright.sync_api import sync_playwright

# A stand-in for the MediaPipe module, replaying the landmarks the real estimator
# produced for this clip. Frames are handed out in order, which is what the page
# asks for as it steps through the video.
STUB = """
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const PoseLandmarker = { createFromOptions: async () => {
  const data = window.__LANDMARKS__;
  let i = 0;
  // Each new clip replays the fixture from its first frame (practice tests
  // analyse the same clip more than once).
  window.__resetLandmarks = () => { i = 0; };
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
    return landmarks_of(sequence)


def landmarks_of(sequence: PoseSequence) -> str:
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
        self.band_note = ""
        self.caveats: list[str] = []
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
            session.band_note = page.text_content("#band-note") or ""
            session.caveats = page.eval_on_selector_all(
                ".metric-caveat", "nodes => nodes.map(n => n.textContent)"
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


def test_the_band_note_says_what_the_shipped_table_does(analysed: Session) -> None:
    """The page's calibration has one band per event, so it must not say a doubtful
    event gets a wider band (#30)."""
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    assert not any(payload["calibration"]["events"]["confidence_edges"])
    assert "measured, not assumed" in analysed.band_note
    assert "wider band" not in analysed.band_note
    assert "every swing gets the same band" in analysed.band_note


def test_a_right_hander_is_not_told_the_band_is_not_theirs(analysed: Session) -> None:
    assert analysed.caveats == []


def test_a_left_hander_is_told_the_band_was_not_measured_for_them(
    sequence: PoseSequence, clip: Path
) -> None:
    """The fixture mirrored: the page finds a left-hander and says what the band is (#33)."""
    session = run_page(landmarks_of(mirrored(sequence)), clip)
    assert not session.refused, session.refusal_reason
    assert session.spread, "no tempo band shown"
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    assert session.caveats == [payload["notes"]["left_handed_tempo_band"]]


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
    # Five percent, and the reason it is not tighter is worth writing down.
    #
    # These two do not read the clip the same way. The page steps a re-encoded
    # video and takes each frame's presentation time from the container; the
    # library is handed the fixture's stored timestamps. Those grids differ by a
    # fraction of a frame, which occasionally moves one event by a whole frame -
    # and at thirty frames a second a downswing is ten frames, so one frame is ten
    # percent of the denominator. A two percent disagreement here is two
    # implementations agreeing, not disagreeing.
    #
    # Exact agreement given identical input is a real requirement and is tested,
    # in test_browser_parity, to within 1e-5. What this bound is for is the
    # failure that actually happened: frame stepping falling back to a slower path
    # and shifting tempo by a quarter, which five percent catches easily.
    assert abs(analysed.tempo - metrics.tempo_ratio.value) / metrics.tempo_ratio.value <= 0.05, (
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


# -- the practice section ------------------------------------------------------------

MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14"
KEPT = "() => JSON.parse(localStorage.getItem('swing-practice-v1') || 'null')"


# Site data blocked, as a private window or a browser setting does: reading
# localStorage throws.
BLOCK_STORAGE = """Object.defineProperty(window, "localStorage", { configurable: true,
  get() { throw new DOMException("The user denied storage", "SecurityError"); } });"""


def _earlier() -> list[dict[str, Any]]:
    """Two earlier swings of the same golfer, so one more makes three and the page
    offers a focus to practise."""
    return [
        {"id": n, "at": "2026-09-29T10:00:00Z", "ok": True, "refusal": None,
         "detection_rate": 0.99, "handedness": "right", "club": None, "camera": None,
         "metrics": {"tempo_ratio": tempo, "detection_rate": 0.99}, "slowed_by": None,
         "clip_key": f"earlier-{n}"}
        for n, tempo in ((1, 3.2), (2, 3.4))
    ]  # fmt: skip


def _practice_page(
    playwright: Any,
    landmark_json: str,
    assets: dict[str, Any] | None = None,
    kept: dict[str, Any] | None = None,
    *,
    block_storage: bool = False,
) -> Any:
    browser = playwright.chromium.launch(executable_path=CHROMIUM)
    # A context of its own, so a test can open a second page on the same storage.
    page = browser.new_context(viewport={"width": 1180, "height": 900}).new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.route(
        "**/vision_bundle.mjs",
        lambda route: route.fulfill(status=200, content_type="text/javascript", body=STUB),
    )
    page.add_init_script(f"window.__LANDMARKS__ = {landmark_json};")
    if assets is not None:
        page.add_init_script(f"window.SWING_ASSETS = {json.dumps(assets)};")
    if kept is not None:
        # Seeded once: init scripts run again on every reload.
        page.add_init_script(
            "if (localStorage.getItem('swing-practice-v1') === null) "
            f"localStorage.setItem('swing-practice-v1', {json.dumps(json.dumps(kept))});"
        )
    if block_storage:
        page.add_init_script(BLOCK_STORAGE)
    page.goto(PAGE.resolve().as_uri())
    return browser, page, errors


def _analyse(page: Any, clip: Path) -> None:
    page.evaluate("() => window.__resetLandmarks && window.__resetLandmarks()")
    page.set_input_files("input[type=file]", str(clip))
    page.wait_for_function(
        "() => document.getElementById('working').classList.contains('hidden')"
        " && (document.getElementById('results').offsetParent !== null"
        " || document.getElementById('refusal').offsetParent !== null)",
        timeout=300_000,
    )


def test_the_practice_log_keeps_one_swing_per_clip_and_can_forget_one(
    landmark_json: str, clip: Path
) -> None:
    """#22: one clip analysed again is one swing, and a kept swing can be removed."""
    with sync_playwright() as playwright:
        browser, page, errors = _practice_page(
            playwright, landmark_json, kept={"next": 3, "swings": _earlier(), "plans": []}
        )
        _analyse(page, clip)
        kept = page.evaluate(KEPT)
        assert [s["id"] for s in kept["swings"]] == [1, 2, 3] and kept["swings"][2]["ok"]
        assert kept["swings"][2]["clip_key"], "the clip was not fingerprinted"

        page.click("#priority-panel [data-focus]")  # start a focus as a plan
        plan = page.evaluate(KEPT)["plans"][0]
        assert plan["status"] == "active" and 3 in plan["baseline"]
        assert page.is_checked("#for-plan")

        # The same file again, with the retest box ticked: replaced, not added,
        # and not counted as a retest swing of its own plan.
        _analyse(page, clip)
        page.wait_for_function(f"() => ({KEPT})().swings[2].reread_at")
        kept = page.evaluate(KEPT)
        assert len(kept["swings"]) == 3
        assert kept["plans"][0]["retest"] == []
        assert "replaced" in (page.text_content("#practice-data") or "")

        page.click("details.kept summary")
        page.click("[data-remove='3']")
        kept = page.evaluate(KEPT)
        assert [s["id"] for s in kept["swings"]] == [1, 2]
        assert 3 not in kept["plans"][0]["baseline"] and kept["plans"][0]["retest"] == []
        assert errors == []
        browser.close()


def test_the_sample_swing_is_not_kept(landmark_json: str, clip: Path) -> None:
    """#22: the page's demonstration clip is not the golfer's swing."""
    sample = "data:video/webm;base64," + base64.b64encode(clip.read_bytes()).decode("ascii")
    assets = {"mediapipe": MEDIAPIPE_CDN, "model": [],
              "sample": [{"src": sample, "type": "video/webm"}]}  # fmt: skip
    with sync_playwright() as playwright:
        browser, page, errors = _practice_page(playwright, landmark_json, assets)
        page.wait_for_selector("#sample", state="visible")
        page.click("#sample")
        page.wait_for_function(
            "() => document.getElementById('results').offsetParent !== null"
            " || document.getElementById('refusal').offsetParent !== null",
            timeout=300_000,
        )
        assert page.locator("#results").is_visible(), "the sample swing was not analysed"
        kept = page.evaluate(KEPT)
        assert kept is None or kept["swings"] == []
        assert errors == []
        browser.close()


def test_a_plan_counts_a_retest_clip_survives_a_reload_and_is_erased(
    landmark_json: str, clip: Path, tmp_path: Path
) -> None:
    """#24: a plan's whole life on the page, through app.js's wiring, not only practice.js."""
    retest = tmp_path / "retest.webm"  # another file, so another clip
    shutil.copy(clip, retest)
    with sync_playwright() as playwright:
        browser, page, errors = _practice_page(
            playwright, landmark_json, kept={"next": 3, "swings": _earlier(), "plans": []}
        )
        _analyse(page, clip)
        page.click("#priority-panel [data-focus]")
        assert page.is_checked("#for-plan")

        # A new clip with the box ticked is kept and counted as a retest swing.
        _analyse(page, retest)
        kept = page.evaluate(KEPT)
        assert [s["id"] for s in kept["swings"]] == [1, 2, 3, 4]
        assert 3 in kept["plans"][0]["baseline"] and kept["plans"][0]["retest"] == [4]

        # Coming back to the page shows the plan and its retest swing straight away.
        page.reload()
        page.wait_for_selector("#plan-panel .practice-card", state="visible")
        plan_text = page.text_content("#plan-panel") or ""
        assert "Your plan" in plan_text and "Retest swings" in plan_text
        assert page.locator("#for-plan-box").is_visible()

        # Erasing asks for the word, and a near miss deletes nothing.
        page.click("#practice-erase")
        page.fill("#erase-typed", "erase")
        page.click("#erase-go")
        assert len(page.evaluate(KEPT)["swings"]) == 4
        page.fill("#erase-typed", "ERASE")
        page.click("#erase-go")
        kept = page.evaluate(KEPT)
        assert kept is None or (kept["swings"] == [] and kept["plans"] == [])
        assert (page.text_content("#plan-panel") or "").strip() == ""
        assert errors == []
        browser.close()


def test_with_storage_blocked_the_page_still_analyses_and_keeps_nothing(
    landmark_json: str, clip: Path
) -> None:
    """#24: blocked site data costs the practice log, not the analysis."""
    with sync_playwright() as playwright:
        browser, page, errors = _practice_page(playwright, landmark_json, block_storage=True)
        _analyse(page, clip)
        assert page.locator("#results").is_visible(), "the clip was not analysed"
        assert "not letting the page keep anything" in (page.text_content("#practice-data") or "")
        assert page.locator("#practice-erase").count() == 0
        assert errors == []
        # The same browser profile without the block: nothing was written.
        other = page.context.new_page()
        other.goto(PAGE.resolve().as_uri())
        assert other.evaluate(KEPT) is None
        browser.close()


def test_a_refused_rerun_keeps_the_earlier_reading_and_says_so(
    landmark_json: str, clip: Path
) -> None:
    """#26: a run that is refused does not wipe out the clip's analysed reading."""
    with sync_playwright() as playwright:
        browser, page, errors = _practice_page(
            playwright, landmark_json, kept={"next": 3, "swings": _earlier(), "plans": []}
        )
        _analyse(page, clip)
        good = page.evaluate(KEPT)["swings"][2]
        assert good["ok"] and good["metrics"]["tempo_ratio"] is not None
        # The same clip again, with no body found in any frame this time.
        page.evaluate("() => window.__LANDMARKS__.detected.fill(false)")
        _analyse(page, clip)
        assert page.locator("#refusal").is_visible(), "the second run was not refused"
        kept = page.evaluate(KEPT)
        assert len(kept["swings"]) == 3 and kept["swings"][2] == good
        assert "swing 3 keeps its earlier reading" in (page.text_content("#practice-data") or "")
        assert errors == []
        browser.close()


# -- recording in the page (#34) -----------------------------------------------------


@pytest.fixture(scope="module")
def fake_camera(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A Y4M file Chromium plays as the camera: 30 fps, portrait, moving bars."""
    width, height, frames = 240, 428, 30
    path = tmp_path_factory.mktemp("camera") / "camera.y4m"
    with path.open("wb") as out:
        out.write(f"YUV4MPEG2 W{width} H{height} F30:1 Ip A1:1 C420jpeg\n".encode())
        for f in range(frames):
            luma = np.full((height, width), 60, dtype=np.uint8)
            luma[:, (f * 8) % width : (f * 8) % width + 20] = 200
            chroma = np.full((height // 2, width // 2), 128, dtype=np.uint8)
            out.write(b"FRAME\n" + luma.tobytes() + chroma.tobytes() + chroma.tobytes())
    return path


def _camera_page(playwright: Any, landmark_json: str, camera: Path | None) -> Any:
    args = ["--use-fake-device-for-media-stream"]
    if camera is not None:
        args += ["--use-fake-ui-for-media-stream", f"--use-file-for-fake-video-capture={camera}"]
    else:
        args += ["--deny-permission-prompts"]
    browser = playwright.chromium.launch(executable_path=CHROMIUM, args=args)
    page = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
    errors: list[str] = []
    requests: list[tuple[str, str, int]] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "request",
        lambda r: requests.append((r.method, r.url, len(r.post_data_buffer or b""))),
    )
    page.route(
        "**/vision_bundle.mjs",
        lambda route: route.fulfill(status=200, content_type="text/javascript", body=STUB),
    )
    page.add_init_script(f"window.__LANDMARKS__ = {landmark_json};")
    # A short countdown and a recording as long as the fixture, so the test is quick.
    page.add_init_script("window.__recordCountdown = 0; window.__recordSeconds = 7;")
    page.goto(PAGE.resolve().as_uri())
    return browser, page, errors, requests


def test_a_swing_recorded_in_the_page_is_analysed_and_never_sent(
    landmark_json: str, fake_camera: Path
) -> None:
    with sync_playwright() as playwright:
        browser, page, errors, requests = _camera_page(playwright, landmark_json, fake_camera)
        page.wait_for_selector("#record", state="visible")
        page.click("#record")
        page.wait_for_function(
            "() => document.getElementById('rec-preview').videoWidth > 0", timeout=20_000
        )
        rate = page.text_content("#rec-rate") or ""
        assert "fps" in rate
        if int(rate.split()[0]) < 50:
            assert page.locator("#rec-rate-note").is_visible()
            assert "At 30 fps" in (page.text_content("#rec-rate-note") or "")
        page.click("#rec-start")
        page.evaluate("() => window.__resetLandmarks && window.__resetLandmarks()")
        page.wait_for_selector("#rec-stop", state="visible", timeout=10_000)
        page.wait_for_function(
            "() => document.getElementById('working').classList.contains('hidden')"
            " && (document.getElementById('results').offsetParent !== null"
            " || document.getElementById('refusal').offsetParent !== null)",
            timeout=300_000,
        )
        assert page.locator("#recorder").is_hidden(), "the camera panel stayed open"
        assert page.locator("#results").is_visible(), page.text_content("#refusal-reason")
        assert (page.text_content("#drop-main") or "").startswith("swing-")
        assert errors == []
        # Nothing left the page: no request carried a body, and none went off this machine.
        assert all(size == 0 for _, _, size in requests), requests
        assert all(
            url.startswith(("file:", "data:", "blob:")) or url.endswith("vision_bundle.mjs")
            for _, url, _ in requests
        ), [u for _, u, _ in requests]
        browser.close()


def test_a_refused_camera_falls_back_to_choosing_a_video(landmark_json: str, clip: Path) -> None:
    with sync_playwright() as playwright:
        browser, page, errors, _ = _camera_page(playwright, landmark_json, None)
        page.wait_for_selector("#record", state="visible")
        page.click("#record")
        page.wait_for_function(
            "() => /Choose a video/.test(document.getElementById('rec-message').textContent)",
            timeout=20_000,
        )
        assert page.locator("#rec-start").is_hidden()
        assert page.locator("#rec-stage").is_hidden()
        # The upload path still works.
        _analyse(page, clip)
        assert page.locator("#results").is_visible()
        assert errors == []
        browser.close()


NO_OVERFLOW = "() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"


def test_on_a_phone_the_one_thing_to_practise_comes_first(landmark_json: str, clip: Path) -> None:
    """#37: at 360 px the summary card leads the results and nothing scrolls sideways."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=CHROMIUM)
        page = browser.new_context(viewport={"width": 360, "height": 740}).new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route(
            "**/vision_bundle.mjs",
            lambda route: route.fulfill(status=200, content_type="text/javascript", body=STUB),
        )
        page.add_init_script(f"window.__LANDMARKS__ = {landmark_json};")
        page.goto(PAGE.resolve().as_uri())
        assert page.evaluate(NO_OVERFLOW), "the empty page scrolls sideways at 360 px"
        assert page.locator("#bar-analyse").is_visible()

        _analyse(page, clip)
        assert page.locator("#results").is_visible(), page.text_content("#refusal-reason")
        assert page.evaluate(NO_OVERFLOW), "the results scroll sideways at 360 px"
        first = page.evaluate(
            "() => [...document.getElementById('results').children]"
            ".find((n) => n.offsetParent !== null).id"
        )
        assert first == "summary-card"

        # The card repeats what is below; it does not say anything new.
        tempo = (page.text_content("#sum-tempo") or "").strip()
        assert tempo and (page.text_content("#tempo-cards .metric-value") or "").startswith(tempo)
        assert page.locator("#sum-shot canvas").count() == 1
        assert "measured spread" in (page.text_content("#sum-range") or "")
        assert page.locator(".summary-card .prov-derived").is_visible()
        assert page.locator("#sum-priority").is_visible()
        assert page.text_content("#sum-priority-title") == page.text_content("#priority-panel h3")

        # The detail sections are folded on a phone, all still on the page, and
        # one opened stays opened in this browser.
        assert page.locator("details.fold[open]").count() == 0
        assert page.locator("#tempo-cards .metric").count() >= 3
        page.click("details.fold[data-fold='tempo'] > summary")
        assert page.locator("#tempo-cards").is_visible()
        assert json.loads(page.evaluate("() => localStorage.getItem('swing-folds-v1')")) == {
            "tempo": True
        }
        assert page.evaluate(NO_OVERFLOW)
        assert page.locator("#bar-practice").is_visible()
        for button in page.locator(".action-bar button:visible, .summary-card .btn:visible").all():
            box = button.bounding_box()
            assert box is not None and box["height"] >= 44, button.text_content()

        page.set_viewport_size({"width": 1280, "height": 800})
        assert page.locator("#action-bar").is_hidden()
        assert page.evaluate(NO_OVERFLOW)
        assert errors == []
        browser.close()
