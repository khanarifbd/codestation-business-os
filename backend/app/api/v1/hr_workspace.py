from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.dependencies import CurrentTenant, DbSession
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
from app.models.team import Department, Employee, EmployeeInvitation, OrganizationRole
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR Workspace"])


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


def _local_today(tenant: TenantContext) -> date:
    try:
        zone = ZoneInfo(tenant.organization.timezone)
    except Exception:
        zone = timezone.utc
    return datetime.now(timezone.utc).astimezone(zone).date()


@router.get("/access")
def hr_access(db: DbSession, tenant: CurrentTenant):
    role = _role(db, tenant)
    is_employee = db.scalar(
        select(func.count(Employee.id)).where(
            Employee.organization_id == tenant.organization_id,
            Employee.membership_id == tenant.membership_id,
            Employee.employment_status == "active",
        )
    )
    can_view = _permission(role, "hr.view")
    can_manage = _permission(role, "hr.manage")
    can_self = _permission(role, "hr.self") and bool(is_employee)
    can_manage_people = tenant.role == MEMBERSHIP_ROLE_ADMIN
    return {
        "can_view": can_view,
        "can_manage": can_manage,
        "can_self": can_self,
        "can_manage_people": can_manage_people,
        "is_employee": bool(is_employee),
        "role_name": role.name if role else None,
        "timezone": tenant.organization.timezone,
        "currency": tenant.organization.currency,
        "landing": "overview" if can_view else ("me" if can_self else "unavailable"),
    }


@router.get("/workspace-summary")
def hr_workspace_summary(db: DbSession, tenant: CurrentTenant):
    role = _role(db, tenant)
    if not _permission(role, "hr.view"):
        raise HTTPException(status_code=403, detail="Permission required: hr.view")

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
    holidays = int(
        db.scalar(select(func.count(HRHoliday.id)).where(HRHoliday.organization_id == org)) or 0
    )
    pending_invitations = 0
    if tenant.role == MEMBERSHIP_ROLE_ADMIN:
        pending_invitations = int(
            db.scalar(
                select(func.count(EmployeeInvitation.id)).where(
                    EmployeeInvitation.organization_id == org,
                    EmployeeInvitation.status == "pending",
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
