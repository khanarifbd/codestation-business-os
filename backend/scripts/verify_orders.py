from dataclasses import dataclass
from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.orders import create_order_from_quotation, change_order_status
from app.db.session import SessionLocal, engine
from app.models.orders import Order, OrderItem
from app.schemas.orders import OrderStatusChange


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


def main() -> None:
    now = datetime.now(timezone.utc)
    accepted_quotation_id = str(uuid4())
    sent_quotation_id = str(uuid4())
    accepted_item_id = str(uuid4())
    sent_item_id = str(uuid4())

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
        client = connection.execute(
            text(
                """
                SELECT id
                FROM clients
                WHERE organization_id = :organization_id
                  AND display_name = 'CI Converted Client'
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {"organization_id": fixture["organization_id"]},
        ).mappings().one()

        sequence = connection.execute(
            text(
                "SELECT prefix FROM organization_document_sequences "
                "WHERE organization_id = :organization_id AND document_type = 'order'"
            ),
            {"organization_id": fixture["organization_id"]},
        ).scalar_one()
        if sequence != "ORD":
            raise AssertionError(f"order sequence prefix mismatch: {sequence}")

        quotation_sql = text(
            """
            INSERT INTO quotations
                (id, organization_id, quotation_number, client_id, created_by_user_id,
                 status, subject, issue_date, currency, tax_calculation_mode,
                 seller_name_snapshot, client_name_snapshot,
                 subtotal, discount_total, tax_total, total,
                 sent_at, accepted_at, created_at, updated_at)
            VALUES
                (:id, :organization_id, :quotation_number, :client_id, :user_id,
                 :status, 'CI Order Flow', :issue_date, 'USD', 'exclusive',
                 'Existing Tenant Fixture', 'CI Converted Client',
                 200.00, 20.00, 27.00, 207.00,
                 :sent_at, :accepted_at, :now, :now)
            """
        )
        connection.execute(
            quotation_sql,
            {
                "id": accepted_quotation_id,
                "organization_id": fixture["organization_id"],
                "quotation_number": f"QUO-CI-{accepted_quotation_id[:8]}",
                "client_id": client["id"],
                "user_id": fixture["user_id"],
                "status": "accepted",
                "issue_date": date.today(),
                "sent_at": now,
                "accepted_at": now,
                "now": now,
            },
        )
        connection.execute(
            quotation_sql,
            {
                "id": sent_quotation_id,
                "organization_id": fixture["organization_id"],
                "quotation_number": f"QUO-CI-{sent_quotation_id[:8]}",
                "client_id": client["id"],
                "user_id": fixture["user_id"],
                "status": "sent",
                "issue_date": date.today(),
                "sent_at": now,
                "accepted_at": None,
                "now": now,
            },
        )

        item_sql = text(
            """
            INSERT INTO quotation_items
                (id, organization_id, quotation_id, sort_order, description,
                 quantity, unit_price, discount_percent, tax_rate,
                 line_subtotal, discount_amount, taxable_amount, tax_amount, line_total,
                 created_at, updated_at)
            VALUES
                (:id, :organization_id, :quotation_id, 0, 'CI Service',
                 2.0000, 100.0000, 10.0000, 15.0000,
                 200.00, 20.00, 180.00, 27.00, 207.00,
                 :now, :now)
            """
        )
        connection.execute(item_sql, {"id": accepted_item_id, "organization_id": fixture["organization_id"], "quotation_id": accepted_quotation_id, "now": now})
        connection.execute(item_sql, {"id": sent_item_id, "organization_id": fixture["organization_id"], "quotation_id": sent_quotation_id, "now": now})

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(timezone=str(fixture["timezone"] or "UTC")),
    )
    db = SessionLocal()
    try:
        expect_http_error(
            409,
            lambda: create_order_from_quotation(
                sent_quotation_id,
                make_request("POST", f"/api/v1/sales/orders/from-quotation/{sent_quotation_id}"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        created = create_order_from_quotation(
            accepted_quotation_id,
            make_request("POST", f"/api/v1/sales/orders/from-quotation/{accepted_quotation_id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if created.status != "confirmed" or not created.order_number.startswith("ORD-"):
            raise AssertionError("Accepted quotation did not create a confirmed numbered order")
        if created.total != 207 or len(created.items) != 1:
            raise AssertionError("Order did not preserve quotation totals and line items")

        order = db.scalar(select(Order).where(Order.id == created.id))
        if order is None or order.quotation_id != accepted_quotation_id:
            raise AssertionError("Order source quotation link was not persisted")
        copied_item = db.scalar(select(OrderItem).where(OrderItem.order_id == created.id))
        if copied_item is None or copied_item.quotation_item_id != accepted_item_id:
            raise AssertionError("Order item source quotation item link was not persisted")

        expect_http_error(
            409,
            lambda: create_order_from_quotation(
                accepted_quotation_id,
                make_request("POST", f"/api/v1/sales/orders/from-quotation/{accepted_quotation_id}"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        started = change_order_status(
            created.id,
            OrderStatusChange(status="in_progress"),
            make_request("PATCH", f"/api/v1/sales/orders/{created.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if started.status != "in_progress" or started.started_at is None:
            raise AssertionError("Confirmed order did not start correctly")
        original_started_at = started.started_at

        completed = change_order_status(
            created.id,
            OrderStatusChange(status="completed"),
            make_request("PATCH", f"/api/v1/sales/orders/{created.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if completed.status != "completed" or completed.completed_at is None:
            raise AssertionError("In-progress order did not complete correctly")

        expect_http_error(
            409,
            lambda: change_order_status(
                created.id,
                OrderStatusChange(status="cancelled"),
                make_request("PATCH", f"/api/v1/sales/orders/{created.id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        reopened = change_order_status(
            created.id,
            OrderStatusChange(status="in_progress"),
            make_request("PATCH", f"/api/v1/sales/orders/{created.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if reopened.status != "in_progress":
            raise AssertionError("Completed order did not reopen correctly")
        if reopened.completed_at is not None:
            raise AssertionError("Reopened order retained a completed timestamp")
        if reopened.started_at != original_started_at:
            raise AssertionError("Reopening an order must preserve the original start timestamp")

        recompleted = change_order_status(
            created.id,
            OrderStatusChange(status="completed"),
            make_request("PATCH", f"/api/v1/sales/orders/{created.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if recompleted.status != "completed" or recompleted.completed_at is None:
            raise AssertionError("Reopened order could not be completed again")
    finally:
        db.close()

    print("accepted quotation order-flow verification passed")


if __name__ == "__main__":
    main()
