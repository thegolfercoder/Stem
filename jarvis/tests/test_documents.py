"""Documents: indexing, chunking, searching, and deleting for real.

The PDF here is built byte by byte rather than checked in as a fixture, so the
test proves extraction works without the repository carrying a binary nobody
can read the diff of.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from jarvis import ingest
from jarvis.config import Settings
from jarvis.db import session_scope
from jarvis.models import DocumentChunk, User
from jarvis.services import documents as document_service
from sqlalchemy.orm import Session

from tests.conftest import CLIENT_HEADERS

CHEMISTRY_NOTES = """# Chemistry - Rates of reaction

The rate of a reaction is how quickly reactants turn into products. It is
measured as the change in concentration divided by the change in time.

## Collision theory

Particles must collide with enough energy to react. That minimum is the
activation energy. Anything that makes collisions more frequent or more
energetic speeds the reaction up.

## What changes the rate

Temperature: higher temperature means faster particles, so more collisions and
more of them energetic enough to react.

Concentration: more particles in the same volume means more frequent collisions.

Surface area: a powder reacts faster than a lump because more of it is exposed.

Catalysts: a catalyst lowers the activation energy and is not used up.
"""

ECONOMICS_NOTES = """Economics - elasticity

Price elasticity of demand measures how much quantity demanded responds to a
price change. Demand is elastic when the response is large, and inelastic when
buyers carry on regardless.

