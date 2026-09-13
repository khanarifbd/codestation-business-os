from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.finance import Invoice, InvoiceItem
from app.models.inventory import Product
from app.models.orders import Order, OrderItem
from app.models.sales import Quotation, QuotationItem
from app.schemas.services import (
    ClientServiceRead,
    ServiceCatalogRead,
    ServiceDurationUpdate,
    ServicePeriodUpdate,
    ServiceSalesRow,
)
from app.services.activity_log import record_activity
from app.services.service_duration import service_end_date
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/services", tags=["Services"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
OrderViewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
OrderManager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _service_status(today, start_date, end_date, duration_months: int | None) -> str:
    if duration_months is None:
        return "one_time"
    if start_date and today < start_date:
        return "upcoming"
    if end_date and today > end_date:
        return "expired"
    return "active"


@router.get("/catalog", response_model=list[ServiceCatalogRead])
def list_service_catalog(db: DbSession, tenant: FinanceViewer, include_inactive: bool = True) -> list[ServiceCatalogRead]:
    query = select(Product).where(
        Product.organization_id == tenant.organization_id,
        Product.item_type == "service",
    )
    if not include_inactive:
        query = query.where(Product.is_active.is_(True))
    rows = db.scalars(query.order_by(Product.is_active.desc(), Product.name.asc())).all()
    return [
        ServiceCatalogRead(
            product_id=item.id,
            sku=item.sku,
            name=item.name,
            currency=item.currency,
            selling_price=item.selling_price,
            duration_months=item.service_duration_months,
            is_active=item.is_active,
        )
        for item in rows
    ]


