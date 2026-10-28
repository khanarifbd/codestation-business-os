"""Serialize leave reservations per employee, including first-time requests."""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hr import LeaveRequest
from app.models.team import Employee


def lock_leave_employee(db: Session, organization_id: str, employee_id: str) -> None:
    # Lock the stable parent, not just existing leave rows: two concurrent first
    # requests must not both observe an empty date range and reserve it.
    employee = db.scalar(select(Employee.id).where(
        Employee.organization_id == organization_id,
        Employee.id == employee_id,
    ).with_for_update())
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")


def ensure_no_leave_overlap(
    db: Session, organization_id: str, employee_id: str,
    start_date: date, end_date: date, *, exclude_request_id: str | None = None,
) -> None:
    """Caller holds the employee lock until its transaction commits/rolls back."""
    query = select(LeaveRequest.id).where(
        LeaveRequest.organization_id == organization_id,
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.status.in_(["pending", "approved"]),
        LeaveRequest.start_date <= end_date,
        LeaveRequest.end_date >= start_date,
    )
    if exclude_request_id is not None:
        query = query.where(LeaveRequest.id != exclude_request_id)
    if db.scalar(query.limit(1)) is not None:
        raise HTTPException(
            status_code=409,
            detail="These dates overlap an existing pending or approved leave request for this employee",
        )
