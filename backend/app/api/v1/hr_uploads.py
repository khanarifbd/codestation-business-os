import mimetypes
import re
from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from starlette.responses import FileResponse

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.hr import EmployeeHRDocument
from app.models.team import Employee
from app.services.activity_log import record_activity
from app.services.document_storage import storage
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr-documents", tags=["HR Documents"])
HRManager = Annotated[TenantContext, Depends(require_tenant_permission("hr.manage"))]
HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]


def _date(value: str | None) -> date | None:
    if not value: return None
    try: return date.fromisoformat(value)
    except ValueError as exc: raise HTTPException(status_code=400, detail="Invalid date") from exc


def _filename(title: str, key: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", title).strip("-.") or "document"
    return f"{stem}{Path(key).suffix.lower()}"


@router.post("/upload", status_code=status.HTTP_201_CREATED)
def upload_document(
    request: Request,
    db: DbSession,
    tenant: HRManager,
    file: Annotated[UploadFile, File()],
    employee_id: Annotated[str, Form()],
    title: Annotated[str, Form()],
    document_type: Annotated[str, Form()],
    reference_number: Annotated[str | None, Form()] = None,
    issued_on: Annotated[str | None, Form()] = None,
    expires_on: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
):
    employee = db.scalar(select(Employee.id).where(Employee.id == employee_id, Employee.organization_id == tenant.organization_id))
    if employee is None: raise HTTPException(status_code=404, detail="Employee not found")
    try:
        key, size = storage.save(organization_id=tenant.organization_id, source=file.file, original_filename=file.filename or "document", content_type=file.content_type)
    except HTTPException as exc:
        record_activity(db, action="hr.document.upload_failed", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="employee_hr_document", outcome="failure", message=str(exc.detail), metadata={"employee_id": employee_id, "filename": file.filename}, request=request)
        db.commit(); raise
    item = EmployeeHRDocument(
        organization_id=tenant.organization_id, employee_id=employee_id, title=title.strip(), document_type=document_type.strip().lower(),
        reference_number=(reference_number or "").strip() or None, issued_on=_date(issued_on), expires_on=_date(expires_on), notes=(notes or "").strip() or None,
        storage_key=key, original_filename=file.filename or "document", content_type=file.content_type, size_bytes=size,
    )
    db.add(item)
    try:
        db.flush(); item.file_url = f"/api/hr-documents/{item.id}/file"
        record_activity(db, action="hr.document.uploaded", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="employee_hr_document", entity_id=item.id, after={"employee_id": employee_id, "title": item.title, "document_type": item.document_type}, metadata={"filename": item.original_filename, "size_bytes": size}, request=request)
        db.commit()
    except Exception:
        db.rollback(); storage.delete(key); raise
    return {"id": item.id, "file_url": item.file_url}


@router.get("/{document_id}/file")
def manager_file(document_id: str, db: DbSession, tenant: HRManager):
    item = db.scalar(select(EmployeeHRDocument).where(EmployeeHRDocument.id == document_id, EmployeeHRDocument.organization_id == tenant.organization_id))
    if item is None or not item.storage_key: raise HTTPException(status_code=404, detail="Document file not found")
    name = item.original_filename or _filename(item.title, item.storage_key)
    return FileResponse(storage.resolve(item.storage_key), media_type=item.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream", filename=name)


@router.get("/self/{document_id}/file")
def self_file(document_id: str, db: DbSession, tenant: HRSelf):
    employee = db.scalar(select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.membership_id == tenant.membership_id))
    if employee is None: raise HTTPException(status_code=404, detail="Employee profile not found")
    item = db.scalar(select(EmployeeHRDocument).where(EmployeeHRDocument.id == document_id, EmployeeHRDocument.organization_id == tenant.organization_id, EmployeeHRDocument.employee_id == employee.id))
    if item is None or not item.storage_key: raise HTTPException(status_code=404, detail="Document file not found")
    name = item.original_filename or _filename(item.title, item.storage_key)
    return FileResponse(storage.resolve(item.storage_key), media_type=item.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream", filename=name)
