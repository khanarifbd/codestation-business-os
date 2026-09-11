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
from app.models.crm import Client, Lead
from app.models.membership import Membership
from app.models.sales import (
    Quotation,
    QuotationItem,
    QuotationMilestone,
    QuotationPaymentSchedule,
    QuotationSection,
)
from app.models.team import Designation, Employee
from app.models.user import User
from app.schemas.sales import (
    QuotationCreate,
    QuotationDetail,
    QuotationItemRead,
    QuotationListItem,
    QuotationMilestoneRead,
    QuotationPage,
    QuotationPaymentScheduleRead,
    QuotationSectionRead,
    QuotationStatusChange,
    QuotationSummary,
    QuotationUpdate,
    SalesClientOption,
    SalesEmployeeOption,
    SalesMeta,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.sales import calculate_line, calculate_payment_amount, calculate_totals
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales", tags=["Sales"])

QuotationViewer = Annotated[TenantContext, Depends(require_tenant_permission("quotations.view"))]
QuotationManager = Annotated[TenantContext, Depends(require_tenant_permission("quotations.manage"))]

LEGACY_SECTION_META = {
    "terms_conditions": ("Terms & Conditions", 900),
    "additional_notes": ("Additional Notes", 910),
}


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


def _prepared_by_snapshot(
    db: DbSession,
    organization_id: str,
    assigned_employee_id: str | None,
    creator_user_id: str,
) -> tuple[str | None, str | None, str | None]:
    if assigned_employee_id:
        row = db.execute(
            select(User.full_name, Employee.work_email, User.email, Designation.name)
            .select_from(Employee)
            .join(Membership, Membership.id == Employee.membership_id)
            .join(User, User.id == Membership.user_id)
            .outerjoin(Designation, Designation.id == Employee.designation_id)
            .where(Employee.id == assigned_employee_id, Employee.organization_id == organization_id)
        ).first()
        if row:
            return row.full_name, row.work_email or row.email, row.name
    user = db.scalar(select(User).where(User.id == creator_user_id))
    if user is None:
        return None, None, None
    return user.full_name, user.email, None


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
        revision_number=quotation.revision_number,
        client_id=quotation.client_id,
        client_name=client_name,
        status=quotation.status,
        subject=quotation.subject,
        project_title=quotation.project_title,
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
        sort_order=item.sort_order,
        group_name=item.group_name,
        title=item.title,
        description=item.description,
        unit=item.unit,
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


def _section_read(item: QuotationSection) -> QuotationSectionRead:
    return QuotationSectionRead(
        id=item.id,
        sort_order=item.sort_order,
        section_type=item.section_type,
        title=item.title,
        content=item.content,
        is_visible=item.is_visible,
    )


def _milestone_read(item: QuotationMilestone) -> QuotationMilestoneRead:
    return QuotationMilestoneRead(
        id=item.id,
        sort_order=item.sort_order,
        title=item.title,
        description=item.description,
        start_date=item.start_date,
        due_date=item.due_date,
        duration_text=item.duration_text,
        acceptance_criteria=item.acceptance_criteria,
    )


def _payment_read(item: QuotationPaymentSchedule) -> QuotationPaymentScheduleRead:
    return QuotationPaymentScheduleRead(
        id=item.id,
        sort_order=item.sort_order,
        label=item.label,
        description=item.description,
        payment_type=item.payment_type,
        percentage=item.percentage,
        amount=item.amount,
        calculated_amount=item.calculated_amount,
        due_condition=item.due_condition,
    )


def _detail(db: DbSession, organization_id: str, quotation_id: str) -> QuotationDetail:
    row = db.execute(_quotation_query(organization_id).where(Quotation.id == quotation_id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    quotation, _client_name, assigned_name = row
    items = db.scalars(
        select(QuotationItem)
        .where(QuotationItem.organization_id == organization_id, QuotationItem.quotation_id == quotation.id)
        .order_by(QuotationItem.sort_order.asc(), QuotationItem.created_at.asc())
    ).all()
    sections = db.scalars(
        select(QuotationSection)
        .where(QuotationSection.organization_id == organization_id, QuotationSection.quotation_id == quotation.id)
        .order_by(QuotationSection.sort_order.asc(), QuotationSection.created_at.asc())
    ).all()
    milestones = db.scalars(
        select(QuotationMilestone)
        .where(QuotationMilestone.organization_id == organization_id, QuotationMilestone.quotation_id == quotation.id)
        .order_by(QuotationMilestone.sort_order.asc(), QuotationMilestone.created_at.asc())
    ).all()
    payment_schedule = db.scalars(
        select(QuotationPaymentSchedule)
        .where(
            QuotationPaymentSchedule.organization_id == organization_id,
            QuotationPaymentSchedule.quotation_id == quotation.id,
        )
        .order_by(QuotationPaymentSchedule.sort_order.asc(), QuotationPaymentSchedule.created_at.asc())
    ).all()
    return QuotationDetail(
        id=quotation.id,
        quotation_number=quotation.quotation_number,
        root_quotation_id=quotation.root_quotation_id,
        supersedes_quotation_id=quotation.supersedes_quotation_id,
        revision_number=quotation.revision_number,
        client_id=quotation.client_id,
        source_lead_id=quotation.source_lead_id,
        assigned_employee_id=quotation.assigned_employee_id,
        assigned_employee_name=assigned_name,
        status=quotation.status,
        subject=quotation.subject,
        project_title=quotation.project_title,
        executive_summary=quotation.executive_summary,
        issue_date=quotation.issue_date,
        valid_until=quotation.valid_until,
        estimated_start_date=quotation.estimated_start_date,
        estimated_end_date=quotation.estimated_end_date,
        estimated_duration=quotation.estimated_duration,
        start_condition=quotation.start_condition,
        currency=quotation.currency,
        tax_calculation_mode=quotation.tax_calculation_mode,
        seller_name_snapshot=quotation.seller_name_snapshot,
        seller_email_snapshot=quotation.seller_email_snapshot,
        seller_phone_snapshot=quotation.seller_phone_snapshot,
        seller_address_snapshot=quotation.seller_address_snapshot,
        seller_tax_identifier_snapshot=quotation.seller_tax_identifier_snapshot,
        client_name_snapshot=quotation.client_name_snapshot,
        client_contact_snapshot=quotation.client_contact_snapshot,
        client_email_snapshot=quotation.client_email_snapshot,
        client_phone_snapshot=quotation.client_phone_snapshot,
        client_address_snapshot=quotation.client_address_snapshot,
        client_tax_identifier_snapshot=quotation.client_tax_identifier_snapshot,
        prepared_by_name_snapshot=quotation.prepared_by_name_snapshot,
        prepared_by_email_snapshot=quotation.prepared_by_email_snapshot,
        prepared_by_designation_snapshot=quotation.prepared_by_designation_snapshot,
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
        sections=[_section_read(item) for item in sections],
        milestones=[_milestone_read(item) for item in milestones],
        payment_schedule=[_payment_read(item) for item in payment_schedule],
        created_at=quotation.created_at,
        updated_at=quotation.updated_at,
    )


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
                sort_order=index,
                group_name=_clean(getattr(payload, "group_name", None)),
                title=_clean(getattr(payload, "title", None)),
                description=payload.description.strip(),
                unit=(getattr(payload, "unit", None) or "item").strip().lower(),
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


def _replace_sections(db: DbSession, quotation: Quotation, payload_sections) -> None:
    existing = db.scalars(
        select(QuotationSection).where(
            QuotationSection.organization_id == quotation.organization_id,
            QuotationSection.quotation_id == quotation.id,
        )
    ).all()
    for item in existing:
        db.delete(item)
    db.flush()

    quotation.notes = None
    quotation.terms_conditions = None
    for index, payload in enumerate(payload_sections):
        content = payload.content.strip()
        title = payload.title.strip()
        db.add(
            QuotationSection(
                organization_id=quotation.organization_id,
                quotation_id=quotation.id,
                section_type=payload.section_type,
                title=title,
                content=content,
                sort_order=index,
                is_visible=payload.is_visible,
            )
        )
        if payload.section_type == "additional_notes":
            quotation.notes = content
        elif payload.section_type == "terms_conditions":
            quotation.terms_conditions = content


def _upsert_legacy_section(
    db: DbSession,
    quotation: Quotation,
    section_type: str,
    content: str | None,
) -> None:
    title, sort_order = LEGACY_SECTION_META[section_type]
    existing = db.scalar(
        select(QuotationSection).where(
            QuotationSection.organization_id == quotation.organization_id,
            QuotationSection.quotation_id == quotation.id,
            QuotationSection.section_type == section_type,
        )
    )
    cleaned = _clean(content)
    if cleaned is None:
        if existing is not None:
            db.delete(existing)
        return
    if existing is None:
        db.add(
            QuotationSection(
                organization_id=quotation.organization_id,
                quotation_id=quotation.id,
                section_type=section_type,
                title=title,
                content=cleaned,
                sort_order=sort_order,
                is_visible=True,
            )
        )
    else:
        existing.title = title
        existing.content = cleaned
        existing.is_visible = True


def _replace_milestones(db: DbSession, quotation: Quotation, payload_milestones) -> None:
    existing = db.scalars(
        select(QuotationMilestone).where(
            QuotationMilestone.organization_id == quotation.organization_id,
            QuotationMilestone.quotation_id == quotation.id,
        )
    ).all()
    for item in existing:
        db.delete(item)
    db.flush()
    for index, payload in enumerate(payload_milestones):
        db.add(
            QuotationMilestone(
                organization_id=quotation.organization_id,
                quotation_id=quotation.id,
                title=payload.title.strip(),
                description=_clean(payload.description),
                start_date=payload.start_date,
                due_date=payload.due_date,
                duration_text=_clean(payload.duration_text),
                acceptance_criteria=_clean(payload.acceptance_criteria),
                sort_order=index,
            )
        )


def _validate_payment_total(quotation: Quotation, amounts: list[Decimal]) -> None:
    scheduled = sum(amounts, Decimal("0"))
    if scheduled > quotation.total + Decimal("0.01"):
        raise HTTPException(
            status_code=400,
            detail="Payment schedule total cannot exceed quotation total",
        )


def _replace_payment_schedule(db: DbSession, quotation: Quotation, payload_entries) -> None:
    calculated_entries: list[tuple[object, Decimal]] = []
    for payload in payload_entries:
        try:
            calculated = calculate_payment_amount(
                quotation_total=quotation.total,
                payment_type=payload.payment_type,
                percentage=payload.percentage,
                amount=payload.amount,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        calculated_entries.append((payload, calculated))
    _validate_payment_total(quotation, [amount for _, amount in calculated_entries])

    existing = db.scalars(
        select(QuotationPaymentSchedule).where(
            QuotationPaymentSchedule.organization_id == quotation.organization_id,
            QuotationPaymentSchedule.quotation_id == quotation.id,
        )
    ).all()
    for item in existing:
        db.delete(item)
    db.flush()
    for index, (payload, calculated) in enumerate(calculated_entries):
        db.add(
            QuotationPaymentSchedule(
                organization_id=quotation.organization_id,
                quotation_id=quotation.id,
                label=payload.label.strip(),
                description=_clean(payload.description),
                payment_type=payload.payment_type,
                percentage=payload.percentage,
                amount=payload.amount,
                calculated_amount=calculated,
                due_condition=_clean(payload.due_condition),
                sort_order=index,
            )
        )


def _recalculate_payment_schedule(db: DbSession, quotation: Quotation) -> None:
    entries = db.scalars(
        select(QuotationPaymentSchedule)
        .where(
            QuotationPaymentSchedule.organization_id == quotation.organization_id,
            QuotationPaymentSchedule.quotation_id == quotation.id,
        )
        .order_by(QuotationPaymentSchedule.sort_order.asc())
    ).all()
    amounts: list[Decimal] = []
    for entry in entries:
        try:
            entry.calculated_amount = calculate_payment_amount(
                quotation_total=quotation.total,
                payment_type=entry.payment_type,
                percentage=entry.percentage,
                amount=entry.amount,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        amounts.append(entry.calculated_amount)
    _validate_payment_total(quotation, amounts)


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


@router.get("/client-options", response_model=list[SalesClientOption])
def get_client_options(
    db: DbSession,
    tenant: QuotationViewer,
    search: str | None = None,
    client_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[SalesClientOption]:
    query = select(Client).where(Client.organization_id == tenant.organization_id, Client.status == "active")
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
    return QuotationSummary(
        total=row[0],
        draft=row[1],
        sent=row[2],
        accepted=row[3],
        rejected=row[4],
        cancelled=row[5],
    )


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
        query = query.where(
            or_(
                Quotation.quotation_number.ilike(needle),
                Quotation.subject.ilike(needle),
                Quotation.project_title.ilike(needle),
                Client.display_name.ilike(needle),
            )
        )
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
def create_quotation(
    payload: QuotationCreate,
    request: Request,
    db: DbSession,
    tenant: QuotationManager,
) -> QuotationDetail:
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
    if payload.estimated_start_date and payload.estimated_end_date and payload.estimated_end_date < payload.estimated_start_date:
        raise HTTPException(status_code=400, detail="Estimated end date cannot be before estimated start date")
    _active_employee(db, tenant.organization_id, payload.assigned_employee_id)

    financial = db.scalar(
        select(OrganizationFinancialSettings).where(
            OrganizationFinancialSettings.organization_id == tenant.organization_id
        )
    )
    profile = db.scalar(select(OrganizationProfile).where(OrganizationProfile.organization_id == tenant.organization_id))
    address = db.scalar(
        select(OrganizationAddress)
        .where(
            OrganizationAddress.organization_id == tenant.organization_id,
            OrganizationAddress.address_type.in_(["billing", "office", "registered"]),
        )
        .order_by(
            (OrganizationAddress.address_type == "billing").desc(),
            (OrganizationAddress.address_type == "office").desc(),
        )
    )
    identifier = db.scalar(
        select(OrganizationIdentifier)
        .where(OrganizationIdentifier.organization_id == tenant.organization_id)
        .order_by(OrganizationIdentifier.is_primary.desc(), OrganizationIdentifier.created_at.asc())
    )
    source_lead_id = db.scalar(
        select(Lead.id)
        .where(Lead.organization_id == tenant.organization_id, Lead.converted_client_id == client.id)
        .order_by(Lead.converted_at.desc().nullslast())
        .limit(1)
    )
    prepared_name, prepared_email, prepared_designation = _prepared_by_snapshot(
        db, tenant.organization_id, payload.assigned_employee_id, tenant.user_id
    )

    quotation = Quotation(
        organization_id=tenant.organization_id,
        quotation_number=next_sequence_code(db, tenant.organization_id, "quotation"),
        client_id=client.id,
        source_lead_id=source_lead_id,
        assigned_employee_id=payload.assigned_employee_id,
        created_by_user_id=tenant.user_id,
        revision_number=1,
        status="draft",
        subject=_clean(payload.subject),
        project_title=_clean(payload.project_title) or _clean(payload.subject),
        executive_summary=_clean(payload.executive_summary),
        issue_date=payload.issue_date,
        valid_until=payload.valid_until,
        estimated_start_date=payload.estimated_start_date,
        estimated_end_date=payload.estimated_end_date,
        estimated_duration=_clean(payload.estimated_duration),
        start_condition=_clean(payload.start_condition),
        currency=(
            payload.currency
            or client.currency
            or (financial.accounting_currency if financial else tenant.organization.currency)
        ).upper(),
        tax_calculation_mode=(
            payload.tax_calculation_mode or (financial.tax_calculation_mode if financial else "exclusive")
        ),
        seller_name_snapshot=(profile.legal_name if profile and profile.legal_name else tenant.organization.name),
        seller_email_snapshot=((profile.billing_email or profile.primary_email) if profile else None),
        seller_phone_snapshot=(profile.phone if profile else None),
        seller_address_snapshot=_address_text(address),
        seller_tax_identifier_snapshot=(identifier.value if identifier else None),
        client_name_snapshot=client.legal_name or client.display_name,
        client_contact_snapshot=client.contact_name,
        client_email_snapshot=client.billing_email or client.email,
        client_phone_snapshot=client.phone,
        client_address_snapshot=_client_address_text(client),
        client_tax_identifier_snapshot=client.tax_identifier,
        prepared_by_name_snapshot=prepared_name,
        prepared_by_email_snapshot=prepared_email,
        prepared_by_designation_snapshot=prepared_designation,
        notes=_clean(payload.notes),
        terms_conditions=_clean(payload.terms_conditions),
        internal_notes=_clean(payload.internal_notes),
    )
    db.add(quotation)
    db.flush()
    _replace_items(db, quotation, payload.items)
    if payload.sections is not None:
        _replace_sections(db, quotation, payload.sections)
    else:
        _upsert_legacy_section(db, quotation, "terms_conditions", quotation.terms_conditions)
        _upsert_legacy_section(db, quotation, "additional_notes", quotation.notes)
    if payload.milestones is not None:
        _replace_milestones(db, quotation, payload.milestones)
    if payload.payment_schedule is not None:
        _replace_payment_schedule(db, quotation, payload.payment_schedule)
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
            "revision_number": quotation.revision_number,
            "client_id": quotation.client_id,
            "project_title": quotation.project_title,
            "status": quotation.status,
            "currency": quotation.currency,
            "subtotal": str(quotation.subtotal),
            "tax_total": str(quotation.tax_total),
            "total": str(quotation.total),
            "item_count": len(payload.items),
            "section_count": len(payload.sections or []),
            "milestone_count": len(payload.milestones or []),
            "payment_schedule_count": len(payload.payment_schedule or []),
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

    before_subject = quotation.subject
    before = {
        "subject": quotation.subject,
        "project_title": quotation.project_title,
        "issue_date": quotation.issue_date.isoformat(),
        "valid_until": quotation.valid_until.isoformat() if quotation.valid_until else None,
        "currency": quotation.currency,
        "tax_calculation_mode": quotation.tax_calculation_mode,
        "assigned_employee_id": quotation.assigned_employee_id,
        "subtotal": str(quotation.subtotal),
        "tax_total": str(quotation.tax_total),
        "total": str(quotation.total),
    }
    changes = payload.model_dump(
        exclude_unset=True,
        exclude={"items", "sections", "milestones", "payment_schedule"},
    )
    if "assigned_employee_id" in changes:
        _active_employee(db, tenant.organization_id, changes["assigned_employee_id"])
    for field, value in changes.items():
        if field == "currency" and value:
            value = value.upper()
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(quotation, field, value)
    if "subject" in changes and "project_title" not in changes:
        if quotation.project_title is None or quotation.project_title == before_subject:
            quotation.project_title = quotation.subject
    if quotation.valid_until and quotation.valid_until < quotation.issue_date:
        raise HTTPException(status_code=400, detail="Valid until date cannot be before issue date")
    if quotation.estimated_start_date and quotation.estimated_end_date and quotation.estimated_end_date < quotation.estimated_start_date:
        raise HTTPException(status_code=400, detail="Estimated end date cannot be before estimated start date")

    pricing_changed = payload.items is not None or "tax_calculation_mode" in changes
    if payload.items is not None:
        _replace_items(db, quotation, payload.items)
    elif "tax_calculation_mode" in changes:
        existing_items = db.scalars(
            select(QuotationItem)
            .where(
                QuotationItem.organization_id == tenant.organization_id,
                QuotationItem.quotation_id == quotation.id,
            )
            .order_by(QuotationItem.sort_order.asc())
        ).all()

        class ExistingPayload:
            def __init__(self, item):
                self.group_name = item.group_name
                self.title = item.title
                self.description = item.description
                self.unit = item.unit
                self.quantity = item.quantity
                self.unit_price = item.unit_price
                self.discount_percent = item.discount_percent
                self.tax_rate = item.tax_rate

        _replace_items(db, quotation, [ExistingPayload(item) for item in existing_items])

    if payload.sections is not None:
        _replace_sections(db, quotation, payload.sections)
    else:
        if "notes" in changes:
            _upsert_legacy_section(db, quotation, "additional_notes", quotation.notes)
        if "terms_conditions" in changes:
            _upsert_legacy_section(db, quotation, "terms_conditions", quotation.terms_conditions)
    if payload.milestones is not None:
        _replace_milestones(db, quotation, payload.milestones)
    if payload.payment_schedule is not None:
        _replace_payment_schedule(db, quotation, payload.payment_schedule)
    elif pricing_changed:
        _recalculate_payment_schedule(db, quotation)

    if "assigned_employee_id" in changes:
        prepared_name, prepared_email, prepared_designation = _prepared_by_snapshot(
            db, tenant.organization_id, quotation.assigned_employee_id, quotation.created_by_user_id
        )
        quotation.prepared_by_name_snapshot = prepared_name
        quotation.prepared_by_email_snapshot = prepared_email
        quotation.prepared_by_designation_snapshot = prepared_designation

    db.flush()
    after = {
        "subject": quotation.subject,
        "project_title": quotation.project_title,
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
        raise HTTPException(
            status_code=409,
            detail=f"Quotation cannot move from {quotation.status} to {payload.status}",
        )

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
        message=(
            f"Quotation {quotation.quotation_number} status changed "
            f"from {previous} to {quotation.status}"
        ),
        request=request,
    )
    db.commit()
    return _detail(db, tenant.organization_id, quotation.id)
