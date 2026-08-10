from datetime import date, timedelta

from fastapi import APIRouter
from sqlalchemy import select

from app.api.dependencies import CurrentTenant, DbSession
from app.models.membership import Membership
from app.models.projects import Project, ProjectMember, ProjectTask
from app.models.team import Employee

router = APIRouter(prefix="/workspace", tags=["Workspace"])


def _employee(db: DbSession, tenant: CurrentTenant) -> Employee | None:
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


@router.get("/me")
def personal_workspace(db: DbSession, tenant: CurrentTenant) -> dict:
    employee = _employee(db, tenant)
    if employee is None:
        return {"employee": None, "summary": {"assigned_tasks": 0, "overdue_tasks": 0, "active_projects": 0, "due_soon": 0}, "tasks": [], "projects": []}

    today = date.today()
    tasks = db.scalars(
        select(ProjectTask)
        .where(
            ProjectTask.organization_id == tenant.organization_id,
            ProjectTask.assignee_employee_id == employee.id,
            ProjectTask.status.notin_(["completed", "cancelled"]),
        )
        .order_by(ProjectTask.due_date.asc().nullslast(), ProjectTask.updated_at.desc())
        .limit(30)
    ).all()
    project_ids = db.scalars(
        select(ProjectMember.project_id).where(
            ProjectMember.organization_id == tenant.organization_id,
            ProjectMember.employee_id == employee.id,
            ProjectMember.is_active.is_(True),
        )
    ).all()
    projects = db.scalars(
        select(Project)
        .where(Project.organization_id == tenant.organization_id, Project.id.in_(project_ids or ["-"]), Project.status.notin_(["completed", "cancelled"]))
        .order_by(Project.due_date.asc().nullslast())
        .limit(20)
    ).all()
    overdue = sum(1 for item in tasks if item.due_date and item.due_date < today)
    due_soon = sum(1 for item in tasks if item.due_date and today <= item.due_date <= today + timedelta(days=3))
    return {
        "employee": {"id": employee.id, "employee_code": employee.employee_code},
        "summary": {"assigned_tasks": len(tasks), "overdue_tasks": overdue, "active_projects": len(projects), "due_soon": due_soon},
        "tasks": [{"id": item.id, "project_id": item.project_id, "task_code": item.task_code, "title": item.title, "status": item.status, "priority": item.priority, "progress_percent": item.progress_percent, "due_date": item.due_date} for item in tasks],
        "projects": [{"id": item.id, "project_number": item.project_number, "name": item.name, "status": item.status, "progress_percent": item.progress_percent, "due_date": item.due_date} for item in projects],
    }


@router.get("/notifications")
def notifications(db: DbSession, tenant: CurrentTenant) -> dict:
    employee = _employee(db, tenant)
    if employee is None:
        return {"unread_count": 0, "items": []}
    today = date.today()
    tasks = db.scalars(
        select(ProjectTask).where(
            ProjectTask.organization_id == tenant.organization_id,
            ProjectTask.assignee_employee_id == employee.id,
            ProjectTask.status.notin_(["completed", "cancelled"]),
            ProjectTask.due_date.is_not(None),
            ProjectTask.due_date <= today + timedelta(days=3),
        ).order_by(ProjectTask.due_date.asc()).limit(30)
    ).all()
    items = []
    for task in tasks:
        overdue = bool(task.due_date and task.due_date < today)
        items.append({
            "id": f"task:{task.id}:{task.due_date}", "kind": "task_overdue" if overdue else "task_due",
            "severity": "critical" if overdue else "warning", "title": f"{task.task_code} · {task.title}",
            "message": f"Task was due {task.due_date}" if overdue else f"Task is due {task.due_date}",
            "href": f"/dashboard/projects/{task.project_id}", "due_date": task.due_date,
        })
    return {"unread_count": len(items), "items": items}
