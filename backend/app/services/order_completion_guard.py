from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.finance import Invoice
from app.models.order_billing_invoice import OrderBillingInvoiceLink
from app.models.order_commercial import OrderBillingMilestone, OrderChange
from app.models.orders import Order
from app.services.order_commercial import commercial_values, staged_billing_enabled


def assert_order_can_complete(db, order: Order) -> None:
    """Protect staged-billing orders from completing with unfinished commercial work.

    Legacy orders without Order Changes or Billing Milestones keep the existing
    completion behavior. Payment collection is intentionally not required: an
    order may be operationally complete while its correctly issued invoices are
    still receivable.
    """
    if not staged_billing_enabled(db, order.organization_id, order.id):
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

    values = commercial_values(db, order)
    revised_contract = values["revised"]
    scheduled = values["scheduled"]
    draft_total = values["drafts"]
    billed_total = values["billed"]

    if revised_contract < 0:
        raise HTTPException(status_code=409, detail="Cannot complete order because the revised contract value is negative.")

    if scheduled < revised_contract:
        remaining = revised_contract - scheduled
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"{remaining} {order.currency} remains unscheduled. "
                "Complete the Billing Schedule first."
            ),
        )
    if scheduled > revised_contract:
        excess = scheduled - revised_contract
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"commercial commitments exceed the revised contract by {excess} {order.currency}. "
                "Correct legacy invoices or cancel/reduce billing milestones first."
            ),
        )

    committed_invoice_total = billed_total + draft_total
    if committed_invoice_total > revised_contract:
        excess = committed_invoice_total - revised_contract
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
        remaining = revised_contract - billed_total
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"{remaining} {order.currency} remains unbilled. "
                "Create and issue the remaining milestone invoice(s) first."
            ),
        )
    if billed_total > revised_contract:
        excess = billed_total - revised_contract
        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot complete staged-billing order {order.order_number}: "
                f"billed value exceeds the revised contract by {excess} {order.currency}. "
                "Correct the invoices before completion."
            ),
        )

    milestones = db.scalars(
        select(OrderBillingMilestone).where(
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
            OrderBillingMilestone.status != "cancelled",
        )
    ).all()
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
