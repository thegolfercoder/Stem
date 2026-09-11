"""Documents: files the owner has given JARVIS permission to read.

The file is copied into `data/documents/`, its text is extracted once, and the
passages are stored as rows. Retrieval then works over passages, so a question
about one paragraph of a revision guide costs one paragraph of context rather
than the whole guide.

The file never leaves the machine. What can leave is a passage that matched the
question, through the same budgeted path everything else takes.
"""

from __future__ import annotations

from collections.abc import Sequence
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete as sql_delete
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from jarvis import ingest, retrieval
from jarvis.db import deleted_rows
from jarvis.models import Document, DocumentChunk, utcnow
from jarvis.services.memory import normalise_tags

MAX_CANDIDATES = 600
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024


class DocumentError(ValueError):
    """A document could not be added, with a sentence saying why."""


@dataclass(frozen=True)
class ScoredChunk:
    chunk: DocumentChunk
    document: Document
    score: float
    matched: tuple[str, ...] = ()


def add(
    session: Session,
    *,
    user_id: int,
    data: bytes,
    filename: str,
    documents_dir: Path,
    category: str = "",
    subject: str = "",
    tags: Sequence[str] | str | None = None,
) -> Document:
    """Index a file. Re-adding the same bytes refreshes the existing row."""
    if not data:
        raise DocumentError("That file is empty.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise DocumentError(
            f"That file is {len(data) // (1024 * 1024)} MB; the limit is "
            f"{MAX_DOCUMENT_BYTES // (1024 * 1024)} MB."
        )

    safe_name = ingest.safe_filename(filename)
    if not ingest.is_supported(safe_name):
        raise DocumentError(
            f"{safe_name}: JARVIS can read "
            f"{', '.join(sorted(s.lstrip('.') for s in ingest.SUPPORTED_SUFFIXES))} files."
        )

    try:
        text = ingest.extract_text(data, safe_name)
    except ingest.UnsupportedDocumentError as exc:
        raise DocumentError(str(exc)) from exc
    if not text.strip():
        raise DocumentError(f"{safe_name}: no readable text in that file.")

    digest = ingest.content_hash(data)
    existing = session.execute(
        select(Document).where(Document.user_id == user_id, Document.content_hash == digest)
    ).scalar_one_or_none()

    documents_dir.mkdir(parents=True, exist_ok=True)

    if existing is not None:
        document = existing
        document.category = category.strip()[:64] or document.category
        document.subject = subject.strip()[:64] or document.subject
        if tags is not None:
            document.tags = normalise_tags(tags)
        document.updated_at = utcnow().replace(tzinfo=None)
        # Chunks are rebuilt rather than diffed. Cheap, and it means a change to
        # the chunker takes effect on re-add instead of leaving a mixed index.
        session.execute(sql_delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
    else:
        stored_path = _unique_path(documents_dir, safe_name)
        stored_path.write_bytes(data)
        document = Document(
            user_id=user_id,
            filename=safe_name,
            path=str(stored_path),
            category=category.strip()[:64],
            subject=subject.strip()[:64],
            tags=normalise_tags(tags),
            content_type=_content_type(safe_name),
            size_bytes=len(data),
            content_hash=digest,
        )
        session.add(document)
        session.flush()

    chunks = ingest.chunk_text(text)
    for chunk in chunks:
        session.add(
            DocumentChunk(
                document_id=document.id,
                ordinal=chunk.ordinal,
                text=chunk.text,
                char_start=chunk.char_start,
            )
        )
    document.excerpt = ingest.excerpt_of(text)
    document.chunk_count = len(chunks)
    document.indexed_at = utcnow().replace(tzinfo=None)
    session.flush()
    return document


def _unique_path(directory: Path, filename: str) -> Path:
    """A path inside `directory` that is not already taken."""
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem, suffix = Path(filename).stem, Path(filename).suffix
    for number in range(2, 1000):
        candidate = directory / f"{stem}-{number}{suffix}"
        if not candidate.exists():
            return candidate
    raise DocumentError("Too many files with that name.")  # pragma: no cover


def _content_type(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".csv": "text/csv",
    }.get(suffix, "text/plain")


def list_all(
    session: Session,
    *,
    user_id: int,
    subject: str | None = None,
    limit: int = 200,
) -> list[Document]:
    statement = select(Document).where(Document.user_id == user_id)
    if subject:
        statement = statement.where(Document.subject == subject)
    statement = statement.order_by(Document.updated_at.desc()).limit(max(1, min(limit, 500)))
    return list(session.execute(statement).scalars())


def get(session: Session, *, user_id: int, document_id: int) -> Document | None:
    return session.execute(
        select(Document).where(Document.id == document_id, Document.user_id == user_id)
    ).scalar_one_or_none()


def remove(session: Session, *, user_id: int, document_id: int, delete_file: bool = True) -> bool:
    """Forget a document, and by default delete the copy JARVIS made of it.

    The copy is JARVIS's, so deleting it is the honest default - a "delete"
    that leaves the file indexed-but-hidden is the behaviour this application
    exists to avoid. Whatever the owner uploaded from is untouched.
    """
    document = get(session, user_id=user_id, document_id=document_id)
    if document is None:
        return False
    path = Path(document.path)
    session.delete(document)
    session.flush()
    if delete_file:
        # A locked or read-only file should not turn a successful delete of the
        # index entry into a failed request.
        with suppress(OSError):
            path.unlink(missing_ok=True)
    return True


def remove_all(session: Session, *, user_id: int, documents_dir: Path) -> int:
    """Every document for this user, files included. Used by "delete memory"."""
    documents = list_all(session, user_id=user_id, limit=500)
    for document in documents:
        path = Path(document.path)
        with suppress(OSError):
            # Only files JARVIS itself copied in, never one merely pointed at.
            if documents_dir in path.parents:
                path.unlink(missing_ok=True)
    return deleted_rows(session.execute(sql_delete(Document).where(Document.user_id == user_id)))


def full_text(session: Session, *, document: Document) -> str:
    """The document as one string, rebuilt from its passages.

    Chunks overlap, so this de-duplicates on the way out; it is for editing a
    note, not for sending anywhere.
    """
    chunks = list(
        session.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == document.id)
            .order_by(DocumentChunk.ordinal)
        ).scalars()
    )
    text = ""
    for chunk in chunks:
        if not text:
            text = chunk.text
            continue
        overlap = 0
        for size in range(min(len(text), len(chunk.text)), 0, -1):
            if text.endswith(chunk.text[:size]):
                overlap = size
                break
        text += chunk.text[overlap:]
    return text


