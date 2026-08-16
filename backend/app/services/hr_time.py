from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.hr import EmployeeShiftAssignment, HRShift


def shift_for_date(
    db: Session,
    *,
    organization_id: str,
    employee_id: str,
    work_date: date,
) -> HRShift | None:
    """Return the employee's most recent effective shift for a local work date."""

    return db.scalar(
        select(HRShift)
        .join(EmployeeShiftAssignment, EmployeeShiftAssignment.shift_id == HRShift.id)
        .where(
            EmployeeShiftAssignment.organization_id == organization_id,
            EmployeeShiftAssignment.employee_id == employee_id,
            EmployeeShiftAssignment.effective_from <= work_date,
            or_(
                EmployeeShiftAssignment.effective_to.is_(None),
                EmployeeShiftAssignment.effective_to >= work_date,
            ),
            HRShift.organization_id == organization_id,
        )
        .order_by(
            EmployeeShiftAssignment.effective_from.desc(),
            EmployeeShiftAssignment.created_at.desc(),
        )
        .limit(1)
    )


def scheduled_presence_minutes(shift: HRShift | None, work_date: date) -> int:
    """Scheduled elapsed presence minutes, including configured break time.

    Attendance currently records elapsed check-in -> check-out time rather than discrete
    breaks, so overtime must compare like-for-like elapsed minutes. A weekly off day has
    zero scheduled minutes, meaning any worked time is overtime. Without a configured
    shift we keep the historical eight-hour fallback.
    """

    if shift is None:
        return 480
    if work_date.weekday() in set(shift.weekly_off_days or []):
        return 0

    start = datetime.combine(work_date, shift.start_time)
    end = datetime.combine(work_date, shift.end_time)
    if end <= start:
        end += timedelta(days=1)
    return max(0, int((end - start).total_seconds() // 60))


def attendance_status_for_check_in(shift: HRShift | None, local_now: datetime) -> str:
    if shift is None or local_now.date().weekday() in set(shift.weekly_off_days or []):
        return "present"

    scheduled_start = datetime.combine(local_now.date(), shift.start_time).replace(tzinfo=local_now.tzinfo)
    latest_on_time = scheduled_start + timedelta(minutes=max(0, shift.grace_minutes or 0))
    return "late" if local_now > latest_on_time else "present"
