from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import func, select, text
from starlette.requests import Request

from app.api.v1.orders import create_order_from_quotation
from app.api.v1.quotation_v2 import update_commercial_quotation
from app.api.v1.sales import change_quotation_status, create_quotation
from app.db.session import SessionLocal, engine
from app.models.finance import InvoiceItem
from app.models.order_commercial import OrderBillingMilestone, OrderBillingMilestoneItem
from app.models.orders import Order, OrderItem
from app.models.sales import QuotationMilestone, QuotationPaymentMilestone
from app.schemas.quotation_v2 import (
    QuotationCommercialUpdate,
    QuotationMilestoneInput,
    QuotationPaymentMilestoneInput,
)
from app.schemas.sales import QuotationCreate, QuotationItemInput, QuotationStatusChange
from app.services.order_commercial import act_on_billing_milestone, commercial_summary, create_milestone_invoice


@dataclass(frozen=True)
class Org:
    id: str
    currency: str
    timezone: str
    name: str = "Existing Tenant Fixture"
    country_code: str | None = "BD"


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    organization: Org
    role: str = "admin"


def req(method: str, path: str) -> Request:
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


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"))


def main() -> None:
    marker = uuid4().hex[:8].upper()
    client_id = str(uuid4())
    now = datetime.now(timezone.utc)

    with engine.begin() as connection:
        fixture = connection.execute(
            text(
                """
                SELECT o.id organization_id, o.created_by_user_id user_id, o.currency, o.timezone,
                       (
                           SELECT m.id
                           FROM memberships m
                           WHERE m.organization_id = o.id
                           ORDER BY m.created_at ASC
                           LIMIT 1
                       ) membership_id
                FROM organizations o
                WHERE o.name = 'Existing Tenant Fixture'
                ORDER BY o.created_at DESC
                LIMIT 1
                """
            )
        ).mappings().one()
        currency = str(fixture["currency"] or "BDT").upper()
        connection.execute(
            text(
                """
                INSERT INTO clients
                    (id, organization_id, client_code, client_type, display_name, currency, status, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :code, 'company', :name, :currency, 'active', :now, :now)
                """
            ),
            {
                "id": client_id,
                "organization_id": fixture["organization_id"],
                "code": f"QB-{marker}",
                "name": f"Quotation Billing Client {marker}",
                "currency": currency,
                "now": now,
            },
        )

    tenant = Tenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        membership_id=str(fixture["membership_id"] or uuid4()),
        organization=Org(
            id=str(fixture["organization_id"]),
            currency=currency,
            timezone=str(fixture["timezone"] or "UTC"),
        ),
    )

    db = SessionLocal()
    try:
        quotation = create_quotation(
            QuotationCreate(
                client_id=client_id,
                subject="Quotation V2 staged billing conversion",
                issue_date=date.today(),
                currency=currency,
                tax_calculation_mode="exclusive",
                items=[
                    QuotationItemInput(
                        item_name="Implementation foundation",
                        item_type="service",
                        unit="project",
                        description="Implementation foundation",
                        quantity=Decimal("1"),
                        unit_price=Decimal("600"),
                        discount_percent=Decimal("0"),
                        tax_rate=Decimal("0"),
                    ),
                    QuotationItemInput(
                        item_name="Launch package",
                        item_type="service",
                        unit="project",
                        description="Launch package with discount and tax",
                        quantity=Decimal("1"),
                        unit_price=Decimal("400"),
                        discount_percent=Decimal("10"),
                        tax_rate=Decimal("10"),
                    ),
                ],
            ),
            req("POST", "/sales/quotations"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if money(quotation.total) != Decimal("996.00"):
            raise AssertionError(f"unexpected quotation total: {quotation.total}")

        commercial = update_commercial_quotation(
            quotation.id,
            QuotationCommercialUpdate(
                milestones=[
                    QuotationMilestoneInput(
                        title="Prototype approval",
                        description="Client approves prototype before the second phase",
                    )
                ],
                payment_milestones=[
                    QuotationPaymentMilestoneInput(
                        quotation_milestone_index=0,
                        title="Advance",
                        description="Project kickoff payment",
                        payment_type="percentage",
                        percentage=Decimal("30"),
                        due_condition="Due on acceptance",
                    ),
                    QuotationPaymentMilestoneInput(
                        title="Prototype payment",
                        payment_type="percentage",
                        percentage=Decimal("40"),
                        due_condition="Due after prototype approval",
                    ),
                    QuotationPaymentMilestoneInput(
                        title="Final payment",
                        payment_type="percentage",
                        percentage=Decimal("30"),
                        due_condition="Due before production handover",
                    ),
                ],
            ),
            req("PATCH", f"/sales/quotations/{quotation.id}/commercial"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        expected_amounts = [Decimal("298.80"), Decimal("398.40"), Decimal("298.80")]
        if [money(item.amount) for item in commercial.payment_milestones] != expected_amounts:
            raise AssertionError(f"unexpected quotation payment schedule: {commercial.payment_milestones}")

        sent = change_quotation_status(
            quotation.id,
            QuotationStatusChange(status="sent"),
            req("PATCH", f"/sales/quotations/{quotation.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        accepted = change_quotation_status(
            sent.id,
            QuotationStatusChange(status="accepted"),
            req("PATCH", f"/sales/quotations/{sent.id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )

        order_detail = create_order_from_quotation(
            accepted.id,
            req("POST", f"/sales/orders/from-quotation/{accepted.id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        order = db.scalar(
            select(Order).where(Order.id == order_detail.id, Order.organization_id == tenant.organization_id)
        )
        if order is None:
            raise AssertionError("created order could not be loaded")

        payments = db.scalars(
            select(QuotationPaymentMilestone)
            .where(
                QuotationPaymentMilestone.organization_id == tenant.organization_id,
                QuotationPaymentMilestone.quotation_id == accepted.id,
            )
            .order_by(QuotationPaymentMilestone.sort_order, QuotationPaymentMilestone.created_at)
        ).all()
        quotation_delivery = db.scalar(
            select(QuotationMilestone).where(
                QuotationMilestone.organization_id == tenant.organization_id,
                QuotationMilestone.quotation_id == accepted.id,
            )
        )
        billing = db.scalars(
            select(OrderBillingMilestone)
            .where(
                OrderBillingMilestone.organization_id == tenant.organization_id,
                OrderBillingMilestone.order_id == order.id,
            )
            .order_by(OrderBillingMilestone.sort_order, OrderBillingMilestone.created_at)
        ).all()
        if len(billing) != 3:
            raise AssertionError(f"expected 3 order billing milestones, got {len(billing)}")
        if [money(item.amount) for item in billing] != expected_amounts:
            raise AssertionError(f"order billing schedule amounts changed: {billing}")
        if [item.source_quotation_payment_milestone_id for item in billing] != [item.id for item in payments]:
            raise AssertionError("quotation payment milestone lineage was not preserved")
        if quotation_delivery is None or billing[0].source_quotation_milestone_id != quotation_delivery.id:
            raise AssertionError("quotation delivery milestone linkage was not carried to the order schedule")
        if billing[0].source_payment_type != "percentage" or Decimal(billing[0].source_percentage or 0) != Decimal("30"):
            raise AssertionError("payment type/percentage snapshot was not preserved")
        if billing[0].due_condition != "Due on acceptance":
            raise AssertionError("payment due condition was not preserved")

        order_items = db.scalars(
            select(OrderItem)
            .where(OrderItem.organization_id == tenant.organization_id, OrderItem.order_id == order.id)
            .order_by(OrderItem.sort_order, OrderItem.created_at)
        ).all()
        if len(order_items) != 2:
            raise AssertionError("order item conversion changed")

        for milestone in billing:
            allocated_total = db.scalar(
                select(func.coalesce(func.sum(OrderBillingMilestoneItem.line_total), 0)).where(
                    OrderBillingMilestoneItem.organization_id == tenant.organization_id,
                    OrderBillingMilestoneItem.billing_milestone_id == milestone.id,
                )
            ) or Decimal("0")
            if money(allocated_total) != money(milestone.amount):
                raise AssertionError(
                    f"billing milestone {milestone.title} item allocation {allocated_total} != {milestone.amount}"
                )

        for item in order_items:
            allocated = db.execute(
                select(
                    func.coalesce(func.sum(OrderBillingMilestoneItem.line_total), 0),
                    func.coalesce(func.sum(OrderBillingMilestoneItem.discount_amount), 0),
                    func.coalesce(func.sum(OrderBillingMilestoneItem.tax_amount), 0),
                ).where(
                    OrderBillingMilestoneItem.organization_id == tenant.organization_id,
                    OrderBillingMilestoneItem.source_order_item_id == item.id,
                )
            ).one()
            if money(allocated[0]) != money(item.line_total):
                raise AssertionError("billing allocation did not preserve order item total")
            if money(allocated[1]) != money(item.discount_amount):
                raise AssertionError("billing allocation did not preserve order item discount")
            if money(allocated[2]) != money(item.tax_amount):
                raise AssertionError("billing allocation did not preserve order item tax")

        summary = commercial_summary(db, tenant.organization_id, order.id)
        if not summary.staged_billing_enabled:
            raise AssertionError("quotation payment schedule did not enable staged billing")
        if money(summary.scheduled_value) != Decimal("996.00") or money(summary.remaining_to_schedule) != Decimal("0.00"):
            raise AssertionError(f"order billing summary is not fully scheduled: {summary}")

        first = act_on_billing_milestone(
            db,
            order,
            billing[0].id,
            "mark_billable",
            tenant.user_id,
            req("POST", f"/sales/orders/{order.id}/billing-milestones/{billing[0].id}/action"),
        )
        if first.status != "billable":
            raise AssertionError("converted billing milestone could not become billable")
        invoice = create_milestone_invoice(
            db,
            order,
            billing[0].id,
            tenant.user_id,
            req("POST", f"/sales/orders/{order.id}/billing-milestones/{billing[0].id}/invoice"),
        )
        if money(invoice.total) != Decimal("298.80"):
            raise AssertionError(f"converted billing milestone invoice total changed: {invoice.total}")
        invoice_line_total = db.scalar(
            select(func.coalesce(func.sum(InvoiceItem.line_total), 0)).where(
                InvoiceItem.organization_id == tenant.organization_id,
                InvoiceItem.invoice_id == invoice.id,
            )
        ) or Decimal("0")
        if money(invoice_line_total) != money(invoice.total):
            raise AssertionError("converted milestone invoice lines do not reconcile to invoice total")

        print(
            "quotation -> order staged billing verification passed: "
            "accepted payment schedule -> lineage-preserving billing milestones -> prorated invoice"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
