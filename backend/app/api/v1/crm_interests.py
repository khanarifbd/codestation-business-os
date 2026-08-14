from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Lead, LeadInterest
from app.schemas.crm import LeadInterestRead, LeadInterestReplace
from app.services.activity_log import record_activity
from app.services.sales_catalog import resolve_sales_line
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm", tags=["CRM"])
CrmViewer = Annotated[TenantContext, Depends(require_tenant_permission("crm.view"))]
CrmManager = Annotated[TenantContext, Depends(require_tenant_permission("crm.manage"))]


def _lead(db: DbSession, organization_id: str, lead_id: str, *, lock: bool = False) -> Lead:
    query = select(Lead).where(Lead.id == lead_id, Lead.organization_id == organization_id)
    if lock:
        query = query.with_for_update()
    lead = db.scalar(query)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


def _read(item: LeadInterest) -> LeadInterestRead:
    return LeadInterestRead(
        id=item.id,
        product_id=item.product_id,
        sort_order=item.sort_order,
        item_name_snapshot=item.item_name_snapshot,
        description=item.description,
        item_type_snapshot=item.item_type_snapshot,
        unit_snapshot=item.unit_snapshot,
        currency=item.currency,
        quantity=item.quantity,
        estimated_unit_price=item.estimated_unit_price,
        notes=item.notes,
    )


@router.get("/leads/{lead_id}/interests", response_model=list[LeadInterestRead])
def list_lead_interests(lead_id: str, db: DbSession, tenant: CrmViewer) -> list[LeadInterestRead]:
    _lead(db, tenant.organization_id, lead_id)
    rows = db.scalars(
        select(LeadInterest)
        .where(
            LeadInterest.organization_id == tenant.organization_id,
            LeadInterest.lead_id == lead_id,
        )
        .order_by(LeadInterest.sort_order.asc(), LeadInterest.created_at.asc())
    ).all()
    return [_read(item) for item in rows]


@router.put("/leads/{lead_id}/interests", response_model=list[LeadInterestRead])
def replace_lead_interests(
    lead_id: str,
    payload: LeadInterestReplace,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> list[LeadInterestRead]:
    lead = _lead(db, tenant.organization_id, lead_id, lock=True)
    currency = (lead.currency or tenant.organization.currency).upper()
    previous = db.scalars(
        select(LeadInterest).where(
            LeadInterest.organization_id == tenant.organization_id,
            LeadInterest.lead_id == lead.id,
        )
    ).all()
    before = [
        {"id": item.id, "product_id": item.product_id, "name": item.item_name_snapshot, "quantity": str(item.quantity)}
        for item in previous
    ]
    db.execute(
        delete(LeadInterest).where(
            LeadInterest.organization_id == tenant.organization_id,
            LeadInterest.lead_id == lead.id,
        )
    )

    created: list[LeadInterest] = []
    for index, source in enumerate(payload.interests):
        snapshot = resolve_sales_line(
            db,
            organization_id=tenant.organization_id,
            currency=currency,
            product_id=source.product_id,
            item_name=source.item_name,
            item_type=source.item_type,
            unit=source.unit,
            description=source.description,
        )
        item = LeadInterest(
            organization_id=tenant.organization_id,
            lead_id=lead.id,
            product_id=snapshot.product_id,
            sort_order=index,
            item_name_snapshot=snapshot.item_name,
            description=snapshot.description,
            item_type_snapshot=snapshot.item_type,
            unit_snapshot=snapshot.unit,
            currency=currency,
            quantity=source.quantity,
            estimated_unit_price=(
                source.estimated_unit_price
                if source.estimated_unit_price is not None
                else snapshot.suggested_unit_price
            ),
            notes=source.notes.strip() if source.notes and source.notes.strip() else None,
            created_by_user_id=tenant.user_id,
        )
        db.add(item)
        created.append(item)
    db.flush()

    after = [
        {"id": item.id, "product_id": item.product_id, "name": item.item_name_snapshot, "quantity": str(item.quantity)}
        for item in created
    ]
    record_activity(
        db,
        action="crm.lead.interests_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead",
        entity_id=lead.id,
        before={"interests": before},
        after={"interests": after, "currency": currency},
        message=f"Lead requirements updated: {lead.lead_code}",
        request=request,
    )
    db.commit()
    return [_read(item) for item in created]
