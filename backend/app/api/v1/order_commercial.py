from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.api.dependencies import DbSession, require_tenant_permission
from app.schemas.order_commercial import (
    BillingMilestoneAction,
    BillingMilestoneCreate,
    BillingMilestoneRead,
    OrderChangeAction,
    OrderChangeCreate,
    OrderChangeRead,
    OrderCommercialSummary,
)
from app.services.order_commercial import (
    act_on_billing_milestone,
    act_on_change,
    commercial_summary,
    create_billing_milestone,
    create_change,
    create_milestone_invoice,
    get_order,
)
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/orders", tags=["Order Commercial"])
OrderViewer = Annotated[TenantContext, Depends(require_tenant_permission("orders.view"))]
OrderManager = Annotated[TenantContext, Depends(require_tenant_permission("orders.manage"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


@router.get("/{order_id}/commercial", response_model=OrderCommercialSummary)
def get_commercial(order_id: str, db: DbSession, tenant: OrderViewer):
    return commercial_summary(db, tenant.organization_id, order_id)


@router.post("/{order_id}/changes", response_model=OrderChangeRead, status_code=status.HTTP_201_CREATED)
def add_change(order_id: str, payload: OrderChangeCreate, request: Request, db: DbSession, tenant: OrderManager):
    order = get_order(db, tenant.organization_id, order_id, lock=True)
    return create_change(db, order, payload, tenant.user_id, request)


@router.post("/{order_id}/changes/{change_id}/action", response_model=OrderChangeRead)
def change_action(order_id: str, change_id: str, payload: OrderChangeAction, request: Request, db: DbSession, tenant: OrderManager):
    order = get_order(db, tenant.organization_id, order_id, lock=True)
    return act_on_change(db, order, change_id, payload.action, tenant.user_id, request)


@router.post("/{order_id}/billing-milestones", response_model=BillingMilestoneRead, status_code=status.HTTP_201_CREATED)
def add_billing_milestone(order_id: str, payload: BillingMilestoneCreate, request: Request, db: DbSession, tenant: OrderManager):
    order = get_order(db, tenant.organization_id, order_id, lock=True)
    return create_billing_milestone(db, order, payload, tenant.user_id, request)


@router.post("/{order_id}/billing-milestones/{milestone_id}/action", response_model=BillingMilestoneRead)
def billing_action(order_id: str, milestone_id: str, payload: BillingMilestoneAction, request: Request, db: DbSession, tenant: OrderManager):
    order = get_order(db, tenant.organization_id, order_id, lock=True)
    return act_on_billing_milestone(db, order, milestone_id, payload.action, tenant.user_id, request)


@router.post("/{order_id}/billing-milestones/{milestone_id}/invoice", status_code=status.HTTP_201_CREATED)
def create_billing_invoice(order_id: str, milestone_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    order = get_order(db, tenant.organization_id, order_id, lock=True)
    invoice = create_milestone_invoice(db, order, milestone_id, tenant.user_id, request)
    return {"invoice_id": invoice.id, "invoice_number": invoice.invoice_number, "status": invoice.status, "currency": invoice.currency, "total": str(invoice.total)}
