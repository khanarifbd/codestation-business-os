from __future__ import annotations

import base64
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.company_defaults import OrganizationSystemDefaults
from app.models.company_settings import (
    OrganizationAddress,
    OrganizationFinancialSettings,
    OrganizationIdentifier,
    OrganizationProfile,
)
from app.models.crm import Client, Lead, LeadInterest
from app.models.inventory import Product
from app.models.membership import Membership
from app.models.sales import Quotation, QuotationItem
from app.models.tax import TaxCode
from app.models.team import Employee
from app.models.user import User
from app.schemas.sales import (
    LeadQuotationInterest,
    LeadQuotationSource,
    QuotationCreate,
    QuotationDetail,
    QuotationItemRead,
    QuotationListItem,
    QuotationPage,
    QuotationStatusChange,
    QuotationSummary,
    QuotationUpdate,
    SalesCatalogOption,
    SalesClientOption,
    SalesEmployeeOption,
    SalesMeta,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.sales import calculate_line, calculate_totals
from app.services.sales_catalog import resolve_sales_line
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Sales"])

QuotationViewer = Annotated[TenantContext, Depends(require_tenant_permission("quotations.view"))]
QuotationManager = Annotated[TenantContext, Depends(require_tenant_permission("quotations.manage"))]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


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


def _cursor_clause(decoded: tuple[datetime, str] | None):
    if decoded is None:
        return None
    created_at, entity_id = decoded
    return or_(
        Quotation.created_at < created_at,
        and_(Quotation.created_at == created_at, Quotation.id < entity_id),
    )


def _is_expired(item: Quotation) -> bool:
    return bool(item.valid_until and item.valid_until < date.today() and item.status == "sent")


def _address_text(address: OrganizationAddress | None) -> str | None:
    if address is None:
        return None
    parts = [address.line1, address.line2, address.city, address.state_region, address.postal_code, address.country_code]
    value = ", ".join(str(part).strip() for part in parts if part and str(part).strip())
    return value or None


def _client_address_text(client: Client) -> str | None:
    parts = [client.address_line1, client.address_line2, client.city, client.state_region, client.postal_code, client.country_code]
    value = ", ".join(str(part).strip() for part in parts if part and str(part).strip())
    return value or None


def _active_employee(db: DbSession, organization_id: str, employee_id: str | None) -> Employee | None:
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


def _employee_options(db: DbSession, organization_id: str) -> list[SalesEmployeeOption]:
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
    return [SalesEmployeeOption(id=row.id, employee_code=row.employee_code, full_name=row.full_name) for row in rows]


def _quotation_query(organization_id: str):
    employee_alias = aliased(Employee)
    membership_alias = aliased(Membership)
    user_alias = aliased(User)
    return (
        select(Quotation, Client.display_name, user_alias.full_name)
        .join(Client, Client.id == Quotation.client_id)
        .outerjoin(employee_alias, employee_alias.id == Quotation.assigned_employee_id)
        .outerjoin(membership_alias, membership_alias.id == employee_alias.membership_id)
        .outerjoin(user_alias, user_alias.id == membership_alias.user_id)
        .where(Quotation.organization_id == organization_id)
    )


def _list_item(row) -> QuotationListItem:
    quotation, client_name, assigned_name = row
    return QuotationListItem(
        id=quotation.id,
        quotation_number=quotation.quotation_number,
        client_id=quotation.client_id,
        client_name=client_name,
        status=quotation.status,
        subject=quotation.subject,
        issue_date=quotation.issue_date,
        valid_until=quotation.valid_until,
        currency=quotation.currency,
        total=quotation.total,
        assigned_employee_id=quotation.assigned_employee_id,
        assigned_employee_name=assigned_name,
        is_expired=_is_expired(quotation),
        created_at=quotation.created_at,
        updated_at=quotation.updated_at,
    )


def _item_read(item: QuotationItem) -> QuotationItemRead:
    return QuotationItemRead(
        id=item.id,
        product_id=item.product_id,
        lead_interest_id=item.lead_interest_id,
        sort_order=item.sort_order,
        item_name_snapshot=item.item_name_snapshot,
        sku_snapshot=item.sku_snapshot,
        item_type_snapshot=item.item_type_snapshot,
        unit_snapshot=item.unit_snapshot,
        description=item.description,
        quantity=item.quantity,
        unit_price=item.unit_price,
        discount_percent=item.discount_percent,
        tax_rate=item.tax_rate,
        line_subtotal=item.line_subtotal,
        discount_amount=item.discount_amount,
        taxable_amount=item.taxable_amount,
        tax_amount=item.tax_amount,
        line_total=item.line_total,
    )


def _detail(db: DbSession, organization_id: str, quotation_id: str) -> QuotationDetail:
    row = db.execute(_quotation_query(organization_id).where(Quotation.id == quotation_id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    quotation, _client_name, assigned_name = row
    items = db.scalars(
        select(QuotationItem)
        .where(
            QuotationItem.organization_id == organization_id,
            QuotationItem.quotation_id == quotation.id,
        )
        .order_by(QuotationItem.sort_order.asc(), QuotationItem.created_at.asc())
    ).all()
    return QuotationDetail(
        id=quotation.id,
        quotation_number=quotation.quotation_number,
        client_id=quotation.client_id,
        source_lead_id=quotation.source_lead_id,
        assigned_employee_id=quotation.assigned_employee_id,
        assigned_employee_name=assigned_name,
        status=quotation.status,
        subject=quotation.subject,
        issue_date=quotation.issue_date,
        valid_until=quotation.valid_until,
        currency=quotation.currency,
        tax_calculation_mode=quotation.tax_calculation_mode,
        seller_name_snapshot=quotation.seller_name_snapshot,
        seller_email_snapshot=quotation.seller_email_snapshot,
        seller_address_snapshot=quotation.seller_address_snapshot,
        seller_tax_identifier_snapshot=quotation.seller_tax_identifier_snapshot,
        client_name_snapshot=quotation.client_name_snapshot,
        client_contact_snapshot=quotation.client_contact_snapshot,
        client_email_snapshot=quotation.client_email_snapshot,
        client_address_snapshot=quotation.client_address_snapshot,
        client_tax_identifier_snapshot=quotation.client_tax_identifier_snapshot,
        subtotal=quotation.subtotal,
        discount_total=quotation.discount_total,
        tax_total=quotation.tax_total,
        total=quotation.total,
        notes=quotation.notes,
        terms_conditions=quotation.terms_conditions,
        internal_notes=quotation.internal_notes,
        sent_at=quotation.sent_at,
        accepted_at=quotation.accepted_at,
        rejected_at=quotation.rejected_at,
        cancelled_at=quotation.cancelled_at,
        is_expired=_is_expired(quotation),
        items=[_item_read(item) for item in items],
        created_at=quotation.created_at,
        updated_at=quotation.updated_at,
    )


def _source_lead_for_client(
    db: DbSession,
    *,
    organization_id: str,
    client_id: str,
    explicit_lead_id: str | None,
) -> str | None:
    if explicit_lead_id:
        lead = db.scalar(
            select(Lead).where(
                Lead.id == explicit_lead_id,
                Lead.organization_id == organization_id,
                Lead.converted_client_id == client_id,
            )
        )
        if lead is None:
            raise HTTPException(status_code=400, detail="Source lead is not converted to the selected client")
        return lead.id
    candidates = db.scalars(
        select(Lead.id)
        .where(Lead.organization_id == organization_id, Lead.converted_client_id == client_id)
        .order_by(Lead.converted_at.desc().nullslast(), Lead.created_at.desc())
        .limit(2)
    ).all()
    return candidates[0] if len(candidates) == 1 else None


def _lead_interest(
    db: DbSession,
    *,
    organization_id: str,
    quotation: Quotation,
    interest_id: str | None,
) -> LeadInterest | None:
    if not interest_id:
        return None
    if not quotation.source_lead_id:
        raise HTTPException(status_code=400, detail="Lead requirement can only be used on a quotation linked to that lead")
    item = db.scalar(
        select(LeadInterest).where(
            LeadInterest.id == interest_id,
            LeadInterest.organization_id == organization_id,
            LeadInterest.lead_id == quotation.source_lead_id,
        )
    )
    if item is None:
        raise HTTPException(status_code=400, detail="Lead requirement does not belong to this quotation source lead")
    return item


def _replace_items(db: DbSession, quotation: Quotation, payload_items) -> None:
    existing = db.scalars(
        select(QuotationItem).where(
            QuotationItem.organization_id == quotation.organization_id,
            QuotationItem.quotation_id == quotation.id,
        )
    ).all()
    for item in existing:
        db.delete(item)
    db.flush()

    calculated_lines = []
    for index, payload in enumerate(payload_items):
        interest = _lead_interest(
            db,
            organization_id=quotation.organization_id,
            quotation=quotation,
            interest_id=getattr(payload, "lead_interest_id", None),
        )
        payload_product_id = getattr(payload, "product_id", None)
        if interest and payload_product_id and interest.product_id and payload_product_id != interest.product_id:
            raise HTTPException(status_code=400, detail="Catalog item does not match the selected lead requirement")
        product_id = payload_product_id or (interest.product_id if interest else None)
        item_name = getattr(payload, "item_name", None) or (interest.item_name_snapshot if interest else None)
        item_type = getattr(payload, "item_type", None) or (interest.item_type_snapshot if interest else "service")
        unit = getattr(payload, "unit", None) or (interest.unit_snapshot if interest else "unit")
        snapshot = resolve_sales_line(
            db,
            organization_id=quotation.organization_id,
            currency=quotation.currency,
            product_id=product_id,
            item_name=item_name,
            item_type=item_type,
            unit=unit,
            description=payload.description,
        )
        calculated = calculate_line(
            quantity=payload.quantity,
            unit_price=payload.unit_price,
            discount_percent=payload.discount_percent,
            tax_rate=payload.tax_rate,
            tax_calculation_mode=quotation.tax_calculation_mode,
        )
        calculated_lines.append(calculated)
        db.add(
            QuotationItem(
                organization_id=quotation.organization_id,
                quotation_id=quotation.id,
                product_id=snapshot.product_id,
                lead_interest_id=interest.id if interest else None,
                sort_order=index,
                item_name_snapshot=snapshot.item_name,
                sku_snapshot=snapshot.sku,
                item_type_snapshot=snapshot.item_type,
                unit_snapshot=snapshot.unit,
                description=snapshot.description,
                quantity=payload.quantity,
                unit_price=payload.unit_price,
                discount_percent=payload.discount_percent,
                tax_rate=payload.tax_rate,
                line_subtotal=calculated.line_subtotal,
                discount_amount=calculated.discount_amount,
                taxable_amount=calculated.taxable_amount,
                tax_amount=calculated.tax_amount,
                line_total=calculated.line_total,
            )
        )
    totals = calculate_totals(calculated_lines)
    quotation.subtotal = totals.subtotal
    quotation.discount_total = totals.discount_total
    quotation.tax_total = totals.tax_total
    quotation.total = totals.total


def _recalculate_items(db: DbSession, quotation: Quotation) -> None:
    rows = db.scalars(
        select(QuotationItem)
        .where(
            QuotationItem.organization_id == quotation.organization_id,
            QuotationItem.quotation_id == quotation.id,
        )
        .order_by(QuotationItem.sort_order.asc())
    ).all()
    calculated_lines = []
    for item in rows:
        calculated = calculate_line(
            quantity=item.quantity,
            unit_price=item.unit_price,
            discount_percent=item.discount_percent,
            tax_rate=item.tax_rate,
            tax_calculation_mode=quotation.tax_calculation_mode,
        )
        calculated_lines.append(calculated)
        item.line_subtotal = calculated.line_subtotal
        item.discount_amount = calculated.discount_amount
        item.taxable_amount = calculated.taxable_amount
        item.tax_amount = calculated.tax_amount
        item.line_total = calculated.line_total
    totals = calculate_totals(calculated_lines)
    quotation.subtotal = totals.subtotal
    quotation.discount_total = totals.discount_total
    quotation.tax_total = totals.tax_total
    quotation.total = totals.total


@router.get("/meta", response_model=SalesMeta)
def get_sales_meta(db: DbSession, tenant: QuotationViewer) -> SalesMeta:
    financial = db.scalar(
        select(OrganizationFinancialSettings).where(
            OrganizationFinancialSettings.organization_id == tenant.organization_id
        )
    )
    defaults = db.scalar(
        select(OrganizationSystemDefaults).where(
            OrganizationSystemDefaults.organization_id == tenant.organization_id
        )
    )
    return SalesMeta(
        default_currency=(financial.accounting_currency if financial else tenant.organization.currency),
        default_tax_calculation_mode=(financial.tax_calculation_mode if financial else "exclusive"),
        default_tax_rate=(financial.default_tax_rate if financial else Decimal("0")),
        default_validity_days=(defaults.quotation_validity_days if defaults else 30),
        employees=_employee_options(db, tenant.organization_id),
    )


@router.get("/catalog-options", response_model=list[SalesCatalogOption])
def get_catalog_options(
    db: DbSession,
    tenant: QuotationViewer,
    currency: str | None = None,
    search: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[SalesCatalogOption]:
    query = select(Product).where(
        Product.organization_id == tenant.organization_id,
        Product.is_active.is_(True),
    )
    if currency:
        query = query.where(Product.currency == currency.upper())
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(or_(Product.sku.ilike(needle), Product.name.ilike(needle), Product.description.ilike(needle)))
    products = db.scalars(query.order_by(Product.name.asc()).limit(limit)).all()
    result: list[SalesCatalogOption] = []
    for product in products:
        tax_rate = None
        if product.tax_code_id:
            tax_rate = db.scalar(
                select(TaxCode.rate).where(
                    TaxCode.id == product.tax_code_id,
                    TaxCode.organization_id == tenant.organization_id,
                    TaxCode.tax_kind == "sales",
                    TaxCode.is_active.is_(True),
                )
            )
        result.append(
            SalesCatalogOption(
                id=product.id,
                sku=product.sku,
                name=product.name,
                description=product.description,
                item_type=product.item_type,
                unit=product.unit,
                currency=product.currency,
                selling_price=product.selling_price,
                tax_rate=tax_rate,
            )
        )
    return result


@router.get("/lead-quotation-source/{lead_id}", response_model=LeadQuotationSource)
def get_lead_quotation_source(lead_id: str, db: DbSession, tenant: QuotationViewer) -> LeadQuotationSource:
    lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.organization_id == tenant.organization_id))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not lead.converted_client_id:
        raise HTTPException(status_code=409, detail="Convert this lead to a client before creating a quotation")
    client = db.scalar(
        select(Client).where(
            Client.id == lead.converted_client_id,
            Client.organization_id == tenant.organization_id,
            Client.status == "active",
        )
    )
    if client is None:
        raise HTTPException(status_code=409, detail="Converted client is not active")
    currency = (lead.currency or client.currency or tenant.organization.currency).upper()
    interests = db.scalars(
        select(LeadInterest)
        .where(
            LeadInterest.organization_id == tenant.organization_id,
            LeadInterest.lead_id == lead.id,
        )
        .order_by(LeadInterest.sort_order.asc(), LeadInterest.created_at.asc())
    ).all()
    return LeadQuotationSource(
        lead_id=lead.id,
        lead_code=lead.lead_code,
        client_id=client.id,
        client_name=client.display_name,
        currency=currency,
        subject=f"Proposal for {lead.company_name or lead.contact_name}",
        interests=[
            LeadQuotationInterest(
                id=item.id,
                product_id=item.product_id,
                item_name=item.item_name_snapshot,
                description=item.description,
                item_type=item.item_type_snapshot,
                unit=item.unit_snapshot,
                currency=item.currency,
                quantity=item.quantity,
                estimated_unit_price=item.estimated_unit_price,
            )
            for item in interests
        ],
    )


@router.get("/client-options", response_model=list[SalesClientOption])
def get_client_options(
    db: DbSession,
    tenant: QuotationViewer,
    search: str | None = None,
    client_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[SalesClientOption]:
    query = select(Client).where(
        Client.organization_id == tenant.organization_id,
        Client.status == "active",
    )
    if client_id:
        query = query.where(Client.id == client_id)
    elif search:
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(
                Client.client_code.ilike(needle),
                Client.display_name.ilike(needle),
                Client.contact_name.ilike(needle),
                Client.email.ilike(needle),
            )
        )
    clients = db.scalars(query.order_by(Client.display_name.asc()).limit(limit)).all()
    return [
        SalesClientOption(
            id=item.id,
            client_code=item.client_code,
            display_name=item.display_name,
            currency=item.currency,
            contact_name=item.contact_name,
        )
        for item in clients
    ]


@router.get("/quotations/summary", response_model=QuotationSummary)
def quotation_summary(db: DbSession, tenant: QuotationViewer) -> QuotationSummary:
    organization_id = tenant.organization_id
    row = db.execute(
        select(
            func.count(Quotation.id),
            func.count(Quotation.id).filter(Quotation.status == "draft"),
            func.count(Quotation.id).filter(Quotation.status == "sent"),
            func.count(Quotation.id).filter(Quotation.status == "accepted"),
            func.count(Quotation.id).filter(Quotation.status == "rejected"),
            func.count(Quotation.id).filter(Quotation.status == "cancelled"),
        ).where(Quotation.organization_id == organization_id)
    ).one()
    return QuotationSummary(total=row[0], draft=row[1], sent=row[2], accepted=row[3], rejected=row[4], cancelled=row[5])


@router.get("/quotations", response_model=QuotationPage)
def list_quotations(
    db: DbSession,
    tenant: QuotationViewer,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    cursor: str | None = None,
    search: str | None = None,
    quotation_status: str | None = Query(default=None, alias="status"),
    client_id: str | None = None,
) -> QuotationPage:
    query = _quotation_query(tenant.organization_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(or_(Quotation.quotation_number.ilike(needle), Quotation.subject.ilike(needle), Client.display_name.ilike(needle)))
    if quotation_status:
        query = query.where(Quotation.status == quotation_status)
    if client_id:
        query = query.where(Quotation.client_id == client_id)
    clause = _cursor_clause(_decode_cursor(cursor))
    if clause is not None:
        query = query.where(clause)
    rows = db.execute(query.order_by(Quotation.created_at.desc(), Quotation.id.desc()).limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return QuotationPage(
        items=[_list_item(row) for row in rows],
        next_cursor=_encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None,
    )


@router.get("/quotations/{quotation_id}", response_model=QuotationDetail)
def get_quotation(quotation_id: str, db: DbSession, tenant: QuotationViewer) -> QuotationDetail:
    return _detail(db, tenant.organization_id, quotation_id)


@router.post("/quotations", response_model=QuotationDetail, status_code=status.HTTP_201_CREATED)
def create_quotation(payload: QuotationCreate, request: Request, db: DbSession, tenant: QuotationManager) -> QuotationDetail:
    client = db.scalar(
        select(Client).where(
            Client.id == payload.client_id,
            Client.organization_id == tenant.organization_id,
            Client.status == "active",
        )
    )
    if client is None:
        raise HTTPException(status_code=400, detail="Active client not found in this company")
    if payload.valid_until and payload.valid_until < payload.issue_date:
        raise HTTPException(status_code=400, detail="Valid until date cannot be before issue date")
    _active_employee(db, tenant.organization_id, payload.assigned_employee_id)

    financial = db.scalar(select(OrganizationFinancialSettings).where(OrganizationFinancialSettings.organization_id == tenant.organization_id))
    profile = db.scalar(select(OrganizationProfile).where(OrganizationProfile.organization_id == tenant.organization_id))
    address = db.scalar(
        select(OrganizationAddress)
        .where(
            OrganizationAddress.organization_id == tenant.organization_id,
            OrganizationAddress.address_type.in_(["billing", "office", "registered"]),
        )
        .order_by((OrganizationAddress.address_type == "billing").desc(), (OrganizationAddress.address_type == "office").desc())
    )
    identifier = db.scalar(
        select(OrganizationIdentifier)
        .where(OrganizationIdentifier.organization_id == tenant.organization_id)
        .order_by(OrganizationIdentifier.is_primary.desc(), OrganizationIdentifier.created_at.asc())
    )
    source_lead_id = _source_lead_for_client(
        db,
        organization_id=tenant.organization_id,
        client_id=client.id,
        explicit_lead_id=payload.source_lead_id,
    )

    quotation = Quotation(
        organization_id=tenant.organization_id,
        quotation_number=next_sequence_code(db, tenant.organization_id, "quotation"),
        client_id=client.id,
        source_lead_id=source_lead_id,
        assigned_employee_id=payload.assigned_employee_id,
        created_by_user_id=tenant.user_id,
        status="draft",
        subject=_clean(payload.subject),
        issue_date=payload.issue_date,
        valid_until=payload.valid_until,
        currency=(payload.currency or client.currency or (financial.accounting_currency if financial else tenant.organization.currency)).upper(),
        tax_calculation_mode=(payload.tax_calculation_mode or (financial.tax_calculation_mode if financial else "exclusive")),
        seller_name_snapshot=(profile.legal_name if profile and profile.legal_name else tenant.organization.name),
        seller_email_snapshot=((profile.billing_email or profile.primary_email) if profile else None),
        seller_address_snapshot=_address_text(address),
        seller_tax_identifier_snapshot=(identifier.value if identifier else None),
        client_name_snapshot=client.legal_name or client.display_name,
        client_contact_snapshot=client.contact_name,
        client_email_snapshot=client.billing_email or client.email,
        client_address_snapshot=_client_address_text(client),
        client_tax_identifier_snapshot=client.tax_identifier,
        notes=_clean(payload.notes),
        terms_conditions=_clean(payload.terms_conditions),
        internal_notes=_clean(payload.internal_notes),
    )
    db.add(quotation)
    db.flush()
    _replace_items(db, quotation, payload.items)
    db.flush()

    record_activity(
        db,
        action="sales.quotation.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="quotation",
        entity_id=quotation.id,
        after={
            "quotation_number": quotation.quotation_number,
            "client_id": quotation.client_id,
            "source_lead_id": quotation.source_lead_id,
            "status": quotation.status,
            "currency": quotation.currency,
            "subtotal": str(quotation.subtotal),
            "tax_total": str(quotation.tax_total),
            "total": str(quotation.total),
            "item_count": len(payload.items),
        },
        message=f"Quotation created: {quotation.quotation_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, quotation.id)


@router.patch("/quotations/{quotation_id}", response_model=QuotationDetail)
def update_quotation(
    quotation_id: str,
    payload: QuotationUpdate,
    request: Request,
    db: DbSession,
    tenant: QuotationManager,
) -> QuotationDetail:
    quotation = db.scalar(
        select(Quotation)
        .where(Quotation.id == quotation_id, Quotation.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if quotation is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if quotation.status != "draft":
        raise HTTPException(status_code=409, detail="Only draft quotations can be edited")

    before = {
        "subject": quotation.subject,
        "issue_date": quotation.issue_date.isoformat(),
        "valid_until": quotation.valid_until.isoformat() if quotation.valid_until else None,
        "currency": quotation.currency,
        "tax_calculation_mode": quotation.tax_calculation_mode,
        "assigned_employee_id": quotation.assigned_employee_id,
        "subtotal": str(quotation.subtotal),
        "tax_total": str(quotation.tax_total),
        "total": str(quotation.total),
    }
    changes = payload.model_dump(exclude_unset=True, exclude={"items"})
    if "assigned_employee_id" in changes:
        _active_employee(db, tenant.organization_id, changes["assigned_employee_id"])
    if "currency" in changes and changes["currency"] and changes["currency"].upper() != quotation.currency and payload.items is None:
        raise HTTPException(status_code=400, detail="Changing quotation currency requires resubmitting line items")
    for field, value in changes.items():
        if field == "currency" and value:
            value = value.upper()
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(quotation, field, value)
    if quotation.valid_until and quotation.valid_until < quotation.issue_date:
        raise HTTPException(status_code=400, detail="Valid until date cannot be before issue date")
    if payload.items is not None:
        _replace_items(db, quotation, payload.items)
    elif "tax_calculation_mode" in changes:
        _recalculate_items(db, quotation)
    db.flush()
    after = {
        "subject": quotation.subject,
        "issue_date": quotation.issue_date.isoformat(),
        "valid_until": quotation.valid_until.isoformat() if quotation.valid_until else None,
        "currency": quotation.currency,
        "tax_calculation_mode": quotation.tax_calculation_mode,
        "assigned_employee_id": quotation.assigned_employee_id,
        "subtotal": str(quotation.subtotal),
        "tax_total": str(quotation.tax_total),
        "total": str(quotation.total),
    }
    record_activity(
        db,
        action="sales.quotation.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="quotation",
        entity_id=quotation.id,
        before=before,
        after=after,
        message=f"Quotation updated: {quotation.quotation_number}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, quotation.id)


@router.patch("/quotations/{quotation_id}/status", response_model=QuotationDetail)
def change_quotation_status(
    quotation_id: str,
    payload: QuotationStatusChange,
    request: Request,
    db: DbSession,
    tenant: QuotationManager,
) -> QuotationDetail:
    quotation = db.scalar(
        select(Quotation)
        .where(Quotation.id == quotation_id, Quotation.organization_id == tenant.organization_id)
        .with_for_update()
    )
    if quotation is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    if quotation.status == payload.status:
        return _detail(db, tenant.organization_id, quotation.id)

    allowed = {
        "draft": {"sent", "cancelled"},
        "sent": {"accepted", "rejected", "cancelled"},
        "accepted": set(),
        "rejected": set(),
        "cancelled": set(),
    }
    if payload.status not in allowed.get(quotation.status, set()):
        raise HTTPException(status_code=409, detail=f"Quotation cannot move from {quotation.status} to {payload.status}")

    previous = quotation.status
    now = datetime.now(timezone.utc)
    quotation.status = payload.status
    if payload.status == "sent":
        quotation.sent_at = now
    elif payload.status == "accepted":
        quotation.accepted_at = now
    elif payload.status == "rejected":
        quotation.rejected_at = now
    elif payload.status == "cancelled":
        quotation.cancelled_at = now
    db.flush()

    record_activity(
        db,
        action="sales.quotation.status_changed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="quotation",
        entity_id=quotation.id,
        before={"status": previous},
        after={"status": quotation.status},
        message=f"Quotation {quotation.quotation_number} status changed from {previous} to {quotation.status}",
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, quotation.id)
