from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentTenant, DbSession
from app.api.v1.team import create_invitation
from app.core.roles import MEMBERSHIP_ROLE_ADMIN
from app.models.hr import (
    AttendanceRecord,
    EmployeeHRDocument,
    HRShift,
    JobCandidate,
    JobOpening,
    LeaveRequest,
    LeaveType,
)
from app.models.hr_extended import HRHoliday
from app.models.membership import Membership
from app.models.team import Department, Designation, Employee, EmployeeInvitation, OrganizationRole
from app.models.user import User
from app.schemas.team import InvitationCreate
from app.services.activity_log import record_activity
from app.services.team_role_grants import ensure_grantable_employee_role, grantable_employee_roles
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR Workspace"])


class JobStatusUpdate(BaseModel):
    status: str


class HRPersonUpdate(BaseModel):
    department_id: str | None = None
    designation_id: str | None = None
    manager_employee_id: str | None = None
    work_email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=64)
    work_phone: str | None = Field(default=None, max_length=64)
    employment_type: str | None = Field(default=None, max_length=32)
    join_date: date | None = None
    end_date: date | None = None
    work_location: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class HRStructureCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=500)


def _role(db: DbSession, tenant: TenantContext) -> OrganizationRole | None:
    return db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )


def _permission(role: OrganizationRole | None, permission: str) -> bool:
    if role is None:
        return False
    permissions = set(role.permissions or [])
    return "*" in permissions or permission in permissions


def _admin(tenant: TenantContext, role: OrganizationRole | None) -> bool:
    return tenant.role == MEMBERSHIP_ROLE_ADMIN or _permission(role, "*")


def _capabilities(db: DbSession, tenant: TenantContext) -> dict[str, bool | OrganizationRole | None]:
    role = _role(db, tenant)
    admin = _admin(tenant, role)
    can_view = _permission(role, "hr.view")
    can_manage = _permission(role, "hr.manage")
    return {
        "role": role,
        "admin": admin,
        "can_view": can_view,
        "can_manage": can_manage,
        "can_view_people": admin or can_view or _permission(role, "employees.view") or _permission(role, "employees.manage"),
        "can_manage_people": admin or can_manage or _permission(role, "employees.manage"),
        "can_invite_employees": admin or _permission(role, "employees.invite"),
        "can_manage_structure": admin or can_manage or _permission(role, "departments.manage") or _permission(role, "designations.manage"),
    }


def _require(db: DbSession, tenant: TenantContext, permission: str) -> OrganizationRole:
    role = _role(db, tenant)
    if not _permission(role, permission):
        raise HTTPException(status_code=403, detail=f"Permission required: {permission}")
    assert role is not None
    return role


def _local_today(tenant: TenantContext) -> date:
    try:
        zone = ZoneInfo(tenant.organization.timezone)
    except Exception:
        zone = timezone.utc
    return datetime.now(timezone.utc).astimezone(zone).date()


def _active_department(db: DbSession, organization_id: str, item_id: str | None) -> Department | None:
    if not item_id:
        return None
    item = db.scalar(
        select(Department).where(
            Department.id == item_id,
            Department.organization_id == organization_id,
            Department.is_active.is_(True),
        )
    )
    if item is None:
        raise HTTPException(status_code=400, detail="Department is not active in this company")
    return item


def _active_designation(db: DbSession, organization_id: str, item_id: str | None) -> Designation | None:
    if not item_id:
        return None
    item = db.scalar(
        select(Designation).where(
            Designation.id == item_id,
            Designation.organization_id == organization_id,
            Designation.is_active.is_(True),
        )
    )
    if item is None:
        raise HTTPException(status_code=400, detail="Designation is not active in this company")
    return item


@router.get("/access")
def hr_access(db: DbSession, tenant: CurrentTenant):
    caps = _capabilities(db, tenant)
    role = caps["role"]
    is_employee = db.scalar(
        select(func.count(Employee.id)).where(
            Employee.organization_id == tenant.organization_id,
            Employee.membership_id == tenant.membership_id,
            Employee.employment_status == "active",
        )
    )
    can_self = _permission(role if isinstance(role, OrganizationRole) else None, "hr.self") and bool(is_employee)
    can_view = bool(caps["can_view"])
    return {
        "can_view": can_view,
        "can_manage": bool(caps["can_manage"]),
        "can_self": can_self,
        "can_view_people": bool(caps["can_view_people"]),
        "can_manage_people": bool(caps["can_manage_people"]),
        "can_invite_employees": bool(caps["can_invite_employees"]),
        "can_manage_structure": bool(caps["can_manage_structure"]),
        "is_employee": bool(is_employee),
        "role_name": role.name if isinstance(role, OrganizationRole) else None,
        "timezone": tenant.organization.timezone,
        "currency": tenant.organization.currency,
        "landing": "overview" if can_view else ("me" if can_self else "unavailable"),
    }


