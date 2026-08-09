from datetime import datetime, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.hr import AttendanceRecord, LeaveType, PerformanceReview
from app.models.team import Employee
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR Self Service"])
HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]


class SelfReviewUpdate(BaseModel):
    self_review: str


def _employee(db: DbSession, tenant: TenantContext) -> Employee:
    item = db.scalar(select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.membership_id == tenant.membership_id))
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


@router.get("/self-meta")
def self_meta(db: DbSession, tenant: HRSelf):
    return {"leave_types": [
        {"id": x.id, "name": x.name, "annual_allowance_days": str(x.annual_allowance_days), "is_paid": x.is_paid}
        for x in db.scalars(select(LeaveType).where(LeaveType.organization_id == tenant.organization_id, LeaveType.is_active.is_(True)).order_by(LeaveType.name)).all()
    ]}


@router.post("/self/check-in")
def check_in(request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    now, local = _now(tenant)
    item = db.scalar(select(AttendanceRecord).where(AttendanceRecord.organization_id == tenant.organization_id, AttendanceRecord.employee_id == employee.id, AttendanceRecord.attendance_date == local.date()).with_for_update())
    if item is None:
        item = AttendanceRecord(organization_id=tenant.organization_id, employee_id=employee.id, attendance_date=local.date(), check_in_at=now, status="present", source="self")
        db.add(item); db.flush()
    elif item.check_in_at is not None:
        raise HTTPException(status_code=409, detail="Already checked in today")
    else:
        item.check_in_at = now; item.status = "present"; item.source = "self"
    record_activity(db, action="hr.attendance.checked_in", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="attendance_record", entity_id=item.id, after={"employee_id": employee.id, "date": str(local.date())}, request=request)
    db.commit()
    return {"id": item.id, "check_in_at": item.check_in_at}


@router.post("/self/check-out")
def check_out(request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    now, local = _now(tenant)
    item = db.scalar(select(AttendanceRecord).where(AttendanceRecord.organization_id == tenant.organization_id, AttendanceRecord.employee_id == employee.id, AttendanceRecord.attendance_date == local.date()).with_for_update())
    if item is None or item.check_in_at is None:
        raise HTTPException(status_code=409, detail="Check in first")
    if item.check_out_at is not None:
        raise HTTPException(status_code=409, detail="Already checked out today")
    item.check_out_at = now
    worked = max(0, int((item.check_out_at - item.check_in_at).total_seconds() // 60))
    item.work_minutes = worked
    item.overtime_minutes = max(0, worked - 480)
    record_activity(db, action="hr.attendance.checked_out", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="attendance_record", entity_id=item.id, after={"work_minutes": worked}, request=request)
    db.commit()
    return {"id": item.id, "check_out_at": item.check_out_at, "work_minutes": item.work_minutes}


@router.patch("/self/performance/{review_id}")
def self_review(review_id: str, payload: SelfReviewUpdate, request: Request, db: DbSession, tenant: HRSelf):
    employee = _employee(db, tenant)
    item = db.scalar(select(PerformanceReview).where(PerformanceReview.id == review_id, PerformanceReview.organization_id == tenant.organization_id, PerformanceReview.employee_id == employee.id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Performance review not found")
    if item.status == "completed":
        raise HTTPException(status_code=409, detail="Completed review is locked")
    item.self_review = payload.self_review.strip()
    record_activity(db, action="hr.performance.self_reviewed", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type="performance_review", entity_id=item.id, after={"employee_id": employee.id}, request=request)
    db.commit()
    return {"id": item.id}
