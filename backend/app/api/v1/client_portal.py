from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.dependencies import CurrentTenant, DbSession
from app.models.client_access import ClientMembership
from app.models.crm import Client
from app.models.finance import Invoice, InvoiceItem, Payment
from app.models.projects import Project
from app.models.sales import Quotation, QuotationItem

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
    quotation_count: int
    financials: list[ClientPortalFinancial]


class ClientPortalProject(BaseModel):
    id: str
    project_number: str
    client_id: str
    name: str
    status: str
    progress_percent: int
    planned_start_date: date | None
    due_date: date | None
    currency: str
    contract_value: Decimal
    description: str | None
    actual_started_at: datetime | None
    completed_at: datetime | None


class ClientPortalInvoice(BaseModel):
    id: str
    invoice_number: str
    client_id: str
    project_id: str | None
    quotation_id: str | None
    status: str
    subject: str | None
    issue_date: date
    due_date: date | None
    currency: str
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal


class ClientPortalInvoiceItem(BaseModel):
    id: str
    item_name: str
    description: str
    quantity: Decimal
    unit: str
    unit_price: Decimal
    discount_percent: Decimal
    tax_rate: Decimal
    line_total: Decimal


class ClientPortalInvoicePayment(BaseModel):
    id: str
    payment_date: date
    invoice_currency: str
    invoice_amount: Decimal
    method: str
    reference: str | None


class ClientPortalInvoiceDetail(ClientPortalInvoice):
    seller_name: str
    seller_email: str | None
    seller_address: str | None
    client_name: str
    client_contact: str | None
    client_email: str | None
    client_address: str | None
    payment_method: str | None
    payment_account_name: str | None
    payment_provider: str | None
    payment_account_holder: str | None
    payment_account_reference: str | None
    payment_currency: str | None
    payment_url: str | None
    payment_instructions: str | None
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    notes: str | None
    terms_conditions: str | None
    items: list[ClientPortalInvoiceItem]
    payments: list[ClientPortalInvoicePayment]


class ClientPortalQuotation(BaseModel):
    id: str
    quotation_number: str
    client_id: str
    status: str
    subject: str | None
    issue_date: date
    valid_until: date | None
    currency: str
    total: Decimal


class ClientPortalQuotationItem(BaseModel):
    id: str
    item_name: str
    description: str
    quantity: Decimal
    unit: str
    unit_price: Decimal
    discount_percent: Decimal
    tax_rate: Decimal
    line_total: Decimal


class ClientPortalQuotationDetail(ClientPortalQuotation):
    seller_name: str
    seller_email: str | None
    seller_address: str | None
    client_name: str
    client_contact: str | None
    client_email: str | None
    client_address: str | None
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    notes: str | None
    terms_conditions: str | None
    accepted_at: datetime | None
    rejected_at: datetime | None
    items: list[ClientPortalQuotationItem]


def _client_portal_rows(db: DbSession, tenant: CurrentTenant):
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
    return rows


def _client_portal_client_ids(db: DbSession, tenant: CurrentTenant) -> list[str]:
    return [client.id for _, client in _client_portal_rows(db, tenant)]


def _project_response(project: Project) -> ClientPortalProject:
    return ClientPortalProject(
        id=project.id,
        project_number=project.project_number,
        client_id=project.client_id,
        name=project.name,
        status=project.status,
        progress_percent=project.progress_percent,
        planned_start_date=project.planned_start_date,
        due_date=project.due_date,
        currency=project.currency,
        contract_value=project.contract_value,
        description=project.description,
        actual_started_at=project.actual_started_at,
        completed_at=project.completed_at,
    )


def _invoice_response(invoice: Invoice) -> ClientPortalInvoice:
    return ClientPortalInvoice(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        client_id=invoice.client_id,
        project_id=invoice.project_id,
        quotation_id=invoice.quotation_id,
        status=invoice.status,
        subject=invoice.subject,
        issue_date=invoice.issue_date,
        due_date=invoice.due_date,
        currency=invoice.currency,
        total=invoice.total,
        amount_paid=invoice.amount_paid,
        balance_due=invoice.balance_due,
    )


