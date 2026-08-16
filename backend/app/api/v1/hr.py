from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.hr import (
    AttendanceRecord, EmployeeHRDocument, EmployeeLifecycleEvent, EmployeeShiftAssignment,
    HRAnnouncement, HRShift, JobCandidate, JobOpening, LeaveRequest, LeaveType, PerformanceReview,
)
from app.models.membership import Membership
from app.models.payroll import PayrollEntry, PayrollPeriod, PayrollRun
from app.models.team import Department, Employee
from app.models.user import User
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR"])
HRViewer = Annotated[TenantContext, Depends(require_tenant_permission("hr.view"))]
HRManager = Annotated[TenantContext, Depends(require_tenant_permission("hr.manage"))]
HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]


class ShiftCreate(BaseModel):
    name: str
    start_time: time
    end_time: time
    break_minutes: int = Field(default=0, ge=0)
    grace_minutes: int = Field(default=0, ge=0)
    weekly_off_days: list[int] = Field(default_factory=list)


class ShiftAssign(BaseModel):
    employee_id: str
    shift_id: str
    effective_from: date


class AttendanceCreate(BaseModel):
    employee_id: str
    attendance_date: date
    status: str = "present"
    check_in_at: datetime | None = None
    check_out_at: datetime | None = None
    work_minutes: int = Field(default=0, ge=0)
    overtime_minutes: int = Field(default=0, ge=0)
    notes: str | None = None


class LeaveTypeCreate(BaseModel):
    name: str
    code: str
    annual_allowance_days: Decimal = Field(default=Decimal("0"), ge=0)
    is_paid: bool = True
    requires_approval: bool = True


class LeaveRequestCreate(BaseModel):
    leave_type_id: str
    start_date: date
    end_date: date
    reason: str | None = None
    employee_id: str | None = None


class LeaveReview(BaseModel):
    status: str
    review_notes: str | None = None


class DocumentCreate(BaseModel):
    employee_id: str
    title: str
    document_type: str
    reference_number: str | None = None
    issued_on: date | None = None
    expires_on: date | None = None
    file_url: str | None = None
    notes: str | None = None


class LifecycleCreate(BaseModel):
    employee_id: str
    event_type: str
    effective_date: date
    title: str
    details: dict = Field(default_factory=dict)
    notes: str | None = None


class PerformanceCreate(BaseModel):
    employee_id: str
    reviewer_employee_id: str | None = None
    period_start: date
    period_end: date
    goals: list[dict] = Field(default_factory=list)


class PerformanceUpdate(BaseModel):
    self_review: str | None = None
    manager_review: str | None = None
    rating: Decimal | None = Field(default=None, ge=0, le=5)
    status: str | None = None
    goals: list[dict] | None = None


class AnnouncementCreate(BaseModel):
    title: str
    body: str
    audience: str = "all"
    is_policy: bool = False
    publish_now: bool = True


class JobCreate(BaseModel):
    title: str
    department_id: str | None = None
    employment_type: str = "full_time"
    location: str | None = None
    description: str | None = None
    openings: int = Field(default=1, ge=1)


class CandidateCreate(BaseModel):
    job_opening_id: str
    full_name: str
    email: str
    phone: str | None = None
    resume_url: str | None = None
    notes: str | None = None


class CandidateUpdate(BaseModel):
    stage: str | None = None
    rating: Decimal | None = Field(default=None, ge=0, le=5)
    notes: str | None = None


