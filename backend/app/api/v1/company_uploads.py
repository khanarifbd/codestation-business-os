from __future__ import annotations

import mimetypes
import re
from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from starlette.responses import FileResponse, Response

from app.api.dependencies import CurrentTenantAdmin, DbSession
from app.models.company_settings import OrganizationDocument
from app.schemas.company_settings import CompanyDocumentRead
from app.services.activity_log import record_activity
from app.services.document_storage import storage

router = APIRouter(prefix="/company-settings", tags=["Company Settings"])


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _optional_date(value: str | None, field_name: str) -> date | None:
    normalized = _optional_text(value)
    if normalized is None:
        return None
    try:
        return date.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field_name} date",
        ) from exc


def _download_name(title: str, storage_key: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", title.strip()).strip("-.") or "document"
    return f"{stem}{Path(storage_key).suffix.lower()}"


@router.post(
    "/documents/upload",
    response_model=CompanyDocumentRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_company_document(
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
    file: Annotated[UploadFile, File()],
    document_type: Annotated[str, Form(min_length=1, max_length=64)],
    title: Annotated[str, Form(min_length=1, max_length=180)],
    document_number: Annotated[str | None, Form()] = None,
    issuing_authority: Annotated[str | None, Form()] = None,
    issue_date: Annotated[str | None, Form()] = None,
    expiry_date: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
) -> CompanyDocumentRead:
    parsed_issue_date = _optional_date(issue_date, "issue")
    parsed_expiry_date = _optional_date(expiry_date, "expiry")

    try:
        storage_key, size_bytes = storage.save(
            organization_id=tenant.organization_id,
            source=file.file,
            original_filename=file.filename or "document",
            content_type=file.content_type,
        )
    except HTTPException as exc:
        record_activity(
            db,
            action="company.document.upload_failed",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization_document",
            outcome="failure",
            message=str(exc.detail),
            metadata={
                "original_filename": file.filename,
                "content_type": file.content_type,
            },
            request=request,
        )
        db.commit()
        raise

    item = OrganizationDocument(
        organization_id=tenant.organization_id,
        document_type=document_type.strip().lower(),
        title=title.strip(),
        document_number=_optional_text(document_number),
        issuing_authority=_optional_text(issuing_authority),
        issue_date=parsed_issue_date,
        expiry_date=parsed_expiry_date,
        storage_key=storage_key,
        notes=_optional_text(notes),
    )
    db.add(item)

    try:
        db.flush()
        item.file_url = f"/api/company-settings/documents/{item.id}/file"
        db.flush()
        after = CompanyDocumentRead.model_validate(item).model_dump(mode="json")
        record_activity(
            db,
            action="company.document.uploaded",
            scope="tenant",
            actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id,
            entity_type="organization_document",
            entity_id=item.id,
            after=after,
            metadata={
                "original_filename": file.filename,
                "content_type": file.content_type,
                "size_bytes": size_bytes,
                "storage_provider": "local",
            },
            message=f"Company document uploaded: {item.title}",
            request=request,
        )
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(storage_key)
        raise

    db.refresh(item)
    return CompanyDocumentRead.model_validate(item)


@router.get("/documents/{document_id}/file")
def download_company_document(
    document_id: str,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> FileResponse:
    item = db.scalar(
        select(OrganizationDocument).where(
            OrganizationDocument.id == document_id,
            OrganizationDocument.organization_id == tenant.organization_id,
        )
    )
    if item is None or not item.storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found")

    path = storage.resolve(item.storage_key)
    filename = _download_name(item.title, item.storage_key)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=filename)


@router.delete("/document-files/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_uploaded_company_document(
    document_id: str,
    request: Request,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> Response:
    item = db.scalar(
        select(OrganizationDocument).where(
            OrganizationDocument.id == document_id,
            OrganizationDocument.organization_id == tenant.organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    storage_key = item.storage_key
    before = CompanyDocumentRead.model_validate(item).model_dump(mode="json")
    db.delete(item)
    record_activity(
        db,
        action="company.document.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization_document",
        entity_id=item.id,
        before=before,
        after=None,
        metadata={"storage_provider": "local" if storage_key else None},
        message=f"Company document removed: {item.title}",
        request=request,
    )
    db.commit()

    if storage_key:
        storage.delete(storage_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)