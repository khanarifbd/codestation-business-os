"""Web GPS attendance configuration and audited exception workflows."""
from datetime import date, datetime, timedelta, timezone
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.hr import AttendanceRecord
from app.models.hr_attendance import EmployeeAttendancePolicy, HRAttendanceRequest, HROfficeLocation
from app.models.membership import Membership
from app.models.team import Employee
from app.models.user import User
from app.services.activity_log import record_activity
from app.services.hr_attendance import effective_attendance_mode, validate_weekly_modes
from app.services.hr_time import attendance_status_for_check_in, scheduled_presence_minutes, shift_for_date
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR Attendance"])
HRViewer = Annotated[TenantContext, Depends(require_tenant_permission("hr.view"))]
HRManager = Annotated[TenantContext, Depends(require_tenant_permission("hr.manage"))]
HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]


class OfficePayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    radius_meters: int = Field(default=100, ge=25, le=1000)
    is_active: bool = True


class PolicyPayload(BaseModel):
    office_id: str | None = None
    weekly_modes: list[str] = Field(min_length=7, max_length=7)


class AttendanceRequestCreate(BaseModel):
    request_type: str
    work_date: date
    reason: str = Field(min_length=5, max_length=1000)
    proposed_check_in_at: datetime | None = None
    proposed_check_out_at: datetime | None = None


class AttendanceRequestReview(BaseModel):
    status: str
    review_notes: str | None = Field(default=None, max_length=1000)


def _local_date(tenant: TenantContext) -> date:
    return datetime.now(timezone.utc).astimezone(ZoneInfo(tenant.organization.timezone)).date()


