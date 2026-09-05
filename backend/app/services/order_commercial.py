from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, Request
from sqlalchemy import func, select

from app.models.finance import Invoice, InvoiceItem
from app.models.order_billing_invoice import OrderBillingInvoiceLink
from app.models.order_commercial import OrderBillingMilestone, OrderBillingMilestoneItem, OrderChange, OrderChangeItem
from app.models.orders import Order, OrderItem
from app.models.organization import Organization
from app.models.projects import Project, ProjectMilestone
from app.schemas.order_commercial import (
    BillingMilestoneCreate,
    BillingMilestoneRead,
    CommercialLineInput,
    CommercialLineRead,
    OrderChangeCreate,
    OrderChangeRead,
    OrderCommercialSummary,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.sales import calculate_line, calculate_totals
from app.services.sales_catalog import resolve_sales_line

MONEY = Decimal("0.01")


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def get_order(db, organization_id: str, order_id: str, *, lock: bool = False) -> Order:
    query = select(Order).where(Order.id == order_id, Order.organization_id == organization_id)
    if lock:
        query = query.with_for_update()
    order = db.scalar(query)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _assert_mutable(order: Order) -> None:
    if order.status == "completed":
        raise HTTPException(status_code=409, detail="Reopen the completed order before changing scope or billing schedule.")
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled orders cannot be changed")


def _effective_delta(change: OrderChange) -> Decimal:
    total = money(change.total)
    return total if change.change_type == "addition" else -total


def _line_read(item) -> CommercialLineRead:
    return CommercialLineRead(
        id=item.id,
        source_order_item_id=getattr(item, "source_order_item_id", None),
        source_order_change_item_id=getattr(item, "source_order_change_item_id", None),
        product_id=item.product_id,
        item_name=item.item_name_snapshot,
        item_type=item.item_type_snapshot,
        unit=item.unit_snapshot,
        description=item.description,
        quantity=item.quantity,
        unit_price=item.unit_price,
        discount_percent=item.discount_percent,
        tax_rate=item.tax_rate,
        line_total=item.line_total,
    )


def _validate_source_links(db, order: Order, source: CommercialLineInput) -> None:
    if source.source_order_item_id:
        found = db.scalar(
            select(OrderItem.id).where(
                OrderItem.id == source.source_order_item_id,
                OrderItem.organization_id == order.organization_id,
                OrderItem.order_id == order.id,
            )
        )
        if found is None:
            raise HTTPException(status_code=404, detail="Source order item is not part of this order")
    if source.source_order_change_item_id:
        found = db.scalar(
            select(OrderChangeItem.id)
            .join(OrderChange, OrderChange.id == OrderChangeItem.order_change_id)
            .where(
                OrderChangeItem.id == source.source_order_change_item_id,
                OrderChangeItem.organization_id == order.organization_id,
                OrderChange.organization_id == order.organization_id,
                OrderChange.order_id == order.id,
            )
        )
        if found is None:
            raise HTTPException(status_code=404, detail="Source order change item is not part of this order")


def _prepare_lines(db, order: Order, inputs: list[CommercialLineInput]):
    prepared = []
    calculated = []
    for source in inputs:
        _validate_source_links(db, order, source)
        snapshot = resolve_sales_line(
            db,
            organization_id=order.organization_id,
            currency=order.currency,
            product_id=source.product_id,
            item_name=source.item_name,
            item_type=source.item_type,
            unit=source.unit,
            description=source.description,
        )
        line = calculate_line(
            quantity=source.quantity,
            unit_price=source.unit_price,
            discount_percent=source.discount_percent,
            tax_rate=source.tax_rate,
            tax_calculation_mode=order.tax_calculation_mode,
        )
        prepared.append((source, snapshot, line))
        calculated.append(line)
    return prepared, calculate_totals(calculated)


def _change_read(db, change: OrderChange) -> OrderChangeRead:
    items = db.scalars(
        select(OrderChangeItem)
        .where(
            OrderChangeItem.organization_id == change.organization_id,
            OrderChangeItem.order_change_id == change.id,
        )
        .order_by(OrderChangeItem.sort_order, OrderChangeItem.created_at)
    ).all()
    return OrderChangeRead(
        id=change.id,
        change_number=change.change_number,
        change_type=change.change_type,
        status=change.status,
        title=change.title,
        reason=change.reason,
        currency=change.currency,
        subtotal=change.subtotal,
        discount_total=change.discount_total,
        tax_total=change.tax_total,
        total=change.total,
        effective_delta=_effective_delta(change),
        items=[_line_read(item) for item in items],
        approved_at=change.approved_at,
        rejected_at=change.rejected_at,
        created_at=change.created_at,
    )


def _milestone_invoice(db, milestone: OrderBillingMilestone):
    return db.execute(
        select(Invoice.id, Invoice.invoice_number, Invoice.status)
        .join(OrderBillingInvoiceLink, OrderBillingInvoiceLink.invoice_id == Invoice.id)
        .where(
            OrderBillingInvoiceLink.organization_id == milestone.organization_id,
            OrderBillingInvoiceLink.billing_milestone_id == milestone.id,
            Invoice.organization_id == milestone.organization_id,
        )
        .order_by(OrderBillingInvoiceLink.created_at.desc())
        .limit(1)
    ).first()


def _milestone_read(db, milestone: OrderBillingMilestone) -> BillingMilestoneRead:
    items = db.scalars(
        select(OrderBillingMilestoneItem)
        .where(
            OrderBillingMilestoneItem.organization_id == milestone.organization_id,
            OrderBillingMilestoneItem.billing_milestone_id == milestone.id,
        )
        .order_by(OrderBillingMilestoneItem.sort_order, OrderBillingMilestoneItem.created_at)
    ).all()
    invoice = _milestone_invoice(db, milestone)
    return BillingMilestoneRead(
        id=milestone.id,
        title=milestone.title,
        description=milestone.description,
        project_id=milestone.project_id,
        project_milestone_id=milestone.project_milestone_id,
        order_change_id=milestone.order_change_id,
        currency=milestone.currency,
        amount=milestone.amount,
        due_date=milestone.due_date,
        status=milestone.status,
        invoice_id=invoice.id if invoice else None,
        invoice_number=invoice.invoice_number if invoice else None,
        items=[_line_read(item) for item in items],
        created_at=milestone.created_at,
    )


def _linked_milestone_invoice_ids(db, order: Order) -> set[str]:
    return set(
        db.scalars(
            select(OrderBillingInvoiceLink.invoice_id)
            .join(OrderBillingMilestone, OrderBillingMilestone.id == OrderBillingInvoiceLink.billing_milestone_id)
            .where(
                OrderBillingInvoiceLink.organization_id == order.organization_id,
                OrderBillingMilestone.organization_id == order.organization_id,
                OrderBillingMilestone.order_id == order.id,
            )
        ).all()
    )


def commercial_values(db, order: Order):
    approved_changes = db.scalars(
        select(OrderChange).where(
            OrderChange.organization_id == order.organization_id,
            OrderChange.order_id == order.id,
            OrderChange.status == "approved",
        )
    ).all()
    approved_delta = sum((_effective_delta(change) for change in approved_changes), Decimal("0"))
    revised = money(Decimal(order.total) + approved_delta)

    milestone_scheduled = money(
        db.scalar(
            select(func.coalesce(func.sum(OrderBillingMilestone.amount), 0)).where(
                OrderBillingMilestone.organization_id == order.organization_id,
                OrderBillingMilestone.order_id == order.id,
                OrderBillingMilestone.status != "cancelled",
            )
        )
        or 0
    )
    invoices = db.scalars(
        select(Invoice).where(
            Invoice.organization_id == order.organization_id,
            Invoice.order_id == order.id,
            Invoice.status != "cancelled",
        )
    ).all()
    linked_invoice_ids = _linked_milestone_invoice_ids(db, order)
    legacy_invoice_commitment = money(
        sum((Decimal(invoice.total) for invoice in invoices if invoice.id not in linked_invoice_ids), Decimal("0"))
    )
    scheduled = money(milestone_scheduled + legacy_invoice_commitment)
    billed = money(sum((Decimal(invoice.total) for invoice in invoices if invoice.status != "draft"), Decimal("0")))
    drafts = money(sum((Decimal(invoice.total) for invoice in invoices if invoice.status == "draft"), Decimal("0")))
    paid = money(sum((Decimal(invoice.amount_paid) for invoice in invoices), Decimal("0")))
    ar = money(sum((Decimal(invoice.balance_due) for invoice in invoices if invoice.status != "draft"), Decimal("0")))
    return {
        "approved_delta": money(approved_delta),
        "revised": revised,
        "scheduled": scheduled,
        "milestone_scheduled": milestone_scheduled,
        "legacy_invoice_commitment": legacy_invoice_commitment,
        "billed": billed,
        "drafts": drafts,
        "paid": paid,
        "ar": ar,
        "remaining_to_bill": max(Decimal("0"), money(revised - billed)),
        "remaining_to_schedule": max(Decimal("0"), money(revised - scheduled)),
    }


def commercial_summary(db, organization_id: str, order_id: str) -> OrderCommercialSummary:
    order = get_order(db, organization_id, order_id)
    values = commercial_values(db, order)
    changes = db.scalars(
        select(OrderChange)
        .where(OrderChange.organization_id == organization_id, OrderChange.order_id == order.id)
        .order_by(OrderChange.created_at)
    ).all()
    milestones = db.scalars(
        select(OrderBillingMilestone)
        .where(OrderBillingMilestone.organization_id == organization_id, OrderBillingMilestone.order_id == order.id)
        .order_by(OrderBillingMilestone.sort_order, OrderBillingMilestone.created_at)
    ).all()
    return OrderCommercialSummary(
        order_id=order.id,
        order_number=order.order_number,
        currency=order.currency,
        staged_billing_enabled=bool(changes or milestones),
        original_value=money(order.total),
        approved_change_value=values["approved_delta"],
        revised_contract_value=values["revised"],
        scheduled_value=values["scheduled"],
        billed_value=values["billed"],
        draft_invoice_value=values["drafts"],
        paid_value=values["paid"],
        accounts_receivable=values["ar"],
        remaining_to_bill=values["remaining_to_bill"],
        remaining_to_schedule=values["remaining_to_schedule"],
        changes=[_change_read(db, change) for change in changes],
        billing_milestones=[_milestone_read(db, milestone) for milestone in milestones],
    )


def create_change(db, order: Order, payload: OrderChangeCreate, user_id: str, request: Request) -> OrderChangeRead:
    _assert_mutable(order)
    prepared, totals = _prepare_lines(db, order, payload.items)
    count = db.scalar(
        select(func.count(OrderChange.id)).where(
            OrderChange.organization_id == order.organization_id,
            OrderChange.order_id == order.id,
        )
    ) or 0
    change = OrderChange(
        organization_id=order.organization_id,
        order_id=order.id,
        change_number=f"{order.order_number}-CHG-{int(count) + 1:02d}",
        change_type=payload.change_type,
        status="draft",
        title=payload.title.strip(),
        reason=(payload.reason or "").strip() or None,
        currency=order.currency,
        subtotal=totals.subtotal,
        discount_total=totals.discount_total,
        tax_total=totals.tax_total,
        total=totals.total,
        created_by_user_id=user_id,
    )
    db.add(change)
    db.flush()
    for index, (source, snapshot, line) in enumerate(prepared):
        db.add(
            OrderChangeItem(
                organization_id=order.organization_id,
                order_change_id=change.id,
                source_order_item_id=source.source_order_item_id,
                product_id=snapshot.product_id,
                sort_order=index,
                item_name_snapshot=snapshot.item_name,
                sku_snapshot=snapshot.sku,
                item_type_snapshot=snapshot.item_type,
                unit_snapshot=snapshot.unit,
                description=snapshot.description,
                quantity=source.quantity,
                unit_price=source.unit_price,
                discount_percent=source.discount_percent,
                tax_rate=source.tax_rate,
                line_subtotal=line.line_subtotal,
                discount_amount=line.discount_amount,
                taxable_amount=line.taxable_amount,
                tax_amount=line.tax_amount,
                line_total=line.line_total,
            )
        )
    record_activity(
        db,
        action="sales.order_change.created",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=order.organization_id,
        entity_type="order_change",
        entity_id=change.id,
        after={"order_id": order.id, "change_type": change.change_type, "total": str(change.total)},
        request=request,
    )
    db.commit()
    db.refresh(change)
    return _change_read(db, change)


def act_on_change(db, order: Order, change_id: str, action: str, user_id: str, request: Request) -> OrderChangeRead:
    _assert_mutable(order)
    change = db.scalar(
        select(OrderChange)
        .where(
            OrderChange.id == change_id,
            OrderChange.organization_id == order.organization_id,
            OrderChange.order_id == order.id,
        )
        .with_for_update()
    )
    if change is None:
        raise HTTPException(status_code=404, detail="Order change not found")
    previous = change.status
    now = datetime.now(timezone.utc)
    synced_projects: list[dict[str, str]] = []
    if action == "submit":
        if change.status != "draft":
            raise HTTPException(status_code=409, detail="Only draft changes can be submitted")
        change.status = "pending"
    elif action == "approve":
        if change.status != "pending":
            raise HTTPException(status_code=409, detail="Only pending changes can be approved")
        if change.change_type != "addition":
            values = commercial_values(db, order)
            proposed = money(values["revised"] - change.total)
            floor = max(values["scheduled"], values["billed"] + values["drafts"])
            if proposed < floor:
                raise HTTPException(
                    status_code=409,
                    detail=f"Reduction would lower contract below committed {money(floor)} {order.currency}; cancel/reduce billing commitments first",
                )
            if proposed < 0:
                raise HTTPException(status_code=409, detail="Revised contract value cannot be negative")
        change.status = "approved"
        change.approved_by_user_id = user_id
        change.approved_at = now
        db.flush()
        revised_contract = commercial_values(db, order)["revised"]
        projects = db.scalars(
            select(Project).where(
                Project.organization_id == order.organization_id,
                Project.order_id == order.id,
            )
        ).all()
        for project in projects:
            before_value = money(project.contract_value)
            if before_value == revised_contract:
                continue
            project.contract_value = revised_contract
            synced_projects.append({"project_id": project.id, "before": str(before_value), "after": str(revised_contract)})
            record_activity(
                db,
                action="projects.contract_value.synced_from_order_change",
                scope="tenant",
                actor_user_id=user_id,
                organization_id=order.organization_id,
                entity_type="project",
                entity_id=project.id,
                before={"contract_value": str(before_value), "currency": project.currency},
                after={"contract_value": str(revised_contract), "currency": project.currency, "order_change_id": change.id},
                request=request,
            )
    elif action == "reject":
        if change.status != "pending":
            raise HTTPException(status_code=409, detail="Only pending changes can be rejected")
        change.status = "rejected"
        change.rejected_by_user_id = user_id
        change.rejected_at = now
    else:
        raise HTTPException(status_code=400, detail="Unsupported order change action")
    after = {"status": change.status, "effective_delta": str(_effective_delta(change))}
    if action == "approve":
        after["revised_contract_value"] = str(commercial_values(db, order)["revised"])
    record_activity(
        db,
        action=f"sales.order_change.{action}",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=order.organization_id,
        entity_type="order_change",
        entity_id=change.id,
        before={"status": previous},
        after=after,
        metadata={"synced_projects": synced_projects} if synced_projects else None,
        request=request,
    )
    db.commit()
    db.refresh(change)
    return _change_read(db, change)


def create_billing_milestone(db, order: Order, payload: BillingMilestoneCreate, user_id: str, request: Request) -> BillingMilestoneRead:
    _assert_mutable(order)
    if payload.project_id:
        project = db.scalar(
            select(Project).where(
                Project.id == payload.project_id,
                Project.organization_id == order.organization_id,
                Project.order_id == order.id,
            )
        )
        if project is None:
            raise HTTPException(status_code=404, detail="Project is not linked to this order")
    if payload.project_milestone_id:
        project_milestone = db.scalar(
            select(ProjectMilestone)
            .join(Project, Project.id == ProjectMilestone.project_id)
            .where(
                ProjectMilestone.id == payload.project_milestone_id,
                ProjectMilestone.organization_id == order.organization_id,
                Project.order_id == order.id,
            )
        )
        if project_milestone is None:
            raise HTTPException(status_code=404, detail="Project milestone is not linked to this order")
    if payload.order_change_id:
        change = db.scalar(
            select(OrderChange).where(
                OrderChange.id == payload.order_change_id,
                OrderChange.organization_id == order.organization_id,
                OrderChange.order_id == order.id,
                OrderChange.status == "approved",
            )
        )
        if change is None:
            raise HTTPException(status_code=404, detail="Approved order change not found")
    prepared, totals = _prepare_lines(db, order, payload.items)
    amount = money(totals.total)
    values = commercial_values(db, order)
    if money(values["scheduled"] + amount) > values["revised"]:
        raise HTTPException(status_code=409, detail=f"Billing schedule exceeds revised contract value {values['revised']} {order.currency}")
    count = db.scalar(
        select(func.count(OrderBillingMilestone.id)).where(
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
        )
    ) or 0
    milestone = OrderBillingMilestone(
        organization_id=order.organization_id,
        order_id=order.id,
        project_id=payload.project_id,
        project_milestone_id=payload.project_milestone_id,
        order_change_id=payload.order_change_id,
        title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        currency=order.currency,
        amount=amount,
        due_date=payload.due_date,
        status="planned",
        sort_order=int(count),
        created_by_user_id=user_id,
    )
    db.add(milestone)
    db.flush()
    for index, (source, snapshot, line) in enumerate(prepared):
        db.add(
            OrderBillingMilestoneItem(
                organization_id=order.organization_id,
                billing_milestone_id=milestone.id,
                source_order_item_id=source.source_order_item_id,
                source_order_change_item_id=source.source_order_change_item_id,
                product_id=snapshot.product_id,
                sort_order=index,
                item_name_snapshot=snapshot.item_name,
                sku_snapshot=snapshot.sku,
                item_type_snapshot=snapshot.item_type,
                unit_snapshot=snapshot.unit,
                description=snapshot.description,
                quantity=source.quantity,
                unit_price=source.unit_price,
                discount_percent=source.discount_percent,
                tax_rate=source.tax_rate,
                line_subtotal=line.line_subtotal,
                discount_amount=line.discount_amount,
                taxable_amount=line.taxable_amount,
                tax_amount=line.tax_amount,
                line_total=line.line_total,
            )
        )
    record_activity(
        db,
        action="finance.billing_milestone.created",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=order.organization_id,
        entity_type="order_billing_milestone",
        entity_id=milestone.id,
        after={"order_id": order.id, "amount": str(amount), "currency": order.currency},
        request=request,
    )
    db.commit()
    db.refresh(milestone)
    return _milestone_read(db, milestone)


def act_on_billing_milestone(db, order: Order, milestone_id: str, action: str, user_id: str, request: Request) -> BillingMilestoneRead:
    _assert_mutable(order)
    milestone = db.scalar(
        select(OrderBillingMilestone)
        .where(
            OrderBillingMilestone.id == milestone_id,
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
        )
        .with_for_update()
    )
    if milestone is None:
        raise HTTPException(status_code=404, detail="Billing milestone not found")
    previous = milestone.status
    if action == "mark_billable":
        if milestone.status != "planned":
            raise HTTPException(status_code=409, detail="Only planned billing milestones can become billable")
        milestone.status = "billable"
    elif action == "cancel":
        active_invoice = db.scalar(
            select(Invoice.id)
            .join(OrderBillingInvoiceLink, OrderBillingInvoiceLink.invoice_id == Invoice.id)
            .where(
                OrderBillingInvoiceLink.organization_id == order.organization_id,
                OrderBillingInvoiceLink.billing_milestone_id == milestone.id,
                Invoice.status != "cancelled",
            )
        )
        if active_invoice:
            raise HTTPException(status_code=409, detail="Cancel the active milestone invoice before cancelling this billing milestone")
        milestone.status = "cancelled"
    else:
        raise HTTPException(status_code=400, detail="Unsupported billing milestone action")
    record_activity(
        db,
        action=f"finance.billing_milestone.{action}",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=order.organization_id,
        entity_type="order_billing_milestone",
        entity_id=milestone.id,
        before={"status": previous},
        after={"status": milestone.status},
        request=request,
    )
    db.commit()
    db.refresh(milestone)
    return _milestone_read(db, milestone)


def _tenant_today(db, organization_id: str):
    timezone_name = db.scalar(select(Organization.timezone).where(Organization.id == organization_id)) or "UTC"
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def create_milestone_invoice(db, order: Order, milestone_id: str, user_id: str, request: Request) -> Invoice:
    _assert_mutable(order)
    milestone = db.scalar(
        select(OrderBillingMilestone)
        .where(
            OrderBillingMilestone.id == milestone_id,
            OrderBillingMilestone.organization_id == order.organization_id,
            OrderBillingMilestone.order_id == order.id,
        )
        .with_for_update()
    )
    if milestone is None:
        raise HTTPException(status_code=404, detail="Billing milestone not found")
    if milestone.status not in {"billable", "invoiced"}:
        raise HTTPException(status_code=409, detail="Mark the billing milestone billable before invoicing")
    active = db.scalar(
        select(Invoice)
        .join(OrderBillingInvoiceLink, OrderBillingInvoiceLink.invoice_id == Invoice.id)
        .where(
            OrderBillingInvoiceLink.organization_id == order.organization_id,
            OrderBillingInvoiceLink.billing_milestone_id == milestone.id,
            Invoice.status != "cancelled",
        )
        .limit(1)
    )
    if active:
        raise HTTPException(status_code=409, detail=f"Billing milestone already has active invoice {active.invoice_number}")
    items = db.scalars(
        select(OrderBillingMilestoneItem)
        .where(
            OrderBillingMilestoneItem.organization_id == order.organization_id,
            OrderBillingMilestoneItem.billing_milestone_id == milestone.id,
        )
        .order_by(OrderBillingMilestoneItem.sort_order, OrderBillingMilestoneItem.created_at)
    ).all()
    if not items:
        raise HTTPException(status_code=409, detail="Billing milestone has no items")
    issue_date = _tenant_today(db, order.organization_id)
    due_date = milestone.due_date if milestone.due_date and milestone.due_date >= issue_date else issue_date
    invoice = Invoice(
        organization_id=order.organization_id,
        invoice_number=next_sequence_code(db, order.organization_id, "invoice"),
        client_id=order.client_id,
        order_id=order.id,
        project_id=milestone.project_id,
        quotation_id=order.quotation_id,
        assigned_employee_id=order.assigned_employee_id,
        created_by_user_id=user_id,
        status="draft",
        subject=milestone.title,
        issue_date=issue_date,
        due_date=due_date,
        currency=order.currency,
        tax_calculation_mode=order.tax_calculation_mode,
        seller_name_snapshot=order.seller_name_snapshot,
        seller_email_snapshot=order.seller_email_snapshot,
        seller_address_snapshot=order.seller_address_snapshot,
        seller_tax_identifier_snapshot=order.seller_tax_identifier_snapshot,
        client_name_snapshot=order.client_name_snapshot,
        client_contact_snapshot=order.client_contact_snapshot,
        client_email_snapshot=order.client_email_snapshot,
        client_address_snapshot=order.client_address_snapshot,
        client_tax_identifier_snapshot=order.client_tax_identifier_snapshot,
        subtotal=money(sum((Decimal(item.line_subtotal) for item in items), Decimal("0"))),
        discount_total=money(sum((Decimal(item.discount_amount) for item in items), Decimal("0"))),
        tax_total=money(sum((Decimal(item.tax_amount) for item in items), Decimal("0"))),
        total=money(milestone.amount),
        amount_paid=Decimal("0"),
        balance_due=money(milestone.amount),
        notes=milestone.description,
        terms_conditions=order.terms_conditions,
        internal_notes=None,
    )
    db.add(invoice)
    db.flush()
    for item in items:
        db.add(
            InvoiceItem(
                organization_id=order.organization_id,
                invoice_id=invoice.id,
                source_order_item_id=item.source_order_item_id,
                product_id=item.product_id,
                sort_order=item.sort_order,
                item_name_snapshot=item.item_name_snapshot,
                sku_snapshot=item.sku_snapshot,
                item_type_snapshot=item.item_type_snapshot,
                unit_snapshot=item.unit_snapshot,
                description=item.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                discount_percent=item.discount_percent,
                tax_rate=item.tax_rate,
                line_subtotal=item.line_subtotal,
                discount_amount=item.discount_amount,
                taxable_amount=item.taxable_amount,
                tax_amount=item.tax_amount,
                line_total=item.line_total,
            )
        )
    db.add(
        OrderBillingInvoiceLink(
            organization_id=order.organization_id,
            billing_milestone_id=milestone.id,
            invoice_id=invoice.id,
            created_by_user_id=user_id,
        )
    )
    milestone.status = "invoiced"
    record_activity(
        db,
        action="finance.invoice.created_from_billing_milestone",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=order.organization_id,
        entity_type="invoice",
        entity_id=invoice.id,
        after={
            "order_id": order.id,
            "billing_milestone_id": milestone.id,
            "total": str(invoice.total),
            "currency": invoice.currency,
        },
        request=request,
    )
    db.commit()
    db.refresh(invoice)
    return invoice


def staged_billing_enabled(db, organization_id: str, order_id: str) -> bool:
    return bool(
        db.scalar(
            select(func.count(OrderBillingMilestone.id)).where(
                OrderBillingMilestone.organization_id == organization_id,
                OrderBillingMilestone.order_id == order_id,
            )
        )
        or db.scalar(
            select(func.count(OrderChange.id)).where(
                OrderChange.organization_id == organization_id,
                OrderChange.order_id == order_id,
            )
        )
    )
