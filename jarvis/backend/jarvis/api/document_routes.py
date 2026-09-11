"""The documents API.

Upload copies the file into `data/documents/`, extracts its text once and stores
the passages. Nothing here streams a file back out to the model - search returns
passages, and the file itself only ever moves onto this machine, never off it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from jarvis.api.deps import app_settings, current_user, db_session
from jarvis.api.schemas import DocumentOut, DocumentSearchHit, NoteIn
from jarvis.config import Settings
from jarvis.models import User
from jarvis.services import documents as document_service

router = APIRouter(prefix="/api", tags=["documents"])


@router.get("/documents/search", response_model=list[DocumentSearchHit])
def search_documents(
    q: str = Query(min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    subject: str | None = None,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[DocumentSearchHit]:
    results = document_service.search(
        session, user_id=user.id, query=q, limit=limit, subject=subject
    )
    return [
        DocumentSearchHit(
            document_id=result.document.id,
            filename=result.document.filename,
            subject=result.document.subject,
            part=result.chunk.ordinal + 1,
            parts=result.document.chunk_count,
            text=result.chunk.text,
            score=round(result.score, 4),
        )
        for result in results
    ]


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(
    subject: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[DocumentOut]:
    documents = document_service.list_all(session, user_id=user.id, subject=subject, limit=limit)
    return [DocumentOut.of(document) for document in documents]


@router.post("/documents", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    category: str = Form(default=""),
    subject: str = Form(default=""),
    tags: str = Form(default=""),
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
) -> DocumentOut:
    """Add a file to the local index.

    Async only because reading an upload is: the indexing itself is ordinary
    synchronous work against the local database.
    """
    data = await file.read()
    try:
        document = document_service.add(
            session,
            user_id=user.id,
            data=data,
            filename=file.filename or "document",
            documents_dir=settings.documents_dir,
            category=category,
            subject=subject,
            tags=tags,
        )
    except document_service.DocumentError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return DocumentOut.of(document)


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> DocumentOut:
    document = document_service.get(session, user_id=user.id, document_id=document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such document.")
    return DocumentOut.of(document)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> None:
    """Remove a document from the index and delete JARVIS's copy of the file."""
    if not document_service.remove(session, user_id=user.id, document_id=document_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such document.")


# --- notes -------------------------------------------------------------------
#
# A note is a document the owner typed instead of uploaded. Deliberately not a
# separate store: it is written to `data/documents/` as markdown and indexed by
# the same code, so searching, budgeting and deleting all behave identically and
# there is no second system to keep in step.

NOTE_CATEGORY = "note"


@router.post("/notes", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def create_note(
    body: NoteIn,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
    settings: Settings = Depends(app_settings),
) -> DocumentOut:
    """Write a note. Stored as `<title>.md` alongside uploaded documents."""
    filename = f"{body.title.strip() or 'note'}.md"
    text = f"# {body.title.strip()}\n\n{body.text}" if body.title.strip() else body.text
    try:
        document = document_service.add(
            session,
            user_id=user.id,
            data=text.encode("utf-8"),
            filename=filename,
            documents_dir=settings.documents_dir,
            category=NOTE_CATEGORY,
            subject=body.subject,
            tags=body.tags,
        )
    except document_service.DocumentError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return DocumentOut.of(document)


@router.get("/notes", response_model=list[DocumentOut])
def list_notes(
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> list[DocumentOut]:
    return [
        DocumentOut.of(document)
        for document in document_service.list_all(session, user_id=user.id, limit=500)
        if document.category == NOTE_CATEGORY
    ]


@router.get("/notes/{document_id}/text", response_model=str)
def note_text(
    document_id: int,
    session: Session = Depends(db_session),
    user: User = Depends(current_user),
) -> str:
    """The note's full text, for editing it.

    Reassembled from the indexed passages rather than read off disk: the index
    is what JARVIS actually sees, so editing that is editing the truth.
    """
    document = document_service.get(session, user_id=user.id, document_id=document_id)
    if document is None or document.category != NOTE_CATEGORY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such note.")
    return document_service.full_text(session, document=document)
