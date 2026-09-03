from datetime import datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.membership import Membership
from app.models.projects import Project, ProjectMember, ProjectMilestone, ProjectTask, ProjectWorkLog
from app.models.team import Employee
from app.models.user import User
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/workspace/projects", tags=["Workspace"])
ProjectWorker = Annotated[TenantContext, Depends(require_tenant_permission("projects.work"))]

_CLOSED_TASK_STATUSES = {"completed", "cancelled"}
_CLOSED_PROJECT_STATUSES = {"completed", "cancelled"}


def _employee(db: DbSession, tenant: TenantContext) -> Employee:
    employee = db.scalar(
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
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return employee


def _project_for_member(
    db: DbSession,
    tenant: TenantContext,
    employee: Employee,
    project_id: str,
) -> Project:
    project = db.scalar(
        select(Project)
        .join(
            ProjectMember,
            (ProjectMember.project_id == Project.id)
            & (ProjectMember.organization_id == Project.organization_id),
        )
        .where(
            Project.id == project_id,
            Project.organization_id == tenant.organization_id,
            ProjectMember.employee_id == employee.id,
            ProjectMember.is_active.is_(True),
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _local_today(tenant: TenantContext):
    try:
        zone = ZoneInfo(tenant.organization.timezone)
    except Exception:
        zone = timezone.utc
    return datetime.now(timezone.utc).astimezone(zone).date()


@router.get("/{project_id}/execution")
def employee_project_execution(project_id: str, db: DbSession, tenant: ProjectWorker) -> dict:
    employee = _employee(db, tenant)
    project = _project_for_member(db, tenant, employee, project_id)
    today = _local_today(tenant)

    milestones = db.scalars(
        select(ProjectMilestone)
        .where(
            ProjectMilestone.organization_id == tenant.organization_id,
            ProjectMilestone.project_id == project.id,
        )
        .order_by(ProjectMilestone.sort_order.asc(), ProjectMilestone.created_at.asc())
    ).all()
    milestone_titles = {item.id: item.title for item in milestones}

    tasks = db.scalars(
        select(ProjectTask)
        .where(
            ProjectTask.organization_id == tenant.organization_id,
            ProjectTask.project_id == project.id,
            ProjectTask.assignee_employee_id == employee.id,
        )
        .order_by(
            ProjectTask.due_date.asc().nullslast(),
            ProjectTask.updated_at.desc(),
        )
    ).all()

    activity_rows = db.execute(
        select(ProjectWorkLog, ProjectTask.task_code, ProjectTask.title, User.full_name)
        .join(ProjectTask, ProjectTask.id == ProjectWorkLog.task_id)
        .join(User, User.id == ProjectWorkLog.user_id)
        .where(
            ProjectWorkLog.organization_id == tenant.organization_id,
            ProjectWorkLog.project_id == project.id,
            ProjectTask.organization_id == tenant.organization_id,
            ProjectTask.project_id == project.id,
            ProjectTask.assignee_employee_id == employee.id,
        )
        .order_by(ProjectWorkLog.created_at.desc())
        .limit(50)
    ).all()

    open_tasks = [item for item in tasks if item.status not in _CLOSED_TASK_STATUSES]
    completed_tasks = [item for item in tasks if item.status == "completed"]
    overdue_tasks = [
        item
        for item in open_tasks
        if item.due_date is not None and item.due_date < today
    ]

    return {
        "today": today,
        "project_locked": project.status in _CLOSED_PROJECT_STATUSES,
        "summary": {
            "assigned_tasks": len(tasks),
            "open_tasks": len(open_tasks),
            "completed_tasks": len(completed_tasks),
            "overdue_tasks": len(overdue_tasks),
        },
        "tasks": [
            {
                "id": item.id,
                "task_code": item.task_code,
                "milestone_id": item.milestone_id,
                "milestone_title": milestone_titles.get(item.milestone_id) if item.milestone_id else None,
                "title": item.title,
                "description": item.description,
                "status": item.status,
                "priority": item.priority,
                "progress_percent": item.progress_percent,
                "planned_start_date": item.planned_start_date,
                "due_date": item.due_date,
                "estimated_minutes": item.estimated_minutes,
                "completed_at": item.completed_at,
                "updated_at": item.updated_at,
            }
            for item in tasks
        ],
        "milestones": [
            {
                "id": item.id,
                "title": item.title,
                "description": item.description,
                "status": item.status,
                "progress_percent": item.progress_percent,
                "due_date": item.due_date,
                "completed_at": item.completed_at,
            }
            for item in milestones
        ],
        "recent_activity": [
            {
                "id": log.id,
                "task_id": log.task_id,
                "task_code": task_code,
                "task_title": task_title,
                "employee_name": full_name,
                "note": log.note,
                "progress_percent": log.progress_percent,
                "time_spent_minutes": log.time_spent_minutes,
                "created_at": log.created_at,
            }
            for log, task_code, task_title, full_name in activity_rows
        ],
    }