@router.get("/people")
def hr_people(db: DbSession, tenant: CurrentTenant):
    caps = _capabilities(db, tenant)
    if not caps["can_view_people"]:
        raise HTTPException(status_code=403, detail="People directory access is not allowed for this role")

    org = tenant.organization_id
    rows = db.execute(
        select(Employee, Membership, User, OrganizationRole, Department, Designation)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .join(OrganizationRole, OrganizationRole.id == Membership.role_id)
        .outerjoin(Department, Department.id == Employee.department_id)
        .outerjoin(Designation, Designation.id == Employee.designation_id)
        .where(Employee.organization_id == org)
        .order_by(User.full_name.asc(), Employee.employee_code.asc())
        .limit(1000)
    ).all()
    people = [
        {
            "id": employee.id,
            "membership_id": membership.id,
            "full_name": user.full_name,
            "login_email": user.email,
            "employee_code": employee.employee_code,
            "role_name": role.name,
            "membership_status": membership.status,
            "department_id": employee.department_id,
            "department_name": department.name if department else None,
            "designation_id": employee.designation_id,
            "designation_name": designation.name if designation else None,
            "manager_employee_id": employee.manager_employee_id,
            "work_email": employee.work_email,
            "phone": employee.phone,
            "work_phone": employee.work_phone,
            "employment_type": employee.employment_type,
            "employment_status": employee.employment_status,
            "join_date": employee.join_date,
            "end_date": employee.end_date,
            "work_location": employee.work_location,
            "notes": employee.notes,
        }
        for employee, membership, user, role, department, designation in rows
    ]
    departments = db.scalars(
        select(Department).where(Department.organization_id == org, Department.is_active.is_(True)).order_by(Department.name.asc())
    ).all()
    designations = db.scalars(
        select(Designation).where(Designation.organization_id == org, Designation.is_active.is_(True)).order_by(Designation.name.asc())
    ).all()

    invitations = []
    invite_roles = []
    if caps["can_invite_employees"]:
        invitation_rows = db.execute(
            select(EmployeeInvitation, OrganizationRole.name)
            .join(OrganizationRole, OrganizationRole.id == EmployeeInvitation.role_id)
            .where(
                EmployeeInvitation.organization_id == org,
                EmployeeInvitation.status == "pending",
                EmployeeInvitation.expires_at > datetime.now(timezone.utc),
            )
            .order_by(EmployeeInvitation.created_at.desc())
            .limit(100)
        ).all()
        invitations = [
            {
                "id": invitation.id,
                "email": invitation.email,
                "full_name": invitation.full_name,
                "employee_code": invitation.employee_code,
                "role_name": role_name,
                "expires_at": invitation.expires_at,
            }
            for invitation, role_name in invitation_rows
        ]
        invite_roles = [
            {"id": role.id, "name": role.name, "slug": role.slug}
            for role in grantable_employee_roles(db, tenant)
        ]

    return {
        "people": people,
        "departments": [{"id": item.id, "name": item.name, "code": item.code} for item in departments],
        "designations": [{"id": item.id, "name": item.name, "code": item.code} for item in designations],
        "invite_roles": invite_roles,
        "invitations": invitations,
        "capabilities": {
            "can_manage_people": bool(caps["can_manage_people"]),
            "can_invite_employees": bool(caps["can_invite_employees"]),
            "can_manage_structure": bool(caps["can_manage_structure"]),
        },
    }


