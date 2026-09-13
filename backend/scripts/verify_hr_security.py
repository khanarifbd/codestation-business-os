from dataclasses import dataclass
from datetime import date
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import text
from starlette.requests import Request

from app.api.v1.hr import LeaveRequestCreate, create_leave_request
from app.db.session import SessionLocal, engine


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


def request() -> Request:
    path = "/hr/leave-requests"
    return Request({"type": "http", "method": "POST", "path": path, "raw_path": path.encode(), "headers": [], "query_string": b"", "scheme": "https", "server": ("testserver", 443), "client": ("127.0.0.1", 50000)})


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency,
                   m.id membership_id, e.id employee_id,
                   (SELECT id FROM leave_types WHERE organization_id=o.id AND is_active=true ORDER BY created_at LIMIT 1) leave_type_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            JOIN employees e ON e.organization_id=o.id AND e.membership_id=m.id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(
        str(row["organization_id"]),
        str(row["user_id"]),
        str(row["membership_id"]),
        "employee",
        Org(str(row["organization_id"]), str(row["timezone"] or "UTC"), str(row["currency"] or "BDT")),
    )
    db = SessionLocal()
    try:
        try:
            create_leave_request(
                LeaveRequestCreate(
                    employee_id=str(uuid4()),
                    leave_type_id=str(row["leave_type_id"]),
                    start_date=date(2098, 1, 10),
                    end_date=date(2098, 1, 11),
                    reason="Security regression test",
                ),
                request(),
                db,
                tenant,  # type: ignore[arg-type]
            )
        except HTTPException as exc:
            if exc.status_code != 403:
                raise AssertionError(f"Expected 403 for cross-employee self-service leave request, got {exc.status_code}") from exc
        else:
            raise AssertionError("Self-service user was allowed to request leave for another employee")
    finally:
        db.close()

    print("HR security verification passed: self-service leave cannot impersonate another employee")


if __name__ == "__main__":
    main()
