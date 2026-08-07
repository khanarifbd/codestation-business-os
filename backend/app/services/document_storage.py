from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO, Protocol
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import settings


ALLOWED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
}

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class DocumentStorage(Protocol):
    def save(
        self,
        *,
        organization_id: str,
        source: BinaryIO,
        original_filename: str,
        content_type: str | None,
    ) -> tuple[str, int]: ...

    def resolve(self, storage_key: str) -> Path: ...

    def delete(self, storage_key: str) -> None: ...


class LocalDocumentStorage:
    """Local VPS storage adapter.

    Files are private on disk. They are never mounted as public static files;
    authenticated API routes resolve and stream them. Replacing this class with
    an S3/R2 adapter later does not require changing the document database model.
    """

    def __init__(self) -> None:
        self.root = Path(settings.local_storage_path).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.max_bytes = settings.max_document_upload_mb * 1024 * 1024

    def save(
        self,
        *,
        organization_id: str,
        source: BinaryIO,
        original_filename: str,
        content_type: str | None,
    ) -> tuple[str, int]:
        suffix = Path(original_filename or "").suffix.lower()
        if suffix not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported document file type",
            )
        if content_type and content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported document content type",
            )

        relative = Path("organizations") / organization_id / "company-documents" / f"{uuid4().hex}{suffix}"
        destination = (self.root / relative).resolve()
        if self.root not in destination.parents:
            raise HTTPException(status_code=400, detail="Invalid storage path")

        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".uploading")
        total = 0

        try:
            source.seek(0)
            with temporary.open("wb") as output:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > self.max_bytes:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"Document exceeds {settings.max_document_upload_mb} MB limit",
                        )
                    output.write(chunk)
            os.replace(temporary, destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            destination.unlink(missing_ok=True)
            raise

        return relative.as_posix(), total

    def resolve(self, storage_key: str) -> Path:
        path = (self.root / storage_key).resolve()
        if self.root not in path.parents or not path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found")
        return path

    def delete(self, storage_key: str) -> None:
        path = (self.root / storage_key).resolve()
        if self.root not in path.parents:
            return
        path.unlink(missing_ok=True)


storage: DocumentStorage = LocalDocumentStorage()