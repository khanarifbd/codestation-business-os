from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.company_settings import OrganizationAddress, OrganizationFinancialSettings, OrganizationIdentifier, OrganizationProfile
from app.models.crm import Client
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, InvoiceItem, Payment
from app.models.orders import Order, OrderItem
from app.models.projects import Project
from app.models.team import Employee
from app.schemas.finance import (
    CurrencyInvoiceSummary,
    FinanceMeta,
    FinanceMetaClient,
    FinanceMetaOrder,
    FinanceMetaProject,
    FinanceSummary,
    FinancialAccountCreate,
    FinancialAccountRead,
    FinancialAccountUpdate,
    InvoiceCreate,
    InvoiceDetail,
    InvoiceItemRead,
    InvoiceListItem,
    InvoicePage,
    InvoiceStatusAction,
    LedgerTransactionRead,
    PaymentCreate,
    PaymentRead,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.sales import calculate_line, calculate_totals
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Finance"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _address(parts: list[str | None]) -> str | None:
    values = [part.strip() for part in parts if part and part.strip()]
    return ", ".join(values) if values else None


def _account_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    credit = db.scalar(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
            FinancialTransaction.direction == "credit",
        )
    ) or Decimal("0")
    debit = db.scalar(
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
            FinancialTransaction.direction == "debit",
        )
    ) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(credit) - Decimal(debit))


def _account_read(db: DbSession, account: FinancialAccount) -> FinancialAccountRead:
    return FinancialAccountRead(
        id=account.id,
        name=account.name,
        account_type=account.account_type,
        provider_name=account.provider_name,
        account_holder_name=account.account_holder_name,
        account_reference=account.account_reference,
        currency=account.currency,
        opening_balance=account.opening_balance,
        current_balance=_account_balance(db, account),
        is_active=account.is_active,
        notes=account.notes,
        created_at=account.created_at,
        updated_at=account.updated_at,
    )


def _invoice_display_status(invoice: Invoice, today) -> str:
    if invoice.status in {"draft", "cancelled", "paid"}:
        return invoice.status
    if invoice.balance_due > 0 and invoice.due_date and invoice.due_date < today:
        return "overdue"
    return invoice.status


def _invoice_list_item(db: DbSession, invoice: Invoice, timezone_name: str) -> InvoiceListItem:
    client = db.get(Client, invoice.client_id)
    return InvoiceListItem(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        client_id=invoice.client_id,
        client_name=client.display_name if client else invoice.client_name_snapshot,
        order_id=invoice.order_id,
        project_id=invoice.project_id,
        status=invoice.status,
        display_status=_invoice_display_status(invoice, _tenant_today(timezone_name)),
        subject=invoice.subject,
        issue_date=invoice.issue_date,
        due_date=invoice.due_date,
        currency=invoice.currency,
        total=invoice.total,
        amount_paid=invoice.amount_paid,
        balance_due=invoice.balance_due,
        created_at=invoice.created_at,
    )


def _invoice_detail(db: DbSession, invoice: Invoice, timezone_name: str) -> InvoiceDetail:
    base = _invoice_list_item(db, invoice, timezone_name)
    items = db.scalars(
        select(InvoiceItem)
        .where(InvoiceItem.organization_id == invoice.organization_id, InvoiceItem.invoice_id == invoice.id)
        .order_by(InvoiceItem.sort_order.asc(), InvoiceItem.created_at.asc())
    ).all()
    return InvoiceDetail(
        **base.model_dump(),
        quotation_id=invoice.quotation_id,
        tax_calculation_mode=invoice.tax_calculation_mode,
        seller_name_snapshot=invoice.seller_name_snapshot,
        seller_email_snapshot=invoice.seller_email_snapshot,
        seller_address_snapshot=invoice.seller_address_snapshot,
        seller_tax_identifier_snapshot=invoice.seller_tax_identifier_snapshot,
        client_name_snapshot=invoice.client_name_snapshot,
        client_contact_snapshot=invoice.client_contact_snapshot,
        client_email_snapshot=invoice.client_email_snapshot,
        client_address_snapshot=invoice.client_address_snapshot,
        client_tax_identifier_snapshot=invoice.client_tax_identifier_snapshot,
        subtotal=invoice.subtotal,
        discount_total=invoice.discount_total,
        tax_total=invoice.tax_total,
        notes=invoice.notes,
        terms_conditions=invoice.terms_conditions,
        internal_notes=invoice.internal_notes,
        sent_at=invoice.sent_at,
        paid_at=invoice.paid_at,
        cancelled_at=invoice.cancelled_at,
        items=[
            InvoiceItemRead(
                id=item.id,
                source_order_item_id=item.source_order_item_id,
                sort_order=item.sort_order,
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
            for item in items
        ],
    )


def _seller_snapshot(db: DbSession, tenant: TenantContext) -> tuple[str, str | None, str | None, str | None]:
    profile = db.scalar(select(OrganizationProfile).where(OrganizationProfile.organization_id == tenant.organization_id))
    address = db.scalar(
        select(OrganizationAddress)
        .where(OrganizationAddress.organization_id == tenant.organization_id)
        .order_by(OrganizationAddress.address_type.asc())
        .limit(1)
    )
    identifier = db.scalar(
        select(OrganizationIdentifier)
        .where(OrganizationIdentifier.organization_id == tenant.organization_id)
        .order_by(OrganizationIdentifier.is_primary.desc(), OrganizationIdentifier.created_at.asc())
        .limit(1)
    )
    return (
        (profile.legal_name if profile and profile.legal_name else tenant.organization.name),
        profile.billing_email or profile.primary_email if profile else None,
        _address([address.line1, address.line2, address.city, address.state_region, address.postal_code, address.country_code]) if address else None,
        identifier.value if identifier else None,
    )


def _client_snapshot(client: Client) -> tuple[str, str | None, str | None, str | None, str | None]:
    return (
        client.display_name,
        client.contact_name,
        client.billing_email or client.email,
        _address([client.address_line1, client.address_line2, client.city, client.state_region, client.postal_code, client.country_code]),
        client.tax_identifier,
    )


def _financial_defaults(db: DbSession, organization_id: str):
    return db.scalar(select(OrganizationFinancialSettings).where(OrganizationFinancialSettings.organization_id == organization_id))


def _validate_employee(db: DbSession, organization_id: str, employee_id: str | None) -> None:
    if employee_id and db.scalar(select(Employee.id).where(Employee.id == employee_id, Employee.organization_id == organization_id, Employee.employment_status == "active")) is None:
        raise HTTPException(status_code=400, detail="Assigned employee is not active in this organization")


def _create_manual_invoice(payload: InvoiceCreate, request: Request, db: DbSession, tenant: TenantContext) -> InvoiceDetail:
    client = db.scalar(select(Client).where(Client.id == payload.client_id, Client.organization_id == tenant.organization_id, Client.status == "active"))
    if client is None:
        raise HTTPException(status_code=404, detail="Active client not found")
    _validate_employee(db, tenant.organization_id, payload.assigned_employee_id)
    today = _tenant_today(tenant.organization.timezone)
    defaults = _financial_defaults(db, tenant.organization_id)
    issue_date = payload.issue_date or today
    due_date = payload.due_date or (issue_date + timedelta(days=defaults.default_payment_terms_days if defaults else 30))
    if due_date < issue_date:
        raise HTTPException(status_code=400, detail="Invoice due date cannot be before issue date")
    currency = (payload.currency or client.currency or tenant.organization.currency).upper()
    calculated = [
        calculate_line(
            quantity=item.quantity,
            unit_price=item.unit_price,
            discount_percent=item.discount_percent,
            tax_rate=item.tax_rate,
            tax_calculation_mode=payload.tax_calculation_mode,
        )
        for item in payload.items
    ]
    totals = calculate_totals(calculated)
    seller_name, seller_email, seller_address, seller_tax = _seller_snapshot(db, tenant)
    client_name, client_contact, client_email, client_address, client_tax = _client_snapshot(client)
    invoice = Invoice(
        organization_id=tenant.organization_id,
        invoice_number=next_sequence_code(db, tenant.organization_id, "invoice"),
        client_id=client.id,
        assigned_employee_id=payload.assigned_employee_id or client.assigned_employee_id,
        created_by_user_id=tenant.user_id,
        status="draft",
        subject=_clean(payload.subject),
        issue_date=issue_date,
        due_date=due_date,
        currency=currency,
        tax_calculation_mode=payload.tax_calculation_mode,
        seller_name_snapshot=seller_name,
        seller_email_snapshot=seller_email,
        seller_address_snapshot=seller_address,
        seller_tax_identifier_snapshot=seller_tax,
        client_name_snapshot=client_name,
        client_contact_snapshot=client_contact,
        client_email_snapshot=client_email,
        client_address_snapshot=client_address,
        client_tax_identifier_snapshot=client_tax,
        subtotal=totals.subtotal,
        discount_total=totals.discount_total,
        tax_total=totals.tax_total,
        total=totals.total,
        amount_paid=Decimal("0"),
        balance_due=totals.total,
        notes=_clean(payload.notes),
        terms_conditions=_clean(payload.terms_conditions),
        internal_notes=_clean(payload.internal_notes),
    )
    db.add(invoice); db.flush()
    for index, (source, line) in enumerate(zip(payload.items, calculated, strict=True)):
        db.add(InvoiceItem(
            organization_id=tenant.organization_id,
            invoice_id=invoice.id,
            sort_order=index,
            description=source.description.strip(),
            quantity=source.quantity,
            unit_price=source.unit_price,
            discount_percent=source.discount_percent,
            tax_rate=source.tax_rate,
            line_subtotal=line.line_subtotal,
            discount_amount=line.discount_amount,
            taxable_amount=line.taxable_amount,
            tax_amount=line.tax_amount,
            line_total=line.line_total,
        ))
    db.flush()
    record_activity(
        db, action="finance.invoice.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="invoice", entity_id=invoice.id,
        after={"invoice_number": invoice.invoice_number, "client_id": client.id, "currency": currency, "total": str(invoice.total), "status": invoice.status},
        message=f"Invoice {invoice.invoice_number} created for {client.display_name}", request=request,
    )
    db.commit(); db.refresh(invoice)
    return _invoice_detail(db, invoice, tenant.organization.timezone)


def _create_invoice_from_order(order: Order, project_id: str | None, request: Request, db: DbSession, tenant: TenantContext) -> InvoiceDetail:
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled orders cannot be invoiced")
    items = db.scalars(
        select(OrderItem).where(OrderItem.organization_id == tenant.organization_id, OrderItem.order_id == order.id).order_by(OrderItem.sort_order.asc(), OrderItem.created_at.asc())
    ).all()
    if not items:
        raise HTTPException(status_code=409, detail="Order has no line items")
    defaults = _financial_defaults(db, tenant.organization_id)
    today = _tenant_today(tenant.organization.timezone)
    invoice = Invoice(
        organization_id=tenant.organization_id,
        invoice_number=next_sequence_code(db, tenant.organization_id, "invoice"),
        client_id=order.client_id,
        order_id=order.id,
        project_id=project_id,
        quotation_id=order.quotation_id,
        assigned_employee_id=order.assigned_employee_id,
        created_by_user_id=tenant.user_id,
        status="draft",
        subject=order.subject,
        issue_date=today,
        due_date=today + timedelta(days=defaults.default_payment_terms_days if defaults else 30),
        currency=order.currency,
        tax_calculation_mode=order.tax_calculation_mode,
        seller_name_snapshot=order.seller_name_snapshot,
        seller_email_snapshot=order.seller_email_snapshot,
        seller_address_snapshot=order.seller_address_snapshot,
        seller_tax_identifier_snapshot=order.seller_tax_identifier_snapshot,
        client_name_snapshot=order.client_name_snapshot,
        client_contact_snapshot=order.client_contact_snapshot,
        client_email_snapshot=order.client_email_snapshot,
        client_address_snapshot=order.client_address_snapshot,
        client_tax_identifier_snapshot=order.client_tax_identifier_snapshot,
        subtotal=order.subtotal,
        discount_total=order.discount_total,
        tax_total=order.tax_total,
        total=order.total,
        amount_paid=Decimal("0"),
        balance_due=order.total,
        notes=order.notes,
        terms_conditions=order.terms_conditions,
        internal_notes=order.internal_notes,
    )
    db.add(invoice); db.flush()
    for item in items:
        db.add(InvoiceItem(
            organization_id=tenant.organization_id,
            invoice_id=invoice.id,
            source_order_item_id=item.id,
            sort_order=item.sort_order,
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
        ))
    db.flush()
    record_activity(
        db, action="finance.invoice.created_from_order", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="invoice", entity_id=invoice.id,
        after={"invoice_number": invoice.invoice_number, "order_id": order.id, "project_id": project_id, "currency": invoice.currency, "total": str(invoice.total)},
        metadata={"source_order_id": order.id, "source_project_id": project_id},
        message=f"Invoice {invoice.invoice_number} created from order {order.order_number}", request=request,
    )
    db.commit(); db.refresh(invoice)
    return _invoice_detail(db, invoice, tenant.organization.timezone)


@router.get("/summary", response_model=FinanceSummary)
def finance_summary(db: DbSession, tenant: FinanceViewer) -> FinanceSummary:
    invoices = db.scalars(select(Invoice).where(Invoice.organization_id == tenant.organization_id)).all()
    today = _tenant_today(tenant.organization.timezone)
    currency_totals: dict[str, dict[str, Decimal]] = {}
    for invoice in invoices:
        if invoice.status == "cancelled":
            continue
        totals = currency_totals.setdefault(invoice.currency, {"invoiced": Decimal("0"), "paid": Decimal("0"), "outstanding": Decimal("0")})
        totals["invoiced"] += invoice.total
        totals["paid"] += invoice.amount_paid
        totals["outstanding"] += invoice.balance_due
    return FinanceSummary(
        invoice_count=len(invoices),
        draft_count=sum(1 for item in invoices if item.status == "draft"),
        sent_count=sum(1 for item in invoices if item.status == "sent"),
        partially_paid_count=sum(1 for item in invoices if item.status == "partially_paid"),
        paid_count=sum(1 for item in invoices if item.status == "paid"),
        overdue_count=sum(1 for item in invoices if _invoice_display_status(item, today) == "overdue"),
        payment_count=db.scalar(select(func.count(Payment.id)).where(Payment.organization_id == tenant.organization_id, Payment.status == "confirmed")) or 0,
        account_count=db.scalar(select(func.count(FinancialAccount.id)).where(FinancialAccount.organization_id == tenant.organization_id, FinancialAccount.is_active.is_(True))) or 0,
        by_currency=[CurrencyInvoiceSummary(currency=code, invoiced=_money(values["invoiced"]), paid=_money(values["paid"]), outstanding=_money(values["outstanding"])) for code, values in sorted(currency_totals.items())],
    )


@router.get("/meta", response_model=FinanceMeta)
def finance_meta(db: DbSession, tenant: FinanceViewer) -> FinanceMeta:
    clients = db.scalars(select(Client).where(Client.organization_id == tenant.organization_id, Client.status == "active").order_by(Client.display_name.asc()).limit(300)).all()
    order_rows = db.execute(
        select(Order, Client.display_name).join(Client, Client.id == Order.client_id).where(Order.organization_id == tenant.organization_id, Order.status != "cancelled").order_by(Order.created_at.desc()).limit(200)
    ).all()
    projects = db.scalars(select(Project).where(Project.organization_id == tenant.organization_id, Project.status != "cancelled").order_by(Project.created_at.desc()).limit(200)).all()
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == tenant.organization_id).order_by(FinancialAccount.is_active.desc(), FinancialAccount.name.asc())).all()
    return FinanceMeta(
        clients=[FinanceMetaClient(id=item.id, code=item.client_code, name=item.display_name, currency=item.currency) for item in clients],
        orders=[FinanceMetaOrder(id=order.id, number=order.order_number, client_id=order.client_id, client_name=client_name, currency=order.currency, total=order.total, status=order.status) for order, client_name in order_rows],
        projects=[FinanceMetaProject(id=item.id, number=item.project_number, order_id=item.order_id, client_id=item.client_id, name=item.name, currency=item.currency, contract_value=item.contract_value, status=item.status) for item in projects],
        accounts=[_account_read(db, item) for item in accounts],
    )


