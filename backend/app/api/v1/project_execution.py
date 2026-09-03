from __future__ import annotations

import logging
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import func, select, text
from starlette.responses import FileResponse, Response

from app.api.dependencies import DbSession, require_any_tenant_permission, require_tenant_permission
from app.core.config import settings
from app.models.activity_log import ActivityLog
from app.models.membership import Membership
from app.models.projects import (
    Project,
    ProjectCredential,
    ProjectDocument,
    ProjectMember,
    ProjectMilestone,
    ProjectTask,
    ProjectWorkLog,
)
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.schemas.project_execution import (
    CredentialCreate,
    CredentialRead,
    CredentialReveal,
    CredentialUpdate,
    MilestoneCreate,
    MilestoneRead,
    MilestoneUpdate,
    ProjectDocumentRead,
    ProjectExecutionSummary,
    ProjectWorkspace,
    TaskCreate,
    TaskProgressUpdate,
    TaskRead,
    TaskUpdate,
    WorkLogRead,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.document_storage import storage
from app.services.project_access import require_project_access, require_project_tab
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/projects", tags=["Project Execution"])
ProjectReader = Annotated[TenantContext, Depends(require_any_tenant_permission("projects.view", "projects.work"))]
ProjectWorker = Annotated[TenantContext, Depends(require_tenant_permission("projects.work"))]
logger = logging.getLogger(__name__)

PREVIEW_MEDIA_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "text/plain",
}


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _project(db: DbSession, tenant: TenantContext, project_id: str, *, lock: bool = False) -> Project:
    query = select(Project).where(Project.id == project_id, Project.organization_id == tenant.organization_id)
    if lock:
        query = query.with_for_update()
    project = db.scalar(query)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _employee_for_user(db: DbSession, tenant: TenantContext) -> Employee | None:
    return db.scalar(
        select(Employee)
        .join(Membership, Membership.id == Employee.membership_id)
        .where(
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
            Membership.user_id == tenant.user_id,
            Membership.status == "active",
            Employee.employment_status == "active",
        )
    )


def _has_manage_permission(db: DbSession, tenant: TenantContext) -> bool:
    role = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    return bool(role and ("*" in role.permissions or "projects.manage" in role.permissions))


def _is_project_member(db: DbSession, project: Project, employee: Employee | None) -> bool:
    if employee is None:
        return False
    return db.scalar(
        select(ProjectMember.id).where(
            ProjectMember.organization_id == project.organization_id,
            ProjectMember.project_id == project.id,
            ProjectMember.employee_id == employee.id,
            ProjectMember.is_active.is_(True),
        )
    ) is not None


def _can_manage_project(db: DbSession, tenant: TenantContext, project: Project, employee: Employee | None = None) -> bool:
    employee = employee or _employee_for_user(db, tenant)
    return _has_manage_permission(db, tenant) or bool(employee and project.project_manager_employee_id == employee.id)


def _require_participant(db: DbSession, tenant: TenantContext, project: Project) -> Employee | None:
    access = require_project_access(db, tenant, project)
    return db.get(Employee, access.current_employee_id) if access.current_employee_id else None


def _require_manager(db: DbSession, tenant: TenantContext, project: Project) -> Employee | None:
    employee = _employee_for_user(db, tenant)
    if _can_manage_project(db, tenant, project, employee):
        return employee
    raise HTTPException(status_code=403, detail="Project manager access required")


def _ensure_open(project: Project) -> None:
    if project.status in {"completed", "cancelled"}:
        raise HTTPException(status_code=409, detail=f"{project.status.capitalize()} projects are locked")


