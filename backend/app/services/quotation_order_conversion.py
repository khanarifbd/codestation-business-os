from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.order_commercial import OrderBillingMilestone, OrderBillingMilestoneItem
from app.models.orders import Order, OrderItem
from app.models.sales import Quotation, QuotationPaymentMilestone

MONEY = Decimal("0.01")
PRICE = Decimal("0.0001")
ONE = Decimal("1.0000")


def _money(value: Decimal | int | str | None) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _split_component(
    total_component: Decimal,
    *,
    line_total: Decimal,
    line_allocations: list[Decimal],
    schedule_amounts: list[Decimal],
    order_total: Decimal,
) -> list[Decimal]:
    """Split a non-negative line component while preserving the exact source total.

    Discount and tax need their own residual-aware split so staged invoices add
    back to the accepted quotation exactly. For zero-value lines (for example a
    100% discounted item), the payment-schedule ratio is used instead.
    """

    total_component = _money(total_component)
    if not line_allocations:
        return []

    remaining = total_component
    shares: list[Decimal] = []
    for index, allocated_total in enumerate(line_allocations):
        if index == len(line_allocations) - 1:
            share = remaining
        elif line_total != 0:
            share = _money(total_component * allocated_total / line_total)
        elif order_total != 0:
            share = _money(total_component * schedule_amounts[index] / order_total)
        else:
            share = Decimal("0.00")
        share = min(max(share, Decimal("0.00")), remaining)
        shares.append(share)
        remaining = _money(remaining - share)

    if _money(sum(shares, Decimal("0"))) != total_component:
        raise HTTPException(status_code=409, detail="Could not preserve quotation line allocation totals")
    return shares


def _adjust_to_target(
    allocations: list[Decimal],
    remaining: list[Decimal],
    target: Decimal,
) -> list[Decimal]:
    """Move rounding cents without exceeding each source line's remaining value."""

    target = _money(target)
    current = _money(sum(allocations, Decimal("0")))
    diff = _money(target - current)
    if diff == 0:
        return allocations

    if diff > 0:
        for index in sorted(range(len(allocations)), key=lambda i: remaining[i] - allocations[i], reverse=True):
            capacity = _money(remaining[index] - allocations[index])
            if capacity <= 0:
                continue
            addition = min(capacity, diff)
            allocations[index] = _money(allocations[index] + addition)
            diff = _money(diff - addition)
            if diff == 0:
                break
    else:
        needed = -diff
        for index in sorted(range(len(allocations)), key=lambda i: allocations[i], reverse=True):
            removable = allocations[index]
            if removable <= 0:
                continue
            reduction = min(removable, needed)
            allocations[index] = _money(allocations[index] - reduction)
            needed = _money(needed - reduction)
            if needed == 0:
                break
        diff = -needed

    if diff != 0:
        raise HTTPException(status_code=409, detail="Could not reconcile quotation payment milestone rounding")
    if _money(sum(allocations, Decimal("0"))) != target:
        raise HTTPException(status_code=409, detail="Quotation payment milestone allocation does not match its amount")
    return allocations


def _allocate_line_totals(
    order_items: list[OrderItem],
    schedule_amounts: list[Decimal],
    order_total: Decimal,
) -> list[list[Decimal]]:
    if not schedule_amounts:
        return []

    remaining = [_money(item.line_total) for item in order_items]
    matrix: list[list[Decimal]] = []
    for milestone_index, target in enumerate(schedule_amounts):
        target = _money(target)
        if milestone_index == len(schedule_amounts) - 1:
            allocations = remaining.copy()
        elif order_total == 0:
            allocations = [Decimal("0.00") for _ in order_items]
        else:
            allocations = [
                min(_money(_money(item.line_total) * target / order_total), remaining[index])
                for index, item in enumerate(order_items)
            ]
            allocations = _adjust_to_target(allocations, remaining, target)

        if _money(sum(allocations, Decimal("0"))) != target:
            raise HTTPException(
                status_code=409,
                detail=f"Quotation payment milestone {milestone_index + 1} cannot be reconciled to order lines",
            )
        matrix.append(allocations)
        remaining = [_money(value - allocations[index]) for index, value in enumerate(remaining)]

    if any(value != 0 for value in remaining):
        raise HTTPException(status_code=409, detail="Quotation payment schedule did not allocate the full order value")
    return matrix


