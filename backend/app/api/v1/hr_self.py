from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.hr import AttendanceRecord, LeaveRequest, LeaveType, PerformanceReview
from app.models.hr_extended import HRAnnouncementAcknowledgement, HRHoliday
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


def _overlap_days(start_date: date, end_date: date, range_start: date, range_end: date) -> Decimal:
    start = max(start_date, range_start)
    end = min(end_date, range_end)
    if end < start:
        return Decimal("0")
    return Decimal((end - start).days + 1)


def _leave_balances(db: DbSession, tenant: TenantContext, employee: Employee, year: int) -> list[dict]:
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    leave_types = db.scalars(
        select(LeaveType)
        .where(
            LeaveType.organization_id == tenant.organization_id,
            LeaveType.is_active.is_(True),
        )
        .order_by(LeaveType.name)
    ).all()
    requests = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.organization_id == tenant.organization_id,
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status.in_(["approved", "pending"]),
            LeaveRequest.start_date <= year_end,
            LeaveRequest.end_date >= year_start,
        )
    ).all()

    result: list[dict] = []
    for leave_type in leave_types:
        approved = Decimal("0")
        pending = Decimal("0")
        for request in requests:
            if request.leave_type_id != leave_type.id:
                continue
            days = _overlap_days(request.start_date, request.end_date, year_start, year_end)
            if request.status == "approved":
                approved += days
            elif request.status == "pending":
                pending += days
        allowance = Decimal(str(leave_type.annual_allowance_days))
        remaining = allowance - approved - pending
        result.append(
            {
                "leave_type_id": leave_type.id,
                "name": leave_type.name,
                "code": leave_type.code,
                "is_paid": leave_type.is_paid,
                "allowance_days": str(allowance),
                "approved_days": str(approved),
                "pending_days": str(pending),
                "remaining_days": str(remaining),
            }
        )
    return result


def _parse_month(value: str | None, local: datetime) -> tuple[int, int]:
    if not value:
        return local.year, local.month
    try:
        parsed = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Month must use YYYY-MM format") from exc
    return parsed.year, parsed.month


