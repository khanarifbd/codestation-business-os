from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.orders import change_order_status, create_order_from_quotation
from app.api.v1.projects import change_project_status, create_project_from_order, update_project_team
from app.db.session import SessionLocal, engine
from app.models.projects import Project
from app.schemas.orders import OrderStatusChange
from app.schemas.projects import ProjectCreateFromOrder, ProjectStatusChange, ProjectTeamUpdate


@dataclass(frozen=True)
class FixtureOrganization:
    timezone: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def make_request(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 50000),
        }
    )


def expect_http_error(expected_status: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise AssertionError(f"Expected HTTP {expected_status}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {expected_status}, but request succeeded")


def seed_accepted_quotation(connection, *, organization_id: str, user_id: str, client_id: str, now: datetime) -> str:
    quotation_id = str(uuid4())
    item_id = str(uuid4())
    connection.execute(
        text(
            """
            INSERT INTO quotations
                (id, organization_id, quotation_number, client_id, created_by_user_id,
                 status, subject, issue_date, currency, tax_calculation_mode,
                 seller_name_snapshot, client_name_snapshot,
                 subtotal, discount_total, tax_total, total,
                 sent_at, accepted_at, created_at, updated_at)
            VALUES
                (:id, :organization_id, :quotation_number, :client_id, :user_id,
                 'accepted', 'CI Project Delivery', :issue_date, 'USD', 'exclusive',
                 'Existing Tenant Fixture', 'CI Converted Client',
                 500.00, 0.00, 0.00, 500.00,
                 :now, :now, :now, :now)
            """
        ),
        {
            "id": quotation_id,
            "organization_id": organization_id,
            "quotation_number": f"QUO-PROJ-{quotation_id[:8]}",
            "client_id": client_id,
            "user_id": user_id,
            "issue_date": date.today(),
            "now": now,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO quotation_items
                (id, organization_id, quotation_id, sort_order,
                 item_name_snapshot, item_type_snapshot, unit_snapshot, description,
                 quantity, unit_price, discount_percent, tax_rate,
                 line_subtotal, discount_amount, taxable_amount, tax_amount, line_total,
                 created_at, updated_at)
            VALUES
                (:id, :organization_id, :quotation_id, 0,
                 'CI Project Service', 'service', 'project', 'CI Project Service',
                 1.0000, 500.0000, 0.0000, 0.0000,
                 500.00, 0.00, 500.00, 0.00, 500.00,
                 :now, :now)
            """
        ),
        {"id": item_id, "organization_id": organization_id, "quotation_id": quotation_id, "now": now},
    )
    return quotation_id


def main() -> None:
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        fixture = connection.execute(
            text(
                """
                SELECT o.id AS organization_id, o.created_by_user_id AS user_id, o.timezone AS timezone
                FROM organizations o
                WHERE o.name = 'Existing Tenant Fixture'
                ORDER BY o.created_at DESC
                LIMIT 1
                """
            )
        ).mappings().one()
        client_id = connection.execute(
            text(
                """
                SELECT id FROM clients
                WHERE organization_id = :organization_id AND display_name = 'CI Converted Client'
                ORDER BY created_at DESC LIMIT 1
                """
            ),
            {"organization_id": fixture["organization_id"]},
        ).scalar_one()
        project_prefix = connection.execute(
            text(
                "SELECT prefix FROM organization_document_sequences "
                "WHERE organization_id = :organization_id AND document_type = 'project'"
            ),
            {"organization_id": fixture["organization_id"]},
        ).scalar_one()
        if project_prefix != "PRJ":
            raise AssertionError(f"project sequence prefix mismatch: {project_prefix}")
        for table_name in ("projects", "project_members"):
            exists = connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"}).scalar_one()
            if not exists:
                raise AssertionError(f"missing table: {table_name}")
        quotation_id = seed_accepted_quotation(
            connection,
            organization_id=str(fixture["organization_id"]),
            user_id=str(fixture["user_id"]),
            client_id=str(client_id),
            now=now,
        )
        second_quotation_id = seed_accepted_quotation(
            connection,
            organization_id=str(fixture["organization_id"]),
            user_id=str(fixture["user_id"]),
            client_id=str(client_id),
            now=now,
        )

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(timezone=str(fixture["timezone"] or "UTC")),
    )
    db = SessionLocal()
    try:
        order = create_order_from_quotation(
            quotation_id,
            make_request("POST", f"/api/v1/sales/orders/from-quotation/{quotation_id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        project = create_project_from_order(
            order.id,
            ProjectCreateFromOrder(
                name="CI Delivery Project",
                priority="high",
                planned_start_date=date.today(),
                member_employee_ids=[],
            ),
            make_request("POST", f"/api/v1/projects/from-order/{order.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if project.status != "planned" or not project.project_number.startswith("PRJ-"):
            raise AssertionError("Confirmed order did not create a planned numbered project")
        if project.contract_value != 500 or project.order_id != order.id or project.quotation_id != quotation_id:
            raise AssertionError("Project did not preserve order commercial links/value")

        expect_http_error(
            409,
            lambda: create_project_from_order(
                order.id,
                ProjectCreateFromOrder(name="Duplicate Project"),
                make_request("POST", f"/api/v1/projects/from-order/{order.id}"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        active = change_project_status(
            project.id,
            ProjectStatusChange(status="active"),
            make_request("PATCH", f"/api/v1/projects/{project.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if active.status != "active" or active.actual_started_at is None:
            raise AssertionError("Planned project did not start correctly")

        held = change_project_status(
            project.id,
            ProjectStatusChange(status="on_hold"),
            make_request("PATCH", f"/api/v1/projects/{project.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if held.status != "on_hold":
            raise AssertionError("Active project did not move on hold")

        resumed = change_project_status(
            project.id,
            ProjectStatusChange(status="active"),
            make_request("PATCH", f"/api/v1/projects/{project.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if resumed.status != "active":
            raise AssertionError("On-hold project did not resume")

        completed = change_project_status(
            project.id,
            ProjectStatusChange(status="completed"),
            make_request("PATCH", f"/api/v1/projects/{project.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if completed.status != "completed" or completed.completed_at is None:
            raise AssertionError("Active project did not complete")

        expect_http_error(
            409,
            lambda: update_project_team(
                project.id,
                ProjectTeamUpdate(project_manager_employee_id=None, member_employee_ids=[]),
                make_request("PUT", f"/api/v1/projects/{project.id}/team"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        second_order = create_order_from_quotation(
            second_quotation_id,
            make_request("POST", f"/api/v1/sales/orders/from-quotation/{second_quotation_id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        started_order = change_order_status(
            second_order.id,
            OrderStatusChange(status="in_progress"),
            make_request("PATCH", f"/api/v1/sales/orders/{second_order.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        active_project = create_project_from_order(
            started_order.id,
            ProjectCreateFromOrder(name="CI Already Started Project"),
            make_request("POST", f"/api/v1/projects/from-order/{started_order.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if active_project.status != "active" or active_project.actual_started_at is None:
            raise AssertionError("In-progress order did not create an active project")

        persisted = db.scalar(select(Project).where(Project.id == active_project.id))
        if persisted is None:
            raise AssertionError("Project row was not persisted")
    finally:
        db.close()

    print("order to project workflow verification passed")


if __name__ == "__main__":
    main()