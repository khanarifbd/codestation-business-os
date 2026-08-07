from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client, Lead, LeadStatus
from app.models.membership import Membership
from app.models.team import Employee
from app.models.user import User
from app.schemas.client_detail import ClientDetailRead
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm", tags=["CRM Clients"])
ClientViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]


@router.get("/clients/{client_id}/detail", response_model=ClientDetailRead)
def get_client_detail(client_id: str, db: DbSession, tenant: ClientViewer) -> ClientDetailRead:
    employee_alias = aliased(Employee)
    membership_alias = aliased(Membership)
    user_alias = aliased(User)
    row = db.execute(
        select(Client, user_alias.full_name)
        .outerjoin(employee_alias, employee_alias.id == Client.assigned_employee_id)
        .outerjoin(membership_alias, membership_alias.id == employee_alias.membership_id)
        .outerjoin(user_alias, user_alias.id == membership_alias.user_id)
        .where(Client.id == client_id, Client.organization_id == tenant.organization_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Client not found")
    client, assigned_name = row

    source = db.execute(
        select(Lead.id, Lead.lead_code, LeadStatus.name)
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .where(
            Lead.organization_id == tenant.organization_id,
            Lead.converted_client_id == client.id,
        )
        .order_by(Lead.converted_at.desc().nullslast(), Lead.created_at.desc())
        .limit(1)
    ).first()

    return ClientDetailRead(
        id=client.id,
        client_code=client.client_code,
        client_type=client.client_type,
        display_name=client.display_name,
        legal_name=client.legal_name,
        contact_name=client.contact_name,
        email=client.email,
        billing_email=client.billing_email,
        phone=client.phone,
        whatsapp=client.whatsapp,
        website=client.website,
        country_code=client.country_code,
        state_region=client.state_region,
        city=client.city,
        postal_code=client.postal_code,
        address_line1=client.address_line1,
        address_line2=client.address_line2,
        tax_identifier=client.tax_identifier,
        currency=client.currency,
        assigned_employee_id=client.assigned_employee_id,
        assigned_employee_name=assigned_name,
        status=client.status,
        notes=client.notes,
        source_lead_id=source.id if source else None,
        source_lead_code=source.lead_code if source else None,
        source_lead_status=source.name if source else None,
        created_at=client.created_at,
        updated_at=client.updated_at,
    )
