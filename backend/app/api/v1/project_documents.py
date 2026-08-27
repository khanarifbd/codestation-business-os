from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.projects import Project, ProjectDocument
from app.schemas.project_execution import ProjectDocumentRead
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/projects", tags=["Project Documents"])
ProjectManager = Annotated[TenantContext, Depends(require_tenant_permission("projects.manage"))]


class ProjectDocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    document_type: str | None = Field(default=None, min_length=1, max_length=64)
    notes: str | None = None


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


@router.patch("/{project_id}/documents/{document_id}", response_model=ProjectDocumentRead)
def update_project_document(
    project_id: str,
    document_id: str,
    payload: ProjectDocumentUpdate,
    request: Request,
    db: DbSession,
    tenant: ProjectManager,
) -> ProjectDocumentRead:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == tenant.organization_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status in {"completed", "cancelled"}:
        raise HTTPException(status_code=409, detail=f"{project.status.capitalize()} projects are locked")

    item = db.scalar(
        select(ProjectDocument)
        .where(
            ProjectDocument.id == document_id,
            ProjectDocument.project_id == project.id,
            ProjectDocument.organization_id == tenant.organization_id,
        )
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Project document not found")

    before = {
        "title": item.title,
        "document_type": item.document_type,
        "notes": item.notes,
    }
    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes:
        title = _clean(changes["title"])
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        item.title = title
    if "document_type" in changes:
        document_type = _clean(changes["document_type"])
        if not document_type:
            raise HTTPException(status_code=400, detail="Document type cannot be empty")
        item.document_type = document_type.lower()
    if "notes" in changes:
        item.notes = _clean(changes["notes"])

    db.flush()
    record_activity(
        db,
        action="projects.document.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project_document",
        entity_id=item.id,
        before=before,
        after={
            "title": item.title,
            "document_type": item.document_type,
            "notes": item.notes,
            "project_id": project.id,
        },
        message=f"Project document updated: {item.title}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return ProjectDocumentRead.model_validate(item, from_attributes=True)
