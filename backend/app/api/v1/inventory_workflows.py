from __future__ import annotations

from decimal import Decimal
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.api.v1.inventory import _balance, _stock_in, _stock_out, cost, qty
from app.models.expenses import Vendor
from app.models.inventory import InventoryBalance, Product, Warehouse
from app.schemas.inventory_workflows import InventoryTransferCreate
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/inventory", tags=["Inventory"])
Viewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
Manager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


@router.get("/dashboard-summary")
def dashboard_summary(db: DbSession, tenant: Viewer):
    stock_products = db.scalar(
        select(func.count()).select_from(Product).where(
            Product.organization_id == tenant.organization_id,
            Product.item_type == "stock_item",
            Product.is_active.is_(True),
        )
    ) or 0
    service_items = db.scalar(
        select(func.count()).select_from(Product).where(
            Product.organization_id == tenant.organization_id,
            Product.item_type == "service",
            Product.is_active.is_(True),
        )
    ) or 0
    active_suppliers = db.scalar(
        select(func.count()).select_from(Vendor).where(
            Vendor.organization_id == tenant.organization_id,
            Vendor.is_active.is_(True),
        )
    ) or 0
    active_warehouses = db.scalar(
        select(func.count()).select_from(Warehouse).where(
            Warehouse.organization_id == tenant.organization_id,
            Warehouse.is_active.is_(True),
        )
    ) or 0

    value_rows = db.execute(
        select(Product.currency, func.coalesce(func.sum(InventoryBalance.inventory_value), 0))
        .join(
            Product,
            (Product.id == InventoryBalance.product_id)
            & (Product.organization_id == tenant.organization_id),
        )
        .where(InventoryBalance.organization_id == tenant.organization_id)
        .group_by(Product.currency)
        .order_by(Product.currency)
    ).all()
    inventory_values = [
        {"currency": str(currency).upper(), "value": cost(value)}
        for currency, value in value_rows
        if Decimal(value or 0) != 0
    ]

    low_stock = []
    out_of_stock_count = 0
    rows = db.execute(
        select(Product, func.coalesce(func.sum(InventoryBalance.on_hand_quantity), 0))
        .outerjoin(
            InventoryBalance,
            (InventoryBalance.product_id == Product.id)
            & (InventoryBalance.organization_id == tenant.organization_id),
        )
        .where(
            Product.organization_id == tenant.organization_id,
            Product.item_type == "stock_item",
            Product.track_inventory.is_(True),
            Product.is_active.is_(True),
        )
        .group_by(Product.id)
        .order_by(Product.name)
    ).all()
    for product, on_hand in rows:
        on_hand_value = Decimal(on_hand or 0)
        if on_hand_value <= 0:
            out_of_stock_count += 1
        if on_hand_value <= Decimal(product.reorder_level):
            low_stock.append(
                {
                    "id": product.id,
                    "sku": product.sku,
                    "name": product.name,
                    "on_hand": qty(on_hand_value),
                    "reorder_level": product.reorder_level,
                    "unit": product.unit,
                }
            )

    return {
        "stock_products": stock_products,
        "service_items": service_items,
        "inventory_values": inventory_values,
        "low_stock_count": len(low_stock),
        "out_of_stock_count": out_of_stock_count,
        "active_suppliers": active_suppliers,
        "active_warehouses": active_warehouses,
        "low_stock": low_stock[:20],
    }


@router.post("/transfers", status_code=status.HTTP_201_CREATED)
def transfer_stock(
    payload: InventoryTransferCreate,
    request: Request,
    db: DbSession,
    tenant: Manager,
):
    product = db.scalar(
        select(Product).where(
            Product.id == payload.product_id,
            Product.organization_id == tenant.organization_id,
            Product.item_type == "stock_item",
            Product.track_inventory.is_(True),
            Product.is_active.is_(True),
        )
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Active tracked stock product not found")

    warehouses = db.scalars(
        select(Warehouse)
        .where(
            Warehouse.organization_id == tenant.organization_id,
            Warehouse.id.in_([payload.from_warehouse_id, payload.to_warehouse_id]),
            Warehouse.is_active.is_(True),
        )
        .with_for_update()
    ).all()
    by_id = {warehouse.id: warehouse for warehouse in warehouses}
    source = by_id.get(payload.from_warehouse_id)
    destination = by_id.get(payload.to_warehouse_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Active source warehouse not found")
    if destination is None:
        raise HTTPException(status_code=404, detail="Active destination warehouse not found")

    transfer_quantity = qty(payload.quantity)
    source_balance = _balance(
        db,
        tenant.organization_id,
        product.id,
        source.id,
        lock=True,
    )
    available = Decimal(source_balance.on_hand_quantity)
    if transfer_quantity > available:
        raise HTTPException(
            status_code=409,
            detail=f"Insufficient stock in {source.name}. Available {qty(available)}",
        )

    transfer_id = str(uuid4())
    reference = payload.reference.strip() if payload.reference else None
    reason = payload.reason.strip()
    source_movement = _stock_out(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        product=product,
        warehouse=source,
        movement_date=payload.transfer_date,
        quantity=transfer_quantity,
        source_type="warehouse_transfer",
        source_id=transfer_id,
        reference=reference,
        reason=reason,
    )
    source_movement.movement_type = "transfer_out"
    incoming_cost = cost(abs(Decimal(source_movement.total_cost)))
    destination_movement = _stock_in(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        product=product,
        warehouse=destination,
        movement_date=payload.transfer_date,
        quantity=transfer_quantity,
        incoming_total_cost=incoming_cost,
        source_type="warehouse_transfer",
        source_id=transfer_id,
        reference=reference,
        reason=reason,
    )
    destination_movement.movement_type = "transfer_in"

    record_activity(
        db,
        action="inventory.stock.transferred",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="warehouse_transfer",
        entity_id=transfer_id,
        after={
            "product_id": product.id,
            "from_warehouse_id": source.id,
            "to_warehouse_id": destination.id,
            "quantity": str(transfer_quantity),
            "unit_cost": str(source_movement.unit_cost),
            "total_cost": str(incoming_cost),
            "currency": product.currency,
            "reason": reason,
            "reference": reference,
        },
        message=f"Transferred {transfer_quantity} {product.unit} of {product.sku} from {source.name} to {destination.name}",
        request=request,
    )
    db.commit()
    return {
        "id": transfer_id,
        "status": "posted",
        "product_id": product.id,
        "currency": product.currency,
        "quantity": transfer_quantity,
        "from_warehouse_id": source.id,
        "to_warehouse_id": destination.id,
    }
