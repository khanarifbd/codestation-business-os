from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.finance import change_invoice_status, record_payment
from app.api.v1.order_commercial import (
    add_billing_milestone,
    add_change,
    billing_action,
    change_action,
    create_billing_invoice,
    get_commercial,
)
from app.api.v1.orders import change_order_status
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry
from app.models.finance import Invoice
from app.schemas.finance import InvoiceStatusAction, PaymentCreate
from app.schemas.order_commercial import (
    BillingMilestoneAction,
    BillingMilestoneCreate,
    CommercialLineInput,
    OrderChangeAction,
    OrderChangeCreate,
)
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


def expect_http_error(expected_status: int, fn, detail_contains: str | None = None) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise AssertionError(f"Expected HTTP {expected_status}, got {exc.status_code}: {exc.detail}") from exc
        if detail_contains and detail_contains.lower() not in str(exc.detail).lower():
            raise AssertionError(f"Expected error containing {detail_contains!r}, got: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {expected_status}, but request succeeded")


def line(title: str, amount: str) -> CommercialLineInput:
    return CommercialLineInput(
        item_name=title,
        item_type="service",
        unit="unit",
        description=title,
        quantity=Decimal("1"),
        unit_price=Decimal(amount),
        discount_percent=Decimal("0"),
        tax_rate=Decimal("0"),
    )


def journal_count(db, organization_id: str) -> int:
    return int(
        db.scalar(
            select(func.count(JournalEntry.id)).where(JournalEntry.organization_id == organization_id)
        )
        or 0
    )


def assert_money(actual: Decimal, expected: str, label: str) -> None:
    target = Decimal(expected)
    if Decimal(actual) != target:
        raise AssertionError(f"{label}: expected {target}, got {actual}")


