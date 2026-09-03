from datetime import datetime, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.hr import AttendanceRecord, LeaveType, PerformanceReview
from app.models.membership import Membership
from app.models.payroll import PayrollEntry, PayrollPeriod, PayrollRun
from app.models.team import Employee
from app.models.user import User
from app.services.activity_log import record_activity
from app.services.hr_time import attendance_status_for_check_in, scheduled_presence_minutes, shift_for_date
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR Self Service"])
HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]


class SelfReviewUpdate(BaseModel):
    self_review: str


def _employee(db: DbSession, tenant: TenantContext) -> Employee:
    item = db.scalar(
        select(Employee).where(
            Employee.organization_id == tenant.organization_id,
            Employee.membership_id == tenant.membership_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return item


def _now(tenant: TenantContext) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    try:
        local = now.astimezone(ZoneInfo(tenant.organization.timezone))
    except Exception:
        local = now
    return now, local


def _open_attendance(db: DbSession, tenant: TenantContext, employee: Employee, local: datetime) -> AttendanceRecord | None:
    """Find an open current/overnight attendance record and lock it."""

    earliest = local.date() - timedelta(days=1)
    return db.scalar(
        select(AttendanceRecord)
        .where(
            AttendanceRecord.organization_id == tenant.organization_id,
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date >= earliest,
            AttendanceRecord.attendance_date <= local.date(),
            AttendanceRecord.check_in_at.is_not(None),
            AttendanceRecord.check_out_at.is_(None),
        )
        .order_by(AttendanceRecord.attendance_date.desc(), AttendanceRecord.created_at.desc())
        .with_for_update()
        .limit(1)
    )


@router.get("/self-meta")
def self_meta(db: DbSession, tenant: HRSelf):
    return {
        "leave_types": [
            {
                "id": x.id,
                "name": x.name,
                "annual_allowance_days": str(x.annual_allowance_days),
                "is_paid": x.is_paid,
            }
            for x in db.scalars(
                select(LeaveType)
                .where(
                    LeaveType.organization_id == tenant.organization_id,
                    LeaveType.is_active.is_(True),
                )
                .order_by(LeaveType.name)
            ).all()
        ]
    }


@router.get("/self/payslips/{entry_id}")
def self_payslip(entry_id: str, db: DbSession, tenant: HRSelf):
    """Return one approved/paid payslip belonging only to the authenticated employee."""

    employee = _employee(db, tenant)
    row = db.execute(
        select(PayrollEntry, PayrollRun, PayrollPeriod, User.full_name)
        .join(PayrollRun, PayrollRun.id == PayrollEntry.run_id)
        .join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id)
        .join(Employee, Employee.id == PayrollEntry.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            PayrollEntry.id == entry_id,
            PayrollEntry.organization_id == tenant.organization_id,
            PayrollEntry.employee_id == employee.id,
            PayrollRun.organization_id == tenant.organization_id,
            PayrollRun.status.in_(["approved", "paid"]),
            PayrollPeriod.organization_id == tenant.organization_id,
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Payslip not found")

    entry, run, period, employee_name = row
    return {
        "organization": {
            "name": tenant.organization.name,
            "country_code": tenant.organization.country_code,
            "currency": tenant.organization.currency,
            "timezone": tenant.organization.timezone,
        },
        "run": {
            "id": run.id,
            "run_number": run.run_number,
            "period_name": period.name,
            "period_start": period.period_start,
            "period_end": period.period_end,
            "pay_date": period.pay_date,
            "status": run.status,
        },
        "entry": {
            "id": entry.id,
            "employee_code": employee.employee_code,
            "employee_name": employee_name,
            "currency": entry.currency,
            "base_salary": str(entry.base_salary),
            "allowances": entry.allowances,
            "deductions": entry.deductions,
            "allowance_total": str(entry.allowance_total),
            "deduction_total": str(entry.deduction_total),
            "tax_amount": str(entry.tax_amount),
            "gross_pay": str(entry.gross_pay),
            "net_pay": str(entry.net_pay),
            "notes": entry.notes,
        },
    }


@router.post("/self/check-in")
def check_in(request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    now, local = _now(tenant)

    open_record = _open_attendance(db, tenant, employee, local)
    if open_record is not None and open_record.attendance_date != local.date():
        raise HTTPException(status_code=409, detail="Check out your previous shift first")

    item = db.scalar(
        select(AttendanceRecord)
        .where(
            AttendanceRecord.organization_id == tenant.organization_id,
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date == local.date(),
        )
        .with_for_update()
    )
    shift = shift_for_date(
        db,
        organization_id=tenant.organization_id,
        employee_id=employee.id,
        work_date=local.date(),
    )
    attendance_status = attendance_status_for_check_in(shift, local)

    if item is None:
        item = AttendanceRecord(
            organization_id=tenant.organization_id,
            employee_id=employee.id,
            attendance_date=local.date(),
            check_in_at=now,
            status=attendance_status,
            source="self",
        )
        db.add(item)
        db.flush()
    elif item.check_in_at is not None:
        raise HTTPException(status_code=409, detail="Already checked in today")
    else:
        item.check_in_at = now
        item.status = attendance_status
        item.source = "self"

    record_activity(
        db,
        action="hr.attendance.checked_in",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="attendance_record",
        entity_id=item.id,
        after={
            "employee_id": employee.id,
            "date": str(local.date()),
            "status": attendance_status,
            "shift_id": shift.id if shift else None,
        },
        request=request,
    )
    db.commit()
    return {"id": item.id, "check_in_at": item.check_in_at, "status": item.status}


@router.post("/self/check-out")
def check_out(request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    now, local = _now(tenant)
    item = _open_attendance(db, tenant, employee, local)
    if item is None or item.check_in_at is None:
        raise HTTPException(status_code=409, detail="Check in first")

    item.check_out_at = now
    worked = max(0, int((item.check_out_at - item.check_in_at).total_seconds() // 60))
    shift = shift_for_date(
        db,
        organization_id=tenant.organization_id,
        employee_id=employee.id,
        work_date=item.attendance_date,
    )
    scheduled = scheduled_presence_minutes(shift, item.attendance_date)
    item.work_minutes = worked
    item.overtime_minutes = max(0, worked - scheduled)

    record_activity(
        db,
        action="hr.attendance.checked_out",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="attendance_record",
        entity_id=item.id,
        after={
            "work_minutes": worked,
            "scheduled_minutes": scheduled,
            "overtime_minutes": item.overtime_minutes,
            "shift_id": shift.id if shift else None,
        },
        request=request,
    )
    db.commit()
    return {
        "id": item.id,
        "check_out_at": item.check_out_at,
        "work_minutes": item.work_minutes,
        "overtime_minutes": item.overtime_minutes,
    }


@router.patch("/self/performance/{review_id}")
def self_review(review_id: str, payload: SelfReviewUpdate, request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    item = db.scalar(
        select(PerformanceReview)
        .where(
            PerformanceReview.id == review_id,
            PerformanceReview.organization_id == tenant.organization_id,
            PerformanceReview.employee_id == employee.id,
        )
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Performance review not found")
    if item.status == "completed":
        raise HTTPException(status_code=409, detail="Completed review is locked")
    item.self_review = payload.self_review.strip()
    record_activity(
        db,
        action="hr.performance.self_reviewed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="performance_review",
        entity_id=item.id,
        after={"employee_id": employee.id},
        request=request,
    )
    db.commit()
    return {"id": item.id}
