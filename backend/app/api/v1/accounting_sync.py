from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.api.dependencies import DbSession, require_tenant_permission
from app.services.accounting_sync import sync_operational_accounting
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting", tags=["Accounting"])
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


class AccountingSyncRead(BaseModel):
    counts: dict[str, int]
    errors: list[str]


@router.post("/sync", response_model=AccountingSyncRead)
def sync_accounting(request: Request, db: DbSession, tenant: AccountingManager):
    result = sync_operational_accounting(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        base_currency=tenant.organization.currency,
    )
    record_activity(
        db,
        action="accounting.operational_sync.completed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization",
        entity_id=tenant.organization_id,
        after=result["counts"],
        metadata={"error_count": len(result["errors"]), "errors": result["errors"][:20]},
        message="Operational finance records synchronized to accounting journals",
        request=request,
    )
    db.commit()
    return AccountingSyncRead(**result)
