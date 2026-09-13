from datetime import datetime, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.membership import Membership
from app.models.projects import Project, ProjectMember, ProjectMilestone, ProjectTask, ProjectWorkLog
from app.models.team import Employee
from app.models.user import User
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/workspace", tags=["Workspace"])
ProjectWorker = Annotated[TenantContext, Depends(require_tenant_permission("projects.work"))]

_OPEN_TASK_STATUSES = ("completed", "cancelled")
_CLOSED_PROJECT_STATUSES = ("completed", "cancelled")


def _employee(db: DbSession, tenant: TenantContext) -> Employee | None:
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


def _require_employee(db: DbSession, tenant: TenantContext) -> Employee:
    employee = _employee(db, tenant)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return employee


def _local_today(tenant: TenantContext):
    try:
        zone = ZoneInfo(tenant.organization.timezone)
    except Exception:
        zone = timezone.utc
    return datetime.now(timezone.utc).astimezone(zone).date()


def _task_payload(task: ProjectTask, project_number: str, project_name: str, milestone_title: str | None = None) -> dict:
    return {
        "id": task.id,
        "project_id": task.project_id,
        "project_number": project_number,
        "project_name": project_name,
        "task_code": task.task_code,
        "milestone_id": task.milestone_id,
        "milestone_title": milestone_title,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "progress_percent": task.progress_percent,
        "planned_start_date": task.planned_start_date,
        "due_date": task.due_date,
        "estimated_minutes": task.estimated_minutes,
        "completed_at": task.completed_at,
        "updated_at": task.updated_at,
    }


def _open_task_filters(tenant: TenantContext, employee: Employee) -> tuple:
    return (
        ProjectTask.organization_id == tenant.organization_id,
        Project.organization_id == tenant.organization_id,
        ProjectTask.assignee_employee_id == employee.id,
        ProjectTask.status.notin_(_OPEN_TASK_STATUSES),
        Project.status.notin_(_CLOSED_PROJECT_STATUSES),
    )


def _member_project_filters(tenant: TenantContext, employee: Employee) -> tuple:
    return (
        Project.organization_id == tenant.organization_id,
        ProjectMember.organization_id == tenant.organization_id,
        ProjectMember.employee_id == employee.id,
        ProjectMember.is_active.is_(True),
        ProjectMember.project_id == Project.id,
    )


@router.get("/me")
def personal_workspace(db: DbSession, tenant: ProjectWorker) -> dict:
    today = _local_today(tenant)
    employee = _employee(db, tenant)
    if employee is None:
        return {
            "today": today,
            "timezone": tenant.organization.timezone,
            "employee": None,
            "summary": {
                "assigned_tasks": 0,
                "overdue_tasks": 0,
                "due_today": 0,
                "active_projects": 0,
                "due_soon": 0,
            },
            "tasks": [],
            "projects": [],
        }

    task_filters = _open_task_filters(tenant, employee)
    task_rows = db.execute(
        select(ProjectTask, Project.project_number, Project.name, ProjectMilestone.title)
        .join(Project, Project.id == ProjectTask.project_id)
        .outerjoin(ProjectMilestone, ProjectMilestone.id == ProjectTask.milestone_id)
        .where(*task_filters)
        .order_by(ProjectTask.due_date.asc().nullslast(), ProjectTask.updated_at.desc())
        .limit(100)
    ).all()

    assigned_tasks = int(
        db.scalar(
            select(func.count(ProjectTask.id))
            .join(Project, Project.id == ProjectTask.project_id)
            .where(*task_filters)
        )
        or 0
    )
    overdue_tasks = int(
        db.scalar(
            select(func.count(ProjectTask.id))
            .join(Project, Project.id == ProjectTask.project_id)
            .where(*task_filters, ProjectTask.due_date.is_not(None), ProjectTask.due_date < today)
        )
        or 0
    )
    due_today = int(
        db.scalar(
            select(func.count(ProjectTask.id))
            .join(Project, Project.id == ProjectTask.project_id)
            .where(*task_filters, ProjectTask.due_date == today)
        )
        or 0
    )
    due_soon = int(
        db.scalar(
            select(func.count(ProjectTask.id))
            .join(Project, Project.id == ProjectTask.project_id)
            .where(
                *task_filters,
                ProjectTask.due_date.is_not(None),
                ProjectTask.due_date >= today,
                ProjectTask.due_date <= today + timedelta(days=3),
            )
        )
        or 0
    )

    member_project_ids = select(ProjectMember.project_id).where(
        ProjectMember.organization_id == tenant.organization_id,
        ProjectMember.employee_id == employee.id,
        ProjectMember.is_active.is_(True),
    )
    project_filters = (
        Project.organization_id == tenant.organization_id,
        Project.id.in_(member_project_ids),
        Project.status.notin_(_CLOSED_PROJECT_STATUSES),
    )
    active_projects = int(db.scalar(select(func.count(Project.id)).where(*project_filters)) or 0)
    projects = db.scalars(
        select(Project)
        .where(*project_filters)
        .order_by(Project.due_date.asc().nullslast(), Project.updated_at.desc())
        .limit(50)
    ).all()

    return {
        "today": today,
        "timezone": tenant.organization.timezone,
        "employee": {"id": employee.id, "employee_code": employee.employee_code},
        "summary": {
            "assigned_tasks": assigned_tasks,
            "overdue_tasks": overdue_tasks,
            "due_today": due_today,
            "active_projects": active_projects,
            "due_soon": due_soon,
        },
        "tasks": [
            _task_payload(task, project_number, project_name, milestone_title)
            for task, project_number, project_name, milestone_title in task_rows
        ],
        "projects": [
            {
                "id": item.id,
                "project_number": item.project_number,
                "name": item.name,
                "status": item.status,
                "priority": item.priority,
                "progress_percent": item.progress_percent,
                "due_date": item.due_date,
            }
            for item in projects
        ],
    }


