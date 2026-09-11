from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import DbSession, require_any_tenant_permission
from app.models.projects import Project, ProjectNote
from app.services.activity_log import record_activity
from app.services.project_access import require_project_tab
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/projects", tags=["Projects"])
ProjectAccessor = Annotated[
    TenantContext,
    Depends(require_any_tenant_permission("projects.view", "projects.work", "projects.manage")),
]


class ProjectNoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    content: str = Field(min_length=1, max_length=20000)


class ProjectNoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    content: str | None = Field(default=None, min_length=1, max_length=20000)


class ProjectNoteRead(BaseModel):
    id: str
    title: str
    content: str
    created_by_user_id: str
    created_at: datetime
    updated_at: datetime


def _project(db: DbSession, tenant: TenantContext, project_id: str) -> Project:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == tenant.organization_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _require_notes_access(db: DbSession, tenant: TenantContext, project: Project):
    return require_project_tab(db, tenant, project, "notes")


def _require_notes_manager(db: DbSession, tenant: TenantContext, project: Project) -> None:
    access = _require_notes_access(db, tenant, project)
    if not (access.can_manage_project or access.is_project_manager):
        raise HTTPException(status_code=403, detail="Project manager access required to manage project notes")


def _note(db: DbSession, tenant: TenantContext, project_id: str, note_id: str) -> ProjectNote:
    note = db.scalar(
        select(ProjectNote).where(
            ProjectNote.id == note_id,
            ProjectNote.organization_id == tenant.organization_id,
            ProjectNote.project_id == project_id,
        )
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Project note not found")
    return note


def _read(note: ProjectNote) -> ProjectNoteRead:
    return ProjectNoteRead(
        id=note.id,
        title=note.title,
        content=note.content,
        created_by_user_id=note.created_by_user_id,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


@router.get("/{project_id}/notes", response_model=list[ProjectNoteRead])
def list_project_notes(project_id: str, db: DbSession, tenant: ProjectAccessor) -> list[ProjectNoteRead]:
    project = _project(db, tenant, project_id)
    _require_notes_access(db, tenant, project)
    notes = db.scalars(
        select(ProjectNote)
        .where(
            ProjectNote.organization_id == tenant.organization_id,
            ProjectNote.project_id == project.id,
        )
        .order_by(ProjectNote.updated_at.desc(), ProjectNote.created_at.desc())
    ).all()
    return [_read(note) for note in notes]


@router.post("/{project_id}/notes", response_model=ProjectNoteRead, status_code=status.HTTP_201_CREATED)
def create_project_note(
    project_id: str,
    payload: ProjectNoteCreate,
    request: Request,
    db: DbSession,
    tenant: ProjectAccessor,
) -> ProjectNoteRead:
    project = _project(db, tenant, project_id)
    _require_notes_manager(db, tenant, project)
    title = payload.title.strip()
    content = payload.content.strip()
    if not title or not content:
        raise HTTPException(status_code=400, detail="Note title and content are required")

    note = ProjectNote(
        organization_id=tenant.organization_id,
        project_id=project.id,
        title=title,
        content=content,
        created_by_user_id=tenant.user_id,
    )
    db.add(note)
    db.flush()
    record_activity(
        db,
        action="projects.note.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project_note",
        entity_id=note.id,
        after={"project_id": project.id, "title": note.title},
        metadata={"project_number": project.project_number},
        message=f"Project note added to {project.project_number}: {note.title}",
        request=request,
    )
    db.commit()
    db.refresh(note)
    return _read(note)


@router.patch("/{project_id}/notes/{note_id}", response_model=ProjectNoteRead)
def update_project_note(
    project_id: str,
    note_id: str,
    payload: ProjectNoteUpdate,
    request: Request,
    db: DbSession,
    tenant: ProjectAccessor,
) -> ProjectNoteRead:
    project = _project(db, tenant, project_id)
    _require_notes_manager(db, tenant, project)
    note = _note(db, tenant, project.id, note_id)
    before = {"title": note.title, "content": note.content}

    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes:
        title = (changes["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="Note title is required")
        note.title = title
    if "content" in changes:
        content = (changes["content"] or "").strip()
        if not content:
            raise HTTPException(status_code=400, detail="Note content is required")
        note.content = content

    db.flush()
    record_activity(
        db,
        action="projects.note.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project_note",
        entity_id=note.id,
        before=before,
        after={"title": note.title, "content": note.content},
        metadata={"project_id": project.id, "project_number": project.project_number},
        message=f"Project note updated on {project.project_number}: {note.title}",
        request=request,
    )
    db.commit()
    db.refresh(note)
    return _read(note)


@router.delete("/{project_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_note(
    project_id: str,
    note_id: str,
    request: Request,
    db: DbSession,
    tenant: ProjectAccessor,
) -> Response:
    project = _project(db, tenant, project_id)
    _require_notes_manager(db, tenant, project)
    note = _note(db, tenant, project.id, note_id)
    before = {"title": note.title, "content": note.content}
    db.delete(note)
    record_activity(
        db,
        action="projects.note.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project_note",
        entity_id=note.id,
        before=before,
        metadata={"project_id": project.id, "project_number": project.project_number},
        message=f"Project note deleted from {project.project_number}: {note.title}",
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
