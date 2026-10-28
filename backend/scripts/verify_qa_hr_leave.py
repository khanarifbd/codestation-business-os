"""QA-009 and previously blocked HR regressions. Local synthetic PostgreSQL only."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4
from fastapi import HTTPException, UploadFile
from sqlalchemy import select, func
from starlette.datastructures import Headers
from starlette.requests import Request
from app.api.v1.hr import LeaveRequestCreate, LeaveReview, LeaveTypeCreate, create_leave_request, create_leave_type, review_leave
from app.api.v1.hr_self import _leave_balances, cancel_self_leave
from app.api.v1.organizations import create_organization
from app.db.session import SessionLocal, engine
from app.models.hr import LeaveRequest, AttendanceRecord
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Employee
from app.models.user import User
from app.schemas.organization import OrganizationCreate
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext


def request():
    return Request({"type":"http","method":"POST","path":"/qa/hr","headers":[],"query_string":b"","client":("127.0.0.1",1),"server":("localhost",80),"scheme":"http"})


def rejected(db, code, action):
    try:
        action()
    except HTTPException as exc:
        db.rollback()
        assert exc.status_code == code, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected HTTP {code}")


def main():
    assert engine.url.host in {"127.0.0.1","localhost"}, "Local synthetic database only"
    marker=uuid4().hex[:10]
    with SessionLocal() as db:
        owner=User(email=f"qa-hr-owner-{marker}@example.invalid",full_name="QA HR Owner",is_active=True,is_verified=True)
        db.add(owner); db.flush()
        record_activity(db,action="qa.hr.fixture",scope="system",actor_user_id=owner.id)
        db.commit()
        result=create_organization(OrganizationCreate(name=f"QA HR {marker}",currency="USD",country_code="US",timezone="UTC"),request(),db,owner)
        org=db.get(Organization,result.organization.id)
        membership=db.scalar(select(Membership).where(Membership.organization_id==org.id,Membership.user_id==owner.id))
        tenant=TenantContext(owner,org,membership)
        employee=db.scalar(select(Employee).where(Employee.membership_id==membership.id))
        manager=User(email=f"qa-hr-manager-{marker}@example.invalid",full_name="QA HR Manager",is_active=True,is_verified=True)
        db.add(manager); db.flush()
        mm=Membership(organization_id=org.id,user_id=manager.id,role="admin",role_id=membership.role_id,status="active")
        db.add(mm); db.flush()
        me=Employee(organization_id=org.id,membership_id=mm.id,employee_code="QA-MANAGER",employment_status="active")
        db.add(me)
        record_activity(db,action="qa.hr.manager_fixture",scope="tenant",organization_id=org.id,actor_user_id=owner.id)
        db.commit()
        mt=TenantContext(manager,org,mm)
        lt=create_leave_type(LeaveTypeCreate(name="Annual QA",code="QA-ANNUAL",annual_allowance_days=12),request(),db,tenant)
        other=create_leave_type(LeaveTypeCreate(name="Other QA",code="QA-OTHER",annual_allowance_days=12,requires_approval=False),request(),db,tenant)
        def create(start,end=None,leave_type=None,employee_id=None):
            return create_leave_request(LeaveRequestCreate(leave_type_id=leave_type or lt.id,start_date=start,end_date=end or start,employee_id=employee_id),request(),db,tenant)
        def balance():
            return next(x for x in _leave_balances(db,tenant,employee,2096) if x["leave_type_id"]==lt.id)
        initial=create(date(2096,10,22),date(2096,10,26))
        assert Decimal(balance()["pending_days"])==5
        rejected(db,409,lambda:create(date(2096,10,22)))
        assert review_leave(initial["id"],LeaveReview(status="approved"),request(),db,mt)["status"]=="approved"
        for start,end in [(date(2096,10,22),date(2096,10,22)),(date(2096,10,21),date(2096,10,22)),(date(2096,10,26),date(2096,10,27)),(date(2096,10,20),date(2096,10,28))]:
            rejected(db,409,lambda:create(start,end))
        rejected(db,409,lambda:create(date(2096,10,23),leave_type=other.id))
        assert Decimal(balance()["approved_days"])==5 and Decimal(balance()["remaining_days"])==7
        adjacent=create(date(2096,10,27))
        assert Decimal(balance()["remaining_days"])==6
        cancel_self_leave(adjacent["id"],request(),db,tenant)
        assert Decimal(balance()["remaining_days"])==7
        replacement=create(date(2096,10,27))
        rejected(db,409,lambda:review_leave(adjacent["id"],LeaveReview(status="approved"),request(),db,mt))
        review_leave(replacement["id"],LeaveReview(status="rejected"),request(),db,mt)
        assert Decimal(balance()["remaining_days"])==7
        create(date(2096,10,23),employee_id=me.id)
        assert create(date(2096,11,1),leave_type=other.id)["status"]=="approved"
        rejected(db,409,lambda:create(date(2096,11,1)))
        overdraft=create(date(2096,12,1),date(2096,12,15))
        assert Decimal(balance()["remaining_days"])==-8
        review_leave(overdraft["id"],LeaveReview(status="rejected"),request(),db,mt)
        assert Decimal(balance()["remaining_days"])==7
        # Resolve IDs before threads; each competing transaction has its own session.
        type_id=lt.id
        concurrent_tenant=SimpleNamespace(organization_id=tenant.organization_id,user_id=tenant.user_id,membership_id=tenant.membership_id,role=tenant.role)
        db.rollback()
        barrier=Barrier(2)
        def concurrent(_):
            with SessionLocal() as local:
                barrier.wait(timeout=10)
                try:
                    create_leave_request(LeaveRequestCreate(leave_type_id=type_id,start_date=date(2096,11,10),end_date=date(2096,11,10)),request(),local,concurrent_tenant)
                    return 201
                except HTTPException as exc:
                    local.rollback(); return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes=sorted(pool.map(concurrent,range(2)))
        assert outcomes==[201,409],outcomes
        assert db.scalar(select(func.count()).select_from(LeaveRequest).where(LeaveRequest.organization_id==org.id,LeaveRequest.start_date==date(2096,11,10)))==1
        # Approval of a previously rejected request races creation on the same dates.
        retry=create(date(2096,11,20))
        review_leave(retry["id"],LeaveReview(status="rejected"),request(),db,mt)
        db.rollback()
        barrier=Barrier(2)
        def approve_or_create(index):
            with SessionLocal() as local:
                barrier.wait(timeout=10)
                try:
                    if index==0:
                        review_leave(retry["id"],LeaveReview(status="approved"),request(),local,concurrent_tenant)
                    else:
                        create_leave_request(LeaveRequestCreate(leave_type_id=type_id,start_date=date(2096,11,20),end_date=date(2096,11,20)),request(),local,concurrent_tenant)
                    return 201
                except HTTPException as exc:
                    local.rollback(); return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(approve_or_create,range(2)))==[201,409]
        print("QA-009 PASS: inclusive overlap, pending/approved, cross-type, auto-approval, adjacent/different employee, balance preservation, cancellation/rejection/reactivation, concurrent create/create and approval/create; calendar-day/overdraft unchanged")
        retest_prior_hr_cases(db,tenant,mt,employee)
        print(f"Retained isolated fixture: {org.id}")


def retest_prior_hr_cases(db,tenant,manager,employee):
    from app.api.v1.hr_attendance import AttendanceRequestCreate, AttendanceRequestReview, PolicyPayload, OfficePayload, create_request, review_request, upsert_policy, create_office
    from app.api.v1.hr_uploads import upload_document, manager_file, self_file
    from app.api.v1.payroll import create_salary_profile, create_period, create_run
    from app.schemas.payroll import SalaryProfileCreate, PayrollPeriodCreate, PayrollRunCreate
    today=datetime.now(timezone.utc).date()
    office=create_office(OfficePayload(name="QA Office",latitude=23,longitude=90,radius_meters=100),request(),db,manager)
    upsert_policy(employee.id,PolicyPayload(office_id=office["id"],weekly_modes=["office"]*7),request(),db,manager)
    remote=create_request(AttendanceRequestCreate(work_date=today+timedelta(days=1),request_type="mode",reason="Synthetic remote request"),request(),db,tenant)
    rejected(db,403,lambda:review_request(remote["id"],AttendanceRequestReview(status="approved"),request(),db,tenant))
    assert review_request(remote["id"],AttendanceRequestReview(status="approved"),request(),db,manager)["status"]=="approved"
    yesterday=today-timedelta(days=1)
    start=datetime.combine(yesterday,datetime.min.time(),tzinfo=timezone.utc)+timedelta(hours=9)
    correction=create_request(AttendanceRequestCreate(work_date=yesterday,request_type="correction",reason="Synthetic correction request",proposed_check_in_at=start,proposed_check_out_at=start+timedelta(hours=8)),request(),db,tenant)
    rejected(db,403,lambda:review_request(correction["id"],AttendanceRequestReview(status="approved"),request(),db,tenant))
    assert review_request(correction["id"],AttendanceRequestReview(status="approved"),request(),db,manager)["status"]=="approved"
    record=db.scalar(select(AttendanceRecord).where(AttendanceRecord.organization_id==tenant.organization_id,AttendanceRecord.employee_id==employee.id,AttendanceRecord.attendance_date==yesterday))
    assert record is not None and record.work_minutes==480
    print("HR29 PASS locally: self-approval rejected 403 for remote/correction; independent manager approval persists; correction creates 480-minute attendance")
    # Minimal valid one-page PDF; fixed synthetic content, no personal data.
    objects=[b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>", b"<< /Length 0 >>\nstream\n\nendstream"]
    content=b"%PDF-1.4\n"
    offsets=[0]
    for number,obj in enumerate(objects,1):
        offsets.append(len(content))
        content+=str(number).encode()+b" 0 obj\n"+obj+b"\nendobj\n"
    xref=len(content)
    content+=b"xref\n0 5\n0000000000 65535 f \n"+b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    content+=f"trailer\n<< /Root 1 0 R /Size 5 >>\nstartxref\n{xref}\n%%EOF\n".encode()
    upload=upload_document(request(),db,manager,UploadFile(filename="qa-employee.pdf",file=BytesIO(content),headers=Headers({"content-type":"application/pdf"})),employee.id,"QA employee file","other")
    for result in [manager_file(upload["id"],db,manager),self_file(upload["id"],db,tenant)]:
        messages=[]
        async def send(message):
            messages.append(message)
        async def receive():
            return {"type":"http.request","body":b"","more_body":False}
        asyncio.run(result({"type":"http","method":"GET","path":"/file","headers":[],"extensions":{}},receive,send))
        assert b"".join(message.get("body",b"") for message in messages)==content
        assert next(message["status"] for message in messages if message["type"]=="http.response.start")==200
        assert "attachment" in result.headers["content-disposition"]
    rejected(db,404,lambda:self_file(upload["id"],db,manager))
    print("HR10 PASS backend file retrieval: exact streamed PDF bytes, manager/self access, other-employee denial; browser download not certified")
    create_salary_profile(SalaryProfileCreate(employee_id=employee.id,currency="USD",pay_frequency="monthly",base_salary=Decimal("1000"),effective_from=date(2096,1,1)),request(),db,manager)
    period=create_period(PayrollPeriodCreate(name="QA half month",period_start=date(2096,11,1),period_end=date(2096,11,15),pay_date=date(2096,11,15)),request(),db,manager)
    run=create_run(PayrollRunCreate(period_id=period.id,currency="USD"),request(),db,manager)
    assert run.status=="draft" and run.gross_total==Decimal("1000")
    print("HR22 PARTIAL, policy unchanged: Nov 1-15 monthly payroll draft remains USD 1000; proration convention requires product decision")


if __name__=="__main__":
    main()
