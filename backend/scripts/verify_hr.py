from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.hr import (
    AnnouncementCreate, AttendanceCreate, CandidateCreate, CandidateUpdate, DocumentCreate,
    JobCreate, LeaveRequestCreate, LeaveReview, LeaveTypeCreate, LifecycleCreate,
    PerformanceCreate, PerformanceUpdate, ShiftAssign, ShiftCreate,
    assign_shift, create_announcement, create_attendance, create_candidate, create_document,
    create_job, create_leave_request, create_leave_type, create_lifecycle, create_performance,
    create_shift, hr_dashboard, hr_meta, review_leave, self_service, update_candidate, update_performance,
)
from app.api.v1.hr_self import self_meta
from app.db.session import SessionLocal, engine
from app.models.hr import AttendanceRecord, EmployeeLifecycleEvent, LeaveRequest, PerformanceReview


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
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()
        employee_id = conn.execute(text("SELECT id FROM employees WHERE organization_id=:o AND membership_id=:m LIMIT 1"), {"o":row["organization_id"],"m":row["membership_id"]}).scalar_one()

    tenant = Tenant(str(row["organization_id"]), str(row["user_id"]), str(row["membership_id"]), "admin", Org(str(row["organization_id"]), str(row["timezone"] or "UTC"), str(row["currency"] or "BDT")))
    db = SessionLocal()
    marker = uuid4().hex[:8]
    try:
        meta = hr_meta(db, tenant)  # type: ignore[arg-type]
        if not meta["employees"] or not meta["leave_types"]:
            raise AssertionError("HR meta missing seeded employees/leave types")
        self_defaults = self_meta(db, tenant)  # type: ignore[arg-type]
        if len(self_defaults["leave_types"]) < 3:
            raise AssertionError("HR default leave types were not seeded")

        leave_type = create_leave_type(LeaveTypeCreate(name=f"CI Leave {marker}", code=f"CI{marker[:4]}", annual_allowance_days=Decimal("5")), request("POST","/hr/leave-types"), db, tenant)  # type: ignore[arg-type]
        leave = create_leave_request(LeaveRequestCreate(employee_id=str(employee_id), leave_type_id=leave_type.id, start_date=date(2097,12,20), end_date=date(2097,12,21), reason="CI"), request("POST","/hr/leave-requests"), db, tenant)  # type: ignore[arg-type]
        reviewed = review_leave(leave["id"], LeaveReview(status="approved"), request("PATCH",f"/hr/leave-requests/{leave['id']}"), db, tenant)  # type: ignore[arg-type]
        if reviewed["status"] != "approved": raise AssertionError("leave approval failed")

        attendance = create_attendance(AttendanceCreate(employee_id=str(employee_id), attendance_date=date(2097,12,22), status="present", work_minutes=480, overtime_minutes=30), request("POST","/hr/attendance"), db, tenant)  # type: ignore[arg-type]
        if db.scalar(select(AttendanceRecord).where(AttendanceRecord.id == attendance["id"])) is None: raise AssertionError("attendance missing")

        shift = create_shift(ShiftCreate(name=f"CI Shift {marker}", start_time=time(9), end_time=time(17), break_minutes=60, grace_minutes=10), request("POST","/hr/shifts"), db, tenant)  # type: ignore[arg-type]
        assignment = assign_shift(ShiftAssign(employee_id=str(employee_id), shift_id=shift.id, effective_from=date(2097,12,1)), request("POST","/hr/shift-assignments"), db, tenant)  # type: ignore[arg-type]
        if not assignment["id"]: raise AssertionError("shift assignment failed")

        document = create_document(DocumentCreate(employee_id=str(employee_id), title=f"CI Contract {marker}", document_type="contract", issued_on=date(2097,1,1), expires_on=date(2098,1,1)), request("POST","/hr/documents"), db, tenant)  # type: ignore[arg-type]
        if not document["id"]: raise AssertionError("employee document failed")

        lifecycle = create_lifecycle(LifecycleCreate(employee_id=str(employee_id), event_type="confirmation", effective_date=date(2097,6,1), title="Confirmed", details={"source":"ci"}), request("POST","/hr/lifecycle"), db, tenant)  # type: ignore[arg-type]
        if db.scalar(select(EmployeeLifecycleEvent).where(EmployeeLifecycleEvent.id == lifecycle["id"])) is None: raise AssertionError("lifecycle event failed")

        perf = create_performance(PerformanceCreate(employee_id=str(employee_id), reviewer_employee_id=str(employee_id), period_start=date(2097,1,1), period_end=date(2097,12,31), goals=[{"name":"Quality","target":"High"}]), request("POST","/hr/performance"), db, tenant)  # type: ignore[arg-type]
        update_performance(perf["id"], PerformanceUpdate(manager_review="Strong year", rating=Decimal("4.5"), status="completed"), request("PATCH",f"/hr/performance/{perf['id']}"), db, tenant)  # type: ignore[arg-type]
        stored_perf = db.scalar(select(PerformanceReview).where(PerformanceReview.id == perf["id"]))
        if stored_perf is None or stored_perf.rating != Decimal("4.50"): raise AssertionError("performance review failed")

        announcement = create_announcement(AnnouncementCreate(title=f"CI Policy {marker}", body="Policy body", is_policy=True), request("POST","/hr/announcements"), db, tenant)  # type: ignore[arg-type]
        if not announcement["id"]: raise AssertionError("announcement failed")

        job = create_job(JobCreate(title=f"CI Engineer {marker}", employment_type="full_time", location="Remote", openings=1), request("POST","/hr/jobs"), db, tenant)  # type: ignore[arg-type]
        candidate = create_candidate(CandidateCreate(job_opening_id=job["id"], full_name="CI Candidate", email=f"ci-{marker}@example.com"), request("POST","/hr/candidates"), db, tenant)  # type: ignore[arg-type]
        moved = update_candidate(candidate["id"], CandidateUpdate(stage="interview", rating=Decimal("4")), request("PATCH",f"/hr/candidates/{candidate['id']}"), db, tenant)  # type: ignore[arg-type]
        if moved["stage"] != "interview": raise AssertionError("candidate pipeline failed")

        dashboard = hr_dashboard(db, tenant)  # type: ignore[arg-type]
        if dashboard["active_employees"] < 1 or dashboard["open_jobs"] < 1: raise AssertionError("HR dashboard metrics failed")
        self_data = self_service(db, tenant)  # type: ignore[arg-type]
        if self_data["employee"]["id"] != employee_id: raise AssertionError("self service employee isolation failed")
        if not any(x["id"] == leave["id"] for x in self_data["leave_requests"]): raise AssertionError("self leave history missing")
        if db.scalar(select(LeaveRequest).where(LeaveRequest.id == leave["id"], LeaveRequest.organization_id == tenant.organization_id)) is None: raise AssertionError("tenant leave persistence missing")
    finally:
        db.close()
    print("HR verification passed: leave -> attendance -> shift -> documents -> lifecycle -> performance -> announcements -> recruitment -> self service")


if __name__ == "__main__":
    main()
