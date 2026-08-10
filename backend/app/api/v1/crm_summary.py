from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Lead, LeadStatus
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm", tags=["CRM"])
CrmViewer = Annotated[TenantContext, Depends(require_tenant_permission("crm.view"))]


@router.get("/summary")
def get_crm_summary(db: DbSession, tenant: CrmViewer) -> dict[str, int]:
    organization_id = tenant.organization_id
    total = db.scalar(select(func.count(Lead.id)).where(Lead.organization_id == organization_id)) or 0
    open_count = db.scalar(
        select(func.count(Lead.id))
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(
            Lead.organization_id == organization_id,
            LeadStatus.category.in_(["open", "qualified"]),
            Lead.converted_client_id.is_(None),
        )
    ) or 0
    won = db.scalar(
        select(func.count(Lead.id))
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(Lead.organization_id == organization_id, LeadStatus.category == "won")
    ) or 0
    lost = db.scalar(
        select(func.count(Lead.id))
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(Lead.organization_id == organization_id, LeadStatus.category == "lost")
    ) or 0
    due_followups = db.scalar(
        select(func.count(Lead.id)).where(
            Lead.organization_id == organization_id,
            Lead.converted_client_id.is_(None),
            Lead.next_follow_up_at.is_not(None),
            Lead.next_follow_up_at <= datetime.now(timezone.utc),
        )
    ) or 0
    converted = db.scalar(
        select(func.count(Lead.id)).where(
            Lead.organization_id == organization_id,
            Lead.converted_client_id.is_not(None),
        )
    ) or 0
    return {
        "total_leads": total,
        "open_leads": open_count,
        "won_leads": won,
        "lost_leads": lost,
        "due_followups": due_followups,
        "converted_leads": converted,
    }
