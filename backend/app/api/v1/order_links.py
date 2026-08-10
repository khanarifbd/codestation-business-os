from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.orders import Order
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Orders"])

OrderViewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]


class QuotationOrderLink(BaseModel):
    order_id: str
    order_number: str
    status: str


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
