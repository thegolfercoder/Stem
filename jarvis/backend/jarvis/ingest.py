"""Turning a file into passages worth retrieving.

Two jobs, both pure: get the text out, and cut it into pieces the right size to
send to a model. No database, no filesystem beyond reading the file it is given
- which is what makes both halves testable without a server.

Chunk size is the one number here with a real trade-off behind it. Too small and
a passage arrives without the sentence that gave it meaning; too large and one
question about one paragraph spends the budget on thirty-nine others. ~900
characters on paragraph boundaries, with a little overlap so a fact split across
a boundary still appears whole somewhere.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

TEXT_SUFFIXES = frozenset({".txt", ".text", ".md", ".markdown", ".rst", ".csv", ".log"})
PDF_SUFFIXES = frozenset({".pdf"})
SUPPORTED_SUFFIXES = TEXT_SUFFIXES | PDF_SUFFIXES

CHUNK_CHARS = 900
CHUNK_OVERLAP = 120
MIN_CHUNK_CHARS = 40
EXCERPT_CHARS = 400


class UnsupportedDocumentError(Exception):
    """The file cannot be read, with a sentence saying why."""


@dataclass(frozen=True)
class Chunk:
    ordinal: int
    text: str
    char_start: int


def is_supported(filename: str) -> bool:
    return Path(filename).suffix.lower() in SUPPORTED_SUFFIXES


def content_hash(data: bytes) -> str:
    """Identity of a document's bytes. Re-adding the same file updates the row
    it already has rather than making a second one."""
    return hashlib.sha256(data).hexdigest()


def extract_text(data: bytes, filename: str) -> str:
    """The readable text of a file, by extension."""
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return _clean(data.decode("utf-8", errors="replace"))
    if suffix in PDF_SUFFIXES:
        return _clean(_extract_pdf(data))
    raise UnsupportedDocumentError(
        f"{filename}: JARVIS can read "
        f"{', '.join(sorted(s.lstrip('.') for s in SUPPORTED_SUFFIXES))} files."
    )


def _extract_pdf(data: bytes) -> str:
    # Imported here rather than at module scope: a machine without pypdf should
    # lose PDFs and keep everything else, instead of failing to start.
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - depends on the installation
        raise UnsupportedDocumentError(
            "Reading PDFs needs pypdf. Install it with `pip install pypdf`, or add "
            "the document as text."
        ) from exc

    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    # pypdf raises a wide range of things on a malformed file.
    except Exception as exc:
        raise UnsupportedDocumentError(f"That PDF could not be read: {exc}") from exc

    text = "\n\n".join(page.strip() for page in pages if page.strip())
    if not text.strip():
        raise UnsupportedDocumentError(
            "That PDF has no extractable text. Scanned pages need OCR, which JARVIS "
            "does not do yet."
        )
    return text


def _clean(text: str) -> str:
    """Normalise whitespace without destroying paragraph structure, which is
    what the chunker cuts on."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_text(text: str, *, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[Chunk]:
    """Split into passages, preferring paragraph then sentence boundaries."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [Chunk(ordinal=0, text=text, char_start=0)]

    chunks: list[Chunk] = []
    start = 0
    ordinal = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            end = _boundary(text, start, end)
        piece = text[start:end].strip()
        if len(piece) >= MIN_CHUNK_CHARS or not chunks:
            chunks.append(Chunk(ordinal=ordinal, text=piece, char_start=start))
            ordinal += 1
        if end >= len(text):
            break
        # Step back a little so a sentence cut in half is whole in one of the
        # two chunks that share it.
        start = max(end - overlap, start + 1)
    return chunks


def _boundary(text: str, start: int, end: int) -> int:
    """The nicest place to cut at or before `end`."""
    window = text[start:end]
    # Look in the last third only: a paragraph break near the start of the
    # window would make a chunk far smaller than asked for.
    floor = len(window) * 2 // 3
    for marker in ("\n\n", "\n", ". ", "; ", ", "):
        position = window.rfind(marker)
        if position > floor:
            return start + position + len(marker)
    return end


def excerpt_of(text: str) -> str:
    """The opening of a document, for listing it without opening the file."""
    opening = text.strip()[:EXCERPT_CHARS]
    return opening.rstrip() + (" ..." if len(text.strip()) > EXCERPT_CHARS else "")


def safe_filename(filename: str) -> str:
    """A name that cannot escape the documents directory.

    Uploads name their own file, and a name is an untrusted string: `../` in it
    would otherwise write wherever it liked. The basename is taken, anything
    unusual is replaced, and the result is never empty.
    """
    name = Path(filename).name
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip(". ")
    return name[:120] or "document"