@router.get("/projects")
def personal_projects(
    db: DbSession,
    tenant: ProjectWorker,
    search: str | None = None,
    status: str | None = None,
) -> dict:
    employee = _require_employee(db, tenant)
    open_task_count = (
        select(func.count(ProjectTask.id))
        .where(
            ProjectTask.organization_id == tenant.organization_id,
            ProjectTask.project_id == Project.id,
            ProjectTask.assignee_employee_id == employee.id,
            ProjectTask.status.notin_(_OPEN_TASK_STATUSES),
        )
        .correlate(Project)
        .scalar_subquery()
    )
    overdue_task_count = (
        select(func.count(ProjectTask.id))
        .where(
            ProjectTask.organization_id == tenant.organization_id,
            ProjectTask.project_id == Project.id,
            ProjectTask.assignee_employee_id == employee.id,
            ProjectTask.status.notin_(_OPEN_TASK_STATUSES),
            ProjectTask.due_date.is_not(None),
            ProjectTask.due_date < _local_today(tenant),
        )
        .correlate(Project)
        .scalar_subquery()
    )
    query = (
        select(
            Project,
            ProjectMember.role_label,
            Client.display_name,
            open_task_count,
            overdue_task_count,
        )
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .join(Client, Client.id == Project.client_id)
        .where(*_member_project_filters(tenant, employee))
    )
    if search and search.strip():
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(
                Project.project_number.ilike(needle),
                Project.name.ilike(needle),
                Client.display_name.ilike(needle),
            )
        )
    if status and status.strip() and status != "all":
        query = query.where(Project.status == status.strip())

    rows = db.execute(
        query.order_by(
            Project.completed_at.desc().nullslast(),
            Project.due_date.asc().nullslast(),
            Project.updated_at.desc(),
        ).limit(200)
    ).all()
    items = [
        {
            "id": project.id,
            "project_number": project.project_number,
            "name": project.name,
            "client_name": client_name,
            "status": project.status,
            "priority": project.priority,
            "progress_percent": project.progress_percent,
            "planned_start_date": project.planned_start_date,
            "due_date": project.due_date,
            "completed_at": project.completed_at,
            "my_role": role_label,
            "my_open_tasks": int(open_count or 0),
            "my_overdue_tasks": int(overdue_count or 0),
        }
        for project, role_label, client_name, open_count, overdue_count in rows
    ]
    return {
        "items": items,
        "summary": {
            "total": len(items),
            "active": sum(1 for item in items if item["status"] == "active"),
            "planned": sum(1 for item in items if item["status"] == "planned"),
            "on_hold": sum(1 for item in items if item["status"] == "on_hold"),
            "completed": sum(1 for item in items if item["status"] == "completed"),
        },
    }


