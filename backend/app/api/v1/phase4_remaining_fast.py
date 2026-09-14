from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from app.api.dependencies import CurrentTenant, DbSession
from app.api.v1.finance_expenses import FinanceViewer, _account_balance_map, _category_read, _money, _vendor_read
from app.api.v1.hr_workspace import _admin, _local_today, _permission, _role
from app.models.expenses import ExpenseCategory, Vendor
from app.models.finance import FinancialAccount
from app.models.hr import AttendanceRecord, EmployeeHRDocument, HRShift, JobCandidate, JobOpening, LeaveRequest, LeaveType
from app.models.hr_extended import HRHoliday
from app.models.team import Department, Employee, EmployeeInvitation, OrganizationRole
from app.schemas.expenses import ExpenseMeta, ExpenseMetaAccount

router = APIRouter()
finance_router = APIRouter(prefix="/finance", tags=["Expenses & Profitability"])
hr_router = APIRouter(prefix="/hr", tags=["HR Workspace"])


@finance_router.get("/expense-meta-lite", response_model=ExpenseMeta)
def expense_meta_lite(db: DbSession, tenant: FinanceViewer) -> ExpenseMeta:
    vendors = db.scalars(
        select(Vendor)
        .where(Vendor.organization_id == tenant.organization_id)
        .order_by(Vendor.is_active.desc(), Vendor.name.asc())
    ).all()
    categories = db.scalars(
        select(ExpenseCategory)
        .where(ExpenseCategory.organization_id == tenant.organization_id)
        .order_by(ExpenseCategory.is_active.desc(), ExpenseCategory.sort_order.asc(), ExpenseCategory.name.asc())
    ).all()
    accounts = db.scalars(
        select(FinancialAccount)
        .where(FinancialAccount.organization_id == tenant.organization_id)
        .order_by(FinancialAccount.is_active.desc(), FinancialAccount.name.asc())
    ).all()
    balance_map = _account_balance_map(db, tenant.organization_id)
    return ExpenseMeta(
        vendors=[_vendor_read(item) for item in vendors],
        categories=[_category_read(item) for item in categories],
        accounts=[
            ExpenseMetaAccount(
                id=item.id,
                name=item.name,
                currency=item.currency,
                current_balance=_money(Decimal(item.opening_balance) + balance_map.get(item.id, Decimal("0"))),
                is_active=item.is_active,
            )
            for item in accounts
        ],
        clients=[],
        projects=[],
        orders=[],
        invoices=[],
        payments=[],
    )


def _count(model, *conditions):
    return select(func.count(model.id)).where(*conditions).scalar_subquery()


@hr_router.get("/workspace-summary")
def hr_workspace_summary_fast(db: DbSession, tenant: CurrentTenant):
    role = getattr(tenant, "organization_role", None)
    if not isinstance(role, OrganizationRole):
        role = _role(db, tenant)
    if not _permission(role, "hr.view"):
        raise HTTPException(status_code=403, detail="Permission required: hr.view")

    org = tenant.organization_id
    today = _local_today(tenant)
    in_30_days = today + timedelta(days=30)
    can_invite_employees = _admin(tenant, role) or _permission(role, "employees.invite")

    columns = [
        _count(Employee, Employee.organization_id == org, Employee.employment_status == "active").label("active_employees"),
        _count(
            AttendanceRecord,
            AttendanceRecord.organization_id == org,
            AttendanceRecord.attendance_date == today,
            AttendanceRecord.status.in_(["present", "late", "remote"]),
        ).label("present_today"),
        _count(
            AttendanceRecord,
            AttendanceRecord.organization_id == org,
            AttendanceRecord.attendance_date == today,
            AttendanceRecord.status == "absent",
        ).label("absent_today"),
        _count(
            LeaveRequest,
            LeaveRequest.organization_id == org,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= today,
            LeaveRequest.end_date >= today,
        ).label("on_leave_today"),
        _count(LeaveRequest, LeaveRequest.organization_id == org, LeaveRequest.status == "pending").label("pending_leave"),
        _count(
            EmployeeHRDocument,
            EmployeeHRDocument.organization_id == org,
            EmployeeHRDocument.expires_on.is_not(None),
            EmployeeHRDocument.expires_on >= today,
            EmployeeHRDocument.expires_on <= in_30_days,
        ).label("documents_expiring_30d"),
        _count(JobOpening, JobOpening.organization_id == org, JobOpening.status == "open").label("open_jobs"),
        _count(
            JobCandidate,
            JobCandidate.organization_id == org,
            JobCandidate.stage.notin_(["hired", "rejected"]),
        ).label("active_candidates"),
        _count(Department, Department.organization_id == org, Department.is_active.is_(True)).label("departments"),
        _count(LeaveType, LeaveType.organization_id == org, LeaveType.is_active.is_(True)).label("leave_types"),
        _count(HRShift, HRShift.organization_id == org, HRShift.is_active.is_(True)).label("shifts"),
        _count(HRHoliday, HRHoliday.organization_id == org).label("holidays"),
    ]
    if can_invite_employees:
        columns.append(
            _count(
                EmployeeInvitation,
                EmployeeInvitation.organization_id == org,
                EmployeeInvitation.status == "pending",
                EmployeeInvitation.expires_at > datetime.now(timezone.utc),
            ).label("pending_invitations")
        )

    row = db.execute(select(*columns)).one()
    pending_invitations = int(getattr(row, "pending_invitations", 0) or 0)
    active_employees = int(row.active_employees or 0)
    return {
        "today": today,
        "timezone": tenant.organization.timezone,
        "metrics": {
            "active_employees": active_employees,
            "present_today": int(row.present_today or 0),
            "absent_today": int(row.absent_today or 0),
            "on_leave_today": int(row.on_leave_today or 0),
        },
        "attention": {
            "pending_leave": int(row.pending_leave or 0),
            "documents_expiring_30d": int(row.documents_expiring_30d or 0),
            "active_candidates": int(row.active_candidates or 0),
            "pending_invitations": pending_invitations,
        },
        "setup": {
            "departments": int(row.departments or 0),
            "leave_types": int(row.leave_types or 0),
            "shifts": int(row.shifts or 0),
            "holidays": int(row.holidays or 0),
            "employees": active_employees,
        },
        "recruitment": {"open_jobs": int(row.open_jobs or 0)},
    }


router.include_router(finance_router)
router.include_router(hr_router)
