"""GPS attendance regression checks using the existing isolated CI tenant fixture.

Run after migrations and verify_hr.py. No production data is required.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.hr_attendance import (
    AttendanceRequestCreate, OfficePayload, PolicyPayload, create_office,
    create_request, self_attendance_plan, upsert_policy,
)
from app.api.v1.hr_self import CheckInPayload, check_in, check_out
from app.db.session import SessionLocal
from app.models.hr import AttendanceRecord
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Employee
from app.models.user import User
from app.services.hr_attendance import (
    distance_meters, effective_attendance_mode, validate_weekly_modes, verify_office_location,
)
from app.tenancy.context import TenantContext


def request(path: str) -> Request:
    return Request({
        "type": "http", "method": "POST", "path": path, "raw_path": path.encode(),
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def denied(code: int, action) -> None:
    try:
        action()
    except HTTPException as exc:
        assert exc.status_code == code, (exc.status_code, exc.detail)
    else:
        raise AssertionError(f"Expected HTTP {code} rejection")


def main() -> None:
    assert distance_meters(23, 90, 23, 90) < 0.001
    assert 110_000 < distance_meters(23, 90, 24, 90) < 112_000
    denied(400, lambda: validate_weekly_modes(["office"] * 6))
    denied(400, lambda: validate_weekly_modes(["office"] * 6 + ["wrong"]))
    test_office = SimpleNamespace(latitude=23.0, longitude=90.0, radius_meters=100)
    assert verify_office_location(test_office, latitude=23.0, longitude=90.0, accuracy_meters=8) < 0.1
    denied(400, lambda: verify_office_location(test_office, latitude=None, longitude=90.0, accuracy_meters=8))
    denied(422, lambda: verify_office_location(test_office, latitude=23.0, longitude=90.0, accuracy_meters=300))
    denied(403, lambda: verify_office_location(test_office, latitude=23.01, longitude=90.0, accuracy_meters=8))

    db = SessionLocal()
    try:
        organization = db.scalar(
            select(Organization).where(Organization.name == "Existing Tenant Fixture")
            .order_by(Organization.created_at.desc())
        )
        assert organization is not None
        user = db.get(User, organization.created_by_user_id)
        membership = db.scalar(select(Membership).where(
            Membership.organization_id == organization.id,
            Membership.user_id == organization.created_by_user_id, Membership.status == "active",
        ))
        assert user is not None and membership is not None
        employee = db.scalar(select(Employee).where(
            Employee.organization_id == organization.id, Employee.membership_id == membership.id,
        ))
        assert employee is not None and employee.employment_status == "active"
        tenant = TenantContext(user=user, organization=organization, membership=membership)
        today = datetime.now(timezone.utc).astimezone(ZoneInfo(organization.timezone)).date()
        tomorrow = today + timedelta(days=1)

        office = create_office(
            OfficePayload(name=f"CI GPS Office {uuid4().hex[:8]}", latitude=23.0,
                          longitude=90.0, radius_meters=100),
            request("/hr/attendance/offices"), db, tenant,
        )
        weekly = ["remote"] * 7
        weekly[today.weekday()] = "office"
        weekly[tomorrow.weekday()] = "office"
        # A weekly schedule repeats, so create a unique employee-day before check-in.
        upsert_policy(employee.id, PolicyPayload(office_id=office["id"], weekly_modes=weekly),
                      request("/hr/attendance/policies"), db, tenant)
        assert self_attendance_plan(db, tenant)["mode"] == "office"

        denied(400, lambda: check_in(request("/hr/self/check-in"), db, tenant, None))
        fresh_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        denied(403, lambda: check_in(request("/hr/self/check-in"), db, tenant,
                                   CheckInPayload(latitude=23.01, longitude=90, accuracy_meters=8,
                                                  location_timestamp_ms=fresh_ms)))
        denied(422, lambda: check_in(request("/hr/self/check-in"), db, tenant,
                                   CheckInPayload(latitude=23, longitude=90, accuracy_meters=500,
                                                  location_timestamp_ms=fresh_ms)))
        started = check_in(request("/hr/self/check-in"), db, tenant,
                           CheckInPayload(latitude=23, longitude=90, accuracy_meters=8,
                                          location_timestamp_ms=int(datetime.now(timezone.utc).timestamp() * 1000)))
        assert started["attendance_mode"] == "office"
        record = db.scalar(select(AttendanceRecord).where(
            AttendanceRecord.organization_id == organization.id, AttendanceRecord.id == started["id"],
        ))
        assert record is not None and record.verification_method == "browser_gps"
        denied(409, lambda: check_in(request("/hr/self/check-in"), db, tenant, None))
        checked_out = check_out(request("/hr/self/check-out"), db, tenant)
        assert checked_out["id"] == started["id"]

        requested_date = tomorrow
        denied(409, lambda: upsert_policy(
            employee.id, PolicyPayload(office_id=office["id"], weekly_modes=weekly),
            request("/hr/attendance/policies"), db, tenant,
        ))
        new_request = create_request(
            AttendanceRequestCreate(request_type="mode", work_date=requested_date, reason="CI remote exception"),
            request("/hr/self/attendance-requests"), db, tenant,
        )
        assert new_request["status"] == "pending" and new_request["requested_mode"] == "remote"
        denied(409, lambda: create_request(
            AttendanceRequestCreate(request_type="mode", work_date=requested_date, reason="Duplicate request"),
            request("/hr/self/attendance-requests"), db, tenant,
        ))
        foreign_mode, foreign_policy, foreign_office = effective_attendance_mode(
            db, organization_id=str(uuid4()), employee_id=employee.id, work_date=today,
        )
        assert foreign_mode == "unconfigured" and foreign_policy is None and foreign_office is None
    finally:
        db.close()
    print("HR GPS attendance verification passed: geofence -> schedule -> self check-in/out -> requests -> tenant isolation")


if __name__ == "__main__":
    main()