@router.get("/accounts", response_model=list[FinancialAccountRead])
def list_accounts(db: DbSession, tenant: FinanceViewer):
    items = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == tenant.organization_id).order_by(FinancialAccount.is_active.desc(), FinancialAccount.name.asc())).all()
    return [_account_read(db, item) for item in items]


@router.post("/accounts", response_model=FinancialAccountRead, status_code=status.HTTP_201_CREATED)
def create_account(payload: FinancialAccountCreate, request: Request, db: DbSession, tenant: FinanceManager):
    account = FinancialAccount(
        organization_id=tenant.organization_id,
        name=payload.name.strip(),
        account_type=payload.account_type,
        provider_name=_clean(payload.provider_name),
        account_holder_name=_clean(payload.account_holder_name),
        account_reference=_clean(payload.account_reference),
        currency=payload.currency.upper(),
        opening_balance=_money(payload.opening_balance),
        notes=_clean(payload.notes),
        created_by_user_id=tenant.user_id,
    )
    db.add(account); db.flush()
    record_activity(db, action="finance.account.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="financial_account", entity_id=account.id,
        after={"name": account.name, "account_type": account.account_type, "currency": account.currency, "opening_balance": str(account.opening_balance)},
        message=f"Financial account created: {account.name}", request=request)
    db.commit(); db.refresh(account)
    return _account_read(db, account)