def _employee(db: DbSession, org_id: str, employee_id: str) -> Employee:
    item = db.scalar(select(Employee).where(Employee.id == employee_id, Employee.organization_id == org_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return item


def _my_employee(db: DbSession, tenant: TenantContext) -> Employee:
    item = db.scalar(select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.membership_id == tenant.membership_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return item


def _employee_names(db: DbSession, org_id: str) -> dict[str, str]:
    rows = db.execute(select(Employee.id, User.full_name).join(Membership, Membership.id == Employee.membership_id).join(User, User.id == Membership.user_id).where(Employee.organization_id == org_id)).all()
    return {row.id: row.full_name for row in rows}


def _audit(db: DbSession, request: Request, tenant: TenantContext, action: str, entity_type: str, entity_id: str, after: dict | None = None) -> None:
    record_activity(db, action=action, scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type=entity_type, entity_id=entity_id, after=after or {}, request=request)


@router.get("/meta")
def hr_meta(db: DbSession, tenant: HRViewer):
    names = _employee_names(db, tenant.organization_id)
    employees = db.scalars(select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.employment_status == "active").order_by(Employee.employee_code)).all()
    departments = db.scalars(select(Department).where(Department.organization_id == tenant.organization_id, Department.is_active.is_(True)).order_by(Department.name)).all()
    return {
        "employees": [{"id": e.id, "employee_code": e.employee_code, "name": names.get(e.id, e.employee_code)} for e in employees],
        "departments": [{"id": d.id, "name": d.name} for d in departments],
        "leave_types": [{"id": x.id, "name": x.name, "code": x.code, "annual_allowance_days": str(x.annual_allowance_days), "is_paid": x.is_paid} for x in db.scalars(select(LeaveType).where(LeaveType.organization_id == tenant.organization_id, LeaveType.is_active.is_(True)).order_by(LeaveType.name)).all()],
        "shifts": [{"id": x.id, "name": x.name, "start_time": str(x.start_time), "end_time": str(x.end_time)} for x in db.scalars(select(HRShift).where(HRShift.organization_id == tenant.organization_id, HRShift.is_active.is_(True)).order_by(HRShift.name)).all()],
    }


@router.get("/dashboard")
def hr_dashboard(db: DbSession, tenant: HRViewer):
    org = tenant.organization_id
    today = datetime.now(timezone.utc).date()
    return {
        "active_employees": int(db.scalar(select(func.count(Employee.id)).where(Employee.organization_id == org, Employee.employment_status == "active")) or 0),
        "present_today": int(db.scalar(select(func.count(AttendanceRecord.id)).where(AttendanceRecord.organization_id == org, AttendanceRecord.attendance_date == today, AttendanceRecord.status.in_(["present", "late"]))) or 0),
        "on_leave_today": int(db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.organization_id == org, LeaveRequest.status == "approved", LeaveRequest.start_date <= today, LeaveRequest.end_date >= today)) or 0),
        "pending_leave": int(db.scalar(select(func.count(LeaveRequest.id)).where(LeaveRequest.organization_id == org, LeaveRequest.status == "pending")) or 0),
        "documents_expiring_30d": int(db.scalar(select(func.count(EmployeeHRDocument.id)).where(EmployeeHRDocument.organization_id == org, EmployeeHRDocument.expires_on.is_not(None), EmployeeHRDocument.expires_on >= today, EmployeeHRDocument.expires_on <= date.fromordinal(today.toordinal() + 30))) or 0),
        "open_jobs": int(db.scalar(select(func.count(JobOpening.id)).where(JobOpening.organization_id == org, JobOpening.status == "open")) or 0),
    }


@router.get("/attendance")
def list_attendance(db: DbSession, tenant: HRViewer):
    names = _employee_names(db, tenant.organization_id)
    rows = db.scalars(select(AttendanceRecord).where(AttendanceRecord.organization_id == tenant.organization_id).order_by(AttendanceRecord.attendance_date.desc(), AttendanceRecord.created_at.desc()).limit(200)).all()
    return [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "attendance_date": x.attendance_date, "status": x.status, "check_in_at": x.check_in_at, "check_out_at": x.check_out_at, "work_minutes": x.work_minutes, "overtime_minutes": x.overtime_minutes, "notes": x.notes} for x in rows]


