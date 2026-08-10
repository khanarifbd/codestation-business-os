from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.dependencies import CurrentTenant, DbSession
from app.models.client_access import ClientMembership
from app.models.crm import Client
from app.models.finance import Invoice
from app.models.projects import Project

router = APIRouter(prefix="/client-portal", tags=["Client Portal"])


class ClientPortalClient(BaseModel):
    id: str
    client_code: str
    display_name: str
    client_type: str
    email: str | None
    phone: str | None
    currency: str | None
    is_primary_contact: bool


class ClientPortalFinancial(BaseModel):
    currency: str
    invoice_count: int
    invoiced_total: Decimal
    balance_due: Decimal


class ClientPortalContext(BaseModel):
    organization_id: str
    organization_name: str
    membership_id: str
    clients: list[ClientPortalClient]
    project_count: int
    financials: list[ClientPortalFinancial]


@router.get("/context", response_model=ClientPortalContext)
def get_client_portal_context(db: DbSession, tenant: CurrentTenant) -> ClientPortalContext:
    rows = db.execute(
        select(ClientMembership, Client)
        .join(Client, Client.id == ClientMembership.client_id)
        .where(
            ClientMembership.organization_id == tenant.organization_id,
            ClientMembership.membership_id == tenant.membership_id,
            ClientMembership.status == "active",
            Client.status == "active",
        )
        .order_by(ClientMembership.is_primary_contact.desc(), Client.display_name.asc())
    ).all()
    if not rows:
        raise HTTPException(status_code=403, detail="Client portal access is not enabled for this workspace")

    clients = [
        ClientPortalClient(
            id=client.id,
            client_code=client.client_code,
            display_name=client.display_name,
            client_type=client.client_type,
            email=client.email,
            phone=client.phone,
            currency=client.currency,
            is_primary_contact=access.is_primary_contact,
        )
        for access, client in rows
    ]
    client_ids = [client.id for _, client in rows]

    financial_rows = db.execute(
        select(
            Invoice.currency,
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.total), 0),
            func.coalesce(func.sum(Invoice.balance_due), 0),
        )
        .where(
            Invoice.organization_id == tenant.organization_id,
            Invoice.client_id.in_(client_ids),
            Invoice.status != "cancelled",
        )
        .group_by(Invoice.currency)
        .order_by(Invoice.currency.asc())
    ).all()
    financials = [
        ClientPortalFinancial(
            currency=currency,
            invoice_count=int(invoice_count or 0),
            invoiced_total=Decimal(invoiced_total or 0),
            balance_due=Decimal(balance_due or 0),
        )
        for currency, invoice_count, invoiced_total, balance_due in financial_rows
    ]

    project_count = db.scalar(
        select(func.count(Project.id)).where(
            Project.organization_id == tenant.organization_id,
            Project.client_id.in_(client_ids),
        )
    ) or 0

    return ClientPortalContext(
        organization_id=tenant.organization_id,
        organization_name=tenant.organization.name,
        membership_id=tenant.membership_id,
        clients=clients,
        project_count=int(project_count),
        financials=financials,
    )