@router.patch("/accounts/{account_id}", response_model=FinancialAccountRead)
def update_account(account_id: str, payload: FinancialAccountUpdate, request: Request, db: DbSession, tenant: FinanceManager):
    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())
    if account is None:
        raise HTTPException(status_code=404, detail="Financial account not found")
    before = {"name": account.name, "account_type": account.account_type, "is_active": account.is_active}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str): value = _clean(value)
        if field == "name" and not value: raise HTTPException(status_code=400, detail="Account name cannot be empty")
        setattr(account, field, value)
    db.flush()
    record_activity(db, action="finance.account.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="financial_account", entity_id=account.id,
        before=before, after={"name": account.name, "account_type": account.account_type, "is_active": account.is_active},
        message=f"Financial account updated: {account.name}", request=request)
    db.commit(); db.refresh(account)
    return _account_read(db, account)


@router.get("/accounts/{account_id}/ledger", response_model=list[LedgerTransactionRead])
def account_ledger(account_id: str, db: DbSession, tenant: FinanceViewer, limit: Annotated[int, Query(ge=1, le=500)] = 100):
    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == account_id, FinancialAccount.organization_id == tenant.organization_id))
    if account is None: raise HTTPException(status_code=404, detail="Financial account not found")
    rows = db.scalars(select(FinancialTransaction).where(FinancialTransaction.organization_id == tenant.organization_id, FinancialTransaction.account_id == account.id).order_by(FinancialTransaction.transaction_date.desc(), FinancialTransaction.created_at.desc()).limit(limit)).all()
    return [LedgerTransactionRead.model_validate(item, from_attributes=True) for item in rows]


