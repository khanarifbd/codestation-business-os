from __future__ import annotations

from sqlalchemy import event, select

from app.models.finance import InvoiceItem
from app.models.inventory import Product
from app.models.orders import Order, OrderItem
from app.models.sales import QuotationItem
from app.services.service_duration import service_end_date


def _product_duration(connection, organization_id: str, product_id: str | None) -> int | None:
    if not product_id:
        return None
    return connection.execute(
        select(Product.__table__.c.service_duration_months).where(
            Product.__table__.c.id == product_id,
            Product.__table__.c.organization_id == organization_id,
        )
    ).scalar_one_or_none()


@event.listens_for(Product, "before_insert")
@event.listens_for(Product, "before_update")
def normalize_catalog_service_duration(_mapper, _connection, target: Product) -> None:
    if target.item_type != "service":
        target.service_duration_months = None
    elif target.service_duration_months is not None and target.service_duration_months <= 0:
        raise ValueError("Service duration must be a positive number of months")


@event.listens_for(QuotationItem, "before_insert")
def snapshot_quotation_service_duration(_mapper, connection, target: QuotationItem) -> None:
    if target.item_type_snapshot != "service":
        target.service_duration_months_snapshot = None
        return
    if target.service_duration_months_snapshot is None:
        target.service_duration_months_snapshot = _product_duration(
            connection,
            target.organization_id,
            target.product_id,
        )


@event.listens_for(OrderItem, "before_insert")
def snapshot_order_service_duration(_mapper, connection, target: OrderItem) -> None:
    if target.item_type_snapshot != "service":
        target.service_duration_months_snapshot = None
        target.service_start_date = None
        target.service_end_date = None
        return

    months = target.service_duration_months_snapshot
    source_snapshot_found = False
    if target.quotation_item_id:
        source_row = connection.execute(
            select(QuotationItem.__table__.c.service_duration_months_snapshot).where(
                QuotationItem.__table__.c.id == target.quotation_item_id,
                QuotationItem.__table__.c.organization_id == target.organization_id,
            )
        ).first()
        if source_row is not None:
            source_snapshot_found = True
            months = source_row[0]
    if not source_snapshot_found and months is None:
        months = _product_duration(connection, target.organization_id, target.product_id)
    target.service_duration_months_snapshot = months

    if months is None:
        target.service_start_date = None
        target.service_end_date = None
        return

    start = target.service_start_date
    if start is None:
        start = connection.execute(
            select(Order.__table__.c.order_date).where(
                Order.__table__.c.id == target.order_id,
                Order.__table__.c.organization_id == target.organization_id,
            )
        ).scalar_one_or_none()
    if start is not None:
        target.service_start_date = start
        target.service_end_date = service_end_date(start, months)


@event.listens_for(InvoiceItem, "before_insert")
def snapshot_invoice_service_duration(_mapper, connection, target: InvoiceItem) -> None:
    if target.item_type_snapshot != "service":
        target.service_duration_months_snapshot = None
        return

    months = target.service_duration_months_snapshot
    source_snapshot_found = False
    if target.source_order_item_id:
        source_row = connection.execute(
            select(OrderItem.__table__.c.service_duration_months_snapshot).where(
                OrderItem.__table__.c.id == target.source_order_item_id,
                OrderItem.__table__.c.organization_id == target.organization_id,
            )
        ).first()
        if source_row is not None:
            source_snapshot_found = True
            months = source_row[0]
    if not source_snapshot_found and months is None:
        months = _product_duration(connection, target.organization_id, target.product_id)
    target.service_duration_months_snapshot = months