Necessities tend to be inelastic. Luxuries tend to be elastic.
"""


def minimal_pdf(text: str) -> bytes:
    """A valid one-page PDF containing `text`.

    Hand-built because the alternative is a PDF-authoring dependency carried
    solely for tests, or a binary fixture in the repository.
    """
    content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)


@pytest.fixture
def db(signed_in: TestClient) -> Iterator[Session]:
    with session_scope() as session:
        yield session


def owner(session: Session) -> User:
    return session.query(User).one()


# --- parsing and chunking (no database) --------------------------------------


def test_markdown_and_text_are_read() -> None:
    assert "Collision theory" in ingest.extract_text(CHEMISTRY_NOTES.encode(), "chem.md")
    assert "elasticity" in ingest.extract_text(ECONOMICS_NOTES.encode(), "econ.txt")


def test_an_unreadable_type_says_what_it_can_read() -> None:
    with pytest.raises(ingest.UnsupportedDocumentError, match="can read"):
        ingest.extract_text(b"\x00\x01", "photo.heic")


def test_a_pdf_is_read() -> None:
    data = minimal_pdf("The chemistry exam is on the third of October")
    assert "third of October" in ingest.extract_text(data, "exam.pdf")


def test_a_pdf_with_no_text_says_so_rather_than_indexing_nothing() -> None:
    with pytest.raises(ingest.UnsupportedDocumentError):
        ingest.extract_text(b"%PDF-1.4\nnot really a pdf\n%%EOF", "scan.pdf")


def test_a_long_document_is_cut_into_overlapping_passages() -> None:
    text = "\n\n".join(f"Paragraph {i} about revision and exams." * 6 for i in range(30))
    chunks = ingest.chunk_text(text)
    assert len(chunks) > 1
    assert all(chunk.text.strip() for chunk in chunks)
    assert [chunk.ordinal for chunk in chunks] == list(range(len(chunks)))
    # Consecutive chunks overlap, so a sentence on a boundary survives whole.
    assert chunks[1].char_start < chunks[0].char_start + len(chunks[0].text)


def test_a_short_document_is_one_passage() -> None:
    assert len(ingest.chunk_text("One short note.")) == 1


def test_an_upload_cannot_write_outside_the_documents_directory() -> None:
    assert ingest.safe_filename("../../.ssh/authorized_keys") == "authorized_keys"
    assert "/" not in ingest.safe_filename("a/b/c.txt")


# --- indexing ----------------------------------------------------------------


def test_adding_a_document_indexes_its_passages(db: Session, settings: Settings) -> None:
    user = owner(db)
    document = document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chemistry-notes.md",
        documents_dir=settings.documents_dir,
        subject="chemistry",
        tags=["igcse", "rates"],
    )
    db.commit()

    assert document.chunk_count >= 1
    assert document.indexed_at is not None
    assert document.tag_list == ["igcse", "rates"]
    assert "rate of a reaction" in document.excerpt.lower()

    # The file itself is on disk, inside the data directory and nowhere else.
    stored = settings.documents_dir / "chemistry-notes.md"
    assert stored.is_file()
    assert settings.documents_dir in stored.parents

    chunks = db.query(DocumentChunk).filter_by(document_id=document.id).all()
    assert len(chunks) == document.chunk_count


def test_adding_the_same_file_twice_updates_it(db: Session, settings: Settings) -> None:
    user = owner(db)
    first = document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chem.md",
        documents_dir=settings.documents_dir,
        subject="chemistry",
    )
    db.commit()
    second = document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chem.md",
        documents_dir=settings.documents_dir,
        subject="chemistry",
    )
    db.commit()

    assert first.id == second.id
    assert len(document_service.list_all(db, user_id=user.id)) == 1
    # Chunks were rebuilt, not appended to.
    assert db.query(DocumentChunk).filter_by(document_id=first.id).count() == second.chunk_count


def test_an_empty_or_unreadable_file_is_refused(db: Session, settings: Settings) -> None:
    user = owner(db)
    with pytest.raises(document_service.DocumentError, match="empty"):
        document_service.add(
            db, user_id=user.id, data=b"", filename="a.txt", documents_dir=settings.documents_dir
        )
    with pytest.raises(document_service.DocumentError, match="can read"):
        document_service.add(
            db,
            user_id=user.id,
            data=b"data",
            filename="a.heic",
            documents_dir=settings.documents_dir,
        )


# --- searching ---------------------------------------------------------------


def test_searching_finds_the_passage_not_the_whole_file(db: Session, settings: Settings) -> None:
    user = owner(db)
    document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chemistry.md",
        documents_dir=settings.documents_dir,
        subject="chemistry",
    )
    document_service.add(
        db,
        user_id=user.id,
        data=ECONOMICS_NOTES.encode(),
        filename="economics.md",
        documents_dir=settings.documents_dir,
        subject="economics",
    )
    db.commit()

    results = document_service.search(db, user_id=user.id, query="what does a catalyst do")
    assert results
    assert results[0].document.filename == "chemistry.md"
    assert "catalyst" in results[0].chunk.text.lower()
    # The economics notes are not dragged along for a chemistry question.
    assert all(r.document.filename != "economics.md" for r in results)


def test_a_document_can_be_found_by_its_name_and_subject(db: Session, settings: Settings) -> None:
    """ "Summarise my chemistry notes" has to work even though the passages
    never say the words "my notes"."""
    user = owner(db)
    document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chemistry-notes.md",
        documents_dir=settings.documents_dir,
        subject="chemistry",
    )
    db.commit()
    assert document_service.search(db, user_id=user.id, query="chemistry notes")


def test_one_long_document_cannot_answer_every_question(db: Session, settings: Settings) -> None:
    """Without a per-document cap, the biggest file wins on word count alone."""
    user = owner(db)
    long_text = "\n\n".join(f"Revision note {i} about exams and revision." * 8 for i in range(40))
    document_service.add(
        db,
        user_id=user.id,
        data=long_text.encode(),
        filename="everything.md",
        documents_dir=settings.documents_dir,
    )
    db.commit()
    results = document_service.search(db, user_id=user.id, query="revision exams", limit=6)
    assert len(results) <= 2


def test_search_is_scoped_to_the_owner(db: Session, settings: Settings) -> None:
    user = owner(db)
    document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chem.md",
        documents_dir=settings.documents_dir,
    )
    db.commit()
    assert document_service.search(db, user_id=user.id + 999, query="catalyst") == []


def test_a_search_matching_nothing_returns_nothing(db: Session, settings: Settings) -> None:
    user = owner(db)
    document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chem.md",
        documents_dir=settings.documents_dir,
    )
    db.commit()
    assert document_service.search(db, user_id=user.id, query="submarine warfare") == []


# --- deleting ----------------------------------------------------------------


def test_deleting_a_document_deletes_the_file_and_its_passages(
    db: Session, settings: Settings
) -> None:
    user = owner(db)
    document = document_service.add(
        db,
        user_id=user.id,
        data=CHEMISTRY_NOTES.encode(),
        filename="chem.md",
        documents_dir=settings.documents_dir,
    )
    db.commit()
    path = settings.documents_dir / "chem.md"
    assert path.is_file()

    assert document_service.remove(db, user_id=user.id, document_id=document.id) is True
    db.commit()

    assert not path.exists(), "a delete that leaves the file is not a delete"
    assert db.query(DocumentChunk).filter_by(document_id=document.id).count() == 0
    assert document_service.get(db, user_id=user.id, document_id=document.id) is None


# --- the HTTP surface --------------------------------------------------------


def test_the_document_api_round_trip(signed_in: TestClient) -> None:
    uploaded = signed_in.post(
        "/api/documents",
        files={"file": ("chemistry-notes.md", CHEMISTRY_NOTES.encode(), "text/markdown")},
        data={"subject": "chemistry", "category": "school", "tags": "igcse,rates"},
        headers=CLIENT_HEADERS,
    )
    assert uploaded.status_code == 201, uploaded.text
    document = uploaded.json()
    assert document["subject"] == "chemistry"
    assert document["tags"] == ["igcse", "rates"]
    assert document["chunk_count"] >= 1

    listed = signed_in.get("/api/documents").json()
    assert [d["id"] for d in listed] == [document["id"]]

    hits = signed_in.get("/api/documents/search?q=activation energy").json()
    assert hits
    assert hits[0]["filename"] == "chemistry-notes.md"
    assert "activation energy" in hits[0]["text"].lower()

    assert (
        signed_in.delete(f"/api/documents/{document['id']}", headers=CLIENT_HEADERS).status_code
        == 204
    )
    assert signed_in.get("/api/documents").json() == []


def test_uploading_a_pdf(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/documents",
        files={
            "file": ("exam.pdf", minimal_pdf("Mock exams begin on 3 October"), "application/pdf")
        },
        data={"subject": "school"},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 201, response.text
    assert "3 October" in response.json()["excerpt"]

    hits = signed_in.get("/api/documents/search?q=mock exams").json()
    assert hits and hits[0]["filename"] == "exam.pdf"


def test_uploading_something_unreadable_explains_itself(signed_in: TestClient) -> None:
    response = signed_in.post(
        "/api/documents",
        files={"file": ("holiday.heic", b"\x00\x01\x02", "image/heic")},
        headers=CLIENT_HEADERS,
    )
    assert response.status_code == 400
    assert "can read" in response.json()["detail"]


def test_the_document_api_needs_a_session(client: TestClient) -> None:
    assert client.get("/api/documents").status_code == 401
    assert client.get("/api/documents/search?q=x").status_code == 401
