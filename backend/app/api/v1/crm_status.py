from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.common import utc_now
from app.models.crm import Lead, LeadInteraction, LeadStatus
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm", tags=["CRM"])

CrmManager = Annotated[TenantContext, Depends(require_tenant_permission("crm.manage"))]


class LeadStatusChange(BaseModel):
    status_id: str


class LeadStatusChangeRead(BaseModel):
    lead_id: str
    status_id: str
    status_name: str
    status_category: str
    previous_status_id: str
    previous_status_name: str
    locked: bool


@router.patch("/leads/{lead_id}/status", response_model=LeadStatusChangeRead)
def change_lead_status(
    lead_id: str,
    payload: LeadStatusChange,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadStatusChangeRead:
    lead = db.scalar(
        select(Lead)
        .where(Lead.id == lead_id, Lead.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")

    current_status = db.scalar(
        select(LeadStatus).where(
            LeadStatus.id == lead.status_id,
            LeadStatus.organization_id == tenant.organization_id,
        )
    )
    target_status = db.scalar(
        select(LeadStatus).where(
            LeadStatus.id == payload.status_id,
            LeadStatus.organization_id == tenant.organization_id,
            LeadStatus.is_active.is_(True),
        )
    )
    if target_status is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead status is not active in this company")
    if current_status is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Current lead status is unavailable")

    if current_status.id == target_status.id:
        return LeadStatusChangeRead(
            lead_id=lead.id,
            status_id=target_status.id,
            status_name=target_status.name,
            status_category=target_status.category,
            previous_status_id=current_status.id,
            previous_status_name=current_status.name,
            locked=current_status.category == "won" or lead.converted_client_id is not None,
        )

    if lead.converted_client_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This lead has already been converted to a client. Its pipeline status is locked.",
        )

    if current_status.category == "won":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Won status is locked and can no longer be changed.",
        )

    changed_at = utc_now()
    lead.status_id = target_status.id

    timeline = LeadInteraction(
        organization_id=tenant.organization_id,
        lead_id=lead.id,
        interaction_type="status_change",
        subject="Status changed",
        body=f"{current_status.name} → {target_status.name}",
        completed_at=changed_at,
        created_by_user_id=tenant.user_id,
    )
    db.add(timeline)
    db.flush()

    record_activity(
        db,
        action="crm.lead.status_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead",
        entity_id=lead.id,
        before={"status_id": current_status.id, "status_name": current_status.name},
        after={
            "status_id": target_status.id,
            "status_name": target_status.name,
            "status_category": target_status.category,
            "locked": target_status.category == "won",
        },
        metadata={"timeline_interaction_id": timeline.id},
        message=f"Lead {lead.lead_code} status changed from {current_status.name} to {target_status.name}",
        request=request,
    )
    db.commit()

    return LeadStatusChangeRead(
        lead_id=lead.id,
        status_id=target_status.id,
        status_name=target_status.name,
        status_category=target_status.category,
        previous_status_id=current_status.id,
        previous_status_name=current_status.name,
        locked=target_status.category == "won",
    )
