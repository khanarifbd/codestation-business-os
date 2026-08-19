from __future__ import annotations

import logging
import mimetypes
import re
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from starlette.responses import FileResponse, Response

from app.api.dependencies import DbSession, require_tenant_permission
from app.core.config import settings
from app.models.activity_log import ActivityLog
from app.models.client_profiles import ClientCredential, ClientDocument, ClientNote
from app.models.crm import Client
from app.models.user import User
from app.schemas.project_execution import CredentialCreate, CredentialRead, CredentialReveal, CredentialUpdate, ProjectDocumentRead
from app.services.activity_log import record_activity
from app.services.document_storage import storage
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm/clients", tags=["Client Resources"])
ClientResourceViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]
ClientResourceManager = Annotated[TenantContext, Depends(require_tenant_permission("clients.manage"))]
logger = logging.getLogger(__name__)

PREVIEW_MEDIA_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "text/plain",
}


class ClientNoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    content: str = Field(min_length=1, max_length=20000)


class ClientNoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    content: str | None = Field(default=None, min_length=1, max_length=20000)


class ClientNoteRead(BaseModel):
    id: str
    title: str
    content: str
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _required(value: str, label: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail=f"{label} cannot be empty")
    return cleaned


def _client(db: DbSession, organization_id: str, client_id: str) -> Client:
    item = db.scalar(
        select(Client).where(
            Client.id == client_id,
            Client.organization_id == organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return item


def _note_read(item: ClientNote) -> ClientNoteRead:
    return ClientNoteRead.model_validate(item, from_attributes=True)


def _document_read(item: ClientDocument) -> ProjectDocumentRead:
    return ProjectDocumentRead.model_validate(item, from_attributes=True)


def _vault_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="Credentials Vault is temporarily unavailable. Please contact your administrator.")


def _encrypt_secret(db: DbSession, secret: str) -> bytes:
    if settings.environment != "development" and settings.project_credential_encryption_key.startswith("development-only"):
        raise _vault_unavailable()
    try:
        return db.execute(
            text("SELECT pgp_sym_encrypt(:secret, :key, 'cipher-algo=aes256')"),
            {"secret": secret, "key": settings.project_credential_encryption_key},
        ).scalar_one()
    except HTTPException:
        raise
    except Exception:
        logger.error("Client Credentials Vault encryption operation failed")
        raise _vault_unavailable()


def _decrypt_secret(db: DbSession, ciphertext: bytes) -> str:
    if settings.environment != "development" and settings.project_credential_encryption_key.startswith("development-only"):
        raise _vault_unavailable()
    try:
        return db.execute(
            text("SELECT pgp_sym_decrypt(:ciphertext, :key)"),
            {"ciphertext": ciphertext, "key": settings.project_credential_encryption_key},
        ).scalar_one()
    except HTTPException:
        raise
    except Exception:
        logger.error("Client Credentials Vault decryption operation failed")
        raise _vault_unavailable()


def _last_credential_reveal(db: DbSession, organization_id: str, credential_id: str) -> tuple[datetime | None, str | None]:
    row = db.execute(
        select(ActivityLog.created_at, User.full_name)
        .outerjoin(User, User.id == ActivityLog.actor_user_id)
        .where(
            ActivityLog.organization_id == organization_id,
            ActivityLog.action == "clients.credential.revealed",
            ActivityLog.entity_type == "client_credential",
            ActivityLog.entity_id == credential_id,
            ActivityLog.outcome == "success",
        )
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(1)
    ).first()
    return (row[0], row[1]) if row else (None, None)


def _credential_read(db: DbSession, item: ClientCredential) -> CredentialRead:
    last_revealed_at, last_revealed_by = _last_credential_reveal(db, item.organization_id, item.id)
    return CredentialRead(
        id=item.id,
        name=item.name,
        credential_type=item.credential_type,
        environment=item.environment,
        username=item.username,
        url=item.url,
        notes=item.notes,
        access_level=item.access_level,
        created_by_user_id=item.created_by_user_id,
        last_revealed_by=last_revealed_by,
        last_revealed_at=last_revealed_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("/{client_id}/notes", response_model=list[ClientNoteRead])
def list_client_notes(client_id: str, db: DbSession, tenant: ClientResourceViewer):
    client = _client(db, tenant.organization_id, client_id)
    items = db.scalars(
        select(ClientNote)
        .where(ClientNote.organization_id == tenant.organization_id, ClientNote.client_id == client.id)
        .order_by(ClientNote.updated_at.desc(), ClientNote.created_at.desc())
    ).all()
    return [_note_read(item) for item in items]


@router.post("/{client_id}/notes", response_model=ClientNoteRead, status_code=status.HTTP_201_CREATED)
def create_client_note(client_id: str, payload: ClientNoteCreate, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item = ClientNote(
        organization_id=tenant.organization_id,
        client_id=client.id,
        title=_required(payload.title, "Title"),
        content=_required(payload.content, "Content"),
        created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    record_activity(
        db, action="clients.note.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_note", entity_id=item.id,
        after={"client_id": client.id, "title": item.title},
        message=f"Client note added to {client.client_code}: {item.title}", request=request,
    )
    db.commit(); db.refresh(item)
    return _note_read(item)


@router.patch("/{client_id}/notes/{note_id}", response_model=ClientNoteRead)
def update_client_note(client_id: str, note_id: str, payload: ClientNoteUpdate, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item = db.scalar(
        select(ClientNote).where(
            ClientNote.id == note_id,
            ClientNote.organization_id == tenant.organization_id,
            ClientNote.client_id == client.id,
        ).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client note not found")
    before_title = item.title
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is None:
            raise HTTPException(status_code=400, detail=f"{field.title()} cannot be empty")
        value = _required(value, field.title())
        setattr(item, field, value)
    db.flush()
    record_activity(
        db, action="clients.note.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_note", entity_id=item.id,
        before={"title": before_title}, after={"title": item.title, "content_changed": "content" in changes},
        message=f"Client note updated for {client.client_code}: {item.title}", request=request,
    )
    db.commit(); db.refresh(item)
    return _note_read(item)


@router.delete("/{client_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_note(client_id: str, note_id: str, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item = db.scalar(
        select(ClientNote).where(
            ClientNote.id == note_id,
            ClientNote.organization_id == tenant.organization_id,
            ClientNote.client_id == client.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client note not found")
    before = {"client_id": client.id, "title": item.title}
    db.delete(item)
    record_activity(
        db, action="clients.note.deleted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_note", entity_id=item.id,
        before=before, message=f"Client note deleted from {client.client_code}: {item.title}", request=request,
    )
    db.commit()
    return Response(status_code=204)


@router.get("/{client_id}/documents", response_model=list[ProjectDocumentRead])
def list_client_documents(client_id: str, db: DbSession, tenant: ClientResourceViewer):
    client = _client(db, tenant.organization_id, client_id)
    items = db.scalars(
        select(ClientDocument)
        .where(ClientDocument.organization_id == tenant.organization_id, ClientDocument.client_id == client.id)
        .order_by(ClientDocument.created_at.desc())
    ).all()
    return [_document_read(item) for item in items]


@router.post("/{client_id}/documents/upload", response_model=ProjectDocumentRead, status_code=status.HTTP_201_CREATED)
def upload_client_document(
    client_id: str,
    request: Request,
    db: DbSession,
    tenant: ClientResourceManager,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(min_length=1, max_length=180)],
    document_type: Annotated[str | None, Form(min_length=1, max_length=64)] = "other",
    notes: Annotated[str | None, Form()] = None,
):
    client = _client(db, tenant.organization_id, client_id)
    clean_title = _required(title, "Title")
    clean_type = _required(document_type or "other", "Document type").lower()
    try:
        storage_key, size_bytes = storage.save(
            organization_id=tenant.organization_id,
            source=file.file,
            original_filename=file.filename or "document",
            content_type=file.content_type,
            namespace=f"clients/{client.id}/documents",
        )
    except HTTPException as exc:
        record_activity(
            db, action="clients.document.upload_failed", scope="tenant", actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id, entity_type="client_document", outcome="failure",
            message=str(exc.detail), metadata={"client_id": client.id, "original_filename": file.filename}, request=request,
        )
        db.commit(); raise
    item = ClientDocument(
        organization_id=tenant.organization_id,
        client_id=client.id,
        title=clean_title,
        document_type=clean_type,
        original_filename=file.filename or "document",
        content_type=file.content_type,
        size_bytes=size_bytes,
        storage_key=storage_key,
        notes=_clean(notes),
        uploaded_by_user_id=tenant.user_id,
    )
    db.add(item)
    try:
        db.flush()
        record_activity(
            db, action="clients.document.uploaded", scope="tenant", actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id, entity_type="client_document", entity_id=item.id,
            after={"client_id": client.id, "title": item.title, "document_type": item.document_type, "size_bytes": item.size_bytes},
            message=f"Client document uploaded for {client.client_code}: {item.title}", request=request,
        )
        db.commit()
    except Exception:
        db.rollback(); storage.delete(storage_key); raise
    db.refresh(item)
    return _document_read(item)


def _client_document_file(db: DbSession, organization_id: str, client_id: str, document_id: str):
    item = db.scalar(
        select(ClientDocument).where(
            ClientDocument.id == document_id,
            ClientDocument.organization_id == organization_id,
            ClientDocument.client_id == client_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client document not found")
    path = storage.resolve(item.storage_key)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", item.title).strip("-.") or "client-document"
    suffix = Path(item.original_filename).suffix.lower()
    filename = f"{safe}{suffix}"
    media_type = item.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return item, path, filename, media_type


@router.get("/{client_id}/documents/{document_id}/preview")
def preview_client_document(client_id: str, document_id: str, db: DbSession, tenant: ClientResourceViewer):
    _client(db, tenant.organization_id, client_id)
    _, path, filename, media_type = _client_document_file(db, tenant.organization_id, client_id, document_id)
    if media_type not in PREVIEW_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Preview is not available for this file type. Please download the document.")
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{client_id}/documents/{document_id}/file")
def download_client_document(client_id: str, document_id: str, db: DbSession, tenant: ClientResourceViewer):
    _client(db, tenant.organization_id, client_id)
    _, path, filename, media_type = _client_document_file(db, tenant.organization_id, client_id, document_id)
    return FileResponse(path, media_type=media_type, filename=filename)


@router.delete("/{client_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_document(client_id: str, document_id: str, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item, _, _, _ = _client_document_file(db, tenant.organization_id, client.id, document_id)
    storage_key = item.storage_key
    before = {"client_id": client.id, "title": item.title, "document_type": item.document_type}
    db.delete(item)
    record_activity(
        db, action="clients.document.deleted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_document", entity_id=item.id,
        before=before, message=f"Client document deleted from {client.client_code}: {item.title}", request=request,
    )
    db.commit(); storage.delete(storage_key)
    return Response(status_code=204)


@router.get("/{client_id}/credentials", response_model=list[CredentialRead])
def list_client_credentials(client_id: str, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    items = db.scalars(
        select(ClientCredential)
        .where(
            ClientCredential.organization_id == tenant.organization_id,
            ClientCredential.client_id == client.id,
        )
        .order_by(ClientCredential.created_at.desc())
    ).all()
    return [_credential_read(db, item) for item in items]


@router.post("/{client_id}/credentials", response_model=CredentialRead, status_code=status.HTTP_201_CREATED)
def create_client_credential(client_id: str, payload: CredentialCreate, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    name = _required(payload.name, "Name")
    credential_type = _required(payload.credential_type, "Credential type").lower()
    environment = _required(payload.environment, "Environment").lower()
    item = ClientCredential(
        organization_id=tenant.organization_id,
        client_id=client.id,
        name=name,
        credential_type=credential_type,
        environment=environment,
        username=_clean(payload.username),
        secret_ciphertext=_encrypt_secret(db, payload.secret),
        url=_clean(payload.url),
        notes=_clean(payload.notes),
        access_level=payload.access_level,
        created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    record_activity(
        db, action="clients.credential.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_credential", entity_id=item.id,
        after={"client_id": client.id, "name": item.name, "credential_type": item.credential_type, "environment": item.environment, "access_level": item.access_level},
        message=f"Client credential added to {client.client_code}: {item.name}", request=request,
    )
    db.commit(); db.refresh(item)
    return _credential_read(db, item)


@router.patch("/{client_id}/credentials/{credential_id}", response_model=CredentialRead)
def update_client_credential(client_id: str, credential_id: str, payload: CredentialUpdate, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item = db.scalar(
        select(ClientCredential).where(
            ClientCredential.id == credential_id,
            ClientCredential.organization_id == tenant.organization_id,
            ClientCredential.client_id == client.id,
        ).with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client credential not found")
    before = {"name": item.name, "credential_type": item.credential_type, "environment": item.environment, "access_level": item.access_level}
    changes = payload.model_dump(exclude_unset=True)
    secret = changes.pop("secret", None)
    for field, value in changes.items():
        if field in {"name", "credential_type", "environment", "access_level"} and value is None:
            raise HTTPException(status_code=400, detail=f"{field} cannot be empty")
        if isinstance(value, str):
            value = _clean(value)
        if field in {"name", "credential_type", "environment", "access_level"} and not value:
            raise HTTPException(status_code=400, detail=f"{field} cannot be empty")
        if field in {"credential_type", "environment"} and value:
            value = value.lower()
        setattr(item, field, value)
    if secret is not None:
        item.secret_ciphertext = _encrypt_secret(db, secret)
    db.flush()
    record_activity(
        db, action="clients.credential.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_credential", entity_id=item.id,
        before=before,
        after={"name": item.name, "credential_type": item.credential_type, "environment": item.environment, "access_level": item.access_level, "secret_changed": secret is not None},
        message=f"Client credential updated for {client.client_code}: {item.name}", request=request,
    )
    db.commit(); db.refresh(item)
    return _credential_read(db, item)


@router.post("/{client_id}/credentials/{credential_id}/reveal", response_model=CredentialReveal)
def reveal_client_credential(client_id: str, credential_id: str, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item = db.scalar(
        select(ClientCredential).where(
            ClientCredential.id == credential_id,
            ClientCredential.organization_id == tenant.organization_id,
            ClientCredential.client_id == client.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client credential not found")
    secret = _decrypt_secret(db, item.secret_ciphertext)
    record_activity(
        db, action="clients.credential.revealed", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_credential", entity_id=item.id,
        metadata={"client_id": client.id, "credential_name": item.name, "access_level": item.access_level},
        message=f"Client credential revealed: {client.client_code} · {item.name}", request=request,
    )
    db.commit()
    return CredentialReveal(id=item.id, secret=secret)


@router.delete("/{client_id}/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_credential(client_id: str, credential_id: str, request: Request, db: DbSession, tenant: ClientResourceManager):
    client = _client(db, tenant.organization_id, client_id)
    item = db.scalar(
        select(ClientCredential).where(
            ClientCredential.id == credential_id,
            ClientCredential.organization_id == tenant.organization_id,
            ClientCredential.client_id == client.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Client credential not found")
    before = {"client_id": client.id, "name": item.name, "credential_type": item.credential_type, "access_level": item.access_level}
    db.delete(item)
    record_activity(
        db, action="clients.credential.deleted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="client_credential", entity_id=item.id,
        before=before, message=f"Client credential deleted from {client.client_code}: {item.name}", request=request,
    )
    db.commit()
    return Response(status_code=204)