def _employee(db: DbSession, tenant: TenantContext, employee_id: str) -> Employee:
    row = db.scalar(select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.id == employee_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return row


def _self_employee(db: DbSession, tenant: TenantContext) -> Employee:
    row = db.scalar(
        select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.membership_id == tenant.membership_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return row


def _audit(db: DbSession, request: Request, tenant: TenantContext, action: str, entity_type: str, entity_id: str,
           *, before: dict | None = None, after: dict | None = None) -> None:
    record_activity(
        db, action=action, scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type=entity_type, entity_id=entity_id,
        before=before, after=after, request=request,
    )


def _office_data(office: HROfficeLocation) -> dict:
    return {
        "id": office.id, "name": office.name, "latitude": office.latitude,
        "longitude": office.longitude, "radius_meters": office.radius_meters, "is_active": office.is_active,
    }


@router.get("/attendance/offices")
def list_offices(db: DbSession, tenant: HRViewer):
    offices = db.scalars(
        select(HROfficeLocation).where(HROfficeLocation.organization_id == tenant.organization_id)
        .order_by(HROfficeLocation.name)
    ).all()
    return [_office_data(x) for x in offices]


@router.post("/attendance/offices", status_code=201)
def create_office(payload: OfficePayload, request: Request, db: DbSession, tenant: HRManager):
    office = HROfficeLocation(organization_id=tenant.organization_id, **payload.model_dump())
    db.add(office)
    db.flush()
    _audit(db, request, tenant, "hr.office.created", "hr_office_location", office.id, after=_office_data(office))
    db.commit()
    return _office_data(office)


@router.patch("/attendance/offices/{office_id}")
def update_office(office_id: str, payload: OfficePayload, request: Request, db: DbSession, tenant: HRManager):
    office = db.scalar(
        select(HROfficeLocation).where(
            HROfficeLocation.organization_id == tenant.organization_id, HROfficeLocation.id == office_id
        ).with_for_update()
    )
    if office is None:
        raise HTTPException(status_code=404, detail="Office not found")
    if not payload.is_active and office.is_active:
        assigned = db.scalar(select(func.count(EmployeeAttendancePolicy.id)).where(
            EmployeeAttendancePolicy.organization_id == tenant.organization_id,
            EmployeeAttendancePolicy.office_id == office.id,
        ))
        if assigned:
            raise HTTPException(status_code=409, detail="Reassign employee policies before disabling this office")
    before = _office_data(office)
    for key, value in payload.model_dump().items():
        setattr(office, key, value)
    _audit(db, request, tenant, "hr.office.updated", "hr_office_location", office.id,
           before=before, after=_office_data(office))
    db.commit()
    return _office_data(office)


@router.get("/attendance/policies")
def list_policies(db: DbSession, tenant: HRViewer):
    rows = db.execute(
        select(EmployeeAttendancePolicy, Employee.employee_code, User.full_name)
        .join(Employee, Employee.id == EmployeeAttendancePolicy.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            EmployeeAttendancePolicy.organization_id == tenant.organization_id,
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
        ).order_by(User.full_name)
    ).all()
    return [{
        "employee_id": p.employee_id, "employee_name": name, "employee_code": code,
        "office_id": p.office_id, "weekly_modes": p.weekly_modes,
    } for p, code, name in rows]


@router.put("/attendance/policies/{employee_id}")
def upsert_policy(employee_id: str, payload: PolicyPayload, request: Request, db: DbSession, tenant: HRManager):
    employee = _employee(db, tenant, employee_id)
    validate_weekly_modes(payload.weekly_modes)
    if "office" in payload.weekly_modes and not payload.office_id:
        raise HTTPException(status_code=400, detail="Assign an office for office workdays")
    if payload.office_id:
        office = db.scalar(select(HROfficeLocation).where(
            HROfficeLocation.organization_id == tenant.organization_id,
            HROfficeLocation.id == payload.office_id,
            HROfficeLocation.is_active.is_(True),
        ))
        if office is None:
            raise HTTPException(status_code=400, detail="Choose an active office in this organization")
    # A change must not invalidate today's already recorded location verification.
    existing_today = db.scalar(select(AttendanceRecord).where(
        AttendanceRecord.organization_id == tenant.organization_id,
        AttendanceRecord.employee_id == employee.id,
        AttendanceRecord.attendance_date == _local_date(tenant),
        AttendanceRecord.check_in_at.is_not(None),
    ))
    if existing_today:
        raise HTTPException(status_code=409, detail="Cannot change the weekly policy after today's check-in")
    policy = db.scalar(select(EmployeeAttendancePolicy).where(
        EmployeeAttendancePolicy.organization_id == tenant.organization_id,
        EmployeeAttendancePolicy.employee_id == employee.id,
    ).with_for_update())
    before = {"office_id": policy.office_id, "weekly_modes": policy.weekly_modes} if policy else None
    if policy is None:
        policy = EmployeeAttendancePolicy(organization_id=tenant.organization_id, employee_id=employee.id,
                                          office_id=payload.office_id, weekly_modes=payload.weekly_modes)
        db.add(policy)
    else:
        policy.office_id = payload.office_id
        policy.weekly_modes = payload.weekly_modes
    db.flush()
    _audit(db, request, tenant, "hr.attendance_policy.saved", "employee_attendance_policy", policy.id,
           before=before, after={"employee_id": employee.id, **payload.model_dump()})
    db.commit()
    return {"employee_id": employee.id, **payload.model_dump()}


def _request_data(row: HRAttendanceRequest) -> dict:
    return {
        "id": row.id, "employee_id": row.employee_id, "work_date": row.work_date,
        "request_type": row.request_type, "requested_mode": row.requested_mode,
        "reason": row.reason, "proposed_check_in_at": row.proposed_check_in_at,
        "proposed_check_out_at": row.proposed_check_out_at, "status": row.status,
        "review_notes": row.review_notes, "created_at": row.created_at,
    }


@router.get("/self/attendance-plan")
def self_attendance_plan(db: DbSession, tenant: HRSelf):
    employee = _self_employee(db, tenant)
    today = _local_date(tenant)
    mode, policy, office = effective_attendance_mode(
        db, organization_id=tenant.organization_id, employee_id=employee.id, work_date=today,
    )
    attendance = db.scalar(select(AttendanceRecord).where(
        AttendanceRecord.organization_id == tenant.organization_id,
        AttendanceRecord.employee_id == employee.id, AttendanceRecord.attendance_date == today,
    ))
    requests = db.scalars(select(HRAttendanceRequest).where(
        HRAttendanceRequest.organization_id == tenant.organization_id,
        HRAttendanceRequest.employee_id == employee.id,
    ).order_by(HRAttendanceRequest.created_at.desc()).limit(15)).all()
    return {
        "date": today, "timezone": tenant.organization.timezone, "mode": mode,
        "weekly_modes": policy.weekly_modes if policy else None,
        "office_name": office.name if office else None,
        "attendance": None if attendance is None else {
            "check_in_at": attendance.check_in_at, "check_out_at": attendance.check_out_at,
            "attendance_mode": attendance.attendance_mode, "status": attendance.status,
        },
        "requests": [_request_data(r) for r in requests],
    }


@router.get("/attendance/requests")
def list_requests(db: DbSession, tenant: HRManager):
    rows = db.execute(
        select(HRAttendanceRequest, Employee.employee_code, User.full_name)
        .join(Employee, Employee.id == HRAttendanceRequest.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            HRAttendanceRequest.organization_id == tenant.organization_id,
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
        )
        .order_by(HRAttendanceRequest.created_at.desc()).limit(100)
    ).all()
    return [{**_request_data(item), "employee_name": name, "employee_code": code} for item, code, name in rows]


@router.post("/self/attendance-requests", status_code=201)
def create_request(payload: AttendanceRequestCreate, request: Request, db: DbSession, tenant: HRSelf):
    employee = _self_employee(db, tenant)
    today = _local_date(tenant)
    if employee.employment_status != "active" or (employee.join_date and payload.work_date < employee.join_date) or (
        employee.end_date and payload.work_date > employee.end_date
    ):
        raise HTTPException(status_code=403, detail="Employee is not eligible for this work date")
    reason = payload.reason.strip()
    if len(reason) < 5:
        raise HTTPException(status_code=400, detail="Provide a reason")
    if payload.request_type == "mode":
        if not today <= payload.work_date <= today + timedelta(days=60):
            raise HTTPException(status_code=400, detail="Remote work date must be within the next 60 days")
        mode, policy, _ = effective_attendance_mode(
            db, organization_id=tenant.organization_id, employee_id=employee.id, work_date=payload.work_date,
        )
        if policy is None or mode != "office":
            raise HTTPException(status_code=409, detail="A remote request requires a scheduled office day")
        if db.scalar(select(AttendanceRecord.id).where(
            AttendanceRecord.organization_id == tenant.organization_id,
            AttendanceRecord.employee_id == employee.id, AttendanceRecord.attendance_date == payload.work_date,
            AttendanceRecord.check_in_at.is_not(None),
        )):
            raise HTTPException(status_code=409, detail="Attendance already started for this day")
        if db.scalar(select(HRAttendanceRequest.id).where(
            HRAttendanceRequest.organization_id == tenant.organization_id,
            HRAttendanceRequest.employee_id == employee.id,
            HRAttendanceRequest.work_date == payload.work_date,
            HRAttendanceRequest.request_type == "mode",
            HRAttendanceRequest.status.in_(["pending", "approved"]),
        )):
            raise HTTPException(status_code=409, detail="Remote work request already exists for this date")
        item = HRAttendanceRequest(
            organization_id=tenant.organization_id, employee_id=employee.id,
            work_date=payload.work_date, request_type="mode", requested_mode="remote", reason=reason,
        )
    elif payload.request_type == "correction":
        if not today - timedelta(days=45) <= payload.work_date <= today:
            raise HTTPException(status_code=400, detail="Correction date must be within the past 45 days")
        start, end = payload.proposed_check_in_at, payload.proposed_check_out_at
        if not start or not end or not start.tzinfo or not end.tzinfo:
            raise HTTPException(status_code=400, detail="Provide timezone-aware check-in and check-out times")
        if not start < end <= datetime.now(timezone.utc) or end - start > timedelta(hours=24):
            raise HTTPException(status_code=400, detail="Invalid correction time range")
        if start.astimezone(ZoneInfo(tenant.organization.timezone)).date() != payload.work_date:
            raise HTTPException(status_code=400, detail="Check-in date must match the organization-local work date")
        if db.scalar(select(HRAttendanceRequest.id).where(
            HRAttendanceRequest.organization_id == tenant.organization_id,
            HRAttendanceRequest.employee_id == employee.id, HRAttendanceRequest.work_date == payload.work_date,
            HRAttendanceRequest.request_type == "correction", HRAttendanceRequest.status == "pending",
        )):
            raise HTTPException(status_code=409, detail="A correction request is already pending for this date")
        item = HRAttendanceRequest(
            organization_id=tenant.organization_id, employee_id=employee.id,
            work_date=payload.work_date, request_type="correction", reason=reason,
            proposed_check_in_at=start, proposed_check_out_at=end,
        )
    else:
        raise HTTPException(status_code=400, detail="Invalid attendance request type")
    db.add(item)
    db.flush()
    _audit(db, request, tenant, "hr.attendance_request.created", "hr_attendance_request", item.id,
           after=_request_data(item))
    db.commit()
    return _request_data(item)


@router.post("/attendance/requests/{request_id}/review")
def review_request(request_id: str, payload: AttendanceRequestReview, request: Request, db: DbSession, tenant: HRManager):
    if payload.status not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="Review status must be approved or rejected")
    item = db.scalar(select(HRAttendanceRequest).where(
        HRAttendanceRequest.organization_id == tenant.organization_id,
        HRAttendanceRequest.id == request_id,
    ).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if item.status != "pending":
        raise HTTPException(status_code=409, detail="Request has already been reviewed")
    employee = _employee(db, tenant, item.employee_id)
    if employee.membership_id == tenant.membership_id:
        raise HTTPException(status_code=403, detail="A different HR manager must review your request")
    today = _local_date(tenant)
    if payload.status == "approved":
        if item.request_type == "mode":
            if item.work_date < today:
                raise HTTPException(status_code=409, detail="Cannot approve a past remote workday")
            mode, policy, _ = effective_attendance_mode(
                db, organization_id=tenant.organization_id, employee_id=employee.id, work_date=item.work_date,
            )
            if policy is None or mode != "office":
                raise HTTPException(status_code=409, detail="Office schedule has changed; review the request again")
            if db.scalar(select(AttendanceRecord.id).where(
                AttendanceRecord.organization_id == tenant.organization_id,
                AttendanceRecord.employee_id == employee.id,
                AttendanceRecord.attendance_date == item.work_date,
                AttendanceRecord.check_in_at.is_not(None),
            )):
                raise HTTPException(status_code=409, detail="Attendance already started for this day")
        else:
            start, end = item.proposed_check_in_at, item.proposed_check_out_at
            if not start or not end or not start < end <= datetime.now(timezone.utc):
                raise HTTPException(status_code=409, detail="Correction times are no longer valid")
            record = db.scalar(select(AttendanceRecord).where(
                AttendanceRecord.organization_id == tenant.organization_id,
                AttendanceRecord.employee_id == employee.id,
                AttendanceRecord.attendance_date == item.work_date,
            ).with_for_update())
            before = None if record is None else {
                "check_in_at": record.check_in_at.isoformat() if record.check_in_at else None,
                "check_out_at": record.check_out_at.isoformat() if record.check_out_at else None,
                "work_minutes": record.work_minutes, "overtime_minutes": record.overtime_minutes,
                "status": record.status, "source": record.source,
            }
            if record is None:
                record = AttendanceRecord(
                    organization_id=tenant.organization_id, employee_id=employee.id,
                    attendance_date=item.work_date, source="correction",
                )
                db.add(record)
            shift = shift_for_date(
                db, organization_id=tenant.organization_id, employee_id=employee.id, work_date=item.work_date,
            )
            work_minutes = max(0, int((end - start).total_seconds() // 60))
            record.check_in_at, record.check_out_at = start, end
            record.work_minutes = work_minutes
            record.overtime_minutes = max(0, work_minutes - scheduled_presence_minutes(shift, item.work_date))
            record.status = attendance_status_for_check_in(shift, start.astimezone(ZoneInfo(tenant.organization.timezone)))
            record.source = "correction"
            # Amended timestamps are HR-approved, not GPS verified.
            record.verification_method = "hr_correction"
            record.check_in_latitude = None
            record.check_in_longitude = None
            record.check_in_accuracy_meters = None
            record.office_id = None
            record.approved_by_user_id = tenant.user_id
            db.flush()
            _audit(db, request, tenant, "hr.attendance.corrected", "attendance_record", record.id,
                   before=before, after={
                       "request_id": item.id, "employee_id": employee.id,
                       "check_in_at": start.isoformat(), "check_out_at": end.isoformat(),
                       "work_minutes": record.work_minutes, "overtime_minutes": record.overtime_minutes,
                       "status": record.status, "reason": item.reason,
                   })
    item.status = payload.status
    item.review_notes = payload.review_notes
    item.reviewed_by_user_id = tenant.user_id
    item.reviewed_at = datetime.now(timezone.utc)
    _audit(db, request, tenant, "hr.attendance_request.reviewed", "hr_attendance_request", item.id,
           before={"status": "pending"}, after={"status": item.status, "review_notes": item.review_notes})
    db.commit()
    return _request_data(item)
