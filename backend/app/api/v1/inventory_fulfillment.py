from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.inventory import _balance, _ledger, _stock_out, cost, money, qty
from app.models.inventory import InventoryBalance, Product, Warehouse
from app.models.inventory_sales import OrderFulfillment, OrderFulfillmentItem
from app.models.orders import Order, OrderItem
from app.schemas.orders import FulfillmentCreate, FulfillmentItemRead, FulfillmentRead
from app.services.accounting_posting import PostingLine, post_journal, system_account
from app.services.activity_log import record_activity
from app.services.posting_idempotency import complete_posting, completed_resource, reserve_posting
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders - Fulfillment"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]
RATE = Decimal("0.0000000001")


def _rate(base_amount: Decimal, source_amount: Decimal) -> Decimal:
    if source_amount == 0:
        return Decimal("1")
    return (Decimal(base_amount) / Decimal(source_amount)).quantize(RATE, rounding=ROUND_HALF_UP)


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


def _fulfillment_read(db: DbSession, organization_id: str, fulfillment_id: str) -> FulfillmentRead:
    row = db.execute(
        select(OrderFulfillment, Warehouse.name)
        .join(
            Warehouse,
            (Warehouse.id == OrderFulfillment.warehouse_id)
            & (Warehouse.organization_id == organization_id),
        )
        .where(
            OrderFulfillment.id == fulfillment_id,
            OrderFulfillment.organization_id == organization_id,
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order fulfillment not found")
    fulfillment, warehouse_name = row
    item_rows = db.execute(
        select(OrderFulfillmentItem, OrderItem.item_name_snapshot, OrderItem.sku_snapshot)
        .join(
            OrderItem,
            (OrderItem.id == OrderFulfillmentItem.order_item_id)
            & (OrderItem.organization_id == organization_id),
        )
        .where(
            OrderFulfillmentItem.organization_id == organization_id,
            OrderFulfillmentItem.fulfillment_id == fulfillment.id,
        )
        .order_by(OrderItem.sort_order.asc(), OrderFulfillmentItem.created_at.asc())
    ).all()
    return FulfillmentRead(
        id=fulfillment.id,
        fulfillment_number=fulfillment.fulfillment_number,
        order_id=fulfillment.order_id,
        warehouse_id=fulfillment.warehouse_id,
        warehouse_name=warehouse_name,
        fulfillment_date=fulfillment.fulfillment_date,
        status=fulfillment.status,
        reference=fulfillment.reference,
        currency=fulfillment.currency,
        base_currency=fulfillment.base_currency,
        total_cogs=fulfillment.total_cogs,
        total_cogs_base=fulfillment.total_cogs_base,
        items=[
            FulfillmentItemRead(
                id=item.id,
                order_item_id=item.order_item_id,
                product_id=item.product_id,
                item_name=item_name,
                sku=sku,
                quantity=item.quantity,
                currency=item.currency,
                base_currency=item.base_currency,
                unit_cost=item.unit_cost,
                total_cost=item.total_cost,
                unit_cost_base=item.unit_cost_base,
                total_cost_base=item.total_cost_base,
                effective_rate_to_base=item.effective_rate_to_base,
            )
            for item, item_name, sku in item_rows
        ],
        created_at=fulfillment.created_at,
    )


@router.get("/orders/{order_id}/fulfillments", response_model=list[FulfillmentRead])
def list_order_fulfillments(order_id: str, db: DbSession, tenant: Viewer) -> list[FulfillmentRead]:
    order_exists = db.scalar(
        select(Order.id).where(
            Order.id == order_id,
            Order.organization_id == tenant.organization_id,
        )
    )
    if order_exists is None:
        raise HTTPException(status_code=404, detail="Order not found")
    ids = db.scalars(
        select(OrderFulfillment.id)
        .where(
            OrderFulfillment.organization_id == tenant.organization_id,
            OrderFulfillment.order_id == order_id,
            OrderFulfillment.status == "posted",
        )
        .order_by(OrderFulfillment.fulfillment_date.desc(), OrderFulfillment.created_at.desc())
    ).all()
    return [_fulfillment_read(db, tenant.organization_id, fulfillment_id) for fulfillment_id in ids]


@router.post(
    "/orders/{order_id}/fulfillments",
    response_model=FulfillmentRead,
    status_code=status.HTTP_201_CREATED,
)
def fulfill_order(
    order_id: str,
    payload: FulfillmentCreate,
    request: Request,
    db: DbSession,
    tenant: Manager,
) -> FulfillmentRead:
    idempotency, repeated = reserve_posting(
        db,
        request,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        action="order_fulfillment.post",
        payload={"order_id": order_id, **payload.model_dump(mode="json")},
    )
    if repeated:
        resource_id = completed_resource(idempotency, "order_fulfillment")
        return _fulfillment_read(db, tenant.organization_id, resource_id)

    order = db.scalar(
        select(Order)
        .where(
            Order.id == order_id,
            Order.organization_id == tenant.organization_id,
        )
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in {"confirmed", "in_progress"}:
        raise HTTPException(status_code=409, detail=f"Order in {order.status} status cannot be fulfilled")

    warehouse = db.scalar(
        select(Warehouse).where(
            Warehouse.id == payload.warehouse_id,
            Warehouse.organization_id == tenant.organization_id,
            Warehouse.is_active.is_(True),
        )
    )
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Active warehouse not found")

    requested_ids = [line.order_item_id for line in payload.items]
    if len(set(requested_ids)) != len(requested_ids):
        raise HTTPException(status_code=400, detail="Use one fulfillment line per order item")

    order_items = db.scalars(
        select(OrderItem).where(
            OrderItem.organization_id == tenant.organization_id,
            OrderItem.order_id == order.id,
            OrderItem.id.in_(requested_ids),
        )
    ).all()
    by_id = {item.id: item for item in order_items}
    if len(by_id) != len(requested_ids):
        raise HTTPException(status_code=404, detail="One or more order items were not found for this order")

    fulfilled = _fulfilled_quantities(db, tenant.organization_id, requested_ids)
    products: dict[str, Product] = {}
    requested_by_product: dict[str, Decimal] = {}
    normalized_lines: list[tuple[OrderItem, Decimal]] = []
    for line in payload.items:
        item = by_id[line.order_item_id]
        if item.item_type_snapshot != "stock_item" or item.product_id is None:
            raise HTTPException(status_code=409, detail=f"{item.item_name_snapshot} is not a tracked stock line and does not require inventory fulfillment")
        requested_quantity = qty(line.quantity)
        already_fulfilled = fulfilled.get(item.id, Decimal("0"))
        remaining = qty(Decimal(item.quantity) - already_fulfilled)
        if requested_quantity > remaining:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot fulfill {requested_quantity} {item.unit_snapshot} of {item.item_name_snapshot}; only {remaining} remains on the order",
            )
        product = products.get(item.product_id)
        if product is None:
            product = db.scalar(
                select(Product).where(
                    Product.id == item.product_id,
                    Product.organization_id == tenant.organization_id,
                    Product.item_type == "stock_item",
                    Product.track_inventory.is_(True),
                )
            )
            if product is None:
                raise HTTPException(status_code=409, detail=f"Tracked stock product for {item.item_name_snapshot} is no longer available")
            products[product.id] = product
        if product.currency.upper() != order.currency.upper():
            raise HTTPException(
                status_code=409,
                detail=f"Order line {item.item_name_snapshot} uses {product.currency}, but order currency is {order.currency}. Resolve the historical sales currency mismatch before fulfillment.",
            )
        requested_by_product[product.id] = requested_by_product.get(product.id, Decimal("0")) + requested_quantity
        normalized_lines.append((item, requested_quantity))

    # Lock and validate every affected inventory balance before creating any stock
    # movement. Fulfillment intentionally disallows negative stock even if a catalog
    # item permits legacy negative adjustments; COGS needs a known carrying value.
    locked_balances: dict[str, InventoryBalance] = {}
    for product_id in sorted(requested_by_product):
        balance = _balance(db, tenant.organization_id, product_id, warehouse.id, lock=True)
        locked_balances[product_id] = balance
        required = qty(requested_by_product[product_id])
        available = qty(balance.on_hand_quantity)
        if required > available:
            product = products[product_id]
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient stock for {product.sku} in {warehouse.name}. Required {required}, available {available}",
            )
        if balance.inventory_value_base is None or balance.average_unit_cost_base is None:
            product = products[product_id]
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Historical base-currency carrying cost is missing for {product.sku} in {warehouse.name}. "
                    "Reconcile the opening inventory value before fulfillment; Business OS will not revalue historical stock using today's FX rate."
                ),
            )

    base_currency = tenant.organization.currency.upper()
    fulfillment = OrderFulfillment(
        organization_id=tenant.organization_id,
        fulfillment_number=f"FUL-{payload.fulfillment_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}",
        order_id=order.id,
        warehouse_id=warehouse.id,
        fulfillment_date=payload.fulfillment_date,
        status="posted",
        reference=payload.reference.strip() if payload.reference and payload.reference.strip() else None,
        currency=order.currency.upper(),
        base_currency=base_currency,
        total_cogs=Decimal("0"),
        total_cogs_base=Decimal("0"),
        created_by_user_id=tenant.user_id,
    )
    db.add(fulfillment)
    db.flush()

    total_cogs = Decimal("0")
    total_cogs_base = Decimal("0")
    movement_ids: list[str] = []
    for item, requested_quantity in normalized_lines:
        product = products[item.product_id]
        movement = _stock_out(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            product=product,
            warehouse=warehouse,
            movement_date=payload.fulfillment_date,
            quantity=requested_quantity,
            source_type="order_fulfillment",
            source_id=fulfillment.id,
            reference=fulfillment.reference or order.order_number,
            reason=f"Fulfilled order {order.order_number}",
        )
        movement.movement_type = "sale"
        source_cost = cost(abs(Decimal(movement.total_cost)))
        base_cost = cost(abs(Decimal(movement.total_cost_base or 0)))
        source_unit = cost(abs(Decimal(movement.unit_cost)))
        base_unit = cost(abs(Decimal(movement.unit_cost_base or 0)))
        effective_rate = _rate(base_cost, source_cost)
        total_cogs += source_cost
        total_cogs_base += base_cost
        movement_ids.append(movement.id)
        db.add(
            OrderFulfillmentItem(
                organization_id=tenant.organization_id,
                fulfillment_id=fulfillment.id,
                order_item_id=item.id,
                product_id=product.id,
                quantity=requested_quantity,
                currency=product.currency.upper(),
                base_currency=base_currency,
                unit_cost=source_unit,
                total_cost=source_cost,
                unit_cost_base=base_unit,
                total_cost_base=base_cost,
                effective_rate_to_base=effective_rate,
            )
        )

    fulfillment.total_cogs = cost(total_cogs)
    fulfillment.total_cogs_base = cost(total_cogs_base)

    journal_amount = money(total_cogs_base)
    if journal_amount > 0:
        inventory_ledger = _ledger(
            db,
            tenant.organization_id,
            tenant.user_id,
            system_key="inventory_asset",
            code="1450",
            name="Inventory Asset",
            category="asset",
            normal_balance="debit",
        )
        cogs_ledger = system_account(db, tenant.organization_id, "cost_of_sales")
        source_amount = cost(total_cogs)
        journal_rate = _rate(journal_amount, source_amount)
        post_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            entry_date=fulfillment.fulfillment_date,
            source_type="inventory_sale_cogs",
            source_id=fulfillment.id,
            lines=[
                PostingLine(
                    ledger_account_id=cogs_ledger.id,
                    debit=journal_amount,
                    currency=order.currency.upper(),
                    exchange_rate_to_base=journal_rate,
                    original_amount=source_amount,
                    description=f"COGS for {fulfillment.fulfillment_number}",
                ),
                PostingLine(
                    ledger_account_id=inventory_ledger.id,
                    credit=journal_amount,
                    currency=order.currency.upper(),
                    exchange_rate_to_base=journal_rate,
                    original_amount=source_amount,
                    description=f"Inventory issued for {order.order_number}",
                ),
            ],
            reference=fulfillment.fulfillment_number,
            memo=f"Inventory fulfillment for order {order.order_number}",
        )

    if order.status == "confirmed":
        order.status = "in_progress"
        order.started_at = datetime.now(timezone.utc)

    db.flush()
    record_activity(
        db,
        action="sales.order.fulfilled",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="order_fulfillment",
        entity_id=fulfillment.id,
        after={
            "fulfillment_number": fulfillment.fulfillment_number,
            "order_id": order.id,
            "order_number": order.order_number,
            "warehouse_id": warehouse.id,
            "warehouse_name": warehouse.name,
            "item_count": len(normalized_lines),
            "currency": fulfillment.currency,
            "total_cogs": str(fulfillment.total_cogs),
            "base_currency": base_currency,
            "total_cogs_base": str(fulfillment.total_cogs_base),
            "stock_movement_ids": movement_ids,
        },
        message=f"Order {order.order_number} fulfilled from {warehouse.name} ({fulfillment.fulfillment_number})",
        request=request,
    )
    complete_posting(
        db,
        idempotency,
        resource_type="order_fulfillment",
        resource_id=fulfillment.id,
    )
    return _fulfillment_read(db, tenant.organization_id, fulfillment.id)