def main() -> None:
    now = datetime.now(timezone.utc)
    order_id = str(uuid4())
    account_id = str(uuid4())
    order_number = f"ORD-COMM-{order_id[:8].upper()}"
    account_name = f"CI Fiverr Wallet {account_id[:8]}"

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
                SELECT id, display_name
                FROM clients
                WHERE organization_id = :organization_id
                  AND display_name = 'CI Converted Client'
                ORDER BY created_at DESC
                LIMIT 1
                """
            ),
            {"organization_id": fixture["organization_id"]},
        ).mappings().one()

        connection.execute(
            text(
                """
                INSERT INTO financial_accounts
                    (id, organization_id, name, account_type, currency, opening_balance,
                     is_active, created_by_user_id, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :name, 'payment_gateway', 'USD', 0,
                     true, :user_id, :now, :now)
                """
            ),
            {
                "id": account_id,
                "organization_id": fixture["organization_id"],
                "name": account_name,
                "user_id": fixture["user_id"],
                "now": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO orders
                    (id, organization_id, order_number, client_id, created_by_user_id,
                     source, external_order_id, status, subject, order_date, currency,
                     tax_calculation_mode, seller_name_snapshot, client_name_snapshot,
                     subtotal, discount_total, tax_total, total,
                     confirmed_at, started_at, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :order_number, :client_id, :user_id,
                     'fiverr', :external_order_id, 'in_progress', 'CI Fiverr milestone order',
                     :order_date, 'USD', 'exclusive', 'Existing Tenant Fixture', :client_name,
                     850.00, 0.00, 0.00, 850.00,
                     :now, :now, :now, :now)
                """
            ),
            {
                "id": order_id,
                "organization_id": fixture["organization_id"],
                "order_number": order_number,
                "client_id": client["id"],
                "user_id": fixture["user_id"],
                "external_order_id": f"FIVERR-CI-{order_id[:8]}",
                "order_date": date.today(),
                "client_name": client["display_name"],
                "now": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO order_items
                    (id, organization_id, order_id, sort_order,
                     item_name_snapshot, item_type_snapshot, unit_snapshot, description,
                     quantity, unit_price, discount_percent, tax_rate,
                     line_subtotal, discount_amount, taxable_amount, tax_amount, line_total,
                     created_at, updated_at)
                VALUES
                    (:id, :organization_id, :order_id, 0,
                     'Fiverr Mobile App Package', 'service', 'unit', 'Fiverr Mobile App Package',
                     1.0000, 850.0000, 0.0000, 0.0000,
                     850.00, 0.00, 850.00, 0.00, 850.00,
                     :now, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "organization_id": fixture["organization_id"],
                "order_id": order_id,
                "now": now,
            },
        )

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(timezone=str(fixture["timezone"] or "UTC")),
    )

    db = SessionLocal()
    try:
        baseline_journals = journal_count(db, tenant.organization_id)

        initial = get_commercial(order_id, db, tenant)  # type: ignore[arg-type]
        if initial.staged_billing_enabled:
            raise AssertionError("Fresh order unexpectedly has staged billing enabled")
        assert_money(initial.original_value, "850.00", "original contract")
        assert_money(initial.revised_contract_value, "850.00", "initial revised contract")

        first = add_billing_milestone(
            order_id,
            BillingMilestoneCreate(
                title="Fiverr milestone 1",
                description="First funded/delivered milestone",
                items=[line("Fiverr milestone 1", "200.00")],
            ),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/billing-milestones"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        billing_action(
            order_id,
            first.id,
            BillingMilestoneAction(action="mark_billable"),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/billing-milestones/{first.id}/action"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        invoice_result = create_billing_invoice(
            order_id,
            first.id,
            make_request("POST", f"/api/v1/sales/orders/{order_id}/billing-milestones/{first.id}/invoice"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        first_invoice_id = str(invoice_result["invoice_id"])
        change_invoice_status(
            first_invoice_id,
            InvoiceStatusAction(action="send"),
            make_request("PATCH", f"/api/v1/finance/invoices/{first_invoice_id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        record_payment(
            PaymentCreate(
                invoice_id=first_invoice_id,
                account_id=account_id,
                invoice_amount=Decimal("200.00"),
                account_amount=Decimal("200.00"),
                method="other",
                reference="FIVERR-CI-M1",
            ),
            make_request("POST", "/api/v1/finance/payments"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        after_first_payment = get_commercial(order_id, db, tenant)  # type: ignore[arg-type]
        assert_money(after_first_payment.revised_contract_value, "850.00", "contract after first milestone")
        assert_money(after_first_payment.scheduled_value, "200.00", "scheduled after first milestone")
        assert_money(after_first_payment.billed_value, "200.00", "billed after first milestone")
        assert_money(after_first_payment.paid_value, "200.00", "paid after first milestone")
        assert_money(after_first_payment.accounts_receivable, "0.00", "receivable after first payment")
        assert_money(after_first_payment.remaining_to_bill, "650.00", "unbilled contract after first payment")
        assert_money(after_first_payment.remaining_to_schedule, "650.00", "unscheduled contract after first payment")

        if journal_count(db, tenant.organization_id) != baseline_journals:
            raise AssertionError("Order Change/Billing Schedule operational flow posted accounting journals directly")

        expect_http_error(
            409,
            lambda: change_order_status(
                order_id,
                OrderStatusChange(status="completed"),
                make_request("PATCH", f"/api/v1/sales/orders/{order_id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "650.00 USD remains unscheduled",
        )
        db.rollback()

        cancellation = add_change(
            order_id,
            OrderChangeCreate(
                change_type="cancellation",
                title="Cancel remaining Fiverr milestones",
                reason="Client ended the order after the first milestone",
                items=[line("Cancelled remaining scope", "650.00")],
            ),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/changes"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        change_action(
            order_id,
            cancellation.id,
            OrderChangeAction(action="submit"),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/changes/{cancellation.id}/action"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        change_action(
            order_id,
            cancellation.id,
            OrderChangeAction(action="approve"),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/changes/{cancellation.id}/action"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        reduced = get_commercial(order_id, db, tenant)  # type: ignore[arg-type]
        assert_money(reduced.approved_change_value, "-650.00", "approved cancellation delta")
        assert_money(reduced.revised_contract_value, "200.00", "revised contract after cancellation")
        assert_money(reduced.remaining_to_bill, "0.00", "remaining to bill after cancellation")
        assert_money(reduced.remaining_to_schedule, "0.00", "remaining to schedule after cancellation")

        completed = change_order_status(
            order_id,
            OrderStatusChange(status="completed"),
            make_request("PATCH", f"/api/v1/sales/orders/{order_id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if completed.status != "completed":
            raise AssertionError("Reduced fully-billed Fiverr order did not complete")

        expect_http_error(
            409,
            lambda: add_change(
                order_id,
                OrderChangeCreate(
                    change_type="addition",
                    title="Post-completion add-on",
                    items=[line("Extra service", "300.00")],
                ),
                make_request("POST", f"/api/v1/sales/orders/{order_id}/changes"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "Reopen the completed order",
        )
        db.rollback()

        reopened = change_order_status(
            order_id,
            OrderStatusChange(status="in_progress"),
            make_request("PATCH", f"/api/v1/sales/orders/{order_id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if reopened.status != "in_progress":
            raise AssertionError("Completed order did not reopen for add-on scope")

        addition = add_change(
            order_id,
            OrderChangeCreate(
                change_type="addition",
                title="Additional service",
                reason="Client requested an extra service on the same order",
                items=[line("Additional service", "300.00")],
            ),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/changes"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        change_action(
            order_id,
            addition.id,
            OrderChangeAction(action="submit"),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/changes/{addition.id}/action"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        change_action(
            order_id,
            addition.id,
            OrderChangeAction(action="approve"),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/changes/{addition.id}/action"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        with_addon = get_commercial(order_id, db, tenant)  # type: ignore[arg-type]
        assert_money(with_addon.approved_change_value, "-350.00", "net approved changes after add-on")
        assert_money(with_addon.revised_contract_value, "500.00", "revised contract after add-on")
        assert_money(with_addon.remaining_to_bill, "300.00", "remaining to bill after add-on")
        assert_money(with_addon.remaining_to_schedule, "300.00", "remaining to schedule after add-on")

        expect_http_error(
            409,
            lambda: change_order_status(
                order_id,
                OrderStatusChange(status="completed"),
                make_request("PATCH", f"/api/v1/sales/orders/{order_id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "300.00 USD remains unscheduled",
        )
        db.rollback()

        addon_milestone = add_billing_milestone(
            order_id,
            BillingMilestoneCreate(
                title="Additional service milestone",
                description="Billing for approved add-on",
                order_change_id=addition.id,
                items=[line("Additional service", "300.00")],
            ),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/billing-milestones"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        billing_action(
            order_id,
            addon_milestone.id,
            BillingMilestoneAction(action="mark_billable"),
            make_request("POST", f"/api/v1/sales/orders/{order_id}/billing-milestones/{addon_milestone.id}/action"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        addon_invoice_result = create_billing_invoice(
            order_id,
            addon_milestone.id,
            make_request("POST", f"/api/v1/sales/orders/{order_id}/billing-milestones/{addon_milestone.id}/invoice"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        addon_invoice_id = str(addon_invoice_result["invoice_id"])

        expect_http_error(
            409,
            lambda: change_order_status(
                order_id,
                OrderStatusChange(status="completed"),
                make_request("PATCH", f"/api/v1/sales/orders/{order_id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
            "300.00 USD is still in draft invoice",
        )
        db.rollback()

        change_invoice_status(
            addon_invoice_id,
            InvoiceStatusAction(action="send"),
            make_request("PATCH", f"/api/v1/finance/invoices/{addon_invoice_id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        final_summary = get_commercial(order_id, db, tenant)  # type: ignore[arg-type]
        assert_money(final_summary.revised_contract_value, "500.00", "final revised contract")
        assert_money(final_summary.scheduled_value, "500.00", "final scheduled value")
        assert_money(final_summary.billed_value, "500.00", "final billed value")
        assert_money(final_summary.paid_value, "200.00", "final paid value")
        assert_money(final_summary.accounts_receivable, "300.00", "final accounts receivable")
        assert_money(final_summary.remaining_to_bill, "0.00", "final remaining to bill")
        assert_money(final_summary.remaining_to_schedule, "0.00", "final remaining to schedule")

        active_invoice_count = db.scalar(
            select(func.count(Invoice.id)).where(
                Invoice.organization_id == tenant.organization_id,
                Invoice.order_id == order_id,
                Invoice.status != "cancelled",
            )
        ) or 0
        if int(active_invoice_count) != 2:
            raise AssertionError(f"Expected two active milestone invoices, got {active_invoice_count}")

        completed_with_receivable = change_order_status(
            order_id,
            OrderStatusChange(status="completed"),
            make_request("PATCH", f"/api/v1/sales/orders/{order_id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if completed_with_receivable.status != "completed":
            raise AssertionError("Fully billed order with valid receivable did not complete")

        wrong_tenant = FixtureTenant(
            organization_id=str(uuid4()),
            user_id=tenant.user_id,
            organization=tenant.organization,
        )
        expect_http_error(
            404,
            lambda: get_commercial(order_id, db, wrong_tenant),  # type: ignore[arg-type]
            "Order not found",
        )
        db.rollback()

        if journal_count(db, tenant.organization_id) != baseline_journals:
            raise AssertionError("Commercial workflow unexpectedly posted accounting journals before accounting sync")
    finally:
        db.close()

    print("order commercial staged billing verification passed")


if __name__ == "__main__":
    main()