def _quotation_response(quotation: Quotation) -> ClientPortalQuotation:
    return ClientPortalQuotation(
        id=quotation.id,
        quotation_number=quotation.quotation_number,
        client_id=quotation.client_id,
        status=quotation.status,
        subject=quotation.subject,
        issue_date=quotation.issue_date,
        valid_until=quotation.valid_until,
        currency=quotation.currency,
        total=quotation.total,
    )


@router.get("/context", response_model=ClientPortalContext)
def get_client_portal_context(db: DbSession, tenant: CurrentTenant) -> ClientPortalContext:
    rows = _client_portal_rows(db, tenant)
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
            Invoice.status.notin_(["draft", "cancelled"]),
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
    quotation_count = db.scalar(
        select(func.count(Quotation.id)).where(
            Quotation.organization_id == tenant.organization_id,
            Quotation.client_id.in_(client_ids),
            Quotation.status.notin_(["draft", "cancelled"]),
        )
    ) or 0

    return ClientPortalContext(
        organization_id=tenant.organization_id,
        organization_name=tenant.organization.name,
        membership_id=tenant.membership_id,
        clients=clients,
        project_count=int(project_count),
        quotation_count=int(quotation_count),
        financials=financials,
    )


@router.get("/projects", response_model=list[ClientPortalProject])
def list_client_portal_projects(db: DbSession, tenant: CurrentTenant) -> list[ClientPortalProject]:
    client_ids = _client_portal_client_ids(db, tenant)
    projects = db.scalars(
        select(Project)
        .where(
            Project.organization_id == tenant.organization_id,
            Project.client_id.in_(client_ids),
        )
        .order_by(Project.created_at.desc())
    ).all()
    return [_project_response(project) for project in projects]


@router.get("/projects/{project_id}", response_model=ClientPortalProject)
def get_client_portal_project(project_id: str, db: DbSession, tenant: CurrentTenant) -> ClientPortalProject:
    client_ids = _client_portal_client_ids(db, tenant)
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == tenant.organization_id,
            Project.client_id.in_(client_ids),
        )
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_response(project)


@router.get("/invoices", response_model=list[ClientPortalInvoice])
def list_client_portal_invoices(db: DbSession, tenant: CurrentTenant) -> list[ClientPortalInvoice]:
    client_ids = _client_portal_client_ids(db, tenant)
    invoices = db.scalars(
        select(Invoice)
        .where(
            Invoice.organization_id == tenant.organization_id,
            Invoice.client_id.in_(client_ids),
            Invoice.status.notin_(["draft", "cancelled"]),
        )
        .order_by(Invoice.issue_date.desc(), Invoice.created_at.desc())
    ).all()
    return [_invoice_response(invoice) for invoice in invoices]


