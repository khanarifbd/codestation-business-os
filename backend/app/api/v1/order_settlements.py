from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.api.dependencies import DbSession, require_tenant_permission
from app.schemas.order_settlements import (
    OrderSettlementCreate,
    OrderSettlementMeta,
    OrderSettlementRead,
    OrderSettlementState,
)
from app.services.order_settlement import settle_order, settlement_meta, settlement_state
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance/orders", tags=["Order Settlement"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


@router.get("/{order_id}/settlement", response_model=OrderSettlementState)
def get_order_settlement_state(
    order_id: str,
    db: DbSession,
    tenant: FinanceViewer,
) -> OrderSettlementState:
    return settlement_state(
        db,
        organization_id=tenant.organization_id,
        order_id=order_id,
    )


@router.get("/{order_id}/settlement-meta", response_model=OrderSettlementMeta)
def get_order_settlement_meta(
    order_id: str,
    db: DbSession,
    tenant: FinanceViewer,
) -> OrderSettlementMeta:
    return settlement_meta(
        db,
        organization_id=tenant.organization_id,
        order_id=order_id,
    )


@router.post(
    "/{order_id}/settle",
    response_model=OrderSettlementRead,
    status_code=status.HTTP_201_CREATED,
)
def create_order_settlement(
    order_id: str,
    payload: OrderSettlementCreate,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
) -> OrderSettlementRead:
    return settle_order(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        organization_timezone=tenant.organization.timezone,
        order_id=order_id,
        payload=payload,
        request=request,
    )