@router.patch("/catalog/{product_id}/duration", response_model=ServiceCatalogRead)
def update_service_duration(
    product_id: str,
    payload: ServiceDurationUpdate,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
) -> ServiceCatalogRead:
    product = db.scalar(
        select(Product)
        .where(Product.id == product_id, Product.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if product is None:
        raise HTTPException(status_code=404, detail="Product or service not found")
    if product.item_type != "service":
        raise HTTPException(status_code=409, detail="Duration can only be set on service catalog items")

    before = {"service_duration_months": product.service_duration_months}
    product.service_duration_months = payload.duration_months
    record_activity(
        db,
        action="services.catalog.duration_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="product",
        entity_id=product.id,
        before=before,
        after={"service_duration_months": product.service_duration_months},
        message=f"Service duration updated: {product.sku} · {product.name}",
        request=request,
    )
    db.commit()
    db.refresh(product)
    return ServiceCatalogRead(
        product_id=product.id,
        sku=product.sku,
        name=product.name,
        currency=product.currency,
        selling_price=product.selling_price,
        duration_months=product.service_duration_months,
        is_active=product.is_active,
    )


@router.patch("/order-items/{order_item_id}/period", response_model=ClientServiceRead)
def update_service_period(
    order_item_id: str,
    payload: ServicePeriodUpdate,
    request: Request,
    db: DbSession,
    tenant: OrderManager,
) -> ClientServiceRead:
    row = db.execute(
        select(OrderItem, Order)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.id == order_item_id,
            OrderItem.organization_id == tenant.organization_id,
            Order.organization_id == tenant.organization_id,
        )
        .with_for_update()
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Order service not found")
    item, order = row
    if item.item_type_snapshot != "service" or item.service_duration_months_snapshot is None:
        raise HTTPException(status_code=409, detail="Only fixed-term services have an editable service period")
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled order services cannot be changed")

    before = {
        "service_start_date": item.service_start_date.isoformat() if item.service_start_date else None,
        "service_end_date": item.service_end_date.isoformat() if item.service_end_date else None,
    }
    item.service_start_date = payload.start_date
    item.service_end_date = service_end_date(payload.start_date, item.service_duration_months_snapshot)
    record_activity(
        db,
        action="services.order_period.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="order_item",
        entity_id=item.id,
        before=before,
        after={
            "service_start_date": item.service_start_date.isoformat(),
            "service_end_date": item.service_end_date.isoformat(),
            "duration_months": item.service_duration_months_snapshot,
        },
        metadata={"order_id": order.id, "order_number": order.order_number},
        message=f"Service period updated for {item.item_name_snapshot} on {order.order_number}",
        request=request,
    )
    db.commit()
    today = _tenant_today(tenant.organization.timezone)
    return ClientServiceRead(
        order_item_id=item.id,
        order_id=order.id,
        order_number=order.order_number,
        order_status=order.status,
        product_id=item.product_id,
        sku=item.sku_snapshot,
        name=item.item_name_snapshot,
        quantity=item.quantity,
        currency=order.currency,
        line_total=item.line_total,
        duration_months=item.service_duration_months_snapshot,
        start_date=item.service_start_date,
        end_date=item.service_end_date,
        service_status=_service_status(today, item.service_start_date, item.service_end_date, item.service_duration_months_snapshot),
    )


@router.get("/clients/{client_id}", response_model=list[ClientServiceRead])
def list_client_services(client_id: str, db: DbSession, tenant: OrderViewer) -> list[ClientServiceRead]:
    if db.scalar(select(Client.id).where(Client.id == client_id, Client.organization_id == tenant.organization_id)) is None:
        raise HTTPException(status_code=404, detail="Client not found")
    rows = db.execute(
        select(OrderItem, Order)
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.organization_id == tenant.organization_id,
            Order.organization_id == tenant.organization_id,
            Order.client_id == client_id,
            Order.status != "cancelled",
            OrderItem.item_type_snapshot == "service",
        )
        .order_by(Order.order_date.desc(), OrderItem.sort_order.asc())
        .limit(300)
    ).all()
    today = _tenant_today(tenant.organization.timezone)
    result: list[ClientServiceRead] = []
    for item, order in rows:
        start_date = item.service_start_date
        end_date = item.service_end_date
        if item.service_duration_months_snapshot is not None and start_date is None:
            start_date = order.order_date
            end_date = service_end_date(start_date, item.service_duration_months_snapshot)
        result.append(
            ClientServiceRead(
                order_item_id=item.id,
                order_id=order.id,
                order_number=order.order_number,
                order_status=order.status,
                product_id=item.product_id,
                sku=item.sku_snapshot,
                name=item.item_name_snapshot,
                quantity=item.quantity,
                currency=order.currency,
                line_total=item.line_total,
                duration_months=item.service_duration_months_snapshot,
                start_date=start_date,
                end_date=end_date,
                service_status=_service_status(today, start_date, end_date, item.service_duration_months_snapshot),
            )
        )
    return result


def _aggregate_pairs(rows) -> dict[str, tuple[Decimal, Decimal]]:
    return {
        str(product_id): (Decimal(quantity or 0), Decimal(value or 0))
        for product_id, quantity, value in rows
        if product_id
    }


@router.get("/sales-summary", response_model=list[ServiceSalesRow])
def service_sales_summary(db: DbSession, tenant: FinanceViewer) -> list[ServiceSalesRow]:
    org_id = tenant.organization_id
    products = db.scalars(
        select(Product)
        .where(Product.organization_id == org_id, Product.item_type == "service")
        .order_by(Product.is_active.desc(), Product.name.asc())
        .limit(500)
    ).all()

    quoted = _aggregate_pairs(db.execute(
        select(QuotationItem.product_id, func.sum(QuotationItem.quantity), func.sum(QuotationItem.line_total))
        .join(Quotation, Quotation.id == QuotationItem.quotation_id)
        .where(
            QuotationItem.organization_id == org_id,
            Quotation.organization_id == org_id,
            Quotation.status != "cancelled",
            QuotationItem.item_type_snapshot == "service",
            QuotationItem.product_id.is_not(None),
        )
        .group_by(QuotationItem.product_id)
    ).all())
    ordered = _aggregate_pairs(db.execute(
        select(OrderItem.product_id, func.sum(OrderItem.quantity), func.sum(OrderItem.line_total))
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.organization_id == org_id,
            Order.organization_id == org_id,
            Order.status != "cancelled",
            OrderItem.item_type_snapshot == "service",
            OrderItem.product_id.is_not(None),
        )
        .group_by(OrderItem.product_id)
    ).all())
    invoiced = _aggregate_pairs(db.execute(
        select(InvoiceItem.product_id, func.sum(InvoiceItem.quantity), func.sum(InvoiceItem.line_total))
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .where(
            InvoiceItem.organization_id == org_id,
            Invoice.organization_id == org_id,
            Invoice.status != "cancelled",
            InvoiceItem.item_type_snapshot == "service",
            InvoiceItem.product_id.is_not(None),
        )
        .group_by(InvoiceItem.product_id)
    ).all())
    fully_paid = {
        str(product_id): Decimal(value or 0)
        for product_id, value in db.execute(
            select(InvoiceItem.product_id, func.sum(InvoiceItem.line_total))
            .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
            .where(
                InvoiceItem.organization_id == org_id,
                Invoice.organization_id == org_id,
                Invoice.status == "paid",
                InvoiceItem.item_type_snapshot == "service",
                InvoiceItem.product_id.is_not(None),
            )
            .group_by(InvoiceItem.product_id)
        ).all()
        if product_id
    }

    today = _tenant_today(tenant.organization.timezone)
    term_counts: dict[str, list[int]] = {}
    term_rows = db.execute(
        select(
            OrderItem.product_id,
            OrderItem.service_duration_months_snapshot,
            OrderItem.service_start_date,
            OrderItem.service_end_date,
            Order.order_date,
        )
        .join(Order, Order.id == OrderItem.order_id)
        .where(
            OrderItem.organization_id == org_id,
            Order.organization_id == org_id,
            Order.status != "cancelled",
            OrderItem.item_type_snapshot == "service",
            OrderItem.product_id.is_not(None),
            OrderItem.service_duration_months_snapshot.is_not(None),
        )
    ).all()
    for product_id, duration, start, end, order_date in term_rows:
        if not product_id or duration is None:
            continue
        start = start or order_date
        end = end or service_end_date(start, duration)
        counts = term_counts.setdefault(str(product_id), [0, 0, 0])
        status = _service_status(today, start, end, duration)
        if status == "active":
            counts[0] += 1
        elif status == "upcoming":
            counts[1] += 1
        elif status == "expired":
            counts[2] += 1

    rows: list[ServiceSalesRow] = []
    for product in products:
        quoted_qty, quoted_value = quoted.get(product.id, (Decimal("0"), Decimal("0")))
        ordered_qty, ordered_value = ordered.get(product.id, (Decimal("0"), Decimal("0")))
        invoiced_qty, invoiced_value = invoiced.get(product.id, (Decimal("0"), Decimal("0")))
        active, upcoming, expired = term_counts.get(product.id, [0, 0, 0])
        rows.append(
            ServiceSalesRow(
                product_id=product.id,
                sku=product.sku,
                name=product.name,
                currency=product.currency,
                duration_months=product.service_duration_months,
                quoted_quantity=quoted_qty,
                quoted_value=quoted_value,
                ordered_quantity=ordered_qty,
                ordered_value=ordered_value,
                invoiced_quantity=invoiced_qty,
                invoiced_value=invoiced_value,
                fully_paid_invoice_value=fully_paid.get(product.id, Decimal("0")),
                active_terms=active,
                upcoming_terms=upcoming,
                expired_terms=expired,
            )
        )
    return rows