def _employee_name_map(db: DbSession, organization_id: str) -> dict[str, str]:
    rows = db.execute(
        select(Employee.id, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(Employee.organization_id == organization_id)
    ).all()
    return {row.id: row.full_name for row in rows}


def _milestone_reads(db: DbSession, project: Project) -> list[MilestoneRead]:
    items = db.scalars(
        select(ProjectMilestone)
        .where(ProjectMilestone.organization_id == project.organization_id, ProjectMilestone.project_id == project.id)
        .order_by(ProjectMilestone.sort_order.asc(), ProjectMilestone.created_at.asc())
    ).all()
    return [MilestoneRead.model_validate(item, from_attributes=True) for item in items]


def _task_reads(db: DbSession, project: Project) -> list[TaskRead]:
    employee_names = _employee_name_map(db, project.organization_id)
    milestones = {item.id: item.title for item in db.scalars(select(ProjectMilestone).where(ProjectMilestone.project_id == project.id)).all()}
    tasks = db.scalars(
        select(ProjectTask)
        .where(ProjectTask.organization_id == project.organization_id, ProjectTask.project_id == project.id)
        .order_by(ProjectTask.created_at.asc())
    ).all()
    return [
        TaskRead(
            id=item.id,
            task_code=item.task_code,
            milestone_id=item.milestone_id,
            milestone_title=milestones.get(item.milestone_id) if item.milestone_id else None,
            title=item.title,
            description=item.description,
            status=item.status,
            priority=item.priority,
            progress_percent=item.progress_percent,
            assignee_employee_id=item.assignee_employee_id,
            assignee_name=employee_names.get(item.assignee_employee_id) if item.assignee_employee_id else None,
            planned_start_date=item.planned_start_date,
            due_date=item.due_date,
            estimated_minutes=item.estimated_minutes,
            completed_at=item.completed_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in tasks
    ]


def _work_log_reads(db: DbSession, project: Project, limit: int = 50) -> list[WorkLogRead]:
    rows = db.execute(
        select(ProjectWorkLog, ProjectTask.task_code, ProjectTask.title, User.full_name)
        .join(ProjectTask, ProjectTask.id == ProjectWorkLog.task_id)
        .join(User, User.id == ProjectWorkLog.user_id)
        .where(ProjectWorkLog.organization_id == project.organization_id, ProjectWorkLog.project_id == project.id)
        .order_by(ProjectWorkLog.created_at.desc())
        .limit(limit)
    ).all()
    return [
        WorkLogRead(
            id=log.id, task_id=log.task_id, task_code=task_code, task_title=task_title,
            employee_id=log.employee_id, employee_name=full_name, note=log.note,
            progress_percent=log.progress_percent, time_spent_minutes=log.time_spent_minutes,
            created_at=log.created_at,
        )
        for log, task_code, task_title, full_name in rows
    ]


def _document_reads(db: DbSession, project: Project) -> list[ProjectDocumentRead]:
    items = db.scalars(
        select(ProjectDocument)
        .where(ProjectDocument.organization_id == project.organization_id, ProjectDocument.project_id == project.id)
        .order_by(ProjectDocument.created_at.desc())
    ).all()
    return [ProjectDocumentRead.model_validate(item, from_attributes=True) for item in items]


def _last_credential_reveal(db: DbSession, project: Project, credential_id: str) -> tuple[datetime | None, str | None]:
    row = db.execute(
        select(ActivityLog.created_at, User.full_name)
        .outerjoin(User, User.id == ActivityLog.actor_user_id)
        .where(
            ActivityLog.organization_id == project.organization_id,
            ActivityLog.action == "projects.credential.revealed",
            ActivityLog.entity_type == "project_credential",
            ActivityLog.entity_id == credential_id,
            ActivityLog.outcome == "success",
        )
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(1)
    ).first()
    if row is None:
        return None, None
    return row[0], row[1]


def _credential_read(db: DbSession, project: Project, item: ProjectCredential) -> CredentialRead:
    last_revealed_at, last_revealed_by = _last_credential_reveal(db, project, item.id)
    return CredentialRead(
        id=item.id, name=item.name, credential_type=item.credential_type, environment=item.environment,
        username=item.username, url=item.url, notes=item.notes, access_level=item.access_level,
        created_by_user_id=item.created_by_user_id, last_revealed_by=last_revealed_by,
        last_revealed_at=last_revealed_at, created_at=item.created_at, updated_at=item.updated_at,
    )


def _credential_reads(db: DbSession, tenant: TenantContext, project: Project, employee: Employee | None) -> list[CredentialRead]:
    query = select(ProjectCredential).where(
        ProjectCredential.organization_id == project.organization_id,
        ProjectCredential.project_id == project.id,
    )
    if not _can_manage_project(db, tenant, project, employee):
        query = query.where(ProjectCredential.access_level == "team")
    items = db.scalars(query.order_by(ProjectCredential.created_at.desc())).all()
    return [_credential_read(db, project, item) for item in items]


def _recalculate_progress(db: DbSession, project: Project) -> None:
    tasks = db.scalars(
        select(ProjectTask).where(
            ProjectTask.organization_id == project.organization_id,
            ProjectTask.project_id == project.id,
            ProjectTask.status != "cancelled",
        )
    ).all()
    project.progress_percent = round(sum(task.progress_percent for task in tasks) / len(tasks)) if tasks else 0

    milestones = db.scalars(
        select(ProjectMilestone).where(
            ProjectMilestone.organization_id == project.organization_id,
            ProjectMilestone.project_id == project.id,
        )
    ).all()
    now = datetime.now(timezone.utc)
    for milestone in milestones:
        milestone_tasks = [task for task in tasks if task.milestone_id == milestone.id]
        if not milestone_tasks:
            milestone.progress_percent = 0
            continue
        milestone.progress_percent = round(sum(task.progress_percent for task in milestone_tasks) / len(milestone_tasks))
        if milestone.progress_percent == 100:
            milestone.status = "completed"
            milestone.completed_at = milestone.completed_at or now
        elif milestone.progress_percent > 0 and milestone.status == "planned":
            milestone.status = "in_progress"
            milestone.completed_at = None
        elif milestone.progress_percent < 100 and milestone.status == "completed":
            milestone.status = "in_progress"
            milestone.completed_at = None


def _summary(db: DbSession, project: Project, allowed_tabs: frozenset[str]) -> ProjectExecutionSummary:
    today = datetime.now(timezone.utc).date()
    can_see_tasks = "tasks" in allowed_tabs or "overview" in allowed_tabs
    can_see_milestones = "milestones" in allowed_tabs or "overview" in allowed_tabs
    task_count = db.scalar(select(func.count(ProjectTask.id)).where(ProjectTask.project_id == project.id)) or 0 if can_see_tasks else 0
    open_count = db.scalar(select(func.count(ProjectTask.id)).where(ProjectTask.project_id == project.id, ProjectTask.status.not_in(["completed", "cancelled"]))) or 0 if can_see_tasks else 0
    overdue = db.scalar(select(func.count(ProjectTask.id)).where(ProjectTask.project_id == project.id, ProjectTask.due_date < today, ProjectTask.status.not_in(["completed", "cancelled"]))) or 0 if can_see_tasks else 0
    blocked = db.scalar(select(func.count(ProjectTask.id)).where(ProjectTask.project_id == project.id, ProjectTask.status == "blocked")) or 0 if can_see_tasks else 0
    milestones = db.scalar(select(func.count(ProjectMilestone.id)).where(ProjectMilestone.project_id == project.id)) or 0 if can_see_milestones else 0
    documents = (db.scalar(select(func.count(ProjectDocument.id)).where(ProjectDocument.project_id == project.id)) or 0) if "documents" in allowed_tabs else 0
    credentials = (db.scalar(select(func.count(ProjectCredential.id)).where(ProjectCredential.project_id == project.id)) or 0) if "credentials" in allowed_tabs else 0
    return ProjectExecutionSummary(
        progress_percent=project.progress_percent, milestone_count=int(milestones), task_count=int(task_count),
        open_task_count=int(open_count), overdue_task_count=int(overdue), blocked_task_count=int(blocked),
        document_count=int(documents), credential_count=int(credentials),
    )


@router.get("/{project_id}/workspace", response_model=ProjectWorkspace)
def get_workspace(project_id: str, db: DbSession, tenant: ProjectReader) -> ProjectWorkspace:
    project = _project(db, tenant, project_id)
    access = require_project_access(db, tenant, project)
    employee = _employee_for_user(db, tenant)
    allowed = access.allowed_tabs
    return ProjectWorkspace(
        summary=_summary(db, project, allowed),
        milestones=_milestone_reads(db, project) if "milestones" in allowed or "overview" in allowed else [],
        tasks=_task_reads(db, project) if "tasks" in allowed else [],
        recent_work=_work_log_reads(db, project) if "work" in allowed or "overview" in allowed else [],
        documents=_document_reads(db, project) if "documents" in allowed else [],
        credentials=_credential_reads(db, tenant, project, employee) if "credentials" in allowed else [],
        can_manage_credentials="credentials" in allowed and _can_manage_project(db, tenant, project, employee),
    )


@router.post("/{project_id}/milestones", response_model=MilestoneRead, status_code=201)
def create_milestone(project_id: str, payload: MilestoneCreate, request: Request, db: DbSession, tenant: ProjectWorker) -> MilestoneRead:
    project = _project(db, tenant, project_id, lock=True); _require_manager(db, tenant, project); _ensure_open(project)
    item = ProjectMilestone(
        organization_id=tenant.organization_id, project_id=project.id, title=payload.title.strip(),
        description=_clean(payload.description), due_date=payload.due_date, sort_order=payload.sort_order,
        status="planned", progress_percent=0, created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    record_activity(db, action="projects.milestone.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_milestone", entity_id=item.id,
        after={"project_id": project.id, "title": item.title, "due_date": item.due_date.isoformat() if item.due_date else None},
        message=f"Milestone created in {project.project_number}: {item.title}", request=request)
    db.commit(); db.refresh(item)
    return MilestoneRead.model_validate(item, from_attributes=True)


@router.patch("/{project_id}/milestones/{milestone_id}", response_model=MilestoneRead)
def update_milestone(project_id: str, milestone_id: str, payload: MilestoneUpdate, request: Request, db: DbSession, tenant: ProjectWorker) -> MilestoneRead:
    project = _project(db, tenant, project_id, lock=True); _require_manager(db, tenant, project); _ensure_open(project)
    item = db.scalar(select(ProjectMilestone).where(ProjectMilestone.id == milestone_id, ProjectMilestone.project_id == project.id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Milestone not found")
    before = {"title": item.title, "status": item.status, "due_date": item.due_date.isoformat() if item.due_date else None}
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in {"title", "description"} and isinstance(value, str): value = _clean(value)
        if field == "title" and not value: raise HTTPException(status_code=400, detail="Milestone title cannot be empty")
        setattr(item, field, value)
    if item.status == "completed": item.completed_at = item.completed_at or datetime.now(timezone.utc)
    elif "status" in changes: item.completed_at = None
    db.flush()
    record_activity(db, action="projects.milestone.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_milestone", entity_id=item.id,
        before=before, after={"title": item.title, "status": item.status, "due_date": item.due_date.isoformat() if item.due_date else None},
        message=f"Milestone updated in {project.project_number}: {item.title}", request=request)
    db.commit(); db.refresh(item)
    return MilestoneRead.model_validate(item, from_attributes=True)


@router.post("/{project_id}/tasks", response_model=TaskRead, status_code=201)
def create_task(project_id: str, payload: TaskCreate, request: Request, db: DbSession, tenant: ProjectWorker) -> TaskRead:
    project = _project(db, tenant, project_id, lock=True); _require_manager(db, tenant, project); _ensure_open(project)
    if payload.milestone_id and db.scalar(select(ProjectMilestone.id).where(ProjectMilestone.id == payload.milestone_id, ProjectMilestone.project_id == project.id)) is None:
        raise HTTPException(status_code=400, detail="Milestone does not belong to this project")
    if payload.assignee_employee_id and not _is_project_member(db, project, db.get(Employee, payload.assignee_employee_id)):
        raise HTTPException(status_code=400, detail="Assignee must be an active project team member")
    if payload.planned_start_date and payload.due_date and payload.due_date < payload.planned_start_date:
        raise HTTPException(status_code=400, detail="Task due date cannot be before planned start date")
    item = ProjectTask(
        organization_id=tenant.organization_id, project_id=project.id, milestone_id=payload.milestone_id,
        task_code=next_sequence_code(db, tenant.organization_id, "task"), title=payload.title.strip(),
        description=_clean(payload.description), priority=payload.priority, status="todo", progress_percent=0,
        assignee_employee_id=payload.assignee_employee_id, created_by_user_id=tenant.user_id,
        planned_start_date=payload.planned_start_date, due_date=payload.due_date, estimated_minutes=payload.estimated_minutes,
    )
    db.add(item); db.flush(); _recalculate_progress(db, project); db.flush()
    record_activity(db, action="projects.task.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_task", entity_id=item.id,
        after={"project_id": project.id, "task_code": item.task_code, "title": item.title, "assignee_employee_id": item.assignee_employee_id},
        message=f"Task {item.task_code} created in {project.project_number}", request=request)
    db.commit()
    return next(task for task in _task_reads(db, project) if task.id == item.id)


@router.patch("/{project_id}/tasks/{task_id}", response_model=TaskRead)
def update_task(project_id: str, task_id: str, payload: TaskUpdate, request: Request, db: DbSession, tenant: ProjectWorker) -> TaskRead:
    project = _project(db, tenant, project_id, lock=True); _require_manager(db, tenant, project); _ensure_open(project)
    item = db.scalar(select(ProjectTask).where(ProjectTask.id == task_id, ProjectTask.project_id == project.id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Task not found")
    changes = payload.model_dump(exclude_unset=True)
    if "milestone_id" in changes and changes["milestone_id"] and db.scalar(select(ProjectMilestone.id).where(ProjectMilestone.id == changes["milestone_id"], ProjectMilestone.project_id == project.id)) is None:
        raise HTTPException(status_code=400, detail="Milestone does not belong to this project")
    if "assignee_employee_id" in changes and changes["assignee_employee_id"] and not _is_project_member(db, project, db.get(Employee, changes["assignee_employee_id"])):
        raise HTTPException(status_code=400, detail="Assignee must be an active project team member")
    before = {"title": item.title, "status": item.status, "progress_percent": item.progress_percent, "assignee_employee_id": item.assignee_employee_id}
    for field, value in changes.items():
        if field in {"title", "description"} and isinstance(value, str): value = _clean(value)
        if field == "title" and not value: raise HTTPException(status_code=400, detail="Task title cannot be empty")
        setattr(item, field, value)
    if item.planned_start_date and item.due_date and item.due_date < item.planned_start_date:
        raise HTTPException(status_code=400, detail="Task due date cannot be before planned start date")
    if item.status == "completed": item.progress_percent = 100; item.completed_at = item.completed_at or datetime.now(timezone.utc)
    elif item.progress_percent == 100 and item.status != "cancelled": item.status = "completed"; item.completed_at = item.completed_at or datetime.now(timezone.utc)
    else: item.completed_at = None
    _recalculate_progress(db, project); db.flush()
    record_activity(db, action="projects.task.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_task", entity_id=item.id, before=before,
        after={"title": item.title, "status": item.status, "progress_percent": item.progress_percent, "assignee_employee_id": item.assignee_employee_id},
        message=f"Task {item.task_code} updated", request=request)
    db.commit()
    return next(task for task in _task_reads(db, project) if task.id == item.id)


@router.post("/{project_id}/tasks/{task_id}/progress", response_model=TaskRead)
def update_task_progress(project_id: str, task_id: str, payload: TaskProgressUpdate, request: Request, db: DbSession, tenant: ProjectWorker) -> TaskRead:
    project = _project(db, tenant, project_id, lock=True); _ensure_open(project)
    require_project_tab(db, tenant, project, "tasks")
    employee = _employee_for_user(db, tenant)
    if employee is None: raise HTTPException(status_code=403, detail="An active employee profile is required")
    item = db.scalar(select(ProjectTask).where(ProjectTask.id == task_id, ProjectTask.project_id == project.id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Task not found")
    if item.status == "cancelled": raise HTTPException(status_code=409, detail="Cancelled tasks cannot receive progress")
    if item.assignee_employee_id != employee.id and not _can_manage_project(db, tenant, project, employee):
        raise HTTPException(status_code=403, detail="Only the assignee or project manager can update task progress")
    next_status = payload.status
    if payload.progress_percent == 100:
        next_status = "completed"
    elif next_status == "completed":
        raise HTTPException(status_code=400, detail="Completed tasks must have 100% progress")
    elif next_status is None:
        next_status = "in_progress" if payload.progress_percent > 0 and item.status == "todo" else item.status
    before = {"progress_percent": item.progress_percent, "status": item.status}
    item.progress_percent = payload.progress_percent; item.status = next_status
    item.completed_at = datetime.now(timezone.utc) if item.status == "completed" else None
    log = ProjectWorkLog(
        organization_id=tenant.organization_id, project_id=project.id, task_id=item.id,
        employee_id=employee.id, user_id=tenant.user_id, note=payload.note.strip(),
        progress_percent=item.progress_percent, time_spent_minutes=payload.time_spent_minutes,
    )
    db.add(log); _recalculate_progress(db, project); db.flush()
    record_activity(db, action="projects.task.progress_updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_task", entity_id=item.id, before=before,
        after={"progress_percent": item.progress_percent, "status": item.status},
        metadata={"work_log_id": log.id, "time_spent_minutes": payload.time_spent_minutes},
        message=f"Progress updated for {item.task_code}: {item.progress_percent}%", request=request)
    db.commit()
    return next(task for task in _task_reads(db, project) if task.id == item.id)


@router.post("/{project_id}/documents/upload", response_model=ProjectDocumentRead, status_code=201)
def upload_project_document(
    project_id: str, request: Request, db: DbSession, tenant: ProjectWorker,
    file: Annotated[UploadFile, File()], title: Annotated[str, Form(min_length=1, max_length=180)],
    document_type: Annotated[str | None, Form(min_length=1, max_length=64)] = "other",
    notes: Annotated[str | None, Form()] = None,
) -> ProjectDocumentRead:
    project = _project(db, tenant, project_id); _require_manager(db, tenant, project); _ensure_open(project)
    try:
        storage_key, size_bytes = storage.save(
            organization_id=tenant.organization_id, source=file.file, original_filename=file.filename or "document",
            content_type=file.content_type, namespace=f"projects/{project.id}/documents",
        )
    except HTTPException as exc:
        record_activity(db, action="projects.document.upload_failed", scope="tenant", actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id, entity_type="project_document", outcome="failure",
            message=str(exc.detail), metadata={"project_id": project.id, "original_filename": file.filename}, request=request)
        db.commit(); raise
    item = ProjectDocument(
        organization_id=tenant.organization_id, project_id=project.id, title=title.strip(),
        document_type=(document_type or "other").strip().lower(), original_filename=file.filename or "document",
        content_type=file.content_type, size_bytes=size_bytes, storage_key=storage_key,
        notes=_clean(notes), uploaded_by_user_id=tenant.user_id,
    )
    db.add(item)
    try:
        db.flush()
        record_activity(db, action="projects.document.uploaded", scope="tenant", actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id, entity_type="project_document", entity_id=item.id,
            after={"project_id": project.id, "title": item.title, "document_type": item.document_type, "size_bytes": item.size_bytes},
            message=f"Project document uploaded: {item.title}", request=request)
        db.commit()
    except Exception:
        db.rollback(); storage.delete(storage_key); raise
    db.refresh(item)
    return ProjectDocumentRead.model_validate(item, from_attributes=True)


def _document_file(db: DbSession, project: Project, document_id: str) -> tuple[ProjectDocument, Path, str, str]:
    item = db.scalar(select(ProjectDocument).where(ProjectDocument.id == document_id, ProjectDocument.project_id == project.id))
    if item is None:
        raise HTTPException(status_code=404, detail="Project document not found")
    path = storage.resolve(item.storage_key)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", item.title).strip("-.") or "project-document"
    suffix = Path(item.original_filename).suffix.lower()
    filename = f"{safe}{suffix}"
    media_type = item.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return item, path, filename, media_type


@router.get("/{project_id}/documents/{document_id}/preview")
def preview_project_document(project_id: str, document_id: str, db: DbSession, tenant: ProjectReader) -> FileResponse:
    project = _project(db, tenant, project_id); require_project_tab(db, tenant, project, "documents")
    _, path, filename, media_type = _document_file(db, project, document_id)
    if media_type not in PREVIEW_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Preview is not available for this file type. Please download the document.")
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{project_id}/documents/{document_id}/file")
def download_project_document(project_id: str, document_id: str, db: DbSession, tenant: ProjectReader) -> FileResponse:
    project = _project(db, tenant, project_id); require_project_tab(db, tenant, project, "documents")
    _, path, filename, media_type = _document_file(db, project, document_id)
    return FileResponse(path, media_type=media_type, filename=filename)


@router.delete("/{project_id}/documents/{document_id}", status_code=204)
def delete_project_document(project_id: str, document_id: str, request: Request, db: DbSession, tenant: ProjectWorker) -> Response:
    project = _project(db, tenant, project_id); _require_manager(db, tenant, project); _ensure_open(project)
    item = db.scalar(select(ProjectDocument).where(ProjectDocument.id == document_id, ProjectDocument.project_id == project.id))
    if item is None: raise HTTPException(status_code=404, detail="Project document not found")
    storage_key = item.storage_key
    db.delete(item)
    record_activity(db, action="projects.document.deleted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_document", entity_id=item.id,
        before={"project_id": project.id, "title": item.title}, message=f"Project document deleted: {item.title}", request=request)
    db.commit(); storage.delete(storage_key)
    return Response(status_code=204)


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
        logger.error("Credentials Vault encryption operation failed")
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
        logger.error("Credentials Vault decryption operation failed")
        raise _vault_unavailable()


@router.post("/{project_id}/credentials", response_model=CredentialRead, status_code=201)
def create_credential(project_id: str, payload: CredentialCreate, request: Request, db: DbSession, tenant: ProjectWorker) -> CredentialRead:
    project = _project(db, tenant, project_id); _require_manager(db, tenant, project); _ensure_open(project)
    item = ProjectCredential(
        organization_id=tenant.organization_id, project_id=project.id, name=payload.name.strip(),
        credential_type=payload.credential_type.strip().lower(), environment=payload.environment.strip().lower(),
        username=_clean(payload.username), secret_ciphertext=_encrypt_secret(db, payload.secret),
        url=_clean(payload.url), notes=_clean(payload.notes), access_level=payload.access_level, created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    record_activity(db, action="projects.credential.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_credential", entity_id=item.id,
        after={"project_id": project.id, "name": item.name, "credential_type": item.credential_type, "environment": item.environment, "access_level": item.access_level},
        message=f"Project credential added: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return _credential_read(db, project, item)


@router.patch("/{project_id}/credentials/{credential_id}", response_model=CredentialRead)
def update_credential(project_id: str, credential_id: str, payload: CredentialUpdate, request: Request, db: DbSession, tenant: ProjectWorker) -> CredentialRead:
    project = _project(db, tenant, project_id); _require_manager(db, tenant, project); _ensure_open(project)
    item = db.scalar(select(ProjectCredential).where(ProjectCredential.id == credential_id, ProjectCredential.project_id == project.id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Credential not found")
    before = {"name": item.name, "credential_type": item.credential_type, "environment": item.environment, "access_level": item.access_level}
    changes = payload.model_dump(exclude_unset=True)
    secret = changes.pop("secret", None)
    for field, value in changes.items():
        if isinstance(value, str): value = _clean(value)
        if field in {"name", "credential_type", "environment"} and not value: raise HTTPException(status_code=400, detail=f"{field} cannot be empty")
        if field in {"credential_type", "environment"} and value: value = value.lower()
        setattr(item, field, value)
    if secret is not None: item.secret_ciphertext = _encrypt_secret(db, secret)
    db.flush()
    record_activity(db, action="projects.credential.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_credential", entity_id=item.id, before=before,
        after={"name": item.name, "credential_type": item.credential_type, "environment": item.environment, "access_level": item.access_level, "secret_changed": secret is not None},
        message=f"Project credential updated: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return _credential_read(db, project, item)


@router.post("/{project_id}/credentials/{credential_id}/reveal", response_model=CredentialReveal)
def reveal_credential(project_id: str, credential_id: str, request: Request, db: DbSession, tenant: ProjectWorker) -> CredentialReveal:
    project = _project(db, tenant, project_id)
    require_project_tab(db, tenant, project, "credentials")
    employee = _require_participant(db, tenant, project)
    item = db.scalar(select(ProjectCredential).where(ProjectCredential.id == credential_id, ProjectCredential.project_id == project.id))
    if item is None: raise HTTPException(status_code=404, detail="Credential not found")
    if item.access_level == "manager_only" and not _can_manage_project(db, tenant, project, employee):
        raise HTTPException(status_code=403, detail="This credential is restricted to the project manager")
    secret = _decrypt_secret(db, item.secret_ciphertext)
    record_activity(db, action="projects.credential.revealed", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_credential", entity_id=item.id,
        metadata={"project_id": project.id, "credential_name": item.name, "access_level": item.access_level},
        message=f"Project credential revealed: {item.name}", request=request)
    db.commit()
    return CredentialReveal(id=item.id, secret=secret)


@router.delete("/{project_id}/credentials/{credential_id}", status_code=204)
def delete_credential(project_id: str, credential_id: str, request: Request, db: DbSession, tenant: ProjectWorker) -> Response:
    project = _project(db, tenant, project_id); _require_manager(db, tenant, project); _ensure_open(project)
    item = db.scalar(select(ProjectCredential).where(ProjectCredential.id == credential_id, ProjectCredential.project_id == project.id))
    if item is None: raise HTTPException(status_code=404, detail="Credential not found")
    before = {"project_id": project.id, "name": item.name, "credential_type": item.credential_type, "access_level": item.access_level}
    db.delete(item)
    record_activity(db, action="projects.credential.deleted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="project_credential", entity_id=item.id,
        before=before, message=f"Project credential deleted: {item.name}", request=request)
    db.commit()
    return Response(status_code=204)
