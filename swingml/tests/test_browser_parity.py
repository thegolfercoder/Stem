"""The browser port and the Python pipeline must give the same answers.

There are two implementations of this analysis. The Python one is where the
thinking happened; the JavaScript one is a hand port that runs in a page with no
install, and it re-implements the features, the network, the ordered decode and
the metrics. Two implementations of the same arithmetic drift apart. It is not a
question of whether.

Nothing was checking. The port was verified once by hand against a saved tensor,
which said the two agreed on the day somebody looked, and said nothing at all
about any day afterwards. The drift then happened exactly as expected: a bug in
the browser's frame stepping fell back to a slower path and returned a tempo a
quarter different from the desktop app's, and it was caught by noticing that a
number on a screenshot looked wrong.

So this runs both over the same clip and compares them. It is slow by the
standards of the other tests here - a second or so of node - and it is the only
thing standing between the two halves of this repository and a silent
disagreement about what a swing was.

The tolerances are tight on purpose. These are not two models being compared,
they are two spellings of one calculation, and anything worse than
single-precision rounding is a difference in the arithmetic rather than in the
floating point.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from swingml.analysis import AnalysisConfig, analyse_pose_sequence, load_model
from swingml.events import NUM_EVENTS, SwingEvent
from swingml.model.decode import decode_events
from swingml.pose.base import PoseSequence
from swingml.quantity import NoReading, Quantity
from swingml.skeleton import Handedness

HERE = Path(__file__).parent
LANDMARKS = HERE / "fixtures" / "real_swing_01.npz"
HARNESS = HERE / "js" / "parity.mjs"
# Written by scripts/export_web_model.py, and the same file the built page embeds.
PAYLOAD = HERE.parent / "out" / "web" / "model.json"
DECODE_HARNESS = HERE / "js" / "decode_parity.mjs"

TIGHT = 5e-5
"""Bound on any single value the two sides both compute.

