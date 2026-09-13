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

    result: list[dict] = []
    for item in rows:
        source_type = item.entity_type or item.action.removeprefix("finance.").removesuffix(".reversed")
        after_data = item.after_data or {}
        result.append(
            {
                "id": item.id,
                "source_type": source_type,
                "source_id": item.entity_id,
                "action": item.action,
                "message": item.message,
                "reason": after_data.get("reason"),
                "reversal_date": after_data.get("reversal_date"),
                "reversal_journal_id": after_data.get("reversal_journal_id"),
                "status": "voided" if source_type == "expense" else "reversed",
                "resulting_source_status": after_data.get("status"),
                "actor_user_id": item.actor_user_id,
                "created_at": item.created_at,
            }
        )
    return result
