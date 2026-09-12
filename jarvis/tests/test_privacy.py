"""What actually leaves this machine.

Every other test checks that JARVIS remembers things. These check the opposite:
that the rest of what it remembers stays put. They run a real turn through the
real chat service with a fake model, then read the request that model received -
which is the only place the question "what was sent?" has a truthful answer.

If one of these fails, the privacy claim in the README is no longer true.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient
from jarvis.config import Settings
from jarvis.db import session_scope
from jarvis.models import User
from jarvis.security import hash_password
from jarvis.services import documents as document_service
from jarvis.services import memory as memory_service

from tests.conftest import CLIENT_HEADERS, FakeProvider

# A believable personal database, most of it irrelevant to any one question.
FACTS = [
    ("goals", "Sam wants an A* in Economics", 5),
    ("subjects", "Sam is studying IGCSE Economics, microeconomics unit", 4),
    ("preferences", "Sam prefers concise answers, one question at a time", 5),
    ("personal", "Sam's home address is 14 Elm Row, Manchester", 5),
    ("personal", "Sam's bank card ends 4417", 5),
    ("people", "Sam's chemistry teacher is Mr Adams", 2),
    ("routines", "Sam revises for an hour after dinner", 3),
    ("projects", "Sam is building JARVIS in Python", 4),
    ("school", "Sam's physics coursework is due in November", 4),
    ("important_facts", "Sam's passport number is 123456789", 5),
]

PRIVATE_STRINGS = ("Elm Row", "4417", "123456789")


def seed(signed_in: TestClient) -> None:
    with session_scope() as session:
        user = session.query(User).one()
        for category, content, importance in FACTS:
            memory_service.save(
                session,
                user_id=user.id,
                content=content,
                category=category,
                importance=importance,
            )
        session.commit()


def send(client: TestClient, message: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    with client.stream(
        "POST", "/api/chat", json={"message": message}, headers=CLIENT_HEADERS
    ) as response:
        assert response.status_code == 200, response.read()
        for line in response.iter_lines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def sent_text(provider: FakeProvider) -> str:
    """Everything in the last request: the system prompt and every message."""
    request = provider.requests[-1]
    parts = [request.system]
    for message in request.messages:
        parts.extend(getattr(block, "text", "") for block in message.content)
    return "\n".join(parts)


def test_only_the_relevant_memories_are_sent(signed_in: TestClient, provider: FakeProvider) -> None:
    """The whole point of the architecture, in one assertion.

    Ten memories on file, one question about economics: the economics goal goes,
    the address and the passport number stay on the machine.
    """
    seed(signed_in)
    send(signed_in, "What are my economics goals?")

    payload = sent_text(provider)
    assert "A* in Economics" in payload
    for private in PRIVATE_STRINGS:
        assert private not in payload, f"{private} should never have left the machine"
    assert "chemistry teacher" not in payload


def test_a_question_about_nothing_stored_sends_no_personal_data(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    seed(signed_in)
    send(signed_in, "What is the capital of France?")

    payload = sent_text(provider)
    assert "<context>" not in payload
    for _, content, _ in FACTS:
        assert content not in payload


def test_the_whole_database_is_never_sent(signed_in: TestClient, provider: FakeProvider) -> None:
    """Even a question that brushes against everything is budgeted."""
    seed(signed_in)
    send(signed_in, "Tell me about my school revision goals and projects")

    payload = sent_text(provider)
    included = [content for _, content, _ in FACTS if content in payload]
    assert len(included) < len(FACTS), "a broad question is not a licence to send everything"
    for private in PRIVATE_STRINGS:
        assert private not in payload


def test_documents_are_sent_as_passages_not_whole_files(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    long_notes = "\n\n".join(
        [
            "Chemistry notes. A catalyst lowers the activation energy of a reaction.",
            *[f"Unrelated section {i}. " + ("filler about other topics. " * 30) for i in range(20)],
            "The last section mentions nothing important.",
        ]
    )
    signed_in.post(
        "/api/documents",
        files={"file": ("chemistry.md", long_notes.encode(), "text/markdown")},
        data={"subject": "chemistry"},
        headers=CLIENT_HEADERS,
    )

    send(signed_in, "what does a catalyst do?")
    payload = sent_text(provider)

    assert "activation energy" in payload
    assert payload.count("Unrelated section") < 5, "the rest of the file stayed on disk"
    assert len(payload) < len(long_notes)


def test_the_context_budget_holds_under_a_large_database(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    """A hundred matching memories should still produce one modest request."""
    with session_scope() as session:
        user = session.query(User).one()
        for i in range(100):
            memory_service.save(
                session,
                user_id=user.id,
                content=f"Sam has revision note number {i} about economics and exams",
                category="school",
            )
        session.commit()

    send(signed_in, "tell me about my economics revision")
    system = provider.requests[-1].system
    assert len(system) < 20_000, f"system prompt was {len(system)} characters"


def test_the_trace_says_what_was_sent(signed_in: TestClient) -> None:
    """The inspector, which is how the owner checks all of the above themselves."""
    seed(signed_in)
    send(signed_in, "What are my economics goals?")

    traces = signed_in.get("/api/context/recent").json()
    assert traces
    latest = traces[0]
    assert latest["query"] == "What are my economics goals?"
    assert latest["total_chars"] > 0
    assert any(s["source"] == "memory" for s in latest["snippets"])
    # The full text is available, but only when explicitly asked for.
    assert "system_text" not in latest
    with_system = signed_in.get("/api/context/recent?include_system=true").json()
    assert "A* in Economics" in with_system[0]["system_text"]


def test_the_trace_is_only_for_the_signed_in_owner(client: TestClient) -> None:
    assert client.get("/api/context/recent").status_code == 401


def test_erasing_memory_clears_the_trace_too(signed_in: TestClient) -> None:
    """The trace is derived from data that was just deleted."""
    seed(signed_in)
    send(signed_in, "What are my economics goals?")
    assert signed_in.get("/api/context/recent").json()

    signed_in.post(
        "/api/memory/erase",
        json={"confirm": "DELETE MY MEMORY", "scope": "all"},
        headers=CLIENT_HEADERS,
    )
    assert signed_in.get("/api/context/recent").json() == []


def test_erase_scopes_delete_what_they_say(signed_in: TestClient) -> None:
    seed(signed_in)
    signed_in.post(
        "/api/documents",
        files={
            "file": (
                "notes.md",
                b"# Notes\n\nSome revision notes about economics.",
                "text/markdown",
            )
        },
        data={"subject": "economics"},
        headers=CLIENT_HEADERS,
    )

    memories_only = signed_in.post(
        "/api/memory/erase",
        json={"confirm": "DELETE MY MEMORY", "scope": "memories"},
        headers=CLIENT_HEADERS,
    ).json()
    assert memories_only["memories_deleted"] == len(FACTS)
    assert memories_only["documents_deleted"] == 0
    assert signed_in.get("/api/memory").json() == []
    assert signed_in.get("/api/documents").json() != [], "documents were not in scope"

    documents_only = signed_in.post(
        "/api/memory/erase",
        json={"confirm": "DELETE MY MEMORY", "scope": "documents"},
        headers=CLIENT_HEADERS,
    ).json()
    assert documents_only["documents_deleted"] == 1
    assert signed_in.get("/api/documents").json() == []


def test_deleting_documents_removes_the_files_from_disk(
    signed_in: TestClient, settings: Settings
) -> None:
    signed_in.post(
        "/api/documents",
        files={
            "file": ("notes.md", b"# Notes\n\nRevision notes about economics.", "text/markdown")
        },
        headers=CLIENT_HEADERS,
    )
    stored = settings.documents_dir / "notes.md"
    assert stored.is_file()

    signed_in.post(
        "/api/memory/erase",
        json={"confirm": "DELETE MY MEMORY", "scope": "documents"},
        headers=CLIENT_HEADERS,
    )
    assert not stored.exists()


def test_the_api_key_is_never_in_a_context_response(signed_in: TestClient) -> None:
    seed(signed_in)
    send(signed_in, "What are my economics goals?")
    body = signed_in.get("/api/context/recent?include_system=true").text
    assert "test-key-not-used" not in body


def test_documents_and_memories_are_scoped_to_the_owner_in_retrieval(
    signed_in: TestClient, provider: FakeProvider, settings: Settings
) -> None:
    """A second user's rows are never candidates, even for the same words.

    JARVIS refuses a second owner through the API, so this reaches past it and
    writes the row directly - the point is the scoping in retrieval, which
    should hold whatever put the row there.
    """
    with session_scope() as session:
        stranger = User(
            username="stranger",
            display_name="Stranger",
            password_hash=hash_password("another good password"),
        )
        session.add(stranger)
        session.flush()

        memory_service.save(
            session,
            user_id=stranger.id,
            content="The stranger's economics password is hunter2",
            category="personal",
        )
        document_service.add(
            session,
            user_id=stranger.id,
            data=b"The stranger's private economics notes.",
            filename="stranger.md",
            documents_dir=settings.documents_dir,
        )
        session.commit()

    send(signed_in, "tell me about economics")
    payload = sent_text(provider)
    assert "hunter2" not in payload
    assert "stranger" not in payload.lower()


def test_the_interface_asks_the_network_for_nothing() -> None:
    """The page must render with the network unplugged.

    This is a privacy claim as much as an offline one. A stylesheet, a font or
    a script pulled from someone else's server tells that server, on every
    single page load, that this machine is running JARVIS and when - which is
    exactly the kind of quiet beacon a local-first assistant is supposed not to
    have. It also means the interface degrades the moment the wifi drops, which
    is the one situation the whole design promises to survive.

    An earlier version of this page pulled two faces from Google Fonts. Nothing
    failed loudly; it just phoned out forever. Hence a test rather than a note.
    """
    frontend = Settings().frontend_dir
    # XML namespaces look like URLs and are never dereferenced - they are
    # identifiers. The inline SVG favicon needs one.
    namespaces = ("http://www.w3.org/",)
    offenders: list[str] = []
    for path in sorted(frontend.rglob("*")):
        if path.suffix.lower() not in {".html", ".css", ".js"}:
            continue
        text = path.read_text(encoding="utf-8")
        for marker in ("http://", "https://", "//cdn.", "//fonts."):
            index = 0
            while (index := text.find(marker, index)) != -1:
                line = text.count("\n", 0, index) + 1
                snippet = text[index : index + 70].split("\n")[0]
                # Links a person may click are fine - those are navigation the
                # owner chooses. A *fetch* the page performs on its own is not.
                fetched = any(
                    hint in text[max(0, index - 200) : index].lower()
                    for hint in ("src=", "href=", "url(", "@import", "fetch(")
                )
                anchor = "<a " in text[max(0, index - 200) : index].lower()
                is_namespace = text.startswith(namespaces, index)
                if fetched and not anchor and not is_namespace:
                    offenders.append(f"{path.name}:{line} {snippet}")
                index += len(marker)
    assert not offenders, "the interface fetches from the network:\n" + "\n".join(offenders)


def test_no_person_is_written_into_the_source() -> None:
    """The owner's identity lives in the database, never in the code.

    The persona is a template with `{user}` in it; the interface's example text
    is written in the first person; evaluation substitutes a fixed neutral name
    so cases do not break when an account is renamed. This test exists because
    the alternative failure is silent - a hardcoded name works perfectly for the
    one person whose name it is, and is wrong for everyone else, including the
    same person after they change it.
    """
    root = Settings().frontend_dir.parent
    searched = {".py", ".js", ".html", ".css", ".md"}
    # Names that were, at some point, actually written into this project.
    forbidden = ("Rian", "Shalini")
    offenders: list[str] = []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in searched or "data" in path.parts:
            continue
        if path.name == "test_privacy.py":  # this file has to name them to check
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for name in forbidden:
                if name in line:
                    offenders.append(f"{path.relative_to(root)}:{number} {line.strip()[:80]}")
    assert not offenders, "a person's name is hardcoded:\n" + "\n".join(offenders)


def test_the_preview_shows_what_would_leave_without_sending_anything(
    signed_in: TestClient, provider: FakeProvider
) -> None:
    """The privacy inspector, moved to before the send button.

    The preview runs the same retrieval a real turn would, so what it shows is
    what would go - and it must never call the model, never record a trace,
    and never count a keystroke as a memory being *used*.
    """
    signed_in.post(
        "/api/memory",
        json={"content": "My economics mocks start on the third of October", "category": "school"},
        headers=CLIENT_HEADERS,
    )
    signed_in.post(
        "/api/memory",
        json={"content": "My passport number is 123456789", "category": "personal"},
        headers=CLIENT_HEADERS,
    )

    calls_before = len(provider.requests)
    # Traces live in a process-global ring buffer, so other tests in this run
    # leave their own behind. What matters is that a preview adds none.
    traces_before = len(signed_in.get("/api/context/recent").json())
    preview = signed_in.get("/api/context/preview", params={"q": "when are my economics mocks"})
    assert preview.status_code == 200, preview.text
    body = preview.json()

    assert body["count"] >= 1
    titles = " ".join(s["title"] for s in body["snippets"]).lower()
    assert "school" in titles, "the relevant memory is what would go"
    assert "passport" not in json.dumps(body).lower(), "the irrelevant one would not"
    assert body["chars"] > 0, "and it says how much"

    # Each row must identify *which* record. The `title` the model sees
    # describes shape ("memory school (importance 3)"); a person checking what
    # would leave needs the content.
    labels = " ".join(s["label"] for s in body["snippets"]).lower()
    assert "mocks" in labels, "a preview row names the record, not just its shape"

    assert len(provider.requests) == calls_before, "a preview never reaches the model"
    traces_after = len(signed_in.get("/api/context/recent").json())
    assert traces_after == traces_before, "and never records a trace"

    # Typing must not count as using a memory.
    rows = signed_in.get("/api/memory").json()
    assert all(row["use_count"] == 0 for row in rows), "a preview is not a use"


def test_an_empty_preview_is_empty_not_an_error(signed_in: TestClient) -> None:
    body = signed_in.get("/api/context/preview", params={"q": "   "}).json()
    assert body == {"query": "", "intent": "ask", "snippets": [], "count": 0, "chars": 0}