@router.get("/invoices", response_model=InvoicePage)
def list_invoices(db: DbSession, tenant: FinanceViewer, search: str | None = None, invoice_status: str | None = Query(default=None, alias="status"), client_id: str | None = None, limit: Annotated[int, Query(ge=1, le=200)] = 100):
    query = select(Invoice).where(Invoice.organization_id == tenant.organization_id)
    if invoice_status and invoice_status != "overdue": query = query.where(Invoice.status == invoice_status)
    if client_id: query = query.where(Invoice.client_id == client_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(Invoice.invoice_number.ilike(needle) | Invoice.subject.ilike(needle) | Invoice.client_name_snapshot.ilike(needle))
    items = db.scalars(query.order_by(Invoice.created_at.desc()).limit(limit)).all()
    if invoice_status == "overdue":
        today = _tenant_today(tenant.organization.timezone)
        items = [item for item in items if _invoice_display_status(item, today) == "overdue"]
    return InvoicePage(items=[_invoice_list_item(db, item, tenant.organization.timezone) for item in items])


@router.post("/invoices", response_model=InvoiceDetail, status_code=status.HTTP_201_CREATED)
def create_invoice(payload: InvoiceCreate, request: Request, db: DbSession, tenant: FinanceManager):
    return _create_manual_invoice(payload, request, db, tenant)


@router.post("/invoices/from-order/{order_id}", response_model=InvoiceDetail, status_code=status.HTTP_201_CREATED)
def create_invoice_from_order(order_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    order = db.scalar(select(Order).where(Order.id == order_id, Order.organization_id == tenant.organization_id))
    if order is None: raise HTTPException(status_code=404, detail="Order not found")
    return _create_invoice_from_order(order, None, request, db, tenant)


@router.post("/invoices/from-project/{project_id}", response_model=InvoiceDetail, status_code=status.HTTP_201_CREATED)
def create_invoice_from_project(project_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    project = db.scalar(select(Project).where(Project.id == project_id, Project.organization_id == tenant.organization_id))
    if project is None: raise HTTPException(status_code=404, detail="Project not found")
    if project.status == "cancelled": raise HTTPException(status_code=409, detail="Cancelled projects cannot be invoiced")
    order = db.scalar(select(Order).where(Order.id == project.order_id, Order.organization_id == tenant.organization_id))
    if order is None: raise HTTPException(status_code=409, detail="Project source order is not available")
    return _create_invoice_from_order(order, project.id, request, db, tenant)


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail)
def get_invoice(invoice_id: str, db: DbSession, tenant: FinanceViewer):
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == tenant.organization_id))
    if invoice is None: raise HTTPException(status_code=404, detail="Invoice not found")
    return _invoice_detail(db, invoice, tenant.organization.timezone)


