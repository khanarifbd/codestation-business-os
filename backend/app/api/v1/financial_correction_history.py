from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.activity_log import ActivityLog
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/corrections", tags=["Accounting - Corrections"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]


@router.get("/history")
def correction_history(db: DbSession, tenant: AccountingViewer, limit: int = 100):
    row_limit = min(max(limit, 1), 200)
    rows = db.scalars(
        select(ActivityLog)
        .where(
            ActivityLog.organization_id == tenant.organization_id,
            ActivityLog.action.like("finance.%.reversed"),
            ActivityLog.outcome == "success",
        )
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(row_limit)
    ).all()

    return [
        {
            "id": item.id,
            "source_type": (item.entity_type or item.action.removeprefix("finance.").removesuffix(".reversed")),
            "source_id": item.entity_id,
            "action": item.action,
            "message": item.message,
            "reason": (item.after_data or {}).get("reason"),
            "reversal_date": (item.after_data or {}).get("reversal_date"),
            "reversal_journal_id": (item.after_data or {}).get("reversal_journal_id"),
            "status": (item.after_data or {}).get("status", "reversed"),
            "actor_user_id": item.actor_user_id,
            "created_at": item.created_at,
        }
        for item in rows
    ]