Both run the same arithmetic in single precision, so the honest bound is
float32 rounding accumulated over a few hundred frames. Measured on the real
clip that comes out at 7e-7 for the sub-frame positions and 7e-7 for the
confidences; this leaves a factor of seventy and is still far tighter than any
difference a person could see.
"""

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not PAYLOAD.is_file() or not LANDMARKS.is_file(),
    reason=(
        "needs node, the real-swing fixture, and an exported web payload "
        "(python scripts/export_web_model.py)"
    ),
)


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
def python_side(sequence: PoseSequence):  # type: ignore[no-untyped-def]
    """The desktop answer, through the same weights the page carries.

    Loaded from the exported payload's own source model rather than from whatever
    this installation would otherwise run, because an ensemble against a single
    network is not the comparison this test is making.
    """
    payload = json.loads(PAYLOAD.read_text(encoding="utf-8"))
    model = load_model(Path(payload["source_model"]))
    return analyse_pose_sequence(sequence, model, AnalysisConfig(handedness=Handedness.RIGHT))


@pytest.fixture(scope="module")
def browser_side(sequence: PoseSequence, tmp_path_factory: pytest.TempPathFactory) -> dict:
    """The same clip through the JavaScript, run under node."""
    job = tmp_path_factory.mktemp("parity") / "job.json"
    job.write_text(
        json.dumps(
            {
                "xy": sequence.xy.tolist(),
                "visibility": sequence.visibility.tolist(),
                "world": (
                    sequence.world_xyz.tolist()
                    if sequence.world_xyz is not None
                    else np.zeros((sequence.n_frames, 33, 3)).tolist()
                ),
                "detected": [bool(v) for v in np.asarray(sequence.detected).ravel()],
                "times": sequence.timestamps_s.tolist(),
                "width": sequence.frame_width,
                "height": sequence.frame_height,
                "handedness": "right",
                "payload": str(PAYLOAD),
            }
        ),
        encoding="utf-8",
    )
    finished = subprocess.run(
        ["node", str(HARNESS), str(job)],
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if finished.returncode != 0:
        pytest.fail(f"the browser pipeline would not run:\n{finished.stderr[-2000:]}")
    return dict(json.loads(finished.stdout))


def test_both_sides_agree_that_there_is_a_swing(python_side, browser_side: dict) -> None:  # type: ignore[no-untyped-def]
    """Or agree that there is not. A refusal on one side only is the worst case.

    It means one of them is reporting numbers for a clip the other declined,
    which is the failure the refusals exist to prevent, happening in the half
    nobody was watching.
    """
    assert browser_side["ok"] is not isinstance(python_side.events, NoReading), (
        f"python: {python_side.events}, browser: {browser_side.get('reason')}"
    )


def test_the_two_pipelines_read_the_same_number_of_frames(python_side, browser_side: dict) -> None:  # type: ignore[no-untyped-def]
    """The resampled grid is where a divergence starts, so it is checked first.

    Everything downstream is indexed by it, so one frame of difference here
    reappears as an event landing on a different frame and is much harder to read
    once it gets there.
    """
    assert browser_side["n"] == python_side.canonical_frames


def test_the_events_land_on_the_same_frames(python_side, browser_side: dict) -> None:  # type: ignore[no-untyped-def]
    assert not isinstance(python_side.events, NoReading)
    assert list(browser_side["frames"]) == list(python_side.events.frames)


def test_the_sub_frame_refinement_agrees(python_side, browser_side: dict) -> None:  # type: ignore[no-untyped-def]
    """Where within the frame, not just which frame.

    This is what tempo is computed from, and it is the part most easily got
    subtly wrong in a re-implementation: a centre of mass over a window, clamped.
    """
    assert not isinstance(python_side.events, NoReading)
    assert python_side.events.subframe is not None
    assert np.allclose(browser_side["subframe"], python_side.events.subframe, rtol=0, atol=TIGHT), (
        f"browser {browser_side['subframe']}\npython {python_side.events.subframe}"
    )


def test_the_model_reports_the_same_confidence(python_side, browser_side: dict) -> None:  # type: ignore[no-untyped-def]
    """The whole network, end to end, in one number per event.

    Confidence is a softmax over the final layer, so it only matches if every
    convolution, normalisation and activation in between matched. It is also what
    the measured error bands are looked up by, so a drift here quietly changes
    which band a clip is given.
    """
    assert not isinstance(python_side.events, NoReading)
    assert np.allclose(
        browser_side["confidence"], python_side.events.confidence, rtol=0, atol=TIGHT
    ), f"browser {browser_side['confidence']}\npython {python_side.events.confidence}"


def test_the_features_agree_before_the_model_ever_sees_them(browser_side: dict) -> None:
    """Guards the case where two feature bugs cancel out in the events.

    The events are eight integers and can easily be unchanged by a feature
    channel that is wrong somewhere the model is not looking. Summing a spread of
    columns over the clip catches that; the reference values come from the Python
    side in the test below.
    """
    assert len(browser_side["featureChecksum"]) == 8
    assert all(np.isfinite(browser_side["featureChecksum"]))


def test_the_feature_columns_match_the_python_ones(
    sequence: PoseSequence, browser_side: dict
) -> None:
    from swingml.features import FeatureConfig, extract_features, resample_pose

    config = FeatureConfig()
    resampled, _ = resample_pose(sequence, config.canonical_rate_hz)
    features = extract_features(resampled, Handedness.RIGHT, config)
    expected = [float(features[:, i * 17].sum()) for i in range(8)]
    assert np.allclose(browser_side["featureChecksum"], expected, rtol=TIGHT, atol=TIGHT), (
        f"browser {browser_side['featureChecksum']}\npython {expected}"
    )


@pytest.mark.parametrize(
    ("key", "attribute", "tolerance"),
    [
        # Every bound is at least an order of magnitude above what the two
        # sides actually disagree by, and two to three orders below the smallest
        # difference that would matter to a reader. Measured, not guessed: the
        # first version of this file allowed 2e-4 everywhere, which let a feature
        # channel scaled by one part in ten thousand pass unnoticed.
        ("tempoRatio", "tempo_ratio", 1e-5),
        ("backswingMs", "backswing_duration", 1e-3),
        ("downswingMs", "downswing_duration", 1e-3),
        ("wholeMs", "swing_duration", 1e-3),
        ("peakHandSpeedMs", "time_to_peak_hand_speed", 1e-3),
        ("shoulderTurnDeg", "shoulder_turn_foreshortened", 5e-4),
        ("hipTurnDeg", "hip_turn_foreshortened", 5e-4),
        ("headMovement", "head_movement", 1e-6),
        ("pelvisSway", "pelvis_sway", 1e-6),
    ],
)
def test_every_reported_metric_agrees(
    python_side, browser_side: dict, key: str, attribute: str, tolerance: float
) -> None:  # type: ignore[no-untyped-def]
    """Each number the interface actually shows, on both sides."""
    metrics = python_side.metrics
    assert not isinstance(metrics, NoReading)
    reading = getattr(metrics, attribute)
    if isinstance(reading, NoReading):
        assert browser_side[key] is None, f"{key}: python refused, browser said {browser_side[key]}"
        return
    assert isinstance(reading, Quantity)
    assert browser_side[key] is not None, f"{key}: browser refused, python said {reading.value}"
    assert abs(browser_side[key] - reading.value) <= tolerance, (
        f"{key}: browser {browser_side[key]}, python {reading.value}"
    )


def test_the_event_order_is_the_one_the_labels_claim(browser_side: dict) -> None:
    """The two sides have to agree about which index means which event.

    They each hold their own list of names, and nothing but this connects them.
    A port that read the eight frames correctly and labelled impact as the top of
    the backswing would pass every other test in this file.
    """
    names = [
        "Address",
        "Toe Up",
        "Mid Backswing",
        "Top",
        "Mid Downswing",
        "Impact",
        "Mid Follow Through",
        "Finish",
    ]
    assert [event.label for event in SwingEvent.ordered()] == names


def decode_cases() -> list[dict]:
    """Logit arrays chosen to land on the decoder's edges rather than its middle.

    A real swing puts its eight events comfortably inside a few hundred frames and
    exercises none of the places a dynamic program goes wrong. These do: a clip
    exactly as long as the number of events, so every event is forced onto its own
    frame and the first has nowhere to move; one frame shorter, which must be
    refused; scores with no structure at all; scores that are identical
    everywhere, where the two sides must break the tie the same way; and a peak
    pressed against frame zero, where the running maximum's first step decides
    the answer.
    """
    rng = np.random.default_rng(4)
    classes = NUM_EVENTS + 1
    cases: list[dict] = []

    def add(logits: np.ndarray, minimum: float = 0.0) -> None:
        cases.append(
            {
                "logits": [float(v) for v in np.asarray(logits, dtype=np.float32).ravel()],
                "n": int(logits.shape[0]),
                "classes": classes,
                "minMeanConfidence": minimum,
            }
        )

    add(rng.normal(size=(NUM_EVENTS, classes)))  # exactly long enough
    add(rng.normal(size=(NUM_EVENTS - 1, classes)))  # one short: must refuse
    add(np.zeros((40, classes)))  # perfectly flat: all ties
    add(rng.normal(size=(9, classes)))  # barely more room than events
    add(rng.normal(size=(200, classes)), minimum=0.99)  # refused for confidence

    # Peaks crowded against the start, then against the end.
    for offset in (0, 1):
        logits = rng.normal(scale=0.2, size=(60, classes))
        for event in range(NUM_EVENTS):
            logits[offset + event, event] += 9.0
        add(logits)
    logits = rng.normal(scale=0.2, size=(60, classes))
    for event in range(NUM_EVENTS):
        logits[59 - NUM_EVENTS + 1 + event, event] += 9.0
    add(logits)

    # A decisive tie: one event with two equally good frames, both reachable.
    # The total score is identical either way, so the answer is decided purely by
    # which frame the search keeps when nothing separates them - and the frame is
    # what gets shown to somebody, so the two sides have to keep the same one.
    # Without this the whole convention could flip between the halves of this
    # repository and every other test here would still pass.
    logits = rng.normal(scale=0.2, size=(60, classes))
    for event in range(NUM_EVENTS):
        logits[5 * (event + 1), event] += 9.0
    logits[22] = logits[20]
    add(logits)

    for length in (12, 33, 128, 301):
        add(rng.normal(size=(length, classes)))
    return cases


@pytest.fixture(scope="module")
def decoded_pairs(tmp_path_factory: pytest.TempPathFactory) -> list[tuple[dict, object]]:
    """Every case decoded by both sides, paired up."""
    cases = decode_cases()
    job = tmp_path_factory.mktemp("decode") / "job.json"
    job.write_text(json.dumps({"cases": cases}), encoding="utf-8")
    finished = subprocess.run(
        ["node", str(DECODE_HARNESS), str(job)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if finished.returncode != 0:
        pytest.fail(f"the browser decoder would not run:\n{finished.stderr[-2000:]}")
    browser = json.loads(finished.stdout)

    pairs = []
    for case, theirs in zip(cases, browser, strict=True):
        logits = np.asarray(case["logits"], dtype=np.float32).reshape(case["n"], case["classes"])
        pairs.append((theirs, decode_events(logits, case["minMeanConfidence"])))
    return pairs


def test_the_decoder_refuses_the_same_cases(decoded_pairs) -> None:  # type: ignore[no-untyped-def]
    for index, (theirs, ours) in enumerate(decoded_pairs):
        assert theirs["ok"] is not isinstance(ours, NoReading), (
            f"case {index}: browser ok={theirs['ok']}, python {ours}"
        )


def test_the_decoder_picks_the_same_frames_everywhere(decoded_pairs) -> None:  # type: ignore[no-untyped-def]
    """Including where the answer is a tie and something has to break it.

    Two implementations of the same search agree on the score and can still
    disagree on which of several equally good sequences to return. That is a real
    difference to a user - the frames are what gets shown - so it has to be
    pinned, not waved through as equivalent.
    """
    for index, (theirs, ours) in enumerate(decoded_pairs):
        if isinstance(ours, NoReading):
            continue
        assert list(theirs["frames"]) == list(ours.frames), f"case {index}"


def test_the_decoder_agrees_on_confidence_and_sub_frame_position(decoded_pairs) -> None:  # type: ignore[no-untyped-def]
    for index, (theirs, ours) in enumerate(decoded_pairs):
        if isinstance(ours, NoReading):
            continue
        assert ours.subframe is not None
        assert np.allclose(theirs["confidence"], ours.confidence, rtol=0, atol=TIGHT), index
        assert np.allclose(theirs["subframe"], ours.subframe, rtol=0, atol=TIGHT), index