@router.get("/projects/{project_id}")
def personal_project_detail(project_id: str, db: DbSession, tenant: ProjectWorker) -> dict:
    employee = _require_employee(db, tenant)
    row = db.execute(
        select(Project, ProjectMember.role_label, Client.display_name)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .join(Client, Client.id == Project.client_id)
        .where(
            *_member_project_filters(tenant, employee),
            Project.id == project_id,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")

    project, role_label, client_name = row
    team_rows = db.execute(
        select(ProjectMember, Employee.employee_code, User.full_name)
        .join(Employee, Employee.id == ProjectMember.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            ProjectMember.organization_id == tenant.organization_id,
            ProjectMember.project_id == project.id,
            ProjectMember.is_active.is_(True),
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
            Membership.status == "active",
        )
        .order_by(
            (ProjectMember.employee_id == project.project_manager_employee_id).desc(),
            User.full_name.asc(),
        )
    ).all()
    team = [
        {
            "employee_id": member.employee_id,
            "employee_code": employee_code,
            "full_name": full_name,
            "role_label": member.role_label,
            "is_manager": member.employee_id == project.project_manager_employee_id,
            "is_me": member.employee_id == employee.id,
        }
        for member, employee_code, full_name in team_rows
    ]
    manager = next((member for member in team if member["is_manager"]), None)
    my_open_tasks = int(
        db.scalar(
            select(func.count(ProjectTask.id)).where(
                ProjectTask.organization_id == tenant.organization_id,
                ProjectTask.project_id == project.id,
                ProjectTask.assignee_employee_id == employee.id,
                ProjectTask.status.notin_(_OPEN_TASK_STATUSES),
            )
        )
        or 0
    )

    return {
        "id": project.id,
        "project_number": project.project_number,
        "name": project.name,
        "client_name": client_name,
        "status": project.status,
        "priority": project.priority,
        "progress_percent": project.progress_percent,
        "planned_start_date": project.planned_start_date,
        "due_date": project.due_date,
        "actual_started_at": project.actual_started_at,
        "completed_at": project.completed_at,
        "description": project.description,
        "my_role": role_label,
        "my_open_tasks": my_open_tasks,
        "project_manager_name": manager["full_name"] if manager else None,
        "team": team,
    }


@router.get("/tasks/{task_id}")
def personal_task_detail(task_id: str, db: DbSession, tenant: ProjectWorker) -> dict:
    employee = _require_employee(db, tenant)
    row = db.execute(
        select(ProjectTask, Project.project_number, Project.name, ProjectMilestone.title)
        .join(Project, Project.id == ProjectTask.project_id)
        .outerjoin(ProjectMilestone, ProjectMilestone.id == ProjectTask.milestone_id)
        .where(
            ProjectTask.id == task_id,
            ProjectTask.organization_id == tenant.organization_id,
            Project.organization_id == tenant.organization_id,
            ProjectTask.assignee_employee_id == employee.id,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Assigned task not found")

    task, project_number, project_name, milestone_title = row
    activity_rows = db.execute(
        select(ProjectWorkLog, User.full_name)
        .join(User, User.id == ProjectWorkLog.user_id)
        .where(
            ProjectWorkLog.organization_id == tenant.organization_id,
            ProjectWorkLog.project_id == task.project_id,
            ProjectWorkLog.task_id == task.id,
        )
        .order_by(ProjectWorkLog.created_at.desc())
        .limit(50)
    ).all()

    return {
        "task": _task_payload(task, project_number, project_name, milestone_title),
        "project_status": db.scalar(
            select(Project.status).where(
                Project.id == task.project_id,
                Project.organization_id == tenant.organization_id,
            )
        ),
        "activity": [
            {
                "id": log.id,
                "employee_name": full_name,
                "note": log.note,
                "progress_percent": log.progress_percent,
                "time_spent_minutes": log.time_spent_minutes,
                "created_at": log.created_at,
            }
            for log, full_name in activity_rows
        ],
    }


@router.get("/notifications")
def notifications(db: DbSession, tenant: ProjectWorker) -> dict:
    employee = _employee(db, tenant)
    if employee is None:
        return {"unread_count": 0, "attention_count": 0, "items": []}

    today = _local_today(tenant)
    tasks = db.scalars(
        select(ProjectTask)
        .join(Project, Project.id == ProjectTask.project_id)
        .where(
            *_open_task_filters(tenant, employee),
            ProjectTask.due_date.is_not(None),
            ProjectTask.due_date <= today + timedelta(days=3),
        )
        .order_by(ProjectTask.due_date.asc(), ProjectTask.updated_at.desc())
        .limit(50)
    ).all()

    items = []
    for task in tasks:
        overdue = bool(task.due_date and task.due_date < today)
        items.append(
            {
                "id": f"task:{task.id}:{task.due_date}",
                "kind": "task_overdue" if overdue else "task_due",
                "severity": "critical" if overdue else "warning",
                "title": f"{task.task_code} · {task.title}",
                "message": f"Task was due {task.due_date}" if overdue else f"Task is due {task.due_date}",
                "href": f"/dashboard/my-work?task={task.id}",
                "due_date": task.due_date,
            }
        )

    return {"unread_count": len(items), "attention_count": len(items), "items": items}
