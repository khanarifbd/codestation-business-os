"""Authenticated payroll boundary regressions on isolated PostgreSQL.

Records existing full-profile behavior, NOT approval of a proration convention.
Only get_db is overridden; real auth/permissions and database code run. Synthetic
fixtures and all endpoint commits are contained by an outer rollback.
"""
import os
from decimal import Decimal as D
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.services.activity_log import record_activity


def main():
    assert os.environ.get("ENVIRONMENT") == "test"
    assert engine.url.get_backend_name() == "postgresql"
    assert engine.url.host in {"localhost", "127.0.0.1"}
    assert not app.dependency_overrides
    conn = engine.connect()
    outer = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode="create_savepoint")

    def local_db():
        with SessionLocal(bind=conn, join_transaction_mode="create_savepoint") as session:
            yield session

    app.dependency_overrides[get_db] = local_db
    http = TestClient(app, raise_server_exceptions=False)
    headers = {}

    def call(method, path, payload=None, expected=200):
        response = http.request(method, "/api/v1" + path, headers=headers, json=payload)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        return response.json()

    def post(path, payload=None, expected=201):
        return call("POST", path, payload, expected)

    def period(name, start, end):
        return post("/payroll/periods", {"name": name, "period_start": start, "period_end": end, "pay_date": end})

    def run(period_row, expected=201):
        return post("/payroll/runs", {"period_id": period_row["id"], "currency": "USD"}, expected)

    def amounts(row, **expected):
        for key, value in expected.items():
            assert D(str(row[key])) == D(str(value)), (key, row[key], value)

    try:
        marker = uuid4().hex[:10]
        owner = User(email=f"qc-payroll-{marker}@example.invalid", full_name="Synthetic payroll owner", is_active=True, is_verified=True)
        db.add(owner)
        db.flush()
        owner_id = owner.id
        record_activity(db, action="qc.payroll.fixture", scope="system", actor_type="system")
        db.commit()
        headers["Authorization"] = "Bearer " + create_access_token(owner_id)
        org = post("/organizations", {"name": "QC payroll " + marker, "currency": "USD", "country_code": "US", "timezone": "UTC"})["organization"]
        headers["X-Organization-ID"] = org["id"]
        employee_id = db.scalar(select(Employee.id).where(Employee.organization_id == org["id"]))
        db.rollback()
        profile = post("/payroll/salary-profiles", {"employee_id": employee_id, "currency": "USD", "base_salary": "1000", "pay_frequency": "monthly", "effective_from": "2096-01-16", "default_allowances": [{"name": "Housing", "amount": "125.50"}], "default_deductions": [{"name": "Fund", "amount": "25.25"}]})
        profile_path = "/payroll/salary-profiles/" + profile["id"]
        before = period("Before profile", "2096-01-01", "2096-01-15")
        run(before, 409)
        half = run(period("Half month", "2096-01-16", "2096-01-31"))
        assert half["employee_count"] == 1
        amounts(half, gross_total="1125.50", deduction_total="25.25", net_total="1100.25")
        entry = half["entries"][0]
        payslip_path = "/hr/self/payslips/" + entry["id"]
        call("GET", payslip_path, expected=404)
        entry_path = f"/payroll/runs/{half['id']}/entries/{entry['id']}"
        adjusted = call("PATCH", entry_path, {"tax_amount": "100.10"})
        amounts(adjusted, gross_total="1125.50", tax_total="100.10", net_total="1000.15")
        call("PATCH", entry_path, {"tax_amount": "2000"}, 400)
        amounts(call("GET", "/payroll/runs/" + half["id"]), net_total="1000.15", tax_total="100.10")
        post("/payroll/runs/" + half["id"] + "/approve", expected=200)
        call("PATCH", entry_path, {"tax_amount": "0"}, 409)
        slip = call("GET", payslip_path)
        amounts(slip["entry"], base_salary="1000", gross_pay="1125.50", tax_amount="100.10", net_pay="1000.15")
        # Updating the profile must never rewrite an approved historical snapshot.
        call("PATCH", profile_path, {"base_salary": "1200"})
        amounts(call("GET", payslip_path)["entry"], base_salary="1000", net_pay="1000.15")
        # Invalid nullable scalar updates and inverted ranges are input errors.
        for field in ("base_salary", "is_active", "default_allowances", "default_deductions"):
            call("PATCH", profile_path, {field: None}, 422)
        call("PATCH", profile_path, {"effective_to": "2096-01-15"}, 400)
        stored = next(p for p in call("GET", "/payroll/salary-profiles") if p["id"] == profile["id"])
        amounts(stored, base_salary="1200")
        assert stored["effective_to"] is None and stored["is_active"]
        # Adjacent archived/new profiles: latest overlapping profile wins, no split.
        newer = post("/payroll/salary-profiles", {"employee_id": employee_id, "currency": "USD", "base_salary": "1500", "effective_from": "2096-02-16"})
        feb = run(period("Profile change month", "2096-02-01", "2096-02-29"))
        assert feb["employee_count"] == 1
        amounts(feb, gross_total="1500", net_total="1500")
        # End date is inclusive; the following day's period is ineligible.
        call("PATCH", "/payroll/salary-profiles/" + newer["id"], {"effective_to": "2096-03-01", "is_active": False})
        one_day = run(period("Inclusive end", "2096-03-01", "2096-03-01"))
        amounts(one_day, gross_total="1500", net_total="1500")
        run(period("After end", "2096-03-02", "2096-03-31"), 409)
        # HR28: distinct non-admin employee identity, real permission checks.
        peer = User(email=f"qc-payroll-peer-{marker}@example.invalid", full_name="Synthetic payroll employee", is_active=True, is_verified=True)
        db.add(peer)
        db.flush()
        peer_id = peer.id
        role_id = db.scalar(select(OrganizationRole.id).where(OrganizationRole.organization_id == org["id"], OrganizationRole.slug == "user"))
        assert role_id
        membership = Membership(organization_id=org["id"], user_id=peer_id, role_id=role_id, role="user", status="active")
        db.add(membership)
        db.flush()
        peer_employee = Employee(organization_id=org["id"], membership_id=membership.id, employee_code="QC-PAYROLL-PEER", employment_status="active")
        db.add(peer_employee)
        db.flush()
        peer_employee_id = peer_employee.id
        record_activity(db, action="qc.payroll.peer_fixture", scope="tenant", organization_id=org["id"], actor_type="system")
        db.commit()
        post("/payroll/salary-profiles", {"employee_id": peer_employee_id, "currency": "USD", "base_salary": "900", "effective_from": "2096-04-01"})
        peer_run = run(period("Employee payslip", "2096-04-01", "2096-04-30"))
        peer_slip_path = "/hr/self/payslips/" + peer_run["entries"][0]["id"]
        owner_token = headers["Authorization"]
        headers["Authorization"] = "Bearer " + create_access_token(peer_id)
        call("GET", peer_slip_path, expected=404)
        # The actual self-service listing must omit both this draft and the
        # other employee's already-approved payroll, not just protect detail.
        assert call("GET", "/hr/self")["payslips"] == []
        call("GET", payslip_path, expected=404)
        call("GET", "/payroll/runs", expected=403)
        headers["Authorization"] = owner_token
        post("/payroll/runs/" + peer_run["id"] + "/approve", expected=200)
        call("GET", peer_slip_path, expected=404)
        headers["Authorization"] = "Bearer " + create_access_token(peer_id)
        listed = call("GET", "/hr/self")["payslips"]
        assert len(listed) == 1, listed
        assert listed[0]["entry_id"] == peer_run["entries"][0]["id"], listed
        assert listed[0]["run_id"] == peer_run["id"] and listed[0]["status"] == "approved", listed
        assert all(row["entry_id"] != entry["id"] for row in listed), listed
        amounts(listed[0], gross_pay="900", net_pay="900")
        peer_slip = call("GET", peer_slip_path)
        amounts(peer_slip["entry"], base_salary="900", gross_pay="900", net_pay="900")
        assert peer_slip["entry"]["employee_name"] == "Synthetic payroll employee"
        call("GET", payslip_path, expected=404)
        headers["Authorization"] = owner_token
        print("PASS payroll: eligibility boundaries, half-month full-profile observation, latest-profile selection, approval lock, payslip snapshot, validation rollback")
        print("PASS HR28: real non-admin JWT, own approved payslip exactly once in self-list, draft/other employees excluded from list and detail, manager-only payroll denied")
        print("POLICY UNRESOLVED: automatic salary proration, join/leave and working-day conventions remain unchanged; these tests do not approve that policy.")
    finally:
        http.close()
        app.dependency_overrides.clear()
        db.close()
        outer.rollback()
        conn.close()
    with SessionLocal() as clean:
        assert clean.get(Organization, org["id"]) is None
        assert clean.get(User, owner_id) is None and clean.get(User, peer_id) is None
    print("PASS cleanup: synthetic organization and users absent after rollback")


if __name__ == "__main__":
    main()