@router.post("/attendance", status_code=status.HTTP_201_CREATED)
def create_attendance(payload: AttendanceCreate, request: Request, db: DbSession, tenant: HRManager):
    _employee(db, tenant.organization_id, payload.employee_id)
    existing = db.scalar(select(AttendanceRecord).where(AttendanceRecord.organization_id == tenant.organization_id, AttendanceRecord.employee_id == payload.employee_id, AttendanceRecord.attendance_date == payload.attendance_date))
    if existing:
        raise HTTPException(status_code=409, detail="Attendance already exists for this employee and date")
    item = AttendanceRecord(organization_id=tenant.organization_id, **payload.model_dump(), approved_by_user_id=tenant.user_id)
    db.add(item); db.flush(); _audit(db, request, tenant, "hr.attendance.created", "attendance_record", item.id, {"employee_id": item.employee_id, "date": str(item.attendance_date)}); db.commit(); db.refresh(item)
    return {"id": item.id}


@router.get("/leave-types")
def list_leave_types(db: DbSession, tenant: HRViewer):
    return db.scalars(select(LeaveType).where(LeaveType.organization_id == tenant.organization_id).order_by(LeaveType.name)).all()


@router.post("/leave-types", status_code=201)
def create_leave_type(payload: LeaveTypeCreate, request: Request, db: DbSession, tenant: HRManager):
    item = LeaveType(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.leave_type.created", "leave_type", item.id); db.commit(); db.refresh(item); return item


@router.get("/leave-requests")
def list_leave_requests(db: DbSession, tenant: HRViewer):
    names = _employee_names(db, tenant.organization_id)
    types = {x.id: x.name for x in db.scalars(select(LeaveType).where(LeaveType.organization_id == tenant.organization_id)).all()}
    rows = db.scalars(select(LeaveRequest).where(LeaveRequest.organization_id == tenant.organization_id).order_by(LeaveRequest.created_at.desc()).limit(200)).all()
    return [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "leave_type_id": x.leave_type_id, "leave_type_name": types.get(x.leave_type_id), "start_date": x.start_date, "end_date": x.end_date, "days": str(x.days), "reason": x.reason, "status": x.status, "review_notes": x.review_notes} for x in rows]


@router.post("/leave-requests", status_code=201)
def create_leave_request(payload: LeaveRequestCreate, request: Request, db: DbSession, tenant: HRSelf):
    self_employee = _my_employee(db, tenant)
    if payload.employee_id is None or payload.employee_id == self_employee.id:
        employee = self_employee
    elif tenant.role == "admin":
        employee = _employee(db, tenant.organization_id, payload.employee_id)
    else:
        raise HTTPException(status_code=403, detail="Cannot request leave for another employee")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    lt = db.scalar(select(LeaveType).where(LeaveType.id == payload.leave_type_id, LeaveType.organization_id == tenant.organization_id, LeaveType.is_active.is_(True)))
    if lt is None: raise HTTPException(status_code=404, detail="Leave type not found")
    days = Decimal((payload.end_date - payload.start_date).days + 1)
    item = LeaveRequest(organization_id=tenant.organization_id, employee_id=employee.id, leave_type_id=lt.id, start_date=payload.start_date, end_date=payload.end_date, days=days, reason=payload.reason, status="pending" if lt.requires_approval else "approved")
    db.add(item); db.flush(); _audit(db, request, tenant, "hr.leave.requested", "leave_request", item.id, {"employee_id": employee.id, "days": str(days)}); db.commit(); db.refresh(item); return {"id": item.id, "status": item.status}


