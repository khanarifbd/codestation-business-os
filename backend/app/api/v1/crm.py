from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.company_defaults import OrganizationSystemDefaults
from app.models.crm import Client, Lead, LeadInteraction, LeadSource, LeadStatus
from app.models.membership import Membership
from app.models.team import Employee
from app.models.user import User
from app.schemas.crm import (
    ClientCreate,
    ClientListItem,
    ClientPage,
    ClientUpdate,
    CrmEmployeeOption,
    CrmMetaRead,
    LeadConvertRequest,
    LeadCreate,
    LeadDetail,
    LeadInteractionCreate,
    LeadInteractionRead,
    LeadListItem,
    LeadPage,
    LeadSourceCreate,
    LeadSourceRead,
    LeadSourceUpdate,
    LeadStatusCreate,
    LeadStatusRead,
    LeadStatusUpdate,
    LeadUpdate,
)
from app.services.activity_log import record_activity
from app.services.crm import get_default_lead_status, next_sequence_code, slugify
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm", tags=["CRM"])

CrmViewer = Annotated[TenantContext, Depends(require_tenant_permission("crm.view"))]
CrmManager = Annotated[TenantContext, Depends(require_tenant_permission("crm.manage"))]
ClientViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]
ClientManager = Annotated[TenantContext, Depends(require_tenant_permission("clients.manage"))]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _payload_value(payload, field: str, fallback):
    """Use a conversion override only when the caller explicitly sent that field."""
    if field in payload.model_fields_set:
        return getattr(payload, field)
    return fallback