def search(
    session: Session,
    *,
    user_id: int,
    query: str,
    limit: int = 6,
    subject: str | None = None,
) -> list[ScoredChunk]:
    """The passages relevant to `query`, best first, at most two per document.

    The per-document cap is what stops one long file answering every question:
    without it a hundred-page guide wins on word count alone and crowds out the
    one note that actually said it.
    """
    terms = retrieval.like_patterns(query)
    if not terms:
        return []

    statement = (
        select(DocumentChunk, Document)
        .join(Document, DocumentChunk.document_id == Document.id)
        .where(Document.user_id == user_id)
    )
    if subject:
        statement = statement.where(Document.subject == subject)
    statement = statement.where(
        or_(*[DocumentChunk.text.icontains(term.strip("%")) for term in terms])
    ).limit(MAX_CANDIDATES)

    rows = list(session.execute(statement).all())
    if not rows:
        return []

    by_id: dict[object, tuple[DocumentChunk, Document]] = {
        chunk.id: (chunk, document) for chunk, document in rows
    }
    candidates = [
        retrieval.Candidate(
            key=chunk.id,
            # The filename and subject are searchable so "my chemistry notes"
            # finds `chemistry-notes.md` even where the passage never says it.
            text=f"{document.filename} {document.subject} {document.tags} {chunk.text}",
        )
        for chunk, document in rows
    ]

    results: list[ScoredChunk] = []
    per_document: dict[int, int] = {}
    for scored in retrieval.rank(query, candidates, limit=limit * 4):
        entry = by_id.get(scored.key)
        if entry is None:  # pragma: no cover - key comes from by_id
            continue
        chunk, document = entry
        if per_document.get(document.id, 0) >= 2:
            continue
        per_document[document.id] = per_document.get(document.id, 0) + 1
        results.append(
            ScoredChunk(chunk=chunk, document=document, score=scored.score, matched=scored.matched)
        )
        if len(results) >= limit:
            break
    return results
