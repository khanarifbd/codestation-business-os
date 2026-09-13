from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Lead
from app.models.orders import Order
from app.schemas.orders import OrderDetail, OrderSourceLeadUpdate
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders"])

OrderViewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
OrderManager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]


class QuotationOrderLink(BaseModel):
    order_id: str
    order_number: str
    status: str


class OrderCurrencyValue(BaseModel):
    currency: str
    amount: Decimal


class OrderValueSummary(BaseModel):
    total: list[OrderCurrencyValue]
    confirmed: list[OrderCurrencyValue]
    in_progress: list[OrderCurrencyValue]
    completed: list[OrderCurrencyValue]
    cancelled: list[OrderCurrencyValue]


def _currency_values(values: dict[str, Decimal]) -> list[OrderCurrencyValue]:
    return [
        OrderCurrencyValue(currency=currency, amount=amount)
        for currency, amount in sorted(values.items())
    ]


@router.get("/quotations/{quotation_id}/order-link", response_model=QuotationOrderLink | None)
def get_quotation_order_link(
    quotation_id: str,
    db: DbSession,
    tenant: OrderViewer,
) -> QuotationOrderLink | None:
    order = db.scalar(
        select(Order).where(
            Order.organization_id == tenant.organization_id,
            Order.quotation_id == quotation_id,
        )
    )
    if order is None:
        return None
    return QuotationOrderLink(order_id=order.id, order_number=order.order_number, status=order.status)


@router.get("/order-value-summary", response_model=OrderValueSummary)
def get_order_value_summary(db: DbSession, tenant: OrderViewer) -> OrderValueSummary:
    rows = db.execute(
        select(
            Order.status,
            Order.currency,
            func.coalesce(func.sum(Order.total), 0),
        )
        .where(Order.organization_id == tenant.organization_id)
        .group_by(Order.status, Order.currency)
        .order_by(Order.currency.asc())
    ).all()

    total_values: dict[str, Decimal] = {}
    status_values: dict[str, dict[str, Decimal]] = {
        "confirmed": {},
        "in_progress": {},
        "completed": {},
        "cancelled": {},
    }
    for order_status, currency, amount in rows:
        currency_code = str(currency).upper()
        decimal_amount = Decimal(amount or 0)
        total_values[currency_code] = total_values.get(currency_code, Decimal("0")) + decimal_amount
        if order_status in status_values:
            status_values[order_status][currency_code] = decimal_amount

    return OrderValueSummary(
        total=_currency_values(total_values),
        confirmed=_currency_values(status_values["confirmed"]),
        in_progress=_currency_values(status_values["in_progress"]),
        completed=_currency_values(status_values["completed"]),
        cancelled=_currency_values(status_values["cancelled"]),
    )


@router.patch("/orders/{order_id}/source-lead", response_model=OrderDetail)
def update_order_source_lead(
    order_id: str,
    payload: OrderSourceLeadUpdate,
    request: Request,
    db: DbSession,
    tenant: OrderManager,
) -> OrderDetail:
    from app.api.v1.orders import _detail

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
    if order.quotation_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Quotation-backed orders inherit their source lead from the quotation and cannot be relinked manually",
        )

    next_lead_id = payload.source_lead_id
    if next_lead_id:
        lead = db.scalar(
            select(Lead).where(
                Lead.id == next_lead_id,
                Lead.organization_id == tenant.organization_id,
                Lead.converted_client_id == order.client_id,
            )
        )
        if lead is None:
            raise HTTPException(
                status_code=400,
                detail="Source lead must belong to this company and be converted to this order's client",
            )

    before_lead_id = order.source_lead_id
    if before_lead_id == next_lead_id:
        return _detail(db, tenant.organization_id, order.id)

    order.source_lead_id = next_lead_id
    db.flush()
    record_activity(
        db,
        action="sales.order.source_lead_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="order",
        entity_id=order.id,
        before={"source_lead_id": before_lead_id},
        after={"source_lead_id": order.source_lead_id},
        metadata={"client_id": order.client_id, "order_number": order.order_number},
        message=f"Source lead updated for {order.order_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, order.id)