def seed_order_billing_from_quotation(
    db: Session,
    *,
    quotation: Quotation,
    order: Order,
    user_id: str,
) -> list[OrderBillingMilestone]:
    """Convert an accepted quotation's payment plan into an operational billing schedule.

    The accepted quotation remains the immutable commercial source of truth. Each
    quotation payment milestone becomes one planned order billing milestone with
    explicit source lineage. Order lines are prorated across the schedule so every
    generated milestone can be invoiced immediately without losing product,
    revenue-classification, discount, or tax lineage.
    """

    payments = db.scalars(
        select(QuotationPaymentMilestone)
        .where(
            QuotationPaymentMilestone.organization_id == quotation.organization_id,
            QuotationPaymentMilestone.quotation_id == quotation.id,
        )
        .order_by(QuotationPaymentMilestone.sort_order.asc(), QuotationPaymentMilestone.created_at.asc())
    ).all()
    if not payments:
        return []

    existing = db.scalar(
        select(func.count(OrderBillingMilestone.id)).where(
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
        )
    ) or 0
    if existing:
        raise HTTPException(status_code=409, detail="Order already has a billing schedule")

    schedule_amounts = [_money(payment.amount) for payment in payments]
    order_total = _money(order.total)
    schedule_total = _money(sum(schedule_amounts, Decimal("0")))
    if schedule_total != order_total:
        raise HTTPException(
            status_code=409,
            detail=f"Quotation payment schedule totals {schedule_total} {order.currency}; expected {order_total} {order.currency}",
        )

    order_items = db.scalars(
        select(OrderItem)
        .where(
            OrderItem.organization_id == order.organization_id,
            OrderItem.order_id == order.id,
        )
        .order_by(OrderItem.sort_order.asc(), OrderItem.created_at.asc())
    ).all()
    if not order_items:
        raise HTTPException(status_code=409, detail="Cannot create billing schedule because the order has no line items")

    line_matrix = _allocate_line_totals(order_items, schedule_amounts, order_total)
    discount_matrix: list[list[Decimal]] = [[Decimal("0.00") for _ in order_items] for _ in payments]
    tax_matrix: list[list[Decimal]] = [[Decimal("0.00") for _ in order_items] for _ in payments]

    for item_index, item in enumerate(order_items):
        line_allocations = [line_matrix[milestone_index][item_index] for milestone_index in range(len(payments))]
        discounts = _split_component(
            Decimal(item.discount_amount),
            line_total=_money(item.line_total),
            line_allocations=line_allocations,
            schedule_amounts=schedule_amounts,
            order_total=order_total,
        )
        taxes = _split_component(
            Decimal(item.tax_amount),
            line_total=_money(item.line_total),
            line_allocations=line_allocations,
            schedule_amounts=schedule_amounts,
            order_total=order_total,
        )
        for milestone_index in range(len(payments)):
            discount_matrix[milestone_index][item_index] = discounts[milestone_index]
            tax_matrix[milestone_index][item_index] = taxes[milestone_index]

    rows: list[OrderBillingMilestone] = []
    for milestone_index, payment in enumerate(payments):
        milestone = OrderBillingMilestone(
            organization_id=order.organization_id,
            order_id=order.id,
            source_quotation_payment_milestone_id=payment.id,
            source_quotation_milestone_id=payment.quotation_milestone_id,
            source_payment_type=payment.payment_type,
            source_percentage=payment.percentage,
            title=payment.title,
            description=payment.description,
            due_condition=payment.due_condition,
            currency=order.currency,
            amount=schedule_amounts[milestone_index],
            due_date=payment.due_date,
            status="planned",
            sort_order=payment.sort_order,
            created_by_user_id=user_id,
        )
        db.add(milestone)
        db.flush()
        rows.append(milestone)

        for item_index, item in enumerate(order_items):
            line_total = line_matrix[milestone_index][item_index]
            discount = discount_matrix[milestone_index][item_index]
            tax = tax_matrix[milestone_index][item_index]
            if order.tax_calculation_mode == "inclusive":
                taxable = line_total
            else:
                taxable = _money(line_total - tax)
            subtotal = _money(taxable + discount)

            db.add(
                OrderBillingMilestoneItem(
                    organization_id=order.organization_id,
                    billing_milestone_id=milestone.id,
                    source_order_item_id=item.id,
                    product_id=item.product_id,
                    sort_order=item.sort_order,
                    item_name_snapshot=item.item_name_snapshot,
                    sku_snapshot=item.sku_snapshot,
                    item_type_snapshot=item.item_type_snapshot,
                    unit_snapshot=item.unit_snapshot,
                    description=item.description,
                    quantity=ONE,
                    unit_price=subtotal.quantize(PRICE, rounding=ROUND_HALF_UP),
                    discount_percent=item.discount_percent,
                    tax_rate=item.tax_rate,
                    line_subtotal=subtotal,
                    discount_amount=discount,
                    taxable_amount=taxable,
                    tax_amount=tax,
                    line_total=line_total,
                )
            )

    db.flush()

    generated_total = _money(sum((Decimal(row.amount) for row in rows), Decimal("0")))
    if generated_total != order_total:
        raise HTTPException(status_code=409, detail="Generated order billing schedule does not match the accepted quotation total")
    return rows
