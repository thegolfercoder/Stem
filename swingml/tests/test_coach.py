"""The local coach: its guard, its client, and the routes, against a stand-in Ollama.

The stand-in speaks the same HTTP as Ollama - version, tags, show, and a streamed
chat - so the client and routes are exercised end to end without a model. Its
reply deliberately includes a sentence about club path, which must never reach
the page.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar

import pytest

from swingml.coach.guard import StreamGuard, guard_text, guarded
from swingml.coach.ollama import LocalModel, OllamaClient, choose_model

REPLY = [
    "1. What stands out: your tempo of 2.9 is quicker ",
    "than most. Your club path looks out-to-in at the top. ",
    "Frame 4 shows a full shoulder turn.\n",
    "2. Work on: a smoother transition. Try a pause-at-the-top drill.\n",
    "3. One camera cannot see the club face.",
]


class FakeOllama(BaseHTTPRequestHandler):
    models: ClassVar[list[dict[str, Any]]] = [
        {"name": "llama3.2:3b", "size": 2_000_000_000, "details": {"family": "llama"}},
        {"name": "gemma3:4b", "size": 3_300_000_000, "details": {"family": "gemma3"}},
    ]
    requests: ClassVar[list[dict[str, Any]]] = []

    def log_message(self, *args: object) -> None:
        pass

    def _send(self, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/api/version":
            self._send({"version": "0.34.4"})
        elif self.path == "/api/tags":
            self._send({"models": self.models})
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        FakeOllama.requests.append({"path": self.path, "body": body})
        if self.path == "/api/show":
            vision = body.get("model", "").startswith("gemma3")
            self._send({"capabilities": ["completion", *(["vision"] if vision else [])]})
        elif self.path == "/api/chat":
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for piece in REPLY:
                line = {"message": {"role": "assistant", "content": piece}, "done": False}
                self.wfile.write((json.dumps(line) + "\n").encode())
                self.wfile.flush()
            self.wfile.write(
                (json.dumps({"message": {"content": ""}, "done": True}) + "\n").encode()
            )
        else:
            self.send_error(404)


@pytest.fixture()
def fake_ollama() -> Iterator[str]:
    FakeOllama.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


# -- the guard -----------------------------------------------------------------


def test_the_guard_drops_sentences_about_what_one_camera_cannot_measure() -> None:
    result = guard_text("".join(REPLY))
    assert "club path" not in result.text.lower()
    assert "tempo of 2.9" in result.text
    assert "shoulder turn" in result.text
    assert result.dropped == 1  # the path sentence
    # Saying that the camera cannot see the club face is the point, not a lapse.
    assert "cannot see the club face" in result.text


def test_the_streaming_guard_matches_the_whole_text_guard() -> None:
    # Split mid-word and mid-number, as a model's tokens are.
    text = "".join(REPLY)
    pieces = [text[i : i + 7] for i in range(0, len(text), 7)]
    guard = StreamGuard()
    streamed = "".join(guarded(pieces, guard))
    assert streamed == guard_text(text).text
    assert guard.dropped == guard_text(text).dropped


def test_a_decimal_point_does_not_end_a_sentence_early() -> None:
    guard = StreamGuard()
    released = guard.feed("Your tempo is 2.")
    assert released == ""
    released += guard.feed("9, which is quick. ")
    assert "2.9" in released


@pytest.mark.parametrize(
    "sentence",
    [
        "Your clubface is open at impact.",
        "You swing on a steep plane. Your swing plane is too upright.",
        "Expect about 2500 rpm of backspin.",
        "That carries 230 yards.",
        "Your attack angle is negative.",
    ],
)
def test_the_guard_catches_the_usual_ways_of_saying_it(sentence: str) -> None:
    assert guard_text(sentence).dropped >= 1


def test_the_guard_keeps_sentences_about_what_cannot_be_measured() -> None:
    text = "A single camera can't tell you your club path or spin. Your tempo is 3.1."
    assert guard_text(text).dropped == 0


# -- choosing a model ------------------------------------------------------------


def test_a_preferred_vision_model_is_chosen_over_an_unknown_one() -> None:
    models = [
        LocalModel("mystery-vl:7b", 1, vision=True),
        LocalModel("gemma3:4b", 1, vision=True),
        LocalModel("llama3.2:3b", 1, vision=False),
    ]
    assert choose_model(models, need_vision=True).name == "gemma3:4b"  # type: ignore[union-attr]
    assert choose_model([models[2]], need_vision=True) is None
    assert choose_model([models[2]], need_vision=False).name == "llama3.2:3b"  # type: ignore[union-attr]


def test_the_client_finds_models_and_asks_which_can_see(fake_ollama: str) -> None:
    status = OllamaClient(fake_ollama).status()
    assert status.running and status.version == "0.34.4"
    assert status.vision_model is not None and status.vision_model.name == "gemma3:4b"
    assert {m.name for m in status.models if not m.vision} == {"llama3.2:3b"}


def test_an_absent_ollama_is_a_state_not_an_exception() -> None:
    status = OllamaClient("http://127.0.0.1:9").status()
    assert not status.running
    assert status.as_dict()["suggested_pull"]


# -- the routes -------------------------------------------------------------------


def stored_analysis() -> Any:
    """A generated swing measured as a real one would be, for the store."""
    from swingml.analysis import SwingAnalysis
    from swingml.events import EventSequence
    from swingml.metrics.swing import compute_metrics
    from swingml.skeleton import Handedness
    from synth.camera import CameraConfig, render_pose_sequence
    from synth.swing import generate_swing
    from tests.test_store_and_web import QUIET

    swing = generate_swing(frame_rate_hz=60.0)
    camera = CameraConfig(
        azimuth_deg=0.0, distance_m=4.5, frame_width=720, frame_height=1280, vertical_fov_deg=55.0
    )
    sequence = render_pose_sequence(swing, camera, QUIET, seed=0)
    frames = tuple(int(f) for f in swing.truth.event_frames)
    events = EventSequence(frames=frames, confidence=(0.9,) * 8)
    return SwingAnalysis(
        video=None,
        detection_rate=1.0,
        canonical_frames=sequence.n_frames,
        events=events,
        event_times_s=tuple(float(sequence.timestamps_s[f]) for f in frames),
        event_source_frames=frames,
        metrics=compute_metrics(sequence, events, Handedness.RIGHT),
        handedness=Handedness.RIGHT,
    )


@pytest.fixture()
def app_with_swing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fake_ollama: str
) -> Iterator[tuple[Any, int]]:
    monkeypatch.setenv("SWINGML_HOME", str(tmp_path))
    monkeypatch.setenv("OLLAMA_HOST", fake_ollama)
    from swingml.store import SwingStore
    from swingml.web.app import create_app

    store = SwingStore(tmp_path / "swings.db")
    swing_id = store.add(stored_analysis(), source_name="clip.mov", club="Driver")
    app = create_app(store=store)
    app.config["TESTING"] = True
    yield app, swing_id


def test_the_coach_streams_a_guarded_read_and_keeps_it(app_with_swing: tuple[Any, int]) -> None:
    app, swing_id = app_with_swing
    client = app.test_client()
    response = client.post(f"/api/swings/{swing_id}/coach")
    assert response.status_code == 200
    text = response.get_data(as_text=True)
    assert "tempo of 2.9" in text
    assert "club path" not in text.lower()
    assert "left out" in text and "1 sentence" in text
    assert response.headers["X-Model"] == "gemma3:4b"

    sent = [r for r in FakeOllama.requests if r["path"] == "/api/chat"][-1]["body"]
    prompt = sent["messages"][0]["content"]
    assert "Tempo" in prompt and "club face angle" in prompt  # the rules went with it

    saved = client.get(f"/api/swings/{swing_id}/coach").get_json()
    assert saved["model"] == "gemma3:4b"
    assert "club path" not in saved["text"].lower()


def test_the_chat_sees_the_history_and_answers(app_with_swing: tuple[Any, int]) -> None:
    app, _ = app_with_swing
    client = app.test_client()
    response = client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "How is my tempo?"}]}
    )
    assert response.status_code == 200
    assert "club path" not in response.get_data(as_text=True).lower()
    sent = [r for r in FakeOllama.requests if r["path"] == "/api/chat"][-1]["body"]
    system = sent["messages"][0]
    assert system["role"] == "system" and "Driver" in system["content"]
    assert sent["messages"][-1] == {"role": "user", "content": "How is my tempo?"}
    assert client.get("/chat").status_code == 200


def test_without_ollama_the_routes_say_what_to_do(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SWINGML_HOME", str(tmp_path))
    monkeypatch.setenv("OLLAMA_HOST", "http://127.0.0.1:9")
    from swingml.store import SwingStore
    from swingml.web.app import create_app

    app = create_app(store=SwingStore(tmp_path / "swings.db"))
    client = app.test_client()
    status = client.get("/api/ai").get_json()
    assert status["running"] is False and "ollama.com" in status["advice"]
    reply = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert reply.status_code == 503 and "ollama pull" in reply.get_json()["error"]
