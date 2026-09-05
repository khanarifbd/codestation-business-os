from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.finance import Invoice
from app.models.order_billing_invoice import OrderBillingInvoiceLink
from app.models.order_commercial import OrderBillingMilestone, OrderChange
from app.models.orders import Order

MONEY = Decimal("0.01")


def _money(value: Decimal | int | str | None) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _effective_change_delta(change: OrderChange) -> Decimal:
    total = _money(change.total)
    return total if change.change_type == "addition" else -total


def _staged_billing_enabled(db, order: Order) -> bool:
    milestone_exists = db.scalar(
        select(OrderBillingMilestone.id)
        .where(
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
        )
        .limit(1)
    )
    if milestone_exists:
        return True
    change_exists = db.scalar(
        select(OrderChange.id)
        .where(
            OrderChange.organization_id == order.organization_id,
            OrderChange.order_id == order.id,
        )
        .limit(1)
    )
    return bool(change_exists)


def assert_order_can_complete(db, order: Order) -> None:
    """Protect staged-billing orders from completing with unfinished commercial work.

    Legacy orders without Order Changes or Billing Milestones keep the existing
    completion behavior. Payment collection is intentionally not required: an
    order may be operationally complete while its correctly issued invoices are
    still receivable.
    """
    if not _staged_billing_enabled(db, order):
        return

    pending_change_count = db.scalar(
        select(func.count(OrderChange.id)).where(
            OrderChange.organization_id == order.organization_id,
            OrderChange.order_id == order.id,
            OrderChange.status == "pending",
        )
    ) or 0
    if pending_change_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"{pending_change_count} order change(s) are still pending approval. "
                "Approve or reject them before completion."
            ),
        )

    approved_changes = db.scalars(
        select(OrderChange).where(
            OrderChange.organization_id == order.organization_id,
            OrderChange.order_id == order.id,
            OrderChange.status == "approved",
        )
    ).all()
    approved_delta = sum((_effective_change_delta(change) for change in approved_changes), Decimal("0"))
    revised_contract = _money(Decimal(order.total) + approved_delta)
    if revised_contract < 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot complete order because the revised contract value is negative.",
        )

    milestones = db.scalars(
        select(OrderBillingMilestone).where(
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
            OrderBillingMilestone.status != "cancelled",
        )
    ).all()
    scheduled = _money(sum((Decimal(item.amount) for item in milestones), Decimal("0")))

    if scheduled < revised_contract:
        remaining = _money(revised_contract - scheduled)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"{remaining} {order.currency} remains unscheduled. "
                "Complete the Billing Schedule first."
            ),
        )
    if scheduled > revised_contract:
        excess = _money(scheduled - revised_contract)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"Billing Schedule exceeds the revised contract by {excess} {order.currency}. "
                "Correct or cancel billing milestones first."
            ),
        )

    active_invoices = db.scalars(
        select(Invoice).where(
            Invoice.organization_id == order.organization_id,
            Invoice.order_id == order.id,
            Invoice.status != "cancelled",
        )
    ).all()
    draft_total = _money(
        sum((Decimal(invoice.total) for invoice in active_invoices if invoice.status == "draft"), Decimal("0"))
    )
    billed_total = _money(
        sum((Decimal(invoice.total) for invoice in active_invoices if invoice.status != "draft"), Decimal("0"))
    )
    committed_invoice_total = _money(billed_total + draft_total)

    if committed_invoice_total > revised_contract:
        excess = _money(committed_invoice_total - revised_contract)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"active invoice commitments exceed the revised contract by {excess} {order.currency}. "
                "Correct or cancel the excess invoice before completion."
            ),
        )

    if draft_total > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"{draft_total} {order.currency} is still in draft invoice(s). "
                "Issue/send or cancel the draft invoice(s) before completion."
            ),
        )

    if billed_total < revised_contract:
        remaining = _money(revised_contract - billed_total)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"{remaining} {order.currency} remains unbilled. "
                "Create and issue the remaining milestone invoice(s) first."
            ),
        )
    if billed_total > revised_contract:
        excess = _money(billed_total - revised_contract)
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"billed value exceeds the revised contract by {excess} {order.currency}. "
                "Correct the invoices before completion."
            ),
        )

    for milestone in milestones:
        linked_issued_invoice = db.scalar(
            select(Invoice.id)
            .join(OrderBillingInvoiceLink, OrderBillingInvoiceLink.invoice_id == Invoice.id)
            .where(
                OrderBillingInvoiceLink.organization_id == order.organization_id,
                OrderBillingInvoiceLink.billing_milestone_id == milestone.id,
                Invoice.organization_id == order.organization_id,
                Invoice.order_id == order.id,
                Invoice.status.not_in(["draft", "cancelled"]),
            )
            .limit(1)
        )
        if linked_issued_invoice is None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot complete staged-billing order {order.order_number}: "
                    f"billing milestone '{milestone.title}' does not have an issued active invoice. "
                    "Create and issue its invoice before completion."
                ),
            )
