"""HR10/PRJ15/SET06 real app HTTP, real auth and PostgreSQL; no retained fixtures.

Only get_db is rebound to a local outer transaction. Actual multipart uploads,
file storage, FileResponse streaming and all auth/tenant permissions run normally.
"""
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, func

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.activity_log import ActivityLog
from app.models.company_settings import OrganizationDocument
from app.models.crm import Client
from app.models.hr import EmployeeHRDocument, AttendanceRecord
from app.models.hr_attendance import HRAttendanceRequest
from app.models.membership import Membership
from app.models.orders import Order
from app.models.organization import Organization
from app.models.projects import Project, ProjectDocument
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.services.activity_log import record_activity
from app.services.document_storage import storage
from verify_qa_document_downloads import PDF


def main():
    assert settings.environment == "test"
    assert engine.url.get_backend_name() == "postgresql" and engine.url.host in {"127.0.0.1", "localhost"}
    assert not app.dependency_overrides
    marker = uuid4().hex[:12]
    org_ids = []
    created_roots = []
    connection = engine.connect()
    outer = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    def local_db():
        with SessionLocal(bind=connection, join_transaction_mode="create_savepoint") as request_db:
            yield request_db
    app.dependency_overrides[get_db] = local_db
    http = TestClient(app)  # No lifespan/bootstrap and no real HTTP sockets.
    def request(method, path, headers=None, expected=200, **kwargs):
        response = http.request(method, "/api/v1" + path, headers=headers or {}, **kwargs)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        return response
    def audit():
        record_activity(db, action="qa.document_http.fixture", scope="system", actor_type="system")
        db.commit()
    def headers(user, org=None):
        result = {"Authorization": "Bearer " + create_access_token(user.id, int(user.auth_token_version or 0))}
        if org:
            result["X-Organization-ID"] = org
        return result
    def fixture(label):
        user = User(email=f"qa-doc-{label}-{marker}@example.invalid", full_name="Synthetic document owner", is_active=True, is_verified=True)
        db.add(user); db.flush(); audit()
        h = headers(user)
        org = request("POST", "/organizations", h, 201, json={"name": f"QA documents {label} {marker}", "currency": "USD", "country_code": "US", "timezone": "UTC"}).json()["organization"]["id"]
        org_ids.append(org)
        root = storage.root / "organizations" / org
        assert not root.exists(), "Synthetic organization storage must be new"
        created_roots.append(root)
        h["X-Organization-ID"] = org
        employee = db.scalar(select(Employee).join(Membership, Employee.membership_id == Membership.id).where(Employee.organization_id == org, Membership.user_id == user.id))
        assert employee
        employee_id = employee.id
        db.rollback()
        return user, h, employee_id
    def upload(path, h, data, expected=201):
        return request("POST", path, h, expected, data=data, files={"file": ("synthetic-review.pdf", PDF, "application/pdf")})
    def download(path, h):
        response = request("GET", path, h)
        assert response.content == PDF and response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("attachment;") and ".pdf" in response.headers["content-disposition"]
    def snapshot():
        db.expire_all()
        rows = tuple(tuple(tuple(row) for row in db.execute(select(model.__table__).where(model.organization_id.in_(org_ids)).order_by(model.id)).all()) for model in (OrganizationDocument, EmployeeHRDocument, ProjectDocument, ActivityLog, HRAttendanceRequest, AttendanceRecord))
        files = tuple(sorted((str(path), sha256(path.read_bytes()).hexdigest()) for root in created_roots for path in root.rglob("*") if path.is_file()))
        db.rollback()
        return rows, files
    try:
        owner, a, owner_employee = fixture("A")
        _, b, _ = fixture("B")
        org = org_ids[0]
        self_user = User(email=f"qa-doc-self-{marker}@example.invalid", full_name="Synthetic self employee", is_active=True, is_verified=True)
        db.add(self_user); db.flush()
        self_role = OrganizationRole(organization_id=org, name="QA HR self only", slug="qa-hr-self", permissions=["hr.self"])
        db.add(self_role); db.flush()
        membership = Membership(organization_id=org, user_id=self_user.id, role="member", role_id=self_role.id, status="active")
        db.add(membership); db.flush()
        self_employee = Employee(organization_id=org, membership_id=membership.id, employee_code="QA-SELF", employment_status="active")
        db.add(self_employee)
        customer = Client(organization_id=org, client_code="QA-DOC", display_name="Synthetic project customer", currency="USD")
        db.add(customer); db.flush()
        order = Order(organization_id=org, order_number="QA-DOC-ORDER", client_id=customer.id, created_by_user_id=owner.id, order_date=date.today(), currency="USD", seller_name_snapshot="Synthetic seller", client_name_snapshot="Synthetic buyer")
        db.add(order); db.flush()
        project = Project(organization_id=org, project_number="QA-DOC-PROJECT", order_id=order.id, client_id=customer.id, created_by_user_id=owner.id, name="Synthetic document project", currency="USD", status="active")
        db.add(project); db.flush(); audit()
        self_h = headers(self_user, org)
        project_id, self_employee_id = project.id, self_employee.id
        company_upload = "/company-settings/documents/upload"
        project_upload = f"/projects/{project_id}/documents/upload"
        hr_upload = "/hr-documents/upload"
        common = {"title": "Synthetic document QA", "document_type": "other"}
        company = upload(company_upload, a, common).json()
        project_doc = upload(project_upload, a, common).json()
        hr_own = upload(hr_upload, a, {**common, "employee_id": self_employee_id}).json()
        hr_other = upload(hr_upload, a, {**common, "employee_id": owner_employee}).json()
        paths = [f'/company-settings/documents/{company["id"]}/file', f'/projects/{project_id}/documents/{project_doc["id"]}/file', f'/hr-documents/{hr_own["id"]}/file']
        for path in paths:
            download(path, a)
        self_path = f'/hr-documents/self/{hr_own["id"]}/file'
        download(self_path, self_h)
        before = snapshot()
        for path in paths:
            request("GET", path, expected=401)
            request("GET", path, b, 404)
            request("GET", path, self_h, 403)
            request("GET", path, {**a, "X-Organization-ID": org_ids[1]}, 404)
        request("GET", self_path, expected=401)
        request("GET", self_path, b, 404)
        request("GET", f'/hr-documents/self/{hr_other["id"]}/file', self_h, 404)
        # Denied multipart requests must not write either metadata or files.
        for path, data in [(company_upload, common), (project_upload, common), (hr_upload, {**common, "employee_id": self_employee_id})]:
            upload(path, {}, data, 401)
            upload(path, self_h, data, 403)
        upload(project_upload, b, common, 404)
        upload(hr_upload, b, {**common, "employee_id": self_employee_id}, 404)
        assert snapshot() == before, "Denied requests changed documents, audit rows, or stored files"
        for path in paths:
            download(path, a)
        # HR29: grant the requester manager permission deliberately, so the 403
        # proves the self-review business guard rather than a missing role scope.
        self_role = db.get(OrganizationRole, self_role.id)
        self_role.permissions = ["hr.self", "hr.manage"]
        audit()
        office = request("POST", "/hr/attendance/offices", a, 201, json={"name": "Synthetic QA Office", "latitude": 23, "longitude": 90, "radius_meters": 100}).json()
        request("PUT", f"/hr/attendance/policies/{self_employee_id}", a, json={"office_id": office["id"], "weekly_modes": ["office"] * 7})
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        start = datetime.combine(yesterday, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=9)
        for payload in [
            {"request_type": "mode", "work_date": (today + timedelta(days=1)).isoformat(), "reason": "Synthetic remote request"},
            {"request_type": "correction", "work_date": yesterday.isoformat(), "reason": "Synthetic correction request", "proposed_check_in_at": start.isoformat(), "proposed_check_out_at": (start + timedelta(hours=8)).isoformat()},
        ]:
            item = request("POST", "/hr/self/attendance-requests", self_h, 201, json=payload).json()
            review_path = f'/hr/attendance/requests/{item["id"]}/review'
            before = snapshot()
            denied = request("POST", review_path, self_h, 403, json={"status": "approved"})
            assert denied.json()["detail"] == "A different HR manager must review your request"
            request("POST", review_path, b, 404, json={"status": "approved"})
            assert snapshot() == before
            pending = db.get(HRAttendanceRequest, item["id"])
            assert pending.status == "pending" and pending.reviewed_by_user_id is None
            db.rollback()
            result = request("POST", review_path, a, json={"status": "approved"}).json()
            assert result["status"] == "approved"
            db.expire_all()
            approved = db.get(HRAttendanceRequest, item["id"])
            assert approved.status == "approved" and approved.reviewed_by_user_id == owner.id
            db.rollback()
        record = db.scalar(select(AttendanceRecord).where(AttendanceRecord.organization_id == org, AttendanceRecord.employee_id == self_employee_id, AttendanceRecord.attendance_date == yesterday))
        assert record.work_minutes == 480 and record.approved_by_user_id == owner.id and record.verification_method == "hr_correction"
        db.rollback()
        print("PASS HR29 real HTTP: requester with hr.manage cannot self-approve remote/correction (specific 403); foreign tenant 404; independent authorized manager approval persists and creates 480-minute correction")
        print(f"PASS HR10/PRJ15/SET06: real authenticated multipart upload and exact {len(PDF)}-byte PDF download; SHA256 {sha256(PDF).hexdigest()}")
        print("PASS real auth/tenant permissions: anonymous 401, foreign tenant 404, insufficient role 403; HR self own download succeeds/other employee 404; denied uploads and downloads leave exact rows and file hashes unchanged")
    finally:
        http.close()
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        connection.close()
        # These UUID organization roots were verified absent before any uploads.
        # Never clean the shared storage root or another fixture's organization.
        for root in created_roots:
            if root.exists():
                for path in sorted(root.rglob("*"), key=lambda p: len(p.parts), reverse=True):
                    if path.is_file():
                        path.unlink()
                    elif path.is_dir():
                        path.rmdir()
                root.rmdir()
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(org_ids))) == 0
    assert all(not root.exists() for root in created_roots)
    print("PASS cleanup: synthetic rows rolled back and only this run's four uploaded files removed; review company untouched")


if __name__ == "__main__":
    main()
