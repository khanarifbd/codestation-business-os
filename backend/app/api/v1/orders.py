from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.inventory_sales import OrderFulfillment, OrderFulfillmentItem
from app.models.membership import Membership
from app.models.orders import Order, OrderItem
from app.models.sales import Quotation, QuotationItem
from app.models.team import Employee
from app.models.user import User
from app.schemas.orders import OrderDetail, OrderItemRead, OrderListItem, OrderPage, OrderStatusChange, OrderSummary
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders"])

OrderViewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
OrderManager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _encode_cursor(created_at: datetime, entity_id: str) -> str:
    raw = json.dumps({"created_at": created_at.isoformat(), "id": entity_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        timestamp = datetime.fromisoformat(payload["created_at"])
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return timestamp, str(payload["id"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid pagination cursor") from exc


def _cursor_clause(decoded: tuple[datetime, str] | None):
    if decoded is None:
        return None
    created_at, entity_id = decoded
    return or_(Order.created_at < created_at, and_(Order.created_at == created_at, Order.id < entity_id))


def _order_query(organization_id: str):
    employee_alias = aliased(Employee)
    membership_alias = aliased(Membership)
    user_alias = aliased(User)
    return (
        select(Order, Client.display_name, Quotation.quotation_number, user_alias.full_name)
        .join(Client, Client.id == Order.client_id)
        .outerjoin(Quotation, Quotation.id == Order.quotation_id)
        .outerjoin(employee_alias, employee_alias.id == Order.assigned_employee_id)
        .outerjoin(membership_alias, membership_alias.id == employee_alias.membership_id)
        .outerjoin(user_alias, user_alias.id == membership_alias.user_id)
        .where(Order.organization_id == organization_id)
    )


def _list_item(row) -> OrderListItem:
    order, client_name, quotation_number, assigned_name = row
    return OrderListItem(
        id=order.id,
        order_number=order.order_number,
        quotation_id=order.quotation_id,
        quotation_number=quotation_number,
        client_id=order.client_id,
        client_name=client_name,
        status=order.status,
        subject=order.subject,
        order_date=order.order_date,
        currency=order.currency,
        total=order.total,
        assigned_employee_id=order.assigned_employee_id,
        assigned_employee_name=assigned_name,
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


def _fulfilled_quantities(db: DbSession, organization_id: str, order_item_ids: list[str]) -> dict[str, Decimal]:
    if not order_item_ids:
        return {}
    rows = db.execute(
        select(OrderFulfillmentItem.order_item_id, func.coalesce(func.sum(OrderFulfillmentItem.quantity), 0))
        .join(
            OrderFulfillment,
            (OrderFulfillment.id == OrderFulfillmentItem.fulfillment_id)
            & (OrderFulfillment.organization_id == organization_id),
        )
        .where(
            OrderFulfillmentItem.organization_id == organization_id,
            OrderFulfillmentItem.order_item_id.in_(order_item_ids),
            OrderFulfillment.status == "posted",
        )
        .group_by(OrderFulfillmentItem.order_item_id)
    ).all()
    return {str(order_item_id): Decimal(quantity or 0) for order_item_id, quantity in rows}


def _stock_items(db: DbSession, organization_id: str, order_id: str) -> list[OrderItem]:
    return db.scalars(
        select(OrderItem)
        .where(
            OrderItem.organization_id == organization_id,
            OrderItem.order_id == order_id,
            OrderItem.item_type_snapshot == "stock_item",
            OrderItem.product_id.is_not(None),
        )
        .order_by(OrderItem.sort_order.asc(), OrderItem.created_at.asc())
    ).all()


def _assert_stock_fulfilled(db: DbSession, organization_id: str, order: Order) -> None:
    items = _stock_items(db, organization_id, order.id)
    if not items:
        return
    fulfilled = _fulfilled_quantities(db, organization_id, [item.id for item in items])
    remaining = []
    for item in items:
        balance = Decimal(item.quantity) - fulfilled.get(item.id, Decimal("0"))
        if balance > 0:
            remaining.append(f"{item.item_name_snapshot}: {balance.normalize()} {item.unit_snapshot}")
    if remaining:
        preview = ", ".join(remaining[:3])
        if len(remaining) > 3:
            preview += f" and {len(remaining) - 3} more"
        raise HTTPException(status_code=409, detail=f"Fulfill all stock items before completing this order. Remaining: {preview}")


def _has_posted_fulfillment(db: DbSession, organization_id: str, order_id: str) -> bool:
    return bool(
        db.scalar(
            select(OrderFulfillment.id).where(
                OrderFulfillment.organization_id == organization_id,
                OrderFulfillment.order_id == order_id,
                OrderFulfillment.status == "posted",
            ).limit(1)
        )
    )


def _detail(db: DbSession, organization_id: str, order_id: str) -> OrderDetail:
    row = db.execute(_order_query(organization_id).where(Order.id == order_id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order not found")
    order, _client_name, quotation_number, assigned_name = row
    items = db.scalars(
        select(OrderItem)
        .where(OrderItem.organization_id == organization_id, OrderItem.order_id == order.id)
        .order_by(OrderItem.sort_order.asc(), OrderItem.created_at.asc())
    ).all()
    fulfilled = _fulfilled_quantities(db, organization_id, [item.id for item in items])
    return OrderDetail(
        id=order.id,
        order_number=order.order_number,
        quotation_id=order.quotation_id,
        quotation_number=quotation_number,
        client_id=order.client_id,
        source_lead_id=order.source_lead_id,
        assigned_employee_id=order.assigned_employee_id,
        assigned_employee_name=assigned_name,
        status=order.status,
        subject=order.subject,
        order_date=order.order_date,
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
        subtotal=order.subtotal,
        discount_total=order.discount_total,
        tax_total=order.tax_total,
        total=order.total,
        notes=order.notes,
        terms_conditions=order.terms_conditions,
        internal_notes=order.internal_notes,
        confirmed_at=order.confirmed_at,
        started_at=order.started_at,
        completed_at=order.completed_at,
        cancelled_at=order.cancelled_at,
        items=[
            OrderItemRead(
                id=item.id,
                quotation_item_id=item.quotation_item_id,
                product_id=item.product_id,
                sort_order=item.sort_order,
                item_name_snapshot=item.item_name_snapshot,
                sku_snapshot=item.sku_snapshot,
                item_type_snapshot=item.item_type_snapshot,
                unit_snapshot=item.unit_snapshot,
                description=item.description,
                quantity=item.quantity,
                fulfilled_quantity=fulfilled.get(item.id, Decimal("0")) if item.item_type_snapshot == "stock_item" and item.product_id else Decimal("0"),
                remaining_quantity=max(Decimal(item.quantity) - fulfilled.get(item.id, Decimal("0")), Decimal("0")) if item.item_type_snapshot == "stock_item" and item.product_id else Decimal("0"),
                unit_price=item.unit_price,
                discount_percent=item.discount_percent,
                tax_rate=item.tax_rate,
                line_subtotal=item.line_subtotal,
                discount_amount=item.discount_amount,
                taxable_amount=item.taxable_amount,
                tax_amount=item.tax_amount,
                line_total=item.line_total,
            )
            for item in items
        ],
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


@router.get("/orders/summary", response_model=OrderSummary)
def order_summary(db: DbSession, tenant: OrderViewer) -> OrderSummary:
    row = db.execute(
        select(
            func.count(Order.id),
            func.count(Order.id).filter(Order.status == "confirmed"),
            func.count(Order.id).filter(Order.status == "in_progress"),
            func.count(Order.id).filter(Order.status == "completed"),
            func.count(Order.id).filter(Order.status == "cancelled"),
        ).where(Order.organization_id == tenant.organization_id)
    ).one()
    return OrderSummary(total=row[0], confirmed=row[1], in_progress=row[2], completed=row[3], cancelled=row[4])


@router.get("/orders", response_model=OrderPage)
def list_orders(
    db: DbSession,
    tenant: OrderViewer,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = None,
    search: str | None = None,
    order_status: str | None = Query(default=None, alias="status"),
    client_id: str | None = None,
) -> OrderPage:
    query = _order_query(tenant.organization_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(Order.order_number.ilike(needle), Order.subject.ilike(needle), Client.display_name.ilike(needle), Quotation.quotation_number.ilike(needle))
        )
    if order_status:
        query = query.where(Order.status == order_status)
    if client_id:
        query = query.where(Order.client_id == client_id)
    clause = _cursor_clause(_decode_cursor(cursor))
    if clause is not None:
        query = query.where(clause)
    rows = db.execute(query.order_by(Order.created_at.desc(), Order.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return OrderPage(
        items=[_list_item(row) for row in rows],
        next_cursor=_encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None,
    )


@router.get("/orders/{order_id}", response_model=OrderDetail)
def get_order(order_id: str, db: DbSession, tenant: OrderViewer) -> OrderDetail:
    return _detail(db, tenant.organization_id, order_id)


@router.post("/orders/from-quotation/{quotation_id}", response_model=OrderDetail, status_code=status.HTTP_201_CREATED)
def create_order_from_quotation(
    quotation_id: str,
    request: Request,
    db: DbSession,
    tenant: OrderManager,
) -> OrderDetail:
    quotation = db.scalar(
        select(Quotation)
        .where(Quotation.id == quotation_id, Quotation.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if quotation is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if quotation.status != "accepted":
        raise HTTPException(status_code=409, detail="Only accepted quotations can be converted to an order")

    existing = db.scalar(select(Order).where(Order.organization_id == tenant.organization_id, Order.quotation_id == quotation.id))
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Quotation already has order {existing.order_number}")

    quotation_items = db.scalars(
        select(QuotationItem)
        .where(QuotationItem.organization_id == tenant.organization_id, QuotationItem.quotation_id == quotation.id)
        .order_by(QuotationItem.sort_order.asc(), QuotationItem.created_at.asc())
    ).all()
    if not quotation_items:
        raise HTTPException(status_code=409, detail="Accepted quotation has no line items")

    now = datetime.now(timezone.utc)
    order = Order(
        organization_id=tenant.organization_id,
        order_number=next_sequence_code(db, tenant.organization_id, "order"),
        quotation_id=quotation.id,
        client_id=quotation.client_id,
        source_lead_id=quotation.source_lead_id,
        assigned_employee_id=quotation.assigned_employee_id,
        created_by_user_id=tenant.user_id,
        status="confirmed",
        subject=quotation.subject,
        order_date=_tenant_today(tenant.organization.timezone),
        currency=quotation.currency,
        tax_calculation_mode=quotation.tax_calculation_mode,
        seller_name_snapshot=quotation.seller_name_snapshot,
        seller_email_snapshot=quotation.seller_email_snapshot,
        seller_address_snapshot=quotation.seller_address_snapshot,
        seller_tax_identifier_snapshot=quotation.seller_tax_identifier_snapshot,
        client_name_snapshot=quotation.client_name_snapshot,
        client_contact_snapshot=quotation.client_contact_snapshot,
        client_email_snapshot=quotation.client_email_snapshot,
        client_address_snapshot=quotation.client_address_snapshot,
        client_tax_identifier_snapshot=quotation.client_tax_identifier_snapshot,
        subtotal=quotation.subtotal,
        discount_total=quotation.discount_total,
        tax_total=quotation.tax_total,
        total=quotation.total,
        notes=quotation.notes,
        terms_conditions=quotation.terms_conditions,
        internal_notes=quotation.internal_notes,
        confirmed_at=now,
    )
    db.add(order)
    db.flush()

    for item in quotation_items:
        db.add(
            OrderItem(
                organization_id=tenant.organization_id,
                order_id=order.id,
                quotation_item_id=item.id,
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
    db.flush()

    record_activity(
        db,
        action="sales.order.created_from_quotation",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="order",
        entity_id=order.id,
        after={
            "order_number": order.order_number,
            "quotation_id": quotation.id,
            "quotation_number": quotation.quotation_number,
            "client_id": order.client_id,
            "status": order.status,
            "currency": order.currency,
            "total": str(order.total),
            "item_count": len(quotation_items),
        },
        metadata={"source_quotation_id": quotation.id},
        message=f"Order {order.order_number} created from accepted quotation {quotation.quotation_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, order.id)


@router.patch("/orders/{order_id}/status", response_model=OrderDetail)
def change_order_status(
    order_id: str,
    payload: OrderStatusChange,
    request: Request,
    db: DbSession,
    tenant: OrderManager,
) -> OrderDetail:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == payload.status:
        return _detail(db, tenant.organization_id, order.id)

    allowed = {
        "confirmed": {"in_progress", "cancelled"},
        "in_progress": {"completed", "cancelled"},
        "completed": set(),
        "cancelled": set(),
    }
    if payload.status not in allowed.get(order.status, set()):
        raise HTTPException(status_code=409, detail=f"Order cannot move from {order.status} to {payload.status}")
    if payload.status == "completed":
        _assert_stock_fulfilled(db, tenant.organization_id, order)
    if payload.status == "cancelled" and _has_posted_fulfillment(db, tenant.organization_id, order.id):
        raise HTTPException(
            status_code=409,
            detail="This order has posted stock fulfillment and cannot be cancelled directly. Record the stock return/reversal before cancelling the order.",
        )

    previous = order.status
    now = datetime.now(timezone.utc)
    order.status = payload.status
    if payload.status == "in_progress":
        order.started_at = now
    elif payload.status == "completed":
        order.completed_at = now
    elif payload.status == "cancelled":
        order.cancelled_at = now
    db.flush()

    record_activity(
        db,
        action="sales.order.status_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="order",
        entity_id=order.id,
        before={"status": previous},
        after={"status": order.status},
        message=f"Order {order.order_number} status changed from {previous} to {order.status}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, order.id)
