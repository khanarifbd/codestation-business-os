from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.team import create_invitation
from app.models.hr import EmployeeShiftAssignment, HRAnnouncement, HRShift, JobCandidate, JobOpening
from app.models.hr_extended import HRAnnouncementAcknowledgement, HRHoliday
from app.models.team import Department, Designation, Employee, OrganizationRole
from app.models.user import User
from app.models.membership import Membership
from app.schemas.team import InvitationCreate
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/hr", tags=["HR Extended"])
HRViewer = Annotated[TenantContext, Depends(require_tenant_permission("hr.view"))]
HRManager = Annotated[TenantContext, Depends(require_tenant_permission("hr.manage"))]
HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]
EmployeeInviter = Annotated[TenantContext, Depends(require_tenant_permission("employees.invite"))]


class HolidayCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    holiday_date: date
    is_paid: bool = True
    notes: str | None = None


class CandidateConvert(BaseModel):
    role_id: str | None = None
    department_id: str | None = None
    designation_id: str | None = None
    employee_code: str | None = Field(default=None, max_length=40)


def _my_employee(db: DbSession, tenant: TenantContext) -> Employee:
    item = db.scalar(select(Employee).where(Employee.organization_id == tenant.organization_id, Employee.membership_id == tenant.membership_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Employee profile not found")
    return item


def _audit(db: DbSession, request: Request, tenant: TenantContext, action: str, entity_type: str, entity_id: str, after: dict | None = None) -> None:
    record_activity(db, action=action, scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id, entity_type=entity_type, entity_id=entity_id, after=after or {}, request=request)


@router.get("/holidays")
def list_holidays(db: DbSession, tenant: HRViewer):
    rows = db.scalars(select(HRHoliday).where(HRHoliday.organization_id == tenant.organization_id).order_by(HRHoliday.holiday_date.asc(), HRHoliday.name.asc()).limit(300)).all()
    return [{"id": x.id, "name": x.name, "holiday_date": x.holiday_date, "is_paid": x.is_paid, "notes": x.notes} for x in rows]


@router.post("/holidays", status_code=status.HTTP_201_CREATED)
def create_holiday(payload: HolidayCreate, request: Request, db: DbSession, tenant: HRManager):
    exists = db.scalar(select(HRHoliday.id).where(HRHoliday.organization_id == tenant.organization_id, HRHoliday.holiday_date == payload.holiday_date, HRHoliday.name == payload.name.strip()))
    if exists:
        raise HTTPException(status_code=409, detail="Holiday already exists")
    item = HRHoliday(organization_id=tenant.organization_id, name=payload.name.strip(), holiday_date=payload.holiday_date, is_paid=payload.is_paid, notes=(payload.notes or "").strip() or None)
    db.add(item); db.flush(); _audit(db, request, tenant, "hr.holiday.created", "hr_holiday", item.id, {"name": item.name, "holiday_date": str(item.holiday_date)}); db.commit(); db.refresh(item)
    return {"id": item.id, "name": item.name, "holiday_date": item.holiday_date, "is_paid": item.is_paid, "notes": item.notes}


@router.get("/shift-assignments")
def list_shift_assignments(db: DbSession, tenant: HRViewer):
    rows = db.execute(
        select(EmployeeShiftAssignment, Employee.employee_code, User.full_name, HRShift.name)
        .join(Employee, Employee.id == EmployeeShiftAssignment.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .join(HRShift, HRShift.id == EmployeeShiftAssignment.shift_id)
        .where(EmployeeShiftAssignment.organization_id == tenant.organization_id)
        .order_by(EmployeeShiftAssignment.effective_from.desc(), EmployeeShiftAssignment.created_at.desc())
        .limit(300)
    ).all()
    return [{"id": item.id, "employee_id": item.employee_id, "employee_code": code, "employee_name": name, "shift_id": item.shift_id, "shift_name": shift_name, "effective_from": item.effective_from, "effective_to": item.effective_to} for item, code, name, shift_name in rows]


@router.get("/announcements/{announcement_id}/acknowledgements")
def announcement_acknowledgements(announcement_id: str, db: DbSession, tenant: HRViewer):
    announcement = db.scalar(select(HRAnnouncement).where(HRAnnouncement.id == announcement_id, HRAnnouncement.organization_id == tenant.organization_id))
    if announcement is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    rows = db.execute(
        select(HRAnnouncementAcknowledgement, Employee.employee_code, User.full_name)
        .join(Employee, Employee.id == HRAnnouncementAcknowledgement.employee_id)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(HRAnnouncementAcknowledgement.organization_id == tenant.organization_id, HRAnnouncementAcknowledgement.announcement_id == announcement_id)
        .order_by(HRAnnouncementAcknowledgement.acknowledged_at.desc())
    ).all()
    return {"announcement_id": announcement.id, "title": announcement.title, "count": len(rows), "items": [{"employee_id": ack.employee_id, "employee_code": code, "employee_name": name, "acknowledged_at": ack.acknowledged_at} for ack, code, name in rows]}


@router.get("/self/policy-acknowledgements")
def self_policy_acknowledgements(db: DbSession, tenant: HRSelf):
    employee = _my_employee(db, tenant)
    rows = db.scalars(select(HRAnnouncementAcknowledgement).where(HRAnnouncementAcknowledgement.organization_id == tenant.organization_id, HRAnnouncementAcknowledgement.employee_id == employee.id)).all()
    return {x.announcement_id: x.acknowledged_at for x in rows}


@router.post("/self/announcements/{announcement_id}/acknowledge")
def acknowledge_policy(announcement_id: str, request: Request, db: DbSession, tenant: HRSelf):
    employee = _my_employee(db, tenant)
    announcement = db.scalar(select(HRAnnouncement).where(HRAnnouncement.id == announcement_id, HRAnnouncement.organization_id == tenant.organization_id, HRAnnouncement.published_at.is_not(None)))
    if announcement is None:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if not announcement.is_policy:
        raise HTTPException(status_code=400, detail="Only policies require acknowledgement")
    existing = db.scalar(select(HRAnnouncementAcknowledgement).where(HRAnnouncementAcknowledgement.organization_id == tenant.organization_id, HRAnnouncementAcknowledgement.announcement_id == announcement.id, HRAnnouncementAcknowledgement.employee_id == employee.id))
    if existing:
        return {"announcement_id": announcement.id, "acknowledged_at": existing.acknowledged_at}
    item = HRAnnouncementAcknowledgement(organization_id=tenant.organization_id, announcement_id=announcement.id, employee_id=employee.id)
    db.add(item); db.flush(); _audit(db, request, tenant, "hr.policy.acknowledged", "hr_announcement", announcement.id, {"employee_id": employee.id}); db.commit(); db.refresh(item)
    return {"announcement_id": announcement.id, "acknowledged_at": item.acknowledged_at}


@router.get("/recruitment-meta")
def recruitment_meta(db: DbSession, tenant: HRViewer):
    roles = db.scalars(select(OrganizationRole).where(OrganizationRole.organization_id == tenant.organization_id, OrganizationRole.is_active.is_(True)).order_by(OrganizationRole.is_system.desc(), OrganizationRole.name)).all()
    departments = db.scalars(select(Department).where(Department.organization_id == tenant.organization_id, Department.is_active.is_(True)).order_by(Department.name)).all()
    designations = db.scalars(select(Designation).where(Designation.organization_id == tenant.organization_id, Designation.is_active.is_(True)).order_by(Designation.name)).all()
    return {
        "roles": [{"id": x.id, "name": x.name, "slug": x.slug} for x in roles],
        "departments": [{"id": x.id, "name": x.name} for x in departments],
        "designations": [{"id": x.id, "name": x.name} for x in designations],
    }


@router.post("/candidates/{candidate_id}/convert", status_code=status.HTTP_201_CREATED)
def convert_candidate(candidate_id: str, payload: CandidateConvert, request: Request, db: DbSession, tenant: EmployeeInviter):
    candidate = db.scalar(select(JobCandidate).where(JobCandidate.id == candidate_id, JobCandidate.organization_id == tenant.organization_id).with_for_update())
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if candidate.stage == "hired":
        raise HTTPException(status_code=409, detail="Candidate is already marked hired")
    job = db.scalar(select(JobOpening).where(JobOpening.id == candidate.job_opening_id, JobOpening.organization_id == tenant.organization_id))
    if job is None:
        raise HTTPException(status_code=404, detail="Job opening not found")
    role_id = payload.role_id or db.scalar(select(OrganizationRole.id).where(OrganizationRole.organization_id == tenant.organization_id, OrganizationRole.slug == "user", OrganizationRole.is_active.is_(True)))
    if not role_id:
        raise HTTPException(status_code=409, detail="No active employee role is available")
    department_id = payload.department_id if payload.department_id is not None else job.department_id
    # Reuse the canonical employee invitation/onboarding flow. It commits the audited invitation transaction.
    invitation = create_invitation(
        InvitationCreate(email=candidate.email, full_name=candidate.full_name, role_id=role_id, department_id=department_id, designation_id=payload.designation_id, employee_code=payload.employee_code),
        request, db, tenant,  # type: ignore[arg-type]
    )
    # The invitation flow committed; lock and mark the candidate hired in a new audited transaction.
    candidate = db.scalar(select(JobCandidate).where(JobCandidate.id == candidate_id, JobCandidate.organization_id == tenant.organization_id).with_for_update())
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate.stage = "hired"
    _audit(db, request, tenant, "hr.candidate.converted", "job_candidate", candidate.id, {"invitation_id": invitation.id, "employee_code": invitation.employee_code}); db.commit()
    return {"candidate_id": candidate.id, "stage": candidate.stage, "invitation_id": invitation.id, "employee_code": invitation.employee_code, "invite_token": invitation.invite_token, "email": invitation.email}