@router.get("/self-meta")
def self_meta(db: DbSession, tenant: HRSelf):
    return {
        "leave_types": [
            {
                "id": x.id,
                "name": x.name,
                "code": x.code,
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


@router.get("/self/home")
def self_home(db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    _, local = _now(tenant)
    today = local.date()
    balances = _leave_balances(db, tenant, employee, today.year)
    annual = next((item for item in balances if item["code"] == "ANNUAL"), None)

    attendance = db.scalar(
        select(AttendanceRecord).where(
            AttendanceRecord.organization_id == tenant.organization_id,
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date == today,
        )
    )
    pending_leave = int(
        db.scalar(
            select(func.count(LeaveRequest.id)).where(
                LeaveRequest.organization_id == tenant.organization_id,
                LeaveRequest.employee_id == employee.id,
                LeaveRequest.status == "pending",
            )
        )
        or 0
    )

    latest_pay = db.execute(
        select(PayrollEntry, PayrollRun, PayrollPeriod)
        .join(PayrollRun, PayrollRun.id == PayrollEntry.run_id)
        .join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id)
        .where(
            PayrollEntry.organization_id == tenant.organization_id,
            PayrollEntry.employee_id == employee.id,
            PayrollRun.organization_id == tenant.organization_id,
            PayrollRun.status.in_(["approved", "paid"]),
            PayrollPeriod.organization_id == tenant.organization_id,
        )
        .order_by(PayrollPeriod.period_end.desc())
        .limit(1)
    ).first()

    policy_ids = db.scalars(
        select(HRAnnouncementAcknowledgement.announcement_id).where(
            HRAnnouncementAcknowledgement.organization_id == tenant.organization_id,
            HRAnnouncementAcknowledgement.employee_id == employee.id,
        )
    ).all()
    from app.models.hr import HRAnnouncement

    policies_to_acknowledge = int(
        db.scalar(
            select(func.count(HRAnnouncement.id)).where(
                HRAnnouncement.organization_id == tenant.organization_id,
                HRAnnouncement.is_policy.is_(True),
                HRAnnouncement.published_at.is_not(None),
                HRAnnouncement.id.notin_(policy_ids) if policy_ids else True,
            )
        )
        or 0
    )

    latest_payslip = None
    if latest_pay is not None:
        entry, run, period = latest_pay
        latest_payslip = {
            "entry_id": entry.id,
            "period_name": period.name,
            "currency": entry.currency,
            "net_pay": str(entry.net_pay),
            "status": run.status,
        }

    return {
        "today": today,
        "attendance": None
        if attendance is None
        else {
            "status": attendance.status,
            "check_in_at": attendance.check_in_at,
            "check_out_at": attendance.check_out_at,
            "work_minutes": attendance.work_minutes,
        },
        "pending_leave": pending_leave,
        "annual_leave": annual,
        "latest_payslip": latest_payslip,
        "policies_to_acknowledge": policies_to_acknowledge,
    }


@router.get("/self/leave-balance")
def self_leave_balance(db: DbSession, tenant: HRSelf, year: int | None = None):
    employee = _employee(db, tenant)
    _, local = _now(tenant)
    selected_year = year or local.year
    if selected_year < 1900 or selected_year > 2200:
        raise HTTPException(status_code=400, detail="Invalid leave balance year")
    return {"year": selected_year, "items": _leave_balances(db, tenant, employee, selected_year)}


@router.post("/self/leave-requests/{request_id}/cancel")
def cancel_self_leave(request_id: str, request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    item = db.scalar(
        select(LeaveRequest)
        .where(
            LeaveRequest.id == request_id,
            LeaveRequest.organization_id == tenant.organization_id,
            LeaveRequest.employee_id == employee.id,
        )
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Leave request not found")
    if item.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending leave requests can be cancelled")

    item.status = "cancelled"
    record_activity(
        db,
        action="hr.leave.cancelled_by_employee",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="leave_request",
        entity_id=item.id,
        after={"employee_id": employee.id, "status": "cancelled"},
        request=request,
    )
    db.commit()
    return {"id": item.id, "status": item.status}


@router.get("/self/attendance/monthly")
def self_attendance_monthly(db: DbSession, tenant: HRSelf, month: str | None = None):
    employee = _employee(db, tenant)
    _, local = _now(tenant)
    year, month_number = _parse_month(month, local)
    month_start = date(year, month_number, 1)
    month_end = date(year, month_number, monthrange(year, month_number)[1])

    attendance_rows = db.scalars(
        select(AttendanceRecord)
        .where(
            AttendanceRecord.organization_id == tenant.organization_id,
            AttendanceRecord.employee_id == employee.id,
            AttendanceRecord.attendance_date >= month_start,
            AttendanceRecord.attendance_date <= month_end,
        )
        .order_by(AttendanceRecord.attendance_date)
    ).all()
    attendance_by_date = {item.attendance_date: item for item in attendance_rows}

    holidays = db.scalars(
        select(HRHoliday).where(
            HRHoliday.organization_id == tenant.organization_id,
            HRHoliday.holiday_date >= month_start,
            HRHoliday.holiday_date <= month_end,
        )
    ).all()
    holiday_by_date = {item.holiday_date: item for item in holidays}

    approved_leave = db.scalars(
        select(LeaveRequest).where(
            LeaveRequest.organization_id == tenant.organization_id,
            LeaveRequest.employee_id == employee.id,
            LeaveRequest.status == "approved",
            LeaveRequest.start_date <= month_end,
            LeaveRequest.end_date >= month_start,
        )
    ).all()

    summary = {
        "present": 0,
        "late": 0,
        "absent": 0,
        "leave": 0,
        "holiday": 0,
        "off": 0,
        "missing": 0,
        "work_minutes": 0,
        "overtime_minutes": 0,
    }
    days: list[dict] = []
    current = month_start
    while current <= month_end:
        record = attendance_by_date.get(current)
        holiday = holiday_by_date.get(current)
        leave = next((item for item in approved_leave if item.start_date <= current <= item.end_date), None)
        employed = not ((employee.join_date and current < employee.join_date) or (employee.end_date and current > employee.end_date))

        if record is not None:
            day_status = record.status
            if day_status == "present":
                summary["present"] += 1
            elif day_status == "late":
                summary["late"] += 1
            elif day_status == "absent":
                summary["absent"] += 1
            summary["work_minutes"] += record.work_minutes or 0
            summary["overtime_minutes"] += record.overtime_minutes or 0
        elif current > local.date():
            day_status = "future"
        elif not employed:
            day_status = "not_employed"
        elif holiday is not None:
            day_status = "holiday"
            summary["holiday"] += 1
        elif leave is not None:
            day_status = "leave"
            summary["leave"] += 1
        else:
            shift = shift_for_date(
                db,
                organization_id=tenant.organization_id,
                employee_id=employee.id,
                work_date=current,
            )
            if shift is not None and scheduled_presence_minutes(shift, current) == 0:
                day_status = "off"
                summary["off"] += 1
            else:
                day_status = "missing"
                summary["missing"] += 1

        days.append(
            {
                "date": current,
                "status": day_status,
                "check_in_at": record.check_in_at if record else None,
                "check_out_at": record.check_out_at if record else None,
                "work_minutes": record.work_minutes if record else 0,
                "overtime_minutes": record.overtime_minutes if record else 0,
                "holiday_name": holiday.name if holiday else None,
            }
        )
        current += timedelta(days=1)

    return {
        "month": f"{year:04d}-{month_number:02d}",
        "summary": summary,
        "days": days,
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