@router.get("/invoices/{invoice_id}", response_model=ClientPortalInvoiceDetail)
def get_client_portal_invoice(invoice_id: str, db: DbSession, tenant: CurrentTenant) -> ClientPortalInvoiceDetail:
    client_ids = _client_portal_client_ids(db, tenant)
    invoice = db.scalar(
        select(Invoice).where(
            Invoice.id == invoice_id,
            Invoice.organization_id == tenant.organization_id,
            Invoice.client_id.in_(client_ids),
            Invoice.status.notin_(["draft", "cancelled"]),
        )
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")

    items = db.scalars(
        select(InvoiceItem)
        .where(
            InvoiceItem.organization_id == tenant.organization_id,
            InvoiceItem.invoice_id == invoice.id,
        )
        .order_by(InvoiceItem.sort_order.asc(), InvoiceItem.created_at.asc())
    ).all()
    payments = db.scalars(
        select(Payment)
        .where(
            Payment.organization_id == tenant.organization_id,
            Payment.invoice_id == invoice.id,
            Payment.status == "confirmed",
        )
        .order_by(Payment.payment_date.desc(), Payment.created_at.desc())
    ).all()

    return ClientPortalInvoiceDetail(
        **_invoice_response(invoice).model_dump(),
        seller_name=invoice.seller_name_snapshot,
        seller_email=invoice.seller_email_snapshot,
        seller_address=invoice.seller_address_snapshot,
        client_name=invoice.client_name_snapshot,
        client_contact=invoice.client_contact_snapshot,
        client_email=invoice.client_email_snapshot,
        client_address=invoice.client_address_snapshot,
        payment_method=invoice.payment_method,
        payment_account_name=invoice.payment_account_name_snapshot,
        payment_provider=invoice.payment_provider_snapshot,
        payment_account_holder=invoice.payment_account_holder_snapshot,
        payment_account_reference=invoice.payment_account_reference_snapshot,
        payment_currency=invoice.payment_currency_snapshot,
        payment_url=invoice.payment_url_snapshot,
        payment_instructions=invoice.payment_instructions_snapshot,
        subtotal=invoice.subtotal,
        discount_total=invoice.discount_total,
        tax_total=invoice.tax_total,
        notes=invoice.notes,
        terms_conditions=invoice.terms_conditions,
        items=[
            ClientPortalInvoiceItem(
                id=item.id,
                item_name=item.item_name_snapshot,
                description=item.description,
                quantity=item.quantity,
                unit=item.unit_snapshot,
                unit_price=item.unit_price,
                discount_percent=item.discount_percent,
                tax_rate=item.tax_rate,
                line_total=item.line_total,
            )
            for item in items
        ],
        payments=[
            ClientPortalInvoicePayment(
                id=payment.id,
                payment_date=payment.payment_date,
                invoice_currency=payment.invoice_currency,
                invoice_amount=payment.invoice_amount,
                method=payment.method,
                reference=payment.reference,
            )
            for payment in payments
        ],
    )


@router.get("/quotations", response_model=list[ClientPortalQuotation])
def list_client_portal_quotations(db: DbSession, tenant: CurrentTenant) -> list[ClientPortalQuotation]:
    client_ids = _client_portal_client_ids(db, tenant)
    quotations = db.scalars(
        select(Quotation)
        .where(
            Quotation.organization_id == tenant.organization_id,
            Quotation.client_id.in_(client_ids),
            Quotation.status.notin_(["draft", "cancelled"]),
        )
        .order_by(Quotation.issue_date.desc(), Quotation.created_at.desc())
    ).all()
    return [_quotation_response(quotation) for quotation in quotations]


@router.get("/quotations/{quotation_id}", response_model=ClientPortalQuotationDetail)
def get_client_portal_quotation(
    quotation_id: str,
    db: DbSession,
    tenant: CurrentTenant,
) -> ClientPortalQuotationDetail:
    client_ids = _client_portal_client_ids(db, tenant)
    quotation = db.scalar(
        select(Quotation).where(
            Quotation.id == quotation_id,
            Quotation.organization_id == tenant.organization_id,
            Quotation.client_id.in_(client_ids),
            Quotation.status.notin_(["draft", "cancelled"]),
        )
    )
    if quotation is None:
        raise HTTPException(status_code=404, detail="Quotation not found")

    items = db.scalars(
        select(QuotationItem)
        .where(
            QuotationItem.organization_id == tenant.organization_id,
            QuotationItem.quotation_id == quotation.id,
        )
        .order_by(QuotationItem.sort_order.asc(), QuotationItem.created_at.asc())
    ).all()

    return ClientPortalQuotationDetail(
        **_quotation_response(quotation).model_dump(),
        seller_name=quotation.seller_name_snapshot,
        seller_email=quotation.seller_email_snapshot,
        seller_address=quotation.seller_address_snapshot,
        client_name=quotation.client_name_snapshot,
        client_contact=quotation.client_contact_snapshot,
        client_email=quotation.client_email_snapshot,
        client_address=quotation.client_address_snapshot,
        subtotal=quotation.subtotal,
        discount_total=quotation.discount_total,
        tax_total=quotation.tax_total,
        notes=quotation.notes,
        terms_conditions=quotation.terms_conditions,
        accepted_at=quotation.accepted_at,
        rejected_at=quotation.rejected_at,
        items=[
            ClientPortalQuotationItem(
                id=item.id,
                item_name=item.item_name_snapshot,
                description=item.description,
                quantity=item.quantity,
                unit=item.unit_snapshot,
                unit_price=item.unit_price,
                discount_percent=item.discount_percent,
                tax_rate=item.tax_rate,
                line_total=item.line_total,
            )
            for item in items
        ],
    )