@router.patch("/invoices/{invoice_id}/status", response_model=InvoiceDetail)
def change_invoice_status(invoice_id: str, payload: InvoiceStatusAction, request: Request, db: DbSession, tenant: FinanceManager):
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == tenant.organization_id).with_for_update())
    if invoice is None: raise HTTPException(status_code=404, detail="Invoice not found")
    previous = invoice.status
    now = datetime.now(timezone.utc)
    if payload.action == "send":
        if invoice.status != "draft": raise HTTPException(status_code=409, detail="Only draft invoices can be sent")
        invoice.status = "sent"; invoice.sent_at = now
    elif payload.action == "cancel":
        if invoice.status in {"paid", "cancelled"} or invoice.amount_paid > 0:
            raise HTTPException(status_code=409, detail="Invoices with payments cannot be cancelled; use a payment reversal workflow")
        invoice.status = "cancelled"; invoice.cancelled_at = now
    db.flush()
    record_activity(db, action="finance.invoice.status_changed", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="invoice", entity_id=invoice.id,
        before={"status": previous}, after={"status": invoice.status},
        message=f"Invoice {invoice.invoice_number} changed from {previous} to {invoice.status}", request=request)
    db.commit(); db.refresh(invoice)
    return _invoice_detail(db, invoice, tenant.organization.timezone)


def _payment_read(db: DbSession, payment: Payment) -> PaymentRead:
    invoice = db.get(Invoice, payment.invoice_id)
    account = db.get(FinancialAccount, payment.account_id)
    client = db.get(Client, invoice.client_id) if invoice else None
    return PaymentRead(
        id=payment.id, payment_number=payment.payment_number, invoice_id=payment.invoice_id,
        invoice_number=invoice.invoice_number if invoice else "—", client_name=client.display_name if client else "—",
        account_id=payment.account_id, account_name=account.name if account else "—", payment_date=payment.payment_date,
        invoice_currency=payment.invoice_currency, account_currency=payment.account_currency,
        invoice_amount=payment.invoice_amount, account_amount=payment.account_amount, exchange_rate=payment.exchange_rate,
        method=payment.method, reference=payment.reference, notes=payment.notes, status=payment.status, created_at=payment.created_at,
    )