@router.patch("/people/{employee_id}")
def update_hr_person(employee_id: str, payload: HRPersonUpdate, request: Request, db: DbSession, tenant: CurrentTenant):
    caps = _capabilities(db, tenant)
    if not caps["can_manage_people"]:
        raise HTTPException(status_code=403, detail="Employee profile management is not allowed for this role")

    employee = db.scalar(
        select(Employee)
        .where(Employee.id == employee_id, Employee.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    changes = payload.model_dump(exclude_unset=True)
    if "department_id" in changes:
        _active_department(db, tenant.organization_id, changes["department_id"])
    if "designation_id" in changes:
        _active_designation(db, tenant.organization_id, changes["designation_id"])
    if "manager_employee_id" in changes and changes["manager_employee_id"]:
        manager = db.scalar(
            select(Employee).where(
                Employee.id == changes["manager_employee_id"],
                Employee.organization_id == tenant.organization_id,
            )
        )
        if manager is None or manager.id == employee.id:
            raise HTTPException(status_code=400, detail="Select another active company employee as manager")
    if "employment_type" in changes and changes["employment_type"] not in {"full_time", "part_time", "contract", "internship", "temporary"}:
        raise HTTPException(status_code=400, detail="Invalid employment type")

    before = {
        "department_id": employee.department_id,
        "designation_id": employee.designation_id,
        "manager_employee_id": employee.manager_employee_id,
        "work_email": employee.work_email,
        "phone": employee.phone,
        "work_phone": employee.work_phone,
        "employment_type": employee.employment_type,
        "join_date": employee.join_date.isoformat() if employee.join_date else None,
        "end_date": employee.end_date.isoformat() if employee.end_date else None,
        "work_location": employee.work_location,
        "notes": employee.notes,
    }
    for field, value in changes.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(employee, field, value)
    if employee.join_date and employee.end_date and employee.end_date < employee.join_date:
        raise HTTPException(status_code=400, detail="End date cannot be before join date")
    db.flush()
    after = {
        "department_id": employee.department_id,
        "designation_id": employee.designation_id,
        "manager_employee_id": employee.manager_employee_id,
        "work_email": employee.work_email,
        "phone": employee.phone,
        "work_phone": employee.work_phone,
        "employment_type": employee.employment_type,
        "join_date": employee.join_date.isoformat() if employee.join_date else None,
        "end_date": employee.end_date.isoformat() if employee.end_date else None,
        "work_location": employee.work_location,
        "notes": employee.notes,
    }
    record_activity(
        db,
        action="hr.person.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="employee",
        entity_id=employee.id,
        before=before,
        after=after,
        message=f"Employee HR profile updated: {employee.employee_code}",
        request=request,
    )
    db.commit()
    return {"id": employee.id, "updated": True}


@router.post("/people/invitations", status_code=status.HTTP_201_CREATED)
def invite_hr_person(payload: InvitationCreate, request: Request, db: DbSession, tenant: CurrentTenant):
    caps = _capabilities(db, tenant)
    if not caps["can_invite_employees"]:
        raise HTTPException(status_code=403, detail="Employee invitation is not allowed for this role")
    ensure_grantable_employee_role(db, tenant, payload.role_id)
    return create_invitation(payload, request, db, tenant)  # type: ignore[arg-type]


@router.post("/people/departments", status_code=status.HTTP_201_CREATED)
def create_hr_department(payload: HRStructureCreate, request: Request, db: DbSession, tenant: CurrentTenant):
    caps = _capabilities(db, tenant)
    if not caps["can_manage_structure"]:
        raise HTTPException(status_code=403, detail="Company structure management is not allowed for this role")
    item = Department(
        organization_id=tenant.organization_id,
        name=payload.name.strip(),
        code=(payload.code or "").strip().upper() or None,
        description=(payload.description or "").strip() or None,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Department name or code already exists") from exc
    record_activity(
        db,
        action="hr.department.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="department",
        entity_id=item.id,
        after={"name": item.name, "code": item.code},
        message=f"Department created: {item.name}",
        request=request,
    )
    db.commit()
    return {"id": item.id, "name": item.name, "code": item.code}


@router.post("/people/designations", status_code=status.HTTP_201_CREATED)
def create_hr_designation(payload: HRStructureCreate, request: Request, db: DbSession, tenant: CurrentTenant):
    caps = _capabilities(db, tenant)
    if not caps["can_manage_structure"]:
        raise HTTPException(status_code=403, detail="Company structure management is not allowed for this role")
    item = Designation(
        organization_id=tenant.organization_id,
        name=payload.name.strip(),
        code=(payload.code or "").strip().upper() or None,
        description=(payload.description or "").strip() or None,
    )
    db.add(item)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Designation name or code already exists") from exc
    record_activity(
        db,
        action="hr.designation.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="designation",
        entity_id=item.id,
        after={"name": item.name, "code": item.code},
        message=f"Designation created: {item.name}",
        request=request,
    )
    db.commit()
    return {"id": item.id, "name": item.name, "code": item.code}


@router.get("/workspace-summary")
def hr_workspace_summary(db: DbSession, tenant: CurrentTenant):
    _require(db, tenant, "hr.view")

    org = tenant.organization_id
    today = _local_today(tenant)
    in_30_days = today + timedelta(days=30)

    active_employees = int(
        db.scalar(
            select(func.count(Employee.id)).where(
                Employee.organization_id == org,
                Employee.employment_status == "active",
            )
        )
        or 0
    )
    present_today = int(
        db.scalar(
            select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.organization_id == org,
                AttendanceRecord.attendance_date == today,
                AttendanceRecord.status.in_(["present", "late", "remote"]),
            )
        )
        or 0
    )
    absent_today = int(
        db.scalar(
            select(func.count(AttendanceRecord.id)).where(
                AttendanceRecord.organization_id == org,
                AttendanceRecord.attendance_date == today,
                AttendanceRecord.status == "absent",
            )
        )
        or 0
    )
    on_leave_today = int(
        db.scalar(
            select(func.count(LeaveRequest.id)).where(
                LeaveRequest.organization_id == org,
                LeaveRequest.status == "approved",
                LeaveRequest.start_date <= today,
                LeaveRequest.end_date >= today,
            )
        )
        or 0
    )
    pending_leave = int(
        db.scalar(
            select(func.count(LeaveRequest.id)).where(
                LeaveRequest.organization_id == org,
                LeaveRequest.status == "pending",
            )
        )
        or 0
    )
    documents_expiring_30d = int(
        db.scalar(
            select(func.count(EmployeeHRDocument.id)).where(
                EmployeeHRDocument.organization_id == org,
                EmployeeHRDocument.expires_on.is_not(None),
                EmployeeHRDocument.expires_on >= today,
                EmployeeHRDocument.expires_on <= in_30_days,
            )
        )
        or 0
    )
    open_jobs = int(
        db.scalar(
            select(func.count(JobOpening.id)).where(
                JobOpening.organization_id == org,
                JobOpening.status == "open",
            )
        )
        or 0
    )
    active_candidates = int(
        db.scalar(
            select(func.count(JobCandidate.id)).where(
                JobCandidate.organization_id == org,
                JobCandidate.stage.notin_(["hired", "rejected"]),
            )
        )
        or 0
    )

    departments = int(
        db.scalar(
            select(func.count(Department.id)).where(
                Department.organization_id == org,
                Department.is_active.is_(True),
            )
        )
        or 0
    )
    leave_types = int(
        db.scalar(
            select(func.count(LeaveType.id)).where(
                LeaveType.organization_id == org,
                LeaveType.is_active.is_(True),
            )
        )
        or 0
    )
    shifts = int(
        db.scalar(
            select(func.count(HRShift.id)).where(
                HRShift.organization_id == org,
                HRShift.is_active.is_(True),
            )
        )
        or 0
    )
    holidays = int(db.scalar(select(func.count(HRHoliday.id)).where(HRHoliday.organization_id == org)) or 0)
    pending_invitations = 0
    caps = _capabilities(db, tenant)
    if caps["can_invite_employees"]:
        pending_invitations = int(
            db.scalar(
                select(func.count(EmployeeInvitation.id)).where(
                    EmployeeInvitation.organization_id == org,
                    EmployeeInvitation.status == "pending",
                    EmployeeInvitation.expires_at > datetime.now(timezone.utc),
                )
            )
            or 0
        )

    return {
        "today": today,
        "timezone": tenant.organization.timezone,
        "metrics": {
            "active_employees": active_employees,
            "present_today": present_today,
            "absent_today": absent_today,
            "on_leave_today": on_leave_today,
        },
        "attention": {
            "pending_leave": pending_leave,
            "documents_expiring_30d": documents_expiring_30d,
            "active_candidates": active_candidates,
            "pending_invitations": pending_invitations,
        },
        "setup": {
            "departments": departments,
            "leave_types": leave_types,
            "shifts": shifts,
            "holidays": holidays,
            "employees": active_employees,
        },
        "recruitment": {"open_jobs": open_jobs},
    }


@router.patch("/jobs/{job_id}/status")
def update_job_status(job_id: str, payload: JobStatusUpdate, request: Request, db: DbSession, tenant: CurrentTenant):
    _require(db, tenant, "hr.manage")
    next_status = payload.status.strip().lower()
    if next_status not in {"open", "on_hold", "closed"}:
        raise HTTPException(status_code=400, detail="Job status must be open, on_hold or closed")
    item = db.scalar(
        select(JobOpening)
        .where(JobOpening.id == job_id, JobOpening.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Job opening not found")
    previous = item.status
    item.status = next_status
    record_activity(
        db,
        action="hr.job.status_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="job_opening",
        entity_id=item.id,
        before={"status": previous},
        after={"status": item.status},
        message=f"Job opening {item.title} changed from {previous} to {item.status}",
        request=request,
    )
    db.commit()
    return {"id": item.id, "status": item.status}