def _encode_cursor(created_at: datetime, entity_id: str) -> str:
    raw = json.dumps({"created_at": created_at.isoformat(), "id": entity_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str | None) -> tuple[datetime, str] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        timestamp = datetime.fromisoformat(payload["created_at"])
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        return timestamp, str(payload["id"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid pagination cursor") from exc


def _cursor_clause(model, decoded: tuple[datetime, str] | None):
    if decoded is None:
        return None
    created_at, entity_id = decoded
    return or_(
        model.created_at < created_at,
        and_(model.created_at == created_at, model.id < entity_id),
    )


def _tenant_employee(db: DbSession, organization_id: str, employee_id: str | None) -> Employee | None:
    if employee_id is None:
        return None
    employee = db.scalar(
        select(Employee).where(
            Employee.id == employee_id,
            Employee.organization_id == organization_id,
            Employee.employment_status == "active",
        )
    )
    if employee is None:
        raise HTTPException(status_code=400, detail="Assigned employee is not active in this company")
    return employee


def _tenant_status(db: DbSession, organization_id: str, status_id: str) -> LeadStatus:
    item = db.scalar(
        select(LeadStatus).where(
            LeadStatus.id == status_id,
            LeadStatus.organization_id == organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=400, detail="Lead status does not belong to this company")
    return item


def _tenant_source(db: DbSession, organization_id: str, source_id: str | None) -> LeadSource | None:
    if source_id is None:
        return None
    item = db.scalar(
        select(LeadSource).where(
            LeadSource.id == source_id,
            LeadSource.organization_id == organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=400, detail="Lead source does not belong to this company")
    return item


def _defaults(db: DbSession, organization_id: str) -> OrganizationSystemDefaults | None:
    return db.scalar(
        select(OrganizationSystemDefaults).where(
            OrganizationSystemDefaults.organization_id == organization_id
        )
    )


def _employee_options(db: DbSession, organization_id: str) -> list[CrmEmployeeOption]:
    rows = db.execute(
        select(Employee.id, Employee.employee_code, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(
            Employee.organization_id == organization_id,
            Employee.employment_status == "active",
            Membership.status == "active",
        )
        .order_by(User.full_name.asc())
    ).all()
    return [CrmEmployeeOption(id=row.id, employee_code=row.employee_code, full_name=row.full_name) for row in rows]


def _lead_item(row) -> LeadListItem:
    lead, lead_status, source, assigned_name = row
    return LeadListItem(
        id=lead.id,
        lead_code=lead.lead_code,
        lead_type=lead.lead_type,
        company_name=lead.company_name,
        contact_name=lead.contact_name,
        email=lead.email,
        phone=lead.phone,
        status_id=lead.status_id,
        status_name=lead_status.name,
        status_color=lead_status.color,
        status_category=lead_status.category,
        source_id=lead.source_id,
        source_name=source.name if source else None,
        assigned_employee_id=lead.assigned_employee_id,
        assigned_employee_name=assigned_name,
        estimated_value=lead.estimated_value,
        currency=lead.currency,
        probability_percent=lead.probability_percent,
        next_follow_up_at=lead.next_follow_up_at,
        converted_client_id=lead.converted_client_id,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


def _client_item(row) -> ClientListItem:
    client, assigned_name = row
    return ClientListItem(
        id=client.id,
        client_code=client.client_code,
        client_type=client.client_type,
        display_name=client.display_name,
        contact_name=client.contact_name,
        email=client.email,
        phone=client.phone,
        country_code=client.country_code,
        currency=client.currency,
        status=client.status,
        assigned_employee_id=client.assigned_employee_id,
        assigned_employee_name=assigned_name,
        created_at=client.created_at,
        updated_at=client.updated_at,
    )


def _lead_query(organization_id: str):
    employee_alias = aliased(Employee)
    membership_alias = aliased(Membership)
    user_alias = aliased(User)
    return (
        select(Lead, LeadStatus, LeadSource, user_alias.full_name)
        .join(LeadStatus, LeadStatus.id == Lead.status_id)
        .outerjoin(LeadSource, LeadSource.id == Lead.source_id)
        .outerjoin(employee_alias, employee_alias.id == Lead.assigned_employee_id)
        .outerjoin(membership_alias, membership_alias.id == employee_alias.membership_id)
        .outerjoin(user_alias, user_alias.id == membership_alias.user_id)
        .where(Lead.organization_id == organization_id)
    )


def _client_query(organization_id: str):
    employee_alias = aliased(Employee)
    membership_alias = aliased(Membership)
    user_alias = aliased(User)
    return (
        select(Client, user_alias.full_name)
        .outerjoin(employee_alias, employee_alias.id == Client.assigned_employee_id)
        .outerjoin(membership_alias, membership_alias.id == employee_alias.membership_id)
        .outerjoin(user_alias, user_alias.id == membership_alias.user_id)
        .where(Client.organization_id == organization_id)
    )


@router.get("/meta", response_model=CrmMetaRead)
def get_crm_meta(db: DbSession, tenant: CrmViewer) -> CrmMetaRead:
    organization_id = tenant.organization_id
    statuses = db.scalars(
        select(LeadStatus)
        .where(LeadStatus.organization_id == organization_id)
        .order_by(LeadStatus.sort_order.asc(), LeadStatus.name.asc())
    ).all()
    sources = db.scalars(
        select(LeadSource)
        .where(LeadSource.organization_id == organization_id)
        .order_by(LeadSource.sort_order.asc(), LeadSource.name.asc())
    ).all()
    defaults = _defaults(db, organization_id)
    return CrmMetaRead(
        statuses=[LeadStatusRead.model_validate(item) for item in statuses],
        sources=[LeadSourceRead.model_validate(item) for item in sources],
        employees=_employee_options(db, organization_id),
        default_country_code=(defaults.default_client_country_code if defaults else tenant.organization.country_code),
        default_currency=(defaults.default_client_currency if defaults else tenant.organization.currency),
    )


@router.get("/leads", response_model=LeadPage)
def list_leads(
    db: DbSession,
    tenant: CrmViewer,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = None,
    search: str | None = None,
    status_id: str | None = None,
    source_id: str | None = None,
    assigned_employee_id: str | None = None,
    converted: bool | None = None,
) -> LeadPage:
    query = _lead_query(tenant.organization_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(
                Lead.lead_code.ilike(needle),
                Lead.contact_name.ilike(needle),
                Lead.company_name.ilike(needle),
                Lead.email.ilike(needle),
                Lead.phone.ilike(needle),
            )
        )
    if status_id:
        query = query.where(Lead.status_id == status_id)
    if source_id:
        query = query.where(Lead.source_id == source_id)
    if assigned_employee_id:
        query = query.where(Lead.assigned_employee_id == assigned_employee_id)
    if converted is True:
        query = query.where(Lead.converted_client_id.is_not(None))
    elif converted is False:
        query = query.where(Lead.converted_client_id.is_(None))
    clause = _cursor_clause(Lead, _decode_cursor(cursor))
    if clause is not None:
        query = query.where(clause)
    rows = db.execute(query.order_by(Lead.created_at.desc(), Lead.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [_lead_item(row) for row in rows]
    next_cursor = _encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None
    return LeadPage(items=items, next_cursor=next_cursor)


@router.post("/leads", response_model=LeadListItem, status_code=status.HTTP_201_CREATED)
def create_lead(
    payload: LeadCreate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadListItem:
    organization_id = tenant.organization_id
    lead_status = _tenant_status(db, organization_id, payload.status_id) if payload.status_id else get_default_lead_status(db, organization_id)
    source = _tenant_source(db, organization_id, payload.source_id)
    _tenant_employee(db, organization_id, payload.assigned_employee_id)
    defaults = _defaults(db, organization_id)

    lead = Lead(
        organization_id=organization_id,
        lead_code=next_sequence_code(db, organization_id, "lead"),
        lead_type=payload.lead_type,
        company_name=_clean(payload.company_name),
        contact_name=payload.contact_name.strip(),
        email=str(payload.email).lower() if payload.email else None,
        phone=_clean(payload.phone),
        whatsapp=_clean(payload.whatsapp),
        website=_clean(payload.website),
        country_code=(payload.country_code.upper() if payload.country_code else (defaults.default_client_country_code if defaults else tenant.organization.country_code)),
        state_region=_clean(payload.state_region),
        city=_clean(payload.city),
        address_line1=_clean(payload.address_line1),
        source_id=source.id if source else None,
        status_id=lead_status.id,
        assigned_employee_id=payload.assigned_employee_id,
        estimated_value=payload.estimated_value,
        currency=(payload.currency.upper() if payload.currency else (defaults.default_client_currency if defaults else tenant.organization.currency)),
        probability_percent=payload.probability_percent,
        next_follow_up_at=payload.next_follow_up_at,
        notes=_clean(payload.notes),
    )
    db.add(lead)
    db.flush()
    record_activity(
        db,
        action="crm.lead.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=organization_id,
        entity_type="lead",
        entity_id=lead.id,
        after={"id": lead.id, "lead_code": lead.lead_code, "contact_name": lead.contact_name, "company_name": lead.company_name, "status_id": lead.status_id, "source_id": lead.source_id, "assigned_employee_id": lead.assigned_employee_id},
        message=f"Lead created: {lead.lead_code}",
        request=request,
    )
    db.commit()

    row = db.execute(_lead_query(organization_id).where(Lead.id == lead.id)).one()
    return _lead_item(row)


@router.get("/leads/{lead_id}", response_model=LeadDetail)
def get_lead(lead_id: str, db: DbSession, tenant: CrmViewer) -> LeadDetail:
    row = db.execute(
        _lead_query(tenant.organization_id).where(Lead.id == lead_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead = row[0]
    interactions = db.scalars(
        select(LeadInteraction)
        .where(
            LeadInteraction.organization_id == tenant.organization_id,
            LeadInteraction.lead_id == lead_id,
        )
        .order_by(LeadInteraction.created_at.desc())
        .limit(100)
    ).all()
    return LeadDetail(
        lead=_lead_item(row),
        website=lead.website,
        whatsapp=lead.whatsapp,
        country_code=lead.country_code,
        state_region=lead.state_region,
        city=lead.city,
        address_line1=lead.address_line1,
        notes=lead.notes,
        interactions=[LeadInteractionRead.model_validate(item) for item in interactions],
    )


@router.patch("/leads/{lead_id}", response_model=LeadListItem)
def update_lead(
    lead_id: str,
    payload: LeadUpdate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadListItem:
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.organization_id == tenant.organization_id))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    before = {
        "contact_name": lead.contact_name, "company_name": lead.company_name, "status_id": lead.status_id,
        "source_id": lead.source_id, "assigned_employee_id": lead.assigned_employee_id,
        "estimated_value": str(lead.estimated_value) if lead.estimated_value is not None else None,
        "probability_percent": lead.probability_percent, "next_follow_up_at": lead.next_follow_up_at.isoformat() if lead.next_follow_up_at else None,
    }
    changes = payload.model_dump(exclude_unset=True)
    if "status_id" in changes:
        raise HTTPException(
            status_code=400,
            detail="Lead status can only be changed from the pipeline status control.",
        )
    if "source_id" in changes:
        _tenant_source(db, tenant.organization_id, changes["source_id"])
    if "assigned_employee_id" in changes:
        _tenant_employee(db, tenant.organization_id, changes["assigned_employee_id"])
    for field, value in changes.items():
        if field in {"country_code", "currency"} and isinstance(value, str):
            value = value.upper()
        elif isinstance(value, str):
            value = value.strip() or None
        if field == "email" and value is not None:
            value = str(value).lower()
        setattr(lead, field, value)
    db.flush()
    after = {
        "contact_name": lead.contact_name, "company_name": lead.company_name, "status_id": lead.status_id,
        "source_id": lead.source_id, "assigned_employee_id": lead.assigned_employee_id,
        "estimated_value": str(lead.estimated_value) if lead.estimated_value is not None else None,
        "probability_percent": lead.probability_percent, "next_follow_up_at": lead.next_follow_up_at.isoformat() if lead.next_follow_up_at else None,
    }
    record_activity(
        db,
        action="crm.lead.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead",
        entity_id=lead.id,
        before=before,
        after=after,
        message=f"Lead updated: {lead.lead_code}",
        request=request,
    )
    db.commit()
    row = db.execute(_lead_query(tenant.organization_id).where(Lead.id == lead.id)).one()
    return _lead_item(row)


@router.post("/leads/{lead_id}/interactions", response_model=LeadInteractionRead, status_code=201)
def add_lead_interaction(
    lead_id: str,
    payload: LeadInteractionCreate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadInteractionRead:
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.organization_id == tenant.organization_id))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    item = LeadInteraction(
        organization_id=tenant.organization_id,
        lead_id=lead.id,
        interaction_type=payload.interaction_type,
        subject=_clean(payload.subject),
        body=_clean(payload.body),
        scheduled_at=payload.scheduled_at,
        completed_at=payload.completed_at,
        created_by_user_id=tenant.user_id,
    )
    db.add(item)
    db.flush()
    if payload.interaction_type == "follow_up" and payload.scheduled_at:
        lead.next_follow_up_at = payload.scheduled_at
    record_activity(
        db,
        action="crm.lead.interaction_created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead_interaction",
        entity_id=item.id,
        after={"lead_id": lead.id, "interaction_type": item.interaction_type, "subject": item.subject, "scheduled_at": item.scheduled_at.isoformat() if item.scheduled_at else None},
        message=f"CRM interaction added to {lead.lead_code}",
        request=request,
    )
    db.commit()
    db.refresh(item)
    return LeadInteractionRead.model_validate(item)


@router.post("/leads/{lead_id}/convert", response_model=ClientListItem, status_code=201)
def convert_lead(
    lead_id: str,
    payload: LeadConvertRequest,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> ClientListItem:
    lead = db.scalar(
        select(Lead).where(Lead.id == lead_id, Lead.organization_id == tenant.organization_id).with_for_update()
    )
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.converted_client_id:
        raise HTTPException(status_code=409, detail="Lead has already been converted to a client")

    current_status = db.scalar(
        select(LeadStatus).where(
            LeadStatus.id == lead.status_id,
            LeadStatus.organization_id == tenant.organization_id,
        )
    )
    if current_status is None or current_status.category != "won":
        raise HTTPException(
            status_code=409,
            detail="Only a Won lead can be converted to a client.",
        )

    client_type = _payload_value(payload, "client_type", lead.lead_type) or lead.lead_type
    display_name = _clean(_payload_value(payload, "display_name", lead.company_name or lead.contact_name))
    if not display_name:
        raise HTTPException(status_code=400, detail="Client display name is required")

    legal_name = _clean(_payload_value(payload, "legal_name", lead.company_name))
    contact_name = _clean(_payload_value(payload, "contact_name", lead.contact_name))

    email_value = _payload_value(payload, "email", lead.email)
    billing_email_value = _payload_value(payload, "billing_email", lead.email)
    phone = _clean(_payload_value(payload, "phone", lead.phone))
    whatsapp = _clean(_payload_value(payload, "whatsapp", lead.whatsapp))
    website = _clean(_payload_value(payload, "website", lead.website))

    country_value = _payload_value(payload, "country_code", lead.country_code)
    state_region = _clean(_payload_value(payload, "state_region", lead.state_region))
    city = _clean(_payload_value(payload, "city", lead.city))
    postal_code = _clean(_payload_value(payload, "postal_code", None))
    address_line1 = _clean(_payload_value(payload, "address_line1", lead.address_line1))
    address_line2 = _clean(_payload_value(payload, "address_line2", None))
    tax_identifier = _clean(_payload_value(payload, "tax_identifier", None))

    currency_value = _payload_value(payload, "currency", lead.currency)
    assigned_employee_id = _payload_value(payload, "assigned_employee_id", lead.assigned_employee_id)
    _tenant_employee(db, tenant.organization_id, assigned_employee_id)
    notes = _clean(_payload_value(payload, "notes", lead.notes))

    client = Client(
        organization_id=tenant.organization_id,
        client_code=next_sequence_code(db, tenant.organization_id, "client"),
        client_type=client_type,
        display_name=display_name,
        legal_name=legal_name,
        contact_name=contact_name,
        email=str(email_value).lower() if email_value else None,
        billing_email=str(billing_email_value).lower() if billing_email_value else None,
        phone=phone,
        whatsapp=whatsapp,
        website=website,
        country_code=str(country_value).upper() if country_value else None,
        state_region=state_region,
        city=city,
        postal_code=postal_code,
        address_line1=address_line1,
        address_line2=address_line2,
        tax_identifier=tax_identifier,
        currency=str(currency_value).upper() if currency_value else None,
        acquisition_source_id=lead.source_id,
        assigned_employee_id=assigned_employee_id,
        status="active",
        notes=notes,
    )
    db.add(client)
    db.flush()

    before = {"status_id": lead.status_id, "converted_client_id": None}
    lead.converted_client_id = client.id
    lead.converted_at = datetime.now(timezone.utc)

    interaction = LeadInteraction(
        organization_id=tenant.organization_id,
        lead_id=lead.id,
        interaction_type="note",
        subject="Converted to client",
        body=f"Converted to {client.client_code} · {client.display_name}",
        completed_at=lead.converted_at,
        created_by_user_id=tenant.user_id,
    )
    db.add(interaction)
    db.flush()
    record_activity(
        db,
        action="crm.lead.converted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead",
        entity_id=lead.id,
        before=before,
        after={
            "status_id": lead.status_id,
            "status_name": current_status.name,
            "converted_client_id": client.id,
            "client_code": client.client_code,
            "client_name": client.display_name,
            "acquisition_source_id": client.acquisition_source_id,
            "assigned_employee_id": client.assigned_employee_id,
        },
        message=f"Lead {lead.lead_code} converted to client {client.client_code}",
        request=request,
    )
    db.commit()
    row = db.execute(_client_query(tenant.organization_id).where(Client.id == client.id)).one()
    return _client_item(row)


@router.get("/clients", response_model=ClientPage)
def list_clients(
    db: DbSession,
    tenant: ClientViewer,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = None,
    search: str | None = None,
    client_status: str | None = Query(default=None, alias="status"),
    assigned_employee_id: str | None = None,
) -> ClientPage:
    query = _client_query(tenant.organization_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(
                Client.client_code.ilike(needle),
                Client.display_name.ilike(needle),
                Client.contact_name.ilike(needle),
                Client.email.ilike(needle),
                Client.phone.ilike(needle),
            )
        )
    if client_status:
        query = query.where(Client.status == client_status)
    if assigned_employee_id:
        query = query.where(Client.assigned_employee_id == assigned_employee_id)
    clause = _cursor_clause(Client, _decode_cursor(cursor))
    if clause is not None:
        query = query.where(clause)
    rows = db.execute(query.order_by(Client.created_at.desc(), Client.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [_client_item(row) for row in rows]
    next_cursor = _encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None
    return ClientPage(items=items, next_cursor=next_cursor)


@router.post("/clients", response_model=ClientListItem, status_code=201)
def create_client(
    payload: ClientCreate,
    request: Request,
    db: DbSession,
    tenant: ClientManager,
) -> ClientListItem:
    _tenant_employee(db, tenant.organization_id, payload.assigned_employee_id)
    source = _tenant_source(db, tenant.organization_id, payload.acquisition_source_id)
    defaults = _defaults(db, tenant.organization_id)
    client = Client(
        organization_id=tenant.organization_id,
        client_code=next_sequence_code(db, tenant.organization_id, "client"),
        client_type=payload.client_type,
        display_name=payload.display_name.strip(),
        legal_name=_clean(payload.legal_name),
        contact_name=_clean(payload.contact_name),
        email=str(payload.email).lower() if payload.email else None,
        billing_email=str(payload.billing_email).lower() if payload.billing_email else None,
        phone=_clean(payload.phone),
        whatsapp=_clean(payload.whatsapp),
        website=_clean(payload.website),
        country_code=(payload.country_code.upper() if payload.country_code else (defaults.default_client_country_code if defaults else tenant.organization.country_code)),
        state_region=_clean(payload.state_region),
        city=_clean(payload.city),
        postal_code=_clean(payload.postal_code),
        address_line1=_clean(payload.address_line1),
        address_line2=_clean(payload.address_line2),
        tax_identifier=_clean(payload.tax_identifier),
        currency=(payload.currency.upper() if payload.currency else (defaults.default_client_currency if defaults else tenant.organization.currency)),
        acquisition_source_id=source.id if source else None,
        assigned_employee_id=payload.assigned_employee_id,
        status="active",
        notes=_clean(payload.notes),
    )
    db.add(client)
    db.flush()
    record_activity(
        db,
        action="crm.client.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client",
        entity_id=client.id,
        after={
            "id": client.id,
            "client_code": client.client_code,
            "display_name": client.display_name,
            "acquisition_source_id": client.acquisition_source_id,
            "assigned_employee_id": client.assigned_employee_id,
            "status": client.status,
        },
        message=f"Client created: {client.client_code}",
        request=request,
    )
    db.commit()
    row = db.execute(_client_query(tenant.organization_id).where(Client.id == client.id)).one()
    return _client_item(row)


@router.patch("/clients/{client_id}", response_model=ClientListItem)
def update_client(
    client_id: str,
    payload: ClientUpdate,
    request: Request,
    db: DbSession,
    tenant: ClientManager,
) -> ClientListItem:
    client = db.scalar(select(Client).where(Client.id == client_id, Client.organization_id == tenant.organization_id))
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    before = {
        "display_name": client.display_name,
        "email": client.email,
        "acquisition_source_id": client.acquisition_source_id,
        "assigned_employee_id": client.assigned_employee_id,
        "status": client.status,
    }
    changes = payload.model_dump(exclude_unset=True)
    if "acquisition_source_id" in changes:
        _tenant_source(db, tenant.organization_id, changes["acquisition_source_id"])
    if "assigned_employee_id" in changes:
        _tenant_employee(db, tenant.organization_id, changes["assigned_employee_id"])
    for field, value in changes.items():
        if field in {"country_code", "currency"} and isinstance(value, str):
            value = value.upper()
        elif isinstance(value, str):
            value = value.strip() or None
        if field in {"email", "billing_email"} and value is not None:
            value = str(value).lower()
        setattr(client, field, value)
    db.flush()
    after = {
        "display_name": client.display_name,
        "email": client.email,
        "acquisition_source_id": client.acquisition_source_id,
        "assigned_employee_id": client.assigned_employee_id,
        "status": client.status,
    }
    record_activity(
        db,
        action="crm.client.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client",
        entity_id=client.id,
        before=before,
        after=after,
        message=f"Client updated: {client.client_code}",
        request=request,
    )
    db.commit()
    row = db.execute(_client_query(tenant.organization_id).where(Client.id == client.id)).one()
    return _client_item(row)


@router.post("/settings/statuses", response_model=LeadStatusRead, status_code=201)
def create_lead_status(
    payload: LeadStatusCreate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadStatusRead:
    slug = slugify(payload.name)
    exists = db.scalar(select(LeadStatus.id).where(LeadStatus.organization_id == tenant.organization_id, LeadStatus.slug == slug))
    if exists:
        raise HTTPException(status_code=409, detail="A lead status with this name already exists")
    if payload.is_default:
        for item in db.scalars(select(LeadStatus).where(LeadStatus.organization_id == tenant.organization_id, LeadStatus.is_default.is_(True))).all():
            item.is_default = False
    item = LeadStatus(
        organization_id=tenant.organization_id,
        name=payload.name.strip(),
        slug=slug,
        color=_clean(payload.color),
        category=payload.category,
        sort_order=payload.sort_order,
        is_default=payload.is_default,
    )
    db.add(item)
    db.flush()
    record_activity(
        db, action="crm.lead_status.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="lead_status", entity_id=item.id,
        after=LeadStatusRead.model_validate(item).model_dump(mode="json"), message=f"Lead status created: {item.name}", request=request,
    )
    db.commit(); db.refresh(item)
    return LeadStatusRead.model_validate(item)


@router.patch("/settings/statuses/{status_id}", response_model=LeadStatusRead)
def update_lead_status(
    status_id: str,
    payload: LeadStatusUpdate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadStatusRead:
    item = db.scalar(select(LeadStatus).where(LeadStatus.id == status_id, LeadStatus.organization_id == tenant.organization_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Lead status not found")
    before = LeadStatusRead.model_validate(item).model_dump(mode="json")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("is_default") is True:
        for other in db.scalars(select(LeadStatus).where(LeadStatus.organization_id == tenant.organization_id, LeadStatus.is_default.is_(True), LeadStatus.id != item.id)).all():
            other.is_default = False
        changes["is_active"] = True
    if changes.get("is_active") is False and item.is_default and changes.get("is_default") is not False:
        raise HTTPException(status_code=400, detail="Default lead status cannot be deactivated")
    if "name" in changes and changes["name"] is not None:
        new_slug = slugify(changes["name"])
        conflict = db.scalar(select(LeadStatus.id).where(LeadStatus.organization_id == tenant.organization_id, LeadStatus.slug == new_slug, LeadStatus.id != item.id))
        if conflict:
            raise HTTPException(status_code=409, detail="A lead status with this name already exists")
        item.slug = new_slug
    for field, value in changes.items():
        if field == "name" and value is not None:
            value = value.strip()
        if field == "color":
            value = _clean(value)
        setattr(item, field, value)
    db.flush()
    after = LeadStatusRead.model_validate(item).model_dump(mode="json")
    record_activity(
        db, action="crm.lead_status.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="lead_status", entity_id=item.id,
        before=before, after=after, message=f"Lead status updated: {item.name}", request=request,
    )
    db.commit(); db.refresh(item)
    return LeadStatusRead.model_validate(item)


@router.post("/settings/sources", response_model=LeadSourceRead, status_code=201)
def create_lead_source(
    payload: LeadSourceCreate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadSourceRead:
    slug = slugify(payload.name)
    exists = db.scalar(select(LeadSource.id).where(LeadSource.organization_id == tenant.organization_id, LeadSource.slug == slug))
    if exists:
        raise HTTPException(status_code=409, detail="A lead source with this name already exists")
    item = LeadSource(organization_id=tenant.organization_id, name=payload.name.strip(), slug=slug, sort_order=payload.sort_order)
    db.add(item); db.flush()
    record_activity(
        db, action="crm.lead_source.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="lead_source", entity_id=item.id,
        after=LeadSourceRead.model_validate(item).model_dump(mode="json"), message=f"Lead source created: {item.name}", request=request,
    )
    db.commit(); db.refresh(item)
    return LeadSourceRead.model_validate(item)


@router.patch("/settings/sources/{source_id}", response_model=LeadSourceRead)
def update_lead_source(
    source_id: str,
    payload: LeadSourceUpdate,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> LeadSourceRead:
    item = db.scalar(select(LeadSource).where(LeadSource.id == source_id, LeadSource.organization_id == tenant.organization_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Lead source not found")
    before = LeadSourceRead.model_validate(item).model_dump(mode="json")
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        new_slug = slugify(changes["name"])
        conflict = db.scalar(select(LeadSource.id).where(LeadSource.organization_id == tenant.organization_id, LeadSource.slug == new_slug, LeadSource.id != item.id))
        if conflict:
            raise HTTPException(status_code=409, detail="A lead source with this name already exists")
        item.slug = new_slug
    for field, value in changes.items():
        if field == "name" and value is not None:
            value = value.strip()
        setattr(item, field, value)
    db.flush()
    after = LeadSourceRead.model_validate(item).model_dump(mode="json")
    record_activity(
        db, action="crm.lead_source.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="lead_source", entity_id=item.id,
        before=before, after=after, message=f"Lead source updated: {item.name}", request=request,
    )
    db.commit(); db.refresh(item)
    return LeadSourceRead.model_validate(item)


@router.delete("/settings/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead_status(
    status_id: str,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> Response:
    item = db.scalar(
        select(LeadStatus).where(
            LeadStatus.id == status_id,
            LeadStatus.organization_id == tenant.organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Lead status not found")
    if item.is_default:
        raise HTTPException(status_code=409, detail="Default lead status cannot be deleted")

    lead_count = db.scalar(
        select(func.count()).select_from(Lead).where(
            Lead.organization_id == tenant.organization_id,
            Lead.status_id == item.id,
        )
    ) or 0
    if lead_count:
        raise HTTPException(
            status_code=409,
            detail=f"This lead status is used by {lead_count} lead(s). Disable it instead to preserve lead history.",
        )

    before = LeadStatusRead.model_validate(item).model_dump(mode="json")
    db.delete(item)
    record_activity(
        db,
        action="crm.lead_status.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead_status",
        entity_id=item.id,
        before=before,
        after=None,
        message=f"Lead status deleted: {item.name}",
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/settings/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead_source(
    source_id: str,
    request: Request,
    db: DbSession,
    tenant: CrmManager,
) -> Response:
    item = db.scalar(
        select(LeadSource).where(
            LeadSource.id == source_id,
            LeadSource.organization_id == tenant.organization_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Lead source not found")

    lead_count = db.scalar(
        select(func.count()).select_from(Lead).where(
            Lead.organization_id == tenant.organization_id,
            Lead.source_id == item.id,
        )
    ) or 0
    client_count = db.scalar(
        select(func.count()).select_from(Client).where(
            Client.organization_id == tenant.organization_id,
            Client.acquisition_source_id == item.id,
        )
    ) or 0
    if lead_count or client_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"This source is used by {lead_count} lead(s) and {client_count} client(s). "
                "Disable it instead to preserve acquisition history."
            ),
        )

    before = LeadSourceRead.model_validate(item).model_dump(mode="json")
    db.delete(item)
    record_activity(
        db,
        action="crm.lead_source.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="lead_source",
        entity_id=item.id,
        before=before,
        after=None,
        message=f"Lead source deleted: {item.name}",
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
