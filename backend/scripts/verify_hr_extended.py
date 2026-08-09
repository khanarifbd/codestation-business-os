from dataclasses import dataclass
from datetime import date
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.hr import AnnouncementCreate, CandidateCreate, JobCreate, create_announcement, create_candidate, create_job
from app.api.v1.hr_extended import CandidateConvert, HolidayCreate, acknowledge_policy, convert_candidate, create_holiday, self_policy_acknowledgements
from app.db.session import SessionLocal, engine
from app.models.team import OrganizationRole


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str
    organization: Org


def request(method: str, path: str) -> Request:
    return Request({"type":"http","method":method,"path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, m.id membership_id
            FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()
    tenant = Tenant(str(row["organization_id"]), str(row["user_id"]), str(row["membership_id"]), "admin", Org(str(row["organization_id"]), str(row["timezone"] or "UTC"), str(row["currency"] or "BDT")))
    db = SessionLocal(); marker = uuid4().hex[:8]
    try:
        role_id = db.scalar(select(OrganizationRole.id).where(OrganizationRole.organization_id == tenant.organization_id, OrganizationRole.is_active.is_(True)).order_by(OrganizationRole.is_system.desc(), OrganizationRole.created_at.asc()))
        if not role_id: raise AssertionError("no active role available for recruitment conversion fixture")
        holiday = create_holiday(HolidayCreate(name=f"CI Holiday {marker}", holiday_date=date(2097, 12, 25), is_paid=True), request("POST", "/hr/holidays"), db, tenant)  # type: ignore[arg-type]
        if holiday["holiday_date"] != date(2097, 12, 25): raise AssertionError("holiday calendar failed")
        policy = create_announcement(AnnouncementCreate(title=f"CI Policy Ext {marker}", body="Policy body", is_policy=True), request("POST", "/hr/announcements"), db, tenant)  # type: ignore[arg-type]
        ack = acknowledge_policy(policy["id"], request("POST", f"/hr/self/announcements/{policy['id']}/acknowledge"), db, tenant)  # type: ignore[arg-type]
        if ack["announcement_id"] != policy["id"] or policy["id"] not in self_policy_acknowledgements(db, tenant): raise AssertionError("policy acknowledgement failed")  # type: ignore[arg-type]
        job = create_job(JobCreate(title=f"CI Ext Engineer {marker}", employment_type="full_time", location="Remote", openings=1), request("POST", "/hr/jobs"), db, tenant)  # type: ignore[arg-type]
        candidate = create_candidate(CandidateCreate(job_opening_id=job["id"], full_name="CI Ext Candidate", email=f"ci-ext-{marker}@example.com"), request("POST", "/hr/candidates"), db, tenant)  # type: ignore[arg-type]
        converted = convert_candidate(candidate["id"], CandidateConvert(role_id=role_id), request("POST", f"/hr/candidates/{candidate['id']}/convert"), db, tenant)  # type: ignore[arg-type]
        if converted["stage"] != "hired" or not converted["invitation_id"] or not converted["invite_token"]: raise AssertionError("candidate conversion failed")
    finally:
        db.close()
    print("extended HR verification passed: holiday -> policy acknowledgement -> candidate invitation conversion")


if __name__ == "__main__": main()
