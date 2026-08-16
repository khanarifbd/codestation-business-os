from datetime import datetime, time, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.hr_workspace import JobStatusUpdate, hr_access, hr_workspace_summary, update_job_status
from app.db.session import SessionLocal
from app.models.hr import JobOpening
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User
from app.services.hr_time import attendance_status_for_check_in, scheduled_presence_minutes
from app.tenancy.context import TenantContext


def request(method: str, path: str) -> Request:
    return Request({
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    db = SessionLocal()
    try:
        organization = db.scalar(
            select(Organization)
            .where(Organization.name == "Existing Tenant Fixture")
            .order_by(Organization.created_at.desc())
        )
        if organization is None:
            raise AssertionError("existing tenant fixture not found")
        user = db.get(User, organization.created_by_user_id)
        membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == organization.id,
                Membership.user_id == organization.created_by_user_id,
                Membership.status == "active",
            )
        )
        if user is None or membership is None:
            raise AssertionError("fixture owner membership missing")
        tenant = TenantContext(user=user, organization=organization, membership=membership)

        access = hr_access(db, tenant)
        if not access["can_view"] or not access["can_manage_people"] or not access["can_invite_employees"]:
            raise AssertionError(f"unexpected HR admin capabilities: {access}")

        summary = hr_workspace_summary(db, tenant)
        try:
            expected_today = datetime.now(timezone.utc).astimezone(ZoneInfo(organization.timezone)).date()
        except Exception:
            expected_today = datetime.now(timezone.utc).date()
        if summary["today"] != expected_today:
            raise AssertionError(f"HR workspace timezone mismatch: {summary['today']} != {expected_today}")
        if summary["metrics"]["active_employees"] < 1:
            raise AssertionError("HR workspace active employee summary missing")

        overnight = SimpleNamespace(
            start_time=time(22, 0),
            end_time=time(6, 0),
            weekly_off_days=[],
            grace_minutes=10,
        )
        if scheduled_presence_minutes(overnight, expected_today) != 480:
            raise AssertionError("overnight shift duration should be eight elapsed hours")

        on_time = datetime.combine(expected_today, time(22, 5), tzinfo=timezone.utc)
        late = datetime.combine(expected_today, time(22, 11), tzinfo=timezone.utc)
        if attendance_status_for_check_in(overnight, on_time) != "present":
            raise AssertionError("grace window should keep attendance present")
        if attendance_status_for_check_in(overnight, late) != "late":
            raise AssertionError("late check-in was not classified")

        weekly_off = SimpleNamespace(
            start_time=time(9, 0),
            end_time=time(17, 0),
            weekly_off_days=[expected_today.weekday()],
            grace_minutes=0,
        )
        if scheduled_presence_minutes(weekly_off, expected_today) != 0:
            raise AssertionError("weekly off must have zero scheduled attendance minutes")

        job = db.scalar(
            select(JobOpening)
            .where(JobOpening.organization_id == organization.id)
            .order_by(JobOpening.created_at.desc())
        )
        if job is None:
            raise AssertionError("HR job fixture missing")
        held = update_job_status(
            job.id,
            JobStatusUpdate(status="on_hold"),
            request("PATCH", f"/hr/jobs/{job.id}/status"),
            db,
            tenant,
        )
        if held["status"] != "on_hold":
            raise AssertionError("job hold status failed")
        reopened = update_job_status(
            job.id,
            JobStatusUpdate(status="open"),
            request("PATCH", f"/hr/jobs/{job.id}/status"),
            db,
            tenant,
        )
        if reopened["status"] != "open":
            raise AssertionError("job reopen status failed")

    finally:
        db.close()

    print("HR workspace verification passed: access -> local day -> shift rules -> audited recruitment lifecycle")


if __name__ == "__main__":
    main()
