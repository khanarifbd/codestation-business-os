from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.membership import Membership
from app.models.orders import Order
from app.models.projects import Project, ProjectMember
from app.models.sales import Quotation
from app.models.team import Employee
from app.models.user import User
from app.schemas.projects import (
    OrderProjectLink,
    ProjectCreateFromOrder,
    ProjectDetail,
    ProjectEmployeeOption,
    ProjectListItem,
    ProjectMemberRead,
    ProjectMeta,
    ProjectPage,
    ProjectStatusChange,
    ProjectSummary,
    ProjectTeamUpdate,
    ProjectUpdate,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/projects", tags=["Projects"])

ProjectViewer = Annotated[TenantContext, Depends(require_tenant_permission("projects.view"))]
ProjectManager = Annotated[TenantContext, Depends(require_tenant_permission("projects.manage"))]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _encode_cursor(created_at: datetime, entity_id: str) -> str:
    raw = json.dumps({"created_at": created_at.isoformat(), "id": entity_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        timestamp = datetime.fromisoformat(payload["created_at"])
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return timestamp, str(payload["id"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid pagination cursor") from exc


def _cursor_clause(decoded: tuple[datetime, str] | None):
    if decoded is None:
        return None
    created_at, entity_id = decoded
    return or_(Project.created_at < created_at, and_(Project.created_at == created_at, Project.id < entity_id))


def _employee_options(db: DbSession, organization_id: str) -> list[ProjectEmployeeOption]:
    rows = db.execute(
        select(Employee.id, Employee.employee_code, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Employee.organization_id == organization_id,
            Employee.employment_status == "active",
            Membership.status == "active",
        )
        .order_by(User.full_name.asc())
    ).all()
    return [ProjectEmployeeOption(id=row.id, employee_code=row.employee_code, full_name=row.full_name) for row in rows]


def _validate_employee_ids(db: DbSession, organization_id: str, employee_ids: set[str]) -> None:
    if not employee_ids:
        return
    found = set(
        db.scalars(
            select(Employee.id).where(
                Employee.organization_id == organization_id,
                Employee.employment_status == "active",
                Employee.id.in_(employee_ids),
            )
        ).all()
    )
    missing = employee_ids - found
    if missing:
        raise HTTPException(status_code=400, detail="One or more selected employees are not active in this company")


def _project_query(organization_id: str):
    manager_employee = aliased(Employee)
    manager_membership = aliased(Membership)
    manager_user = aliased(User)
    member_count = (
        select(func.count(ProjectMember.id))
        .where(
            ProjectMember.organization_id == organization_id,
            ProjectMember.project_id == Project.id,
            ProjectMember.is_active.is_(True),
        )
        .correlate(Project)
        .scalar_subquery()
    )
    return (
        select(
            Project,
            Client.display_name,
            Order.order_number,
            Quotation.quotation_number,
            manager_user.full_name,
            member_count,
        )
        .join(Client, Client.id == Project.client_id)
        .join(Order, Order.id == Project.order_id)
        .join(Quotation, Quotation.id == Project.quotation_id)
        .outerjoin(manager_employee, manager_employee.id == Project.project_manager_employee_id)
        .outerjoin(manager_membership, manager_membership.id == manager_employee.membership_id)
        .outerjoin(manager_user, manager_user.id == manager_membership.user_id)
        .where(Project.organization_id == organization_id)
    )


def _list_item(row) -> ProjectListItem:
    project, client_name, order_number, _quotation_number, manager_name, member_count = row
    return ProjectListItem(
        id=project.id,
        project_number=project.project_number,
        order_id=project.order_id,
        order_number=order_number,
        client_id=project.client_id,
        client_name=client_name,
        name=project.name,
        status=project.status,
        priority=project.priority,
        planned_start_date=project.planned_start_date,
        due_date=project.due_date,
        currency=project.currency,
        contract_value=project.contract_value,
        project_manager_employee_id=project.project_manager_employee_id,
        project_manager_name=manager_name,
        member_count=int(member_count or 0),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _member_reads(db: DbSession, organization_id: str, project_id: str) -> list[ProjectMemberRead]:
    rows = db.execute(
        select(ProjectMember, Employee.employee_code, User.full_name)
        .join(Employee, Employee.id == ProjectMember.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            ProjectMember.organization_id == organization_id,
            ProjectMember.project_id == project_id,
            ProjectMember.is_active.is_(True),
        )
        .order_by(
            (ProjectMember.role_label == "Project Manager").desc(),
            User.full_name.asc(),
        )
    ).all()
    return [
        ProjectMemberRead(
            id=member.id,
            employee_id=member.employee_id,
            employee_code=employee_code,
            full_name=full_name,
            role_label=member.role_label,
            is_active=member.is_active,
            added_at=member.added_at,
        )
        for member, employee_code, full_name in rows
    ]


def _detail(db: DbSession, organization_id: str, project_id: str) -> ProjectDetail:
    row = db.execute(_project_query(organization_id).where(Project.id == project_id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    project, client_name, order_number, quotation_number, manager_name, _member_count = row
    return ProjectDetail(
        id=project.id,
        project_number=project.project_number,
        order_id=project.order_id,
        order_number=order_number,
        quotation_id=project.quotation_id,
        quotation_number=quotation_number,
        client_id=project.client_id,
        client_name=client_name,
        source_lead_id=project.source_lead_id,
        project_manager_employee_id=project.project_manager_employee_id,
        project_manager_name=manager_name,
        name=project.name,
        status=project.status,
        priority=project.priority,
        planned_start_date=project.planned_start_date,
        due_date=project.due_date,
        currency=project.currency,
        contract_value=project.contract_value,
        description=project.description,
        notes=project.notes,
        actual_started_at=project.actual_started_at,
        completed_at=project.completed_at,
        cancelled_at=project.cancelled_at,
        members=_member_reads(db, organization_id, project.id),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _ensure_project_editable(project: Project) -> None:
    if project.status in {"completed", "cancelled"}:
        raise HTTPException(status_code=409, detail=f"{project.status.capitalize()} projects are locked")


def _sync_team(
    db: DbSession,
    project: Project,
    *,
    manager_employee_id: str | None,
    member_employee_ids: list[str],
    actor_user_id: str,
) -> None:
    desired_ids = {employee_id for employee_id in member_employee_ids if employee_id}
    if manager_employee_id:
        desired_ids.add(manager_employee_id)
    _validate_employee_ids(db, project.organization_id, desired_ids)

    existing = db.scalars(
        select(ProjectMember).where(
            ProjectMember.organization_id == project.organization_id,
            ProjectMember.project_id == project.id,
        )
    ).all()
    by_employee = {member.employee_id: member for member in existing}

    for employee_id, member in by_employee.items():
        member.is_active = employee_id in desired_ids
        if member.is_active:
            member.role_label = "Project Manager" if employee_id == manager_employee_id else "Team Member"

    for employee_id in desired_ids - set(by_employee):
        db.add(
            ProjectMember(
                organization_id=project.organization_id,
                project_id=project.id,
                employee_id=employee_id,
                role_label="Project Manager" if employee_id == manager_employee_id else "Team Member",
                is_active=True,
                added_by_user_id=actor_user_id,
            )
        )
    project.project_manager_employee_id = manager_employee_id


@router.get("/meta", response_model=ProjectMeta)
def get_project_meta(db: DbSession, tenant: ProjectViewer) -> ProjectMeta:
    return ProjectMeta(employees=_employee_options(db, tenant.organization_id))


@router.get("/summary", response_model=ProjectSummary)
def project_summary(db: DbSession, tenant: ProjectViewer) -> ProjectSummary:
    row = db.execute(
        select(
            func.count(Project.id),
            func.count(Project.id).filter(Project.status == "planned"),
            func.count(Project.id).filter(Project.status == "active"),
            func.count(Project.id).filter(Project.status == "on_hold"),
            func.count(Project.id).filter(Project.status == "completed"),
            func.count(Project.id).filter(Project.status == "cancelled"),
        ).where(Project.organization_id == tenant.organization_id)
    ).one()
    return ProjectSummary(total=row[0], planned=row[1], active=row[2], on_hold=row[3], completed=row[4], cancelled=row[5])


@router.get("", response_model=ProjectPage)
def list_projects(
    db: DbSession,
    tenant: ProjectViewer,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = None,
    search: str | None = None,
    project_status: str | None = Query(default=None, alias="status"),
    client_id: str | None = None,
) -> ProjectPage:
    query = _project_query(tenant.organization_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(
                Project.project_number.ilike(needle),
                Project.name.ilike(needle),
                Client.display_name.ilike(needle),
                Order.order_number.ilike(needle),
            )
        )
    if project_status:
        query = query.where(Project.status == project_status)
    if client_id:
        query = query.where(Project.client_id == client_id)
    clause = _cursor_clause(_decode_cursor(cursor))
    if clause is not None:
        query = query.where(clause)
    rows = db.execute(query.order_by(Project.created_at.desc(), Project.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return ProjectPage(
        items=[_list_item(row) for row in rows],
        next_cursor=_encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None,
    )


@router.get("/order/{order_id}/link", response_model=OrderProjectLink | None)
def get_order_project_link(order_id: str, db: DbSession, tenant: ProjectViewer) -> OrderProjectLink | None:
    project = db.scalar(
        select(Project).where(Project.organization_id == tenant.organization_id, Project.order_id == order_id)
    )
    if project is None:
        return None
    return OrderProjectLink(project_id=project.id, project_number=project.project_number, status=project.status)


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, db: DbSession, tenant: ProjectViewer) -> ProjectDetail:
    return _detail(db, tenant.organization_id, project_id)


@router.post("/from-order/{order_id}", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_project_from_order(
    order_id: str,
    payload: ProjectCreateFromOrder,
    request: Request,
    db: DbSession,
    tenant: ProjectManager,
) -> ProjectDetail:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in {"confirmed", "in_progress"}:
        raise HTTPException(status_code=409, detail="Only confirmed or in-progress orders can become projects")
    existing = db.scalar(
        select(Project).where(Project.organization_id == tenant.organization_id, Project.order_id == order.id)
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Order already has project {existing.project_number}")
    if payload.planned_start_date and payload.due_date and payload.due_date < payload.planned_start_date:
        raise HTTPException(status_code=400, detail="Project due date cannot be before planned start date")

    manager_employee_id = payload.project_manager_employee_id or order.assigned_employee_id
    desired_ids = {employee_id for employee_id in payload.member_employee_ids if employee_id}
    if manager_employee_id:
        desired_ids.add(manager_employee_id)
    _validate_employee_ids(db, tenant.organization_id, desired_ids)

    client = db.scalar(
        select(Client).where(Client.id == order.client_id, Client.organization_id == tenant.organization_id)
    )
    if client is None:
        raise HTTPException(status_code=409, detail="Order client is no longer available")

    initial_status = "active" if order.status == "in_progress" else "planned"
    project = Project(
        organization_id=tenant.organization_id,
        project_number=next_sequence_code(db, tenant.organization_id, "project"),
        order_id=order.id,
        quotation_id=order.quotation_id,
        client_id=order.client_id,
        source_lead_id=order.source_lead_id,
        project_manager_employee_id=manager_employee_id,
        created_by_user_id=tenant.user_id,
        name=_clean(payload.name) or _clean(order.subject) or f"{client.display_name} · {order.order_number}",
        status=initial_status,
        priority=payload.priority,
        planned_start_date=payload.planned_start_date,
        due_date=payload.due_date,
        currency=order.currency,
        contract_value=order.total,
        description=_clean(payload.description),
        notes=_clean(payload.notes),
        actual_started_at=(order.started_at or datetime.now(timezone.utc)) if initial_status == "active" else None,
    )
    db.add(project)
    db.flush()
    _sync_team(
        db,
        project,
        manager_employee_id=manager_employee_id,
        member_employee_ids=payload.member_employee_ids,
        actor_user_id=tenant.user_id,
    )
    db.flush()

    record_activity(
        db,
        action="projects.project.created_from_order",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project",
        entity_id=project.id,
        after={
            "project_number": project.project_number,
            "order_id": order.id,
            "order_number": order.order_number,
            "client_id": project.client_id,
            "status": project.status,
            "priority": project.priority,
            "project_manager_employee_id": project.project_manager_employee_id,
            "team_size": len(desired_ids),
            "contract_value": str(project.contract_value),
            "currency": project.currency,
        },
        metadata={"source_order_id": order.id, "source_quotation_id": order.quotation_id},
        message=f"Project {project.project_number} created from order {order.order_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, project.id)


@router.patch("/{project_id}", response_model=ProjectDetail)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    request: Request,
    db: DbSession,
    tenant: ProjectManager,
) -> ProjectDetail:
    project = db.scalar(
        select(Project)
        .where(Project.id == project_id, Project.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _ensure_project_editable(project)

    before = {
        "name": project.name,
        "priority": project.priority,
        "project_manager_employee_id": project.project_manager_employee_id,
        "planned_start_date": project.planned_start_date.isoformat() if project.planned_start_date else None,
        "due_date": project.due_date.isoformat() if project.due_date else None,
    }
    changes = payload.model_dump(exclude_unset=True)
    if "project_manager_employee_id" in changes:
        manager_id = changes["project_manager_employee_id"]
        _validate_employee_ids(db, tenant.organization_id, {manager_id} if manager_id else set())
        project.project_manager_employee_id = manager_id
        if manager_id:
            member = db.scalar(
                select(ProjectMember).where(
                    ProjectMember.organization_id == tenant.organization_id,
                    ProjectMember.project_id == project.id,
                    ProjectMember.employee_id == manager_id,
                )
            )
            if member is None:
                db.add(ProjectMember(
                    organization_id=tenant.organization_id,
                    project_id=project.id,
                    employee_id=manager_id,
                    role_label="Project Manager",
                    is_active=True,
                    added_by_user_id=tenant.user_id,
                ))
            else:
                member.is_active = True
                member.role_label = "Project Manager"
        for member in db.scalars(
            select(ProjectMember).where(
                ProjectMember.organization_id == tenant.organization_id,
                ProjectMember.project_id == project.id,
                ProjectMember.is_active.is_(True),
            )
        ).all():
            if member.employee_id != manager_id and member.role_label == "Project Manager":
                member.role_label = "Team Member"

    for field in ("name", "priority", "planned_start_date", "due_date", "description", "notes"):
        if field not in changes:
            continue
        value = changes[field]
        if field in {"name", "description", "notes"} and isinstance(value, str):
            value = _clean(value)
        if field == "name" and not value:
            raise HTTPException(status_code=400, detail="Project name cannot be empty")
        setattr(project, field, value)
    if project.planned_start_date and project.due_date and project.due_date < project.planned_start_date:
        raise HTTPException(status_code=400, detail="Project due date cannot be before planned start date")
    db.flush()

    after = {
        "name": project.name,
        "priority": project.priority,
        "project_manager_employee_id": project.project_manager_employee_id,
        "planned_start_date": project.planned_start_date.isoformat() if project.planned_start_date else None,
        "due_date": project.due_date.isoformat() if project.due_date else None,
    }
    record_activity(
        db,
        action="projects.project.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project",
        entity_id=project.id,
        before=before,
        after=after,
        message=f"Project updated: {project.project_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, project.id)


@router.put("/{project_id}/team", response_model=ProjectDetail)
def update_project_team(
    project_id: str,
    payload: ProjectTeamUpdate,
    request: Request,
    db: DbSession,
    tenant: ProjectManager,
) -> ProjectDetail:
    project = db.scalar(
        select(Project)
        .where(Project.id == project_id, Project.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _ensure_project_editable(project)

    before_members = _member_reads(db, tenant.organization_id, project.id)
    before = {
        "project_manager_employee_id": project.project_manager_employee_id,
        "member_employee_ids": [member.employee_id for member in before_members],
    }
    _sync_team(
        db,
        project,
        manager_employee_id=payload.project_manager_employee_id,
        member_employee_ids=payload.member_employee_ids,
        actor_user_id=tenant.user_id,
    )
    db.flush()
    after_members = _member_reads(db, tenant.organization_id, project.id)
    after = {
        "project_manager_employee_id": project.project_manager_employee_id,
        "member_employee_ids": [member.employee_id for member in after_members],
    }
    record_activity(
        db,
        action="projects.project.team_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project",
        entity_id=project.id,
        before=before,
        after=after,
        message=f"Project team updated: {project.project_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, project.id)


@router.patch("/{project_id}/status", response_model=ProjectDetail)
def change_project_status(
    project_id: str,
    payload: ProjectStatusChange,
    request: Request,
    db: DbSession,
    tenant: ProjectManager,
) -> ProjectDetail:
    project = db.scalar(
        select(Project)
        .where(Project.id == project_id, Project.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status == payload.status:
        return _detail(db, tenant.organization_id, project.id)

    allowed = {
        "planned": {"active", "cancelled"},
        "active": {"on_hold", "completed", "cancelled"},
        "on_hold": {"active", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    }
    if payload.status not in allowed.get(project.status, set()):
        raise HTTPException(status_code=409, detail=f"Project cannot move from {project.status} to {payload.status}")

    previous = project.status
    now = datetime.now(timezone.utc)
    project.status = payload.status
    if payload.status == "active" and project.actual_started_at is None:
        project.actual_started_at = now
    elif payload.status == "completed":
        project.completed_at = now
    elif payload.status == "cancelled":
        project.cancelled_at = now
    db.flush()

    record_activity(
        db,
        action="projects.project.status_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project",
        entity_id=project.id,
        before={"status": previous},
        after={"status": project.status},
        message=f"Project {project.project_number} status changed from {previous} to {project.status}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, project.id)
