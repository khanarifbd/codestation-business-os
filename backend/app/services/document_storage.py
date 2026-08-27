from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO, Protocol
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import settings


ALLOWED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv", ".zip",
}

ALLOWED_CONTENT_TYPES = {
    "application/octet-stream",
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
    "application/zip",
}

PROJECT_DOCUMENT_NAMESPACE = "projects"


class DocumentStorage(Protocol):
    def save(
        self,
        *,
        organization_id: str,
        source: BinaryIO,
        original_filename: str,
        content_type: str | None,
        namespace: str = "company-documents",
    ) -> tuple[str, int]: ...

    def resolve(self, storage_key: str) -> Path: ...
    def delete(self, storage_key: str) -> None: ...


class LocalDocumentStorage:
    """Private VPS storage adapter; swap with S3/R2 later without schema changes."""

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
        namespace: str = "company-documents",
    ) -> tuple[str, int]:
        namespace_path = Path(namespace.strip("/"))
        if namespace_path.is_absolute() or ".." in namespace_path.parts:
            raise HTTPException(status_code=400, detail="Invalid storage namespace")

        # Project workspaces are private file vaults used for source files,
        # certificates, JSON/configs, archives and other delivery artifacts.
        # Keep the stricter allowlist for other document areas, but allow any
        # file type inside an organization-scoped project namespace.
        allow_all_file_types = bool(namespace_path.parts) and namespace_path.parts[0] == PROJECT_DOCUMENT_NAMESPACE

        suffix = Path(original_filename or "").suffix.lower()
        if not allow_all_file_types:
            if suffix not in ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document file type")
            if content_type and content_type not in ALLOWED_CONTENT_TYPES:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document content type")

        relative = Path("organizations") / organization_id / namespace_path / f"{uuid4().hex}{suffix}"
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
