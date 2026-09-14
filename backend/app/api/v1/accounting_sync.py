from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.api.dependencies import DbSession, require_tenant_permission
from app.services.accounting_integrity import audit_financial_integrity
from app.services.accounting_sync import sync_operational_accounting
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting", tags=["Accounting"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]


class AccountingIntegrityRead(BaseModel):
    counts: dict[str, int]
    issues: list[str]


class AccountingSyncRead(BaseModel):
    counts: dict[str, int]
    errors: list[str]
    integrity: AccountingIntegrityRead


@router.get("/integrity", response_model=AccountingIntegrityRead)
def accounting_integrity(db: DbSession, tenant: AccountingViewer):
    """Read-only operational-vs-GL audit. Never mutates or repairs data."""

    return AccountingIntegrityRead(**audit_financial_integrity(db, tenant.organization_id))


@router.post("/sync", response_model=AccountingSyncRead)
def sync_accounting(request: Request, db: DbSession, tenant: AccountingManager):
    # Repair/backfill only. Normal financial mutations post their journal entries
    # atomically and do not depend on this endpoint.
    result = sync_operational_accounting(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        base_currency=tenant.organization.currency,
    )
    integrity_result = audit_financial_integrity(db, tenant.organization_id)
    integrity = AccountingIntegrityRead(**integrity_result)
    result["counts"]["integrity_issues"] = int(integrity.counts["issue_count"])

    record_activity(
        db,
        action="accounting.operational_sync.completed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="organization",
        entity_id=tenant.organization_id,
        after=result["counts"],
        metadata={
            "mode": "repair_backfill",
            "error_count": len(result["errors"]),
            "errors": result["errors"][:20],
            "integrity_counts": integrity.counts,
            "integrity_issues": integrity.issues[:20],
        },
        message="Operational accounting repair/backfill completed and financial integrity audited",
        request=request,
    )
    db.commit()

    # Repair execution errors and read-only integrity findings are intentionally
    # separate: an audit can flag historical/manual fixtures that the repair scope
    # must never silently mutate.
    return AccountingSyncRead(
        counts=result["counts"],
        errors=result["errors"],
        integrity=integrity,
    )