@router.patch("/leave-requests/{request_id}")
def review_leave(request_id: str, payload: LeaveReview, request: Request, db: DbSession, tenant: HRManager):
    if payload.status not in {"approved", "rejected", "cancelled"}: raise HTTPException(status_code=400, detail="Unsupported leave status")
    item = db.scalar(select(LeaveRequest).where(LeaveRequest.id == request_id, LeaveRequest.organization_id == tenant.organization_id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Leave request not found")
    item.status = payload.status; item.review_notes = payload.review_notes; item.reviewed_by_user_id = tenant.user_id; item.reviewed_at = datetime.now(timezone.utc)
    _audit(db, request, tenant, "hr.leave.reviewed", "leave_request", item.id, {"status": item.status}); db.commit(); return {"id": item.id, "status": item.status}


@router.get("/shifts")
def list_shifts(db: DbSession, tenant: HRViewer):
    return db.scalars(select(HRShift).where(HRShift.organization_id == tenant.organization_id).order_by(HRShift.name)).all()


@router.post("/shifts", status_code=201)
def create_shift(payload: ShiftCreate, request: Request, db: DbSession, tenant: HRManager):
    item = HRShift(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.shift.created", "hr_shift", item.id); db.commit(); db.refresh(item); return item


@router.post("/shift-assignments", status_code=201)
def assign_shift(payload: ShiftAssign, request: Request, db: DbSession, tenant: HRManager):
    _employee(db, tenant.organization_id, payload.employee_id)
    if db.scalar(select(HRShift.id).where(HRShift.id == payload.shift_id, HRShift.organization_id == tenant.organization_id, HRShift.is_active.is_(True))) is None: raise HTTPException(status_code=404, detail="Shift not found")
    item = EmployeeShiftAssignment(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.shift.assigned", "employee_shift_assignment", item.id); db.commit(); return {"id": item.id}


@router.get("/documents")
def list_documents(db: DbSession, tenant: HRViewer):
    names = _employee_names(db, tenant.organization_id)
    rows = db.scalars(select(EmployeeHRDocument).where(EmployeeHRDocument.organization_id == tenant.organization_id).order_by(EmployeeHRDocument.created_at.desc()).limit(200)).all()
    return [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "title": x.title, "document_type": x.document_type, "reference_number": x.reference_number, "issued_on": x.issued_on, "expires_on": x.expires_on, "file_url": x.file_url, "notes": x.notes} for x in rows]


@router.post("/documents", status_code=201)
def create_document(payload: DocumentCreate, request: Request, db: DbSession, tenant: HRManager):
    _employee(db, tenant.organization_id, payload.employee_id); item = EmployeeHRDocument(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.document.created", "employee_hr_document", item.id); db.commit(); return {"id": item.id}


@router.get("/lifecycle")
def list_lifecycle(db: DbSession, tenant: HRViewer):
    names = _employee_names(db, tenant.organization_id); rows = db.scalars(select(EmployeeLifecycleEvent).where(EmployeeLifecycleEvent.organization_id == tenant.organization_id).order_by(EmployeeLifecycleEvent.effective_date.desc()).limit(200)).all()
    return [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "event_type": x.event_type, "effective_date": x.effective_date, "title": x.title, "details": x.details, "notes": x.notes} for x in rows]


@router.post("/lifecycle", status_code=201)
def create_lifecycle(payload: LifecycleCreate, request: Request, db: DbSession, tenant: HRManager):
    employee = _employee(db, tenant.organization_id, payload.employee_id); item = EmployeeLifecycleEvent(organization_id=tenant.organization_id, created_by_user_id=tenant.user_id, **payload.model_dump()); db.add(item)
    if payload.event_type in {"resignation", "termination"}: employee.employment_status = "inactive"; employee.end_date = payload.effective_date
    db.flush(); _audit(db, request, tenant, "hr.lifecycle.created", "employee_lifecycle_event", item.id, {"event_type": item.event_type}); db.commit(); return {"id": item.id}


@router.get("/performance")
def list_performance(db: DbSession, tenant: HRViewer):
    names = _employee_names(db, tenant.organization_id); rows = db.scalars(select(PerformanceReview).where(PerformanceReview.organization_id == tenant.organization_id).order_by(PerformanceReview.period_end.desc()).limit(200)).all()
    return [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "reviewer_employee_id": x.reviewer_employee_id, "period_start": x.period_start, "period_end": x.period_end, "status": x.status, "goals": x.goals, "self_review": x.self_review, "manager_review": x.manager_review, "rating": str(x.rating) if x.rating is not None else None} for x in rows]


@router.post("/performance", status_code=201)
def create_performance(payload: PerformanceCreate, request: Request, db: DbSession, tenant: HRManager):
    _employee(db, tenant.organization_id, payload.employee_id); item = PerformanceReview(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.performance.created", "performance_review", item.id); db.commit(); return {"id": item.id}


@router.patch("/performance/{review_id}")
def update_performance(review_id: str, payload: PerformanceUpdate, request: Request, db: DbSession, tenant: HRManager):
    item = db.scalar(select(PerformanceReview).where(PerformanceReview.id == review_id, PerformanceReview.organization_id == tenant.organization_id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Performance review not found")
    for key, value in payload.model_dump(exclude_unset=True).items(): setattr(item, key, value)
    _audit(db, request, tenant, "hr.performance.updated", "performance_review", item.id, {"status": item.status, "rating": str(item.rating) if item.rating is not None else None}); db.commit(); return {"id": item.id}


@router.get("/announcements")
def list_announcements(db: DbSession, tenant: HRViewer):
    return db.scalars(select(HRAnnouncement).where(HRAnnouncement.organization_id == tenant.organization_id).order_by(HRAnnouncement.created_at.desc()).limit(100)).all()


@router.post("/announcements", status_code=201)
def create_announcement(payload: AnnouncementCreate, request: Request, db: DbSession, tenant: HRManager):
    item = HRAnnouncement(organization_id=tenant.organization_id, title=payload.title, body=payload.body, audience=payload.audience, is_policy=payload.is_policy, published_at=datetime.now(timezone.utc) if payload.publish_now else None, created_by_user_id=tenant.user_id); db.add(item); db.flush(); _audit(db, request, tenant, "hr.announcement.created", "hr_announcement", item.id); db.commit(); return {"id": item.id}


@router.get("/jobs")
def list_jobs(db: DbSession, tenant: HRViewer):
    rows = db.scalars(select(JobOpening).where(JobOpening.organization_id == tenant.organization_id).order_by(JobOpening.created_at.desc()).limit(100)).all()
    return [{"id": x.id, "title": x.title, "department_id": x.department_id, "employment_type": x.employment_type, "location": x.location, "openings": x.openings, "status": x.status, "description": x.description} for x in rows]


@router.post("/jobs", status_code=201)
def create_job(payload: JobCreate, request: Request, db: DbSession, tenant: HRManager):
    item = JobOpening(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.job.created", "job_opening", item.id); db.commit(); return {"id": item.id}


@router.get("/candidates")
def list_candidates(db: DbSession, tenant: HRViewer):
    jobs = {x.id: x.title for x in db.scalars(select(JobOpening).where(JobOpening.organization_id == tenant.organization_id)).all()}; rows = db.scalars(select(JobCandidate).where(JobCandidate.organization_id == tenant.organization_id).order_by(JobCandidate.created_at.desc()).limit(200)).all()
    return [{"id": x.id, "job_opening_id": x.job_opening_id, "job_title": jobs.get(x.job_opening_id), "full_name": x.full_name, "email": x.email, "phone": x.phone, "stage": x.stage, "rating": str(x.rating) if x.rating is not None else None, "resume_url": x.resume_url, "notes": x.notes} for x in rows]


@router.post("/candidates", status_code=201)
def create_candidate(payload: CandidateCreate, request: Request, db: DbSession, tenant: HRManager):
    if db.scalar(select(JobOpening.id).where(JobOpening.id == payload.job_opening_id, JobOpening.organization_id == tenant.organization_id)) is None: raise HTTPException(status_code=404, detail="Job opening not found")
    item = JobCandidate(organization_id=tenant.organization_id, **payload.model_dump()); db.add(item); db.flush(); _audit(db, request, tenant, "hr.candidate.created", "job_candidate", item.id); db.commit(); return {"id": item.id}


@router.patch("/candidates/{candidate_id}")
def update_candidate(candidate_id: str, payload: CandidateUpdate, request: Request, db: DbSession, tenant: HRManager):
    item = db.scalar(select(JobCandidate).where(JobCandidate.id == candidate_id, JobCandidate.organization_id == tenant.organization_id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Candidate not found")
    for key, value in payload.model_dump(exclude_unset=True).items(): setattr(item, key, value)
    _audit(db, request, tenant, "hr.candidate.updated", "job_candidate", item.id, {"stage": item.stage}); db.commit(); return {"id": item.id, "stage": item.stage}


@router.get("/self")
def self_service(db: DbSession, tenant: HRSelf):
    employee = _my_employee(db, tenant)
    leave_types = {x.id: x.name for x in db.scalars(select(LeaveType).where(LeaveType.organization_id == tenant.organization_id)).all()}
    leaves = db.scalars(select(LeaveRequest).where(LeaveRequest.organization_id == tenant.organization_id, LeaveRequest.employee_id == employee.id).order_by(LeaveRequest.created_at.desc()).limit(50)).all()
    attendance = db.scalars(select(AttendanceRecord).where(AttendanceRecord.organization_id == tenant.organization_id, AttendanceRecord.employee_id == employee.id).order_by(AttendanceRecord.attendance_date.desc()).limit(60)).all()
    documents = db.scalars(select(EmployeeHRDocument).where(EmployeeHRDocument.organization_id == tenant.organization_id, EmployeeHRDocument.employee_id == employee.id).order_by(EmployeeHRDocument.created_at.desc())).all()
    reviews = db.scalars(select(PerformanceReview).where(PerformanceReview.organization_id == tenant.organization_id, PerformanceReview.employee_id == employee.id).order_by(PerformanceReview.period_end.desc())).all()
    announcements = db.scalars(select(HRAnnouncement).where(HRAnnouncement.organization_id == tenant.organization_id, HRAnnouncement.published_at.is_not(None)).order_by(HRAnnouncement.published_at.desc()).limit(20)).all()
    payslips = db.execute(select(PayrollEntry, PayrollRun, PayrollPeriod).join(PayrollRun, PayrollRun.id == PayrollEntry.run_id).join(PayrollPeriod, PayrollPeriod.id == PayrollRun.period_id).where(PayrollEntry.organization_id == tenant.organization_id, PayrollEntry.employee_id == employee.id, PayrollRun.status.in_(["approved", "paid"])).order_by(PayrollPeriod.period_end.desc()).limit(24)).all()
    return {
        "employee": {"id": employee.id, "employee_code": employee.employee_code, "employment_status": employee.employment_status, "join_date": employee.join_date, "work_location": employee.work_location},
        "leave_requests": [{"id": x.id, "leave_type": leave_types.get(x.leave_type_id), "start_date": x.start_date, "end_date": x.end_date, "days": str(x.days), "status": x.status} for x in leaves],
        "attendance": [{"date": x.attendance_date, "status": x.status, "check_in_at": x.check_in_at, "check_out_at": x.check_out_at, "work_minutes": x.work_minutes} for x in attendance],
        "documents": [{"id": x.id, "title": x.title, "document_type": x.document_type, "expires_on": x.expires_on, "file_url": x.file_url} for x in documents],
        "performance": [{"id": x.id, "period_start": x.period_start, "period_end": x.period_end, "status": x.status, "rating": str(x.rating) if x.rating is not None else None, "self_review": x.self_review, "manager_review": x.manager_review} for x in reviews],
        "announcements": [{"id": x.id, "title": x.title, "body": x.body, "is_policy": x.is_policy, "published_at": x.published_at} for x in announcements],
        "payslips": [{"run_id": run.id, "entry_id": entry.id, "run_number": run.run_number, "period_name": period.name, "currency": entry.currency, "gross_pay": str(entry.gross_pay), "net_pay": str(entry.net_pay), "status": run.status} for entry, run, period in payslips],
    }