@router.get("/payments", response_model=list[PaymentRead])
def list_payments(db: DbSession, tenant: FinanceViewer, invoice_id: str | None = None, limit: Annotated[int, Query(ge=1, le=500)] = 100):
    query = select(Payment).where(Payment.organization_id == tenant.organization_id)
    if invoice_id: query = query.where(Payment.invoice_id == invoice_id)
    items = db.scalars(query.order_by(Payment.payment_date.desc(), Payment.created_at.desc()).limit(limit)).all()
    return [_payment_read(db, item) for item in items]


@router.post("/payments", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
def record_payment(payload: PaymentCreate, request: Request, db: DbSession, tenant: FinanceManager):
    invoice = db.scalar(select(Invoice).where(Invoice.id == payload.invoice_id, Invoice.organization_id == tenant.organization_id).with_for_update())
    if invoice is None: raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "draft": raise HTTPException(status_code=409, detail="Send the invoice before recording payment")
    if invoice.status in {"paid", "cancelled"}: raise HTTPException(status_code=409, detail=f"Cannot record payment against a {invoice.status} invoice")
    if payload.invoice_amount > invoice.balance_due:
        raise HTTPException(status_code=409, detail=f"Payment exceeds invoice balance {invoice.balance_due} {invoice.currency}")
    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())
    if account is None or not account.is_active: raise HTTPException(status_code=404, detail="Active financial account not found")
    if account.currency == invoice.currency:
        exchange_rate = Decimal("1")
    else:
        if payload.exchange_rate is None: raise HTTPException(status_code=400, detail=f"Exchange rate is required for {invoice.currency} to {account.currency}")
        exchange_rate = Decimal(payload.exchange_rate).quantize(RATE, rounding=ROUND_HALF_UP)
    account_amount = _money(payload.invoice_amount * exchange_rate)
    payment_date = payload.payment_date or _tenant_today(tenant.organization.timezone)
    payment = Payment(
        organization_id=tenant.organization_id,
        payment_number=next_sequence_code(db, tenant.organization_id, "payment"),
        invoice_id=invoice.id,
        account_id=account.id,
        payment_date=payment_date,
        invoice_currency=invoice.currency,
        account_currency=account.currency,
        invoice_amount=_money(payload.invoice_amount),
        account_amount=account_amount,
        exchange_rate=exchange_rate,
        method=payload.method,
        reference=_clean(payload.reference),
        notes=_clean(payload.notes),
        status="confirmed",
        created_by_user_id=tenant.user_id,
    )
    db.add(payment); db.flush()
    db.add(FinancialTransaction(
        organization_id=tenant.organization_id,
        account_id=account.id,
        transaction_date=payment_date,
        direction="credit",
        amount=account_amount,
        currency=account.currency,
        source_type="payment",
        source_id=payment.id,
        reference=payment.reference or payment.payment_number,
        description=f"Payment {payment.payment_number} for invoice {invoice.invoice_number}",
        created_by_user_id=tenant.user_id,
    ))
    invoice.amount_paid = _money(invoice.amount_paid + payment.invoice_amount)
    invoice.balance_due = _money(invoice.total - invoice.amount_paid)
    if invoice.balance_due <= 0:
        invoice.balance_due = Decimal("0.00"); invoice.status = "paid"; invoice.paid_at = datetime.now(timezone.utc)
    elif invoice.amount_paid > 0:
        invoice.status = "partially_paid"; invoice.paid_at = None
    db.flush()
    record_activity(db, action="finance.payment.recorded", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="payment", entity_id=payment.id,
        after={"payment_number": payment.payment_number, "invoice_id": invoice.id, "invoice_amount": str(payment.invoice_amount), "invoice_currency": invoice.currency, "account_id": account.id, "account_amount": str(account_amount), "account_currency": account.currency, "exchange_rate": str(exchange_rate), "invoice_status": invoice.status, "balance_due": str(invoice.balance_due)},
        metadata={"ledger_direction": "credit"}, message=f"Payment {payment.payment_number} recorded for invoice {invoice.invoice_number}", request=request)
    db.commit(); db.refresh(payment)
    return _payment_read(db, payment)
