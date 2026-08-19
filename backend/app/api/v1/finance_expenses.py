from __future__ import annotations

import base64
import json
import mimetypes
import re
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from sqlalchemy import and_, case, func, or_, select
from starlette.responses import FileResponse, Response

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.expenses import Expense, ExpenseCategory, ExpenseDocument, Vendor
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.models.orders import Order
from app.models.projects import Project
from app.schemas.expenses import (
    ClientProfitabilityRow,
    ExpenseCategoryCreate,
    ExpenseCategoryRead,
    ExpenseCategoryUpdate,
    ExpenseCreate,
    ExpenseCurrencySummary,
    ExpenseDetail,
    ExpenseDocumentRead,
    ExpenseListItem,
    ExpenseMeta,
    ExpenseMetaAccount,
    ExpenseMetaClient,
    ExpenseMetaInvoice,
    ExpenseMetaOrder,
    ExpenseMetaPayment,
    ExpenseMetaProject,
    ExpensePage,
    ExpenseSummary,
    ExpenseUpdate,
    ProfitabilityReport,
    ProfitLossCurrencyRow,
    ProjectProfitabilityRow,
    VendorCreate,
    VendorRead,
    VendorUpdate,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.services.document_storage import storage
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Expenses & Profitability"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")
PERCENT = Decimal("0.01")

PREVIEW_MEDIA_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "text/plain",
}


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _rate(value: Decimal) -> Decimal:
    return Decimal(value).quantize(RATE, rounding=ROUND_HALF_UP)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "category"


def _account_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (FinancialTransaction.direction == "credit", FinancialTransaction.amount),
                        else_=-FinancialTransaction.amount,
                    )
                ),
                0,
            )
        ).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _account_balance_map(db: DbSession, organization_id: str) -> dict[str, Decimal]:
    rows = db.execute(
        select(
            FinancialTransaction.account_id,
            func.coalesce(
                func.sum(
                    case(
                        (FinancialTransaction.direction == "credit", FinancialTransaction.amount),
                        else_=-FinancialTransaction.amount,
                    )
                ),
                0,
            ),
        )
        .where(FinancialTransaction.organization_id == organization_id)
        .group_by(FinancialTransaction.account_id)
    ).all()
    return {str(account_id): Decimal(net or 0) for account_id, net in rows}


def _encode_expense_cursor(expense_date: date, created_at: datetime, entity_id: str) -> str:
    raw = json.dumps(
        {"expense_date": expense_date.isoformat(), "created_at": created_at.isoformat(), "id": entity_id},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_expense_cursor(cursor: str | None) -> tuple[date, datetime, str] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        expense_date = date.fromisoformat(payload["expense_date"])
        created_at = datetime.fromisoformat(payload["created_at"])
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return expense_date, created_at, str(payload["id"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid expense pagination cursor") from exc


def _expense_cursor_clause(decoded: tuple[date, datetime, str] | None):
    if decoded is None:
        return None
    expense_date, created_at, entity_id = decoded
    return or_(
        Expense.expense_date < expense_date,
        and_(Expense.expense_date == expense_date, Expense.created_at < created_at),
        and_(Expense.expense_date == expense_date, Expense.created_at == created_at, Expense.id < entity_id),
    )


def _vendor_read(item: Vendor) -> VendorRead:
    return VendorRead.model_validate(item, from_attributes=True)


def _category_read(item: ExpenseCategory) -> ExpenseCategoryRead:
    return ExpenseCategoryRead.model_validate(item, from_attributes=True)


def _document_reads(db: DbSession, expense_id: str) -> list[ExpenseDocumentRead]:
    rows = db.scalars(
        select(ExpenseDocument)
        .where(ExpenseDocument.expense_id == expense_id)
        .order_by(ExpenseDocument.created_at.desc())
    ).all()
    return [ExpenseDocumentRead.model_validate(item, from_attributes=True) for item in rows]


def _expense_row_query(organization_id: str):
    document_counts = (
        select(ExpenseDocument.expense_id, func.count(ExpenseDocument.id).label("document_count"))
        .where(ExpenseDocument.organization_id == organization_id)
        .group_by(ExpenseDocument.expense_id)
        .subquery()
    )
    return (
        select(
            Expense,
            Vendor.name.label("vendor_name"),
            ExpenseCategory.name.label("category_name"),
            ExpenseCategory.cost_type.label("cost_type"),
            FinancialAccount.name.label("account_name"),
            Client.display_name.label("client_name"),
            Project.project_number.label("project_number"),
            Project.name.label("project_name"),
            Order.order_number.label("order_number"),
            Invoice.invoice_number.label("invoice_number"),
            Payment.payment_number.label("payment_number"),
            func.coalesce(document_counts.c.document_count, 0).label("document_count"),
        )
        .join(ExpenseCategory, and_(ExpenseCategory.id == Expense.category_id, ExpenseCategory.organization_id == organization_id))
        .join(FinancialAccount, and_(FinancialAccount.id == Expense.account_id, FinancialAccount.organization_id == organization_id))
        .outerjoin(Vendor, and_(Vendor.id == Expense.vendor_id, Vendor.organization_id == organization_id))
        .outerjoin(Client, and_(Client.id == Expense.client_id, Client.organization_id == organization_id))
        .outerjoin(Project, and_(Project.id == Expense.project_id, Project.organization_id == organization_id))
        .outerjoin(Order, and_(Order.id == Expense.order_id, Order.organization_id == organization_id))
        .outerjoin(Invoice, and_(Invoice.id == Expense.invoice_id, Invoice.organization_id == organization_id))
        .outerjoin(Payment, and_(Payment.id == Expense.payment_id, Payment.organization_id == organization_id))
        .outerjoin(document_counts, document_counts.c.expense_id == Expense.id)
        .where(Expense.organization_id == organization_id)
    )


def _expense_list_item(row) -> ExpenseListItem:
    item: Expense = row[0]
    return ExpenseListItem(
        id=item.id,
        expense_number=item.expense_number,
        description=item.description,
        expense_date=item.expense_date,
        vendor_id=item.vendor_id,
        vendor_name=row.vendor_name,
        category_id=item.category_id,
        category_name=row.category_name,
        cost_type=row.cost_type,
        account_id=item.account_id,
        account_name=row.account_name,
        client_id=item.client_id,
        client_name=row.client_name,
        project_id=item.project_id,
        project_number=row.project_number,
        project_name=row.project_name,
        order_id=item.order_id,
        order_number=row.order_number,
        invoice_id=item.invoice_id,
        invoice_number=row.invoice_number,
        payment_id=item.payment_id,
        payment_number=row.payment_number,
        expense_currency=item.expense_currency,
        expense_amount=item.expense_amount,
        account_currency=item.account_currency,
        account_amount=item.account_amount,
        exchange_rate=item.exchange_rate,
        profitability_currency=item.profitability_currency,
        profitability_amount=item.profitability_amount,
        tax_amount=item.tax_amount,
        payment_method=item.payment_method,
        reference=item.reference,
        status=item.status,
        document_count=int(row.document_count or 0),
        created_at=item.created_at,
    )


def _expense_detail(db: DbSession, organization_id: str, expense_id: str) -> ExpenseDetail:
    row = db.execute(_expense_row_query(organization_id).where(Expense.id == expense_id)).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    item: Expense = row[0]
    base = _expense_list_item(row)
    return ExpenseDetail(
        **base.model_dump(),
        profitability_exchange_rate=item.profitability_exchange_rate,
        notes=item.notes,
        voided_at=item.voided_at,
        documents=_document_reads(db, item.id),
    )


def _resolve_expense_relationships(payload: ExpenseCreate, db: DbSession, organization_id: str):
    client_id = payload.client_id
    project_id = payload.project_id
    order_id = payload.order_id
    invoice_id = payload.invoice_id
    payment_id = payload.payment_id

    payment = None
    invoice = None
    project = None
    order = None
    client = None

    if payment_id:
        payment = db.scalar(
            select(Payment).where(
                Payment.id == payment_id,
                Payment.organization_id == organization_id,
                Payment.status == "confirmed",
            )
        )
        if payment is None:
            raise HTTPException(status_code=404, detail="Confirmed payment not found in this organization")
        if invoice_id and invoice_id != payment.invoice_id:
            raise HTTPException(status_code=400, detail="Selected payment does not belong to the selected invoice")
        invoice_id = payment.invoice_id

    if invoice_id:
        invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == organization_id))
        if invoice is None:
            raise HTTPException(status_code=404, detail="Invoice not found in this organization")
        if client_id and client_id != invoice.client_id:
            raise HTTPException(status_code=400, detail="Selected client does not match the invoice client")
        client_id = invoice.client_id
        if invoice.order_id:
            if order_id and order_id != invoice.order_id:
                raise HTTPException(status_code=400, detail="Selected order does not match the invoice order")
            order_id = invoice.order_id
        if invoice.project_id:
            if project_id and project_id != invoice.project_id:
                raise HTTPException(status_code=400, detail="Selected project does not match the invoice project")
            project_id = invoice.project_id

    if project_id:
        project = db.scalar(select(Project).where(Project.id == project_id, Project.organization_id == organization_id))
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found in this organization")
        if client_id and client_id != project.client_id:
            raise HTTPException(status_code=400, detail="Selected client does not match the project client")
        if order_id and order_id != project.order_id:
            raise HTTPException(status_code=400, detail="Selected order does not match the project order")
        client_id = project.client_id
        order_id = project.order_id

    if order_id:
        order = db.scalar(select(Order).where(Order.id == order_id, Order.organization_id == organization_id))
        if order is None:
            raise HTTPException(status_code=404, detail="Order not found in this organization")
        if client_id and client_id != order.client_id:
            raise HTTPException(status_code=400, detail="Selected client does not match the order client")
        client_id = order.client_id

    if client_id:
        client = db.scalar(select(Client).where(Client.id == client_id, Client.organization_id == organization_id))
        if client is None:
            raise HTTPException(status_code=404, detail="Client not found in this organization")

    return client, project, order, invoice, payment


@router.get("/expense-summary", response_model=ExpenseSummary)
def expense_summary(db: DbSession, tenant: FinanceViewer) -> ExpenseSummary:
    counts = db.execute(
        select(
            func.count(Expense.id),
            func.count(Expense.id).filter(Expense.status == "posted"),
            func.count(Expense.id).filter(Expense.status == "voided"),
            func.count(Expense.id).filter(Expense.status == "posted", Expense.project_id.is_not(None)),
        ).where(Expense.organization_id == tenant.organization_id)
    ).one()
    vendors = db.scalar(
        select(func.count(Vendor.id)).where(
            Vendor.organization_id == tenant.organization_id,
            Vendor.is_active.is_(True),
        )
    ) or 0
    receipts = db.scalar(
        select(func.count(ExpenseDocument.id)).where(ExpenseDocument.organization_id == tenant.organization_id)
    ) or 0
    expense_rows = db.execute(
        select(Expense.expense_currency, func.coalesce(func.sum(Expense.expense_amount), 0))
        .where(Expense.organization_id == tenant.organization_id, Expense.status == "posted")
        .group_by(Expense.expense_currency)
    ).all()
    currency_rows: dict[str, dict[str, Decimal]] = {
        currency: {"expenses": Decimal(amount or 0), "fees": Decimal("0")}
        for currency, amount in expense_rows
    }
    fee_rows = db.execute(
        select(FinancialTransaction.currency, func.coalesce(func.sum(FinancialTransaction.amount), 0))
        .where(
            FinancialTransaction.organization_id == tenant.organization_id,
            FinancialTransaction.source_type == "transfer_fee",
            FinancialTransaction.direction == "debit",
        )
        .group_by(FinancialTransaction.currency)
    ).all()
    for currency, amount in fee_rows:
        row = currency_rows.setdefault(currency, {"expenses": Decimal("0"), "fees": Decimal("0")})
        row["fees"] += Decimal(amount or 0)
    return ExpenseSummary(
        expense_count=int(counts[0] or 0),
        posted_count=int(counts[1] or 0),
        voided_count=int(counts[2] or 0),
        vendor_count=int(vendors),
        receipt_count=int(receipts),
        project_expense_count=int(counts[3] or 0),
        by_currency=[
            ExpenseCurrencySummary(
                currency=currency,
                posted_expenses=_money(values["expenses"]),
                transfer_fees=_money(values["fees"]),
            )
            for currency, values in sorted(currency_rows.items())
        ],
    )


@router.get("/expense-meta", response_model=ExpenseMeta)
def expense_meta(db: DbSession, tenant: FinanceViewer) -> ExpenseMeta:
    vendors = db.scalars(
        select(Vendor)
        .where(Vendor.organization_id == tenant.organization_id)
        .order_by(Vendor.is_active.desc(), Vendor.name.asc())
    ).all()
    categories = db.scalars(
        select(ExpenseCategory)
        .where(ExpenseCategory.organization_id == tenant.organization_id)
        .order_by(ExpenseCategory.is_active.desc(), ExpenseCategory.sort_order.asc(), ExpenseCategory.name.asc())
    ).all()
    accounts = db.scalars(
        select(FinancialAccount)
        .where(FinancialAccount.organization_id == tenant.organization_id)
        .order_by(FinancialAccount.is_active.desc(), FinancialAccount.name.asc())
    ).all()
    balance_map = _account_balance_map(db, tenant.organization_id)
    clients = db.scalars(
        select(Client)
        .where(Client.organization_id == tenant.organization_id, Client.status == "active")
        .order_by(Client.display_name.asc())
        .limit(500)
    ).all()
    project_rows = db.execute(
        select(Project, Client.display_name)
        .join(Client, and_(Client.id == Project.client_id, Client.organization_id == tenant.organization_id))
        .where(Project.organization_id == tenant.organization_id)
        .order_by(Project.created_at.desc())
        .limit(500)
    ).all()
    orders = db.scalars(
        select(Order)
        .where(Order.organization_id == tenant.organization_id)
        .order_by(Order.created_at.desc())
        .limit(500)
    ).all()
    invoices = db.scalars(
        select(Invoice)
        .where(Invoice.organization_id == tenant.organization_id)
        .order_by(Invoice.created_at.desc())
        .limit(500)
    ).all()
    payment_rows = db.execute(
        select(Payment, Invoice.invoice_number, Invoice.client_id, Invoice.client_name_snapshot)
        .join(Invoice, and_(Invoice.id == Payment.invoice_id, Invoice.organization_id == tenant.organization_id))
        .where(Payment.organization_id == tenant.organization_id)
        .order_by(Payment.payment_date.desc(), Payment.created_at.desc())
        .limit(500)
    ).all()
    return ExpenseMeta(
        vendors=[_vendor_read(item) for item in vendors],
        categories=[_category_read(item) for item in categories],
        accounts=[
            ExpenseMetaAccount(
                id=item.id,
                name=item.name,
                currency=item.currency,
                current_balance=_money(Decimal(item.opening_balance) + balance_map.get(item.id, Decimal("0"))),
                is_active=item.is_active,
            )
            for item in accounts
        ],
        clients=[ExpenseMetaClient(id=item.id, code=item.client_code, name=item.display_name, currency=item.currency) for item in clients],
        projects=[
            ExpenseMetaProject(
                id=project.id,
                number=project.project_number,
                name=project.name,
                order_id=project.order_id,
                client_id=project.client_id,
                client_name=client_name,
                currency=project.currency,
                status=project.status,
            )
            for project, client_name in project_rows
        ],
        orders=[
            ExpenseMetaOrder(
                id=item.id,
                number=item.order_number,
                client_id=item.client_id,
                client_name=item.client_name_snapshot,
                currency=item.currency,
                total=item.total,
                status=item.status,
            )
            for item in orders
        ],
        invoices=[
            ExpenseMetaInvoice(
                id=item.id,
                number=item.invoice_number,
                client_id=item.client_id,
                client_name=item.client_name_snapshot,
                order_id=item.order_id,
                project_id=item.project_id,
                currency=item.currency,
                total=item.total,
                status=item.status,
            )
            for item in invoices
        ],
        payments=[
            ExpenseMetaPayment(
                id=payment.id,
                number=payment.payment_number,
                invoice_id=payment.invoice_id,
                invoice_number=invoice_number,
                client_id=client_id,
                client_name=client_name,
                invoice_currency=payment.invoice_currency,
                invoice_amount=payment.invoice_amount,
                payment_date=payment.payment_date,
                status=payment.status,
            )
            for payment, invoice_number, client_id, client_name in payment_rows
        ],
    )


@router.get("/vendors", response_model=list[VendorRead])
def list_vendors(db: DbSession, tenant: FinanceViewer):
    items = db.scalars(select(Vendor).where(Vendor.organization_id == tenant.organization_id).order_by(Vendor.is_active.desc(), Vendor.name.asc())).all()
    return [_vendor_read(item) for item in items]


@router.post("/vendors", response_model=VendorRead, status_code=status.HTTP_201_CREATED)
def create_vendor(payload: VendorCreate, request: Request, db: DbSession, tenant: FinanceManager):
    item = Vendor(
        organization_id=tenant.organization_id,
        vendor_code=next_sequence_code(db, tenant.organization_id, "vendor"),
        name=payload.name.strip(),
        contact_name=_clean(payload.contact_name),
        email=str(payload.email) if payload.email else None,
        phone=_clean(payload.phone),
        website=_clean(payload.website),
        tax_identifier=_clean(payload.tax_identifier),
        country_code=payload.country_code.upper() if payload.country_code else None,
        currency=payload.currency.upper() if payload.currency else None,
        notes=_clean(payload.notes),
        created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    record_activity(db, action="finance.vendor.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="vendor", entity_id=item.id,
        after={"vendor_code": item.vendor_code, "name": item.name, "currency": item.currency},
        message=f"Vendor {item.vendor_code} created: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return _vendor_read(item)


@router.patch("/vendors/{vendor_id}", response_model=VendorRead)
def update_vendor(vendor_id: str, payload: VendorUpdate, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(Vendor).where(Vendor.id == vendor_id, Vendor.organization_id == tenant.organization_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    before = {"name": item.name, "is_active": item.is_active, "currency": item.currency}
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field == "email" and value is not None:
            value = str(value)
        if isinstance(value, str):
            value = _clean(value)
        if field == "name" and not value:
            raise HTTPException(status_code=400, detail="Vendor name cannot be empty")
        if field == "country_code" and value:
            value = value.upper()
        if field == "currency" and value:
            value = value.upper()
        setattr(item, field, value)
    db.flush()
    record_activity(db, action="finance.vendor.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="vendor", entity_id=item.id,
        before=before, after={"name": item.name, "is_active": item.is_active, "currency": item.currency},
        message=f"Vendor {item.vendor_code} updated", request=request)
    db.commit(); db.refresh(item)
    return _vendor_read(item)


@router.get("/expense-categories", response_model=list[ExpenseCategoryRead])
def list_expense_categories(db: DbSession, tenant: FinanceViewer):
    items = db.scalars(select(ExpenseCategory).where(ExpenseCategory.organization_id == tenant.organization_id).order_by(ExpenseCategory.is_active.desc(), ExpenseCategory.sort_order.asc(), ExpenseCategory.name.asc())).all()
    return [_category_read(item) for item in items]


@router.post("/expense-categories", response_model=ExpenseCategoryRead, status_code=status.HTTP_201_CREATED)
def create_expense_category(payload: ExpenseCategoryCreate, request: Request, db: DbSession, tenant: FinanceManager):
    base_slug = _slugify(payload.name)
    slug = base_slug
    counter = 2
    while db.scalar(select(ExpenseCategory.id).where(ExpenseCategory.organization_id == tenant.organization_id, ExpenseCategory.slug == slug)) is not None:
        slug = f"{base_slug}-{counter}"
        counter += 1
    item = ExpenseCategory(organization_id=tenant.organization_id, name=payload.name.strip(), slug=slug, cost_type=payload.cost_type, sort_order=payload.sort_order)
    db.add(item); db.flush()
    record_activity(db, action="finance.expense_category.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="expense_category", entity_id=item.id,
        after={"name": item.name, "slug": item.slug, "cost_type": item.cost_type},
        message=f"Expense category created: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return _category_read(item)


@router.patch("/expense-categories/{category_id}", response_model=ExpenseCategoryRead)
def update_expense_category(category_id: str, payload: ExpenseCategoryUpdate, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(ExpenseCategory).where(ExpenseCategory.id == category_id, ExpenseCategory.organization_id == tenant.organization_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Expense category not found")
    before = {"name": item.name, "cost_type": item.cost_type, "is_active": item.is_active}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name":
            value = value.strip()
            if not value:
                raise HTTPException(status_code=400, detail="Category name cannot be empty")
        setattr(item, field, value)
    db.flush()
    record_activity(db, action="finance.expense_category.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="expense_category", entity_id=item.id,
        before=before, after={"name": item.name, "cost_type": item.cost_type, "is_active": item.is_active},
        message=f"Expense category updated: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return _category_read(item)


@router.get("/expenses", response_model=ExpensePage)
def list_expenses(
    db: DbSession,
    tenant: FinanceViewer,
    search: str | None = None,
    expense_status: str | None = Query(default=None, alias="status"),
    category_id: str | None = None,
    vendor_id: str | None = None,
    project_id: str | None = None,
    client_id: str | None = None,
    order_id: str | None = None,
    invoice_id: str | None = None,
    payment_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: str | None = None,
):
    query = _expense_row_query(tenant.organization_id)
    if expense_status:
        query = query.where(Expense.status == expense_status)
    if category_id:
        query = query.where(Expense.category_id == category_id)
    if vendor_id:
        query = query.where(Expense.vendor_id == vendor_id)
    if project_id:
        query = query.where(Expense.project_id == project_id)
    if client_id:
        query = query.where(Expense.client_id == client_id)
    if order_id:
        query = query.where(Expense.order_id == order_id)
    if invoice_id:
        query = query.where(Expense.invoice_id == invoice_id)
    if payment_id:
        query = query.where(Expense.payment_id == payment_id)
    if search:
        needle = f"%{search.strip()}%"
        query = query.where(
            or_(
                Expense.expense_number.ilike(needle),
                Expense.description.ilike(needle),
                Expense.reference.ilike(needle),
                Order.order_number.ilike(needle),
                Invoice.invoice_number.ilike(needle),
                Payment.payment_number.ilike(needle),
            )
        )
    clause = _expense_cursor_clause(_decode_expense_cursor(cursor))
    if clause is not None:
        query = query.where(clause)
    rows = db.execute(
        query.order_by(Expense.expense_date.desc(), Expense.created_at.desc(), Expense.id.desc()).limit(limit + 1)
    ).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    last = rows[-1][0] if rows else None
    return ExpensePage(
        items=[_expense_list_item(row) for row in rows],
        next_cursor=(
            _encode_expense_cursor(last.expense_date, last.created_at, last.id)
            if has_more and last is not None
            else None
        ),
    )


@router.get("/expenses/{expense_id}", response_model=ExpenseDetail)
def get_expense(expense_id: str, db: DbSession, tenant: FinanceViewer):
    return _expense_detail(db, tenant.organization_id, expense_id)


@router.post("/expenses", response_model=ExpenseDetail, status_code=status.HTTP_201_CREATED)
def create_expense(payload: ExpenseCreate, request: Request, db: DbSession, tenant: FinanceManager):
    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())
    if account is None or not account.is_active:
        raise HTTPException(status_code=404, detail="Active financial account not found")
    category = db.scalar(select(ExpenseCategory).where(ExpenseCategory.id == payload.category_id, ExpenseCategory.organization_id == tenant.organization_id, ExpenseCategory.is_active.is_(True)))
    if category is None:
        raise HTTPException(status_code=404, detail="Active expense category not found")
    vendor = None
    if payload.vendor_id:
        vendor = db.scalar(select(Vendor).where(Vendor.id == payload.vendor_id, Vendor.organization_id == tenant.organization_id, Vendor.is_active.is_(True)))
        if vendor is None:
            raise HTTPException(status_code=404, detail="Active vendor not found")

    client, project, order, invoice, payment = _resolve_expense_relationships(payload, db, tenant.organization_id)

    expense_currency = payload.expense_currency.upper()
    expense_amount = _money(payload.expense_amount)
    tax_amount = _money(payload.tax_amount)
    if tax_amount > expense_amount:
        raise HTTPException(status_code=400, detail="Tax amount cannot exceed the expense amount")

    if account.currency == expense_currency:
        account_amount = expense_amount
        exchange_rate = Decimal("1.00000000")
    elif payload.account_amount is not None:
        account_amount = _money(payload.account_amount)
        exchange_rate = _rate(account_amount / expense_amount)
    elif payload.exchange_rate is not None:
        exchange_rate = _rate(payload.exchange_rate)
        account_amount = _money(expense_amount * exchange_rate)
    else:
        raise HTTPException(status_code=400, detail=f"Actual account amount or exchange rate is required for {expense_currency} to {account.currency}")

    profitability_currency = (
        project.currency if project else
        order.currency if order else
        invoice.currency if invoice else
        client.currency if client and client.currency else
        expense_currency
    )
    profitability_currency = profitability_currency.upper()
    if profitability_currency == expense_currency:
        profitability_amount = expense_amount
        profitability_exchange_rate = Decimal("1.00000000")
    elif payload.profitability_amount is not None:
        profitability_amount = _money(payload.profitability_amount)
        profitability_exchange_rate = _rate(profitability_amount / expense_amount)
    elif payload.profitability_exchange_rate is not None:
        profitability_exchange_rate = _rate(payload.profitability_exchange_rate)
        profitability_amount = _money(expense_amount * profitability_exchange_rate)
    else:
        raise HTTPException(status_code=400, detail=f"Profitability conversion is required to report this cost in {profitability_currency}")

    current_balance = _account_balance(db, account)
    if account_amount > current_balance:
        raise HTTPException(status_code=409, detail=f"Insufficient balance in {account.name}. Available {current_balance} {account.currency}")

    expense_date = payload.expense_date or _tenant_today(tenant.organization.timezone)
    item = Expense(
        organization_id=tenant.organization_id,
        expense_number=next_sequence_code(db, tenant.organization_id, "expense"),
        vendor_id=vendor.id if vendor else None,
        category_id=category.id,
        account_id=account.id,
        client_id=client.id if client else None,
        project_id=project.id if project else None,
        order_id=order.id if order else None,
        invoice_id=invoice.id if invoice else None,
        payment_id=payment.id if payment else None,
        description=payload.description.strip(),
        expense_date=expense_date,
        expense_currency=expense_currency,
        expense_amount=expense_amount,
        account_currency=account.currency,
        account_amount=account_amount,
        exchange_rate=exchange_rate,
        profitability_currency=profitability_currency,
        profitability_amount=profitability_amount,
        profitability_exchange_rate=profitability_exchange_rate,
        tax_amount=tax_amount,
        payment_method=payload.payment_method,
        reference=_clean(payload.reference),
        notes=_clean(payload.notes),
        status="posted",
        created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    db.add(FinancialTransaction(
        organization_id=tenant.organization_id,
        account_id=account.id,
        transaction_date=expense_date,
        direction="debit",
        amount=account_amount,
        currency=account.currency,
        source_type="expense",
        source_id=item.id,
        reference=item.reference or item.expense_number,
        description=f"Expense {item.expense_number}: {item.description}",
        created_by_user_id=tenant.user_id,
    ))
    db.flush()
    record_activity(db, action="finance.expense.posted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="expense", entity_id=item.id,
        after={
            "expense_number": item.expense_number, "category_id": item.category_id, "vendor_id": item.vendor_id,
            "account_id": item.account_id, "project_id": item.project_id, "client_id": item.client_id,
            "order_id": item.order_id, "invoice_id": item.invoice_id, "payment_id": item.payment_id,
            "expense_amount": str(item.expense_amount), "expense_currency": item.expense_currency,
            "account_amount": str(item.account_amount), "account_currency": item.account_currency,
            "profitability_amount": str(item.profitability_amount), "profitability_currency": item.profitability_currency,
        },
        metadata={"ledger_direction": "debit", "cost_type": category.cost_type},
        message=f"Expense {item.expense_number} posted: {item.description}", request=request)
    db.commit()
    return _expense_detail(db, tenant.organization_id, item.id)


@router.patch("/expenses/{expense_id}", response_model=ExpenseDetail)
def update_expense(expense_id: str, payload: ExpenseUpdate, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(Expense).where(Expense.id == expense_id, Expense.organization_id == tenant.organization_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    if item.status != "posted":
        raise HTTPException(status_code=409, detail="Voided expenses are locked")
    before = {"description": item.description, "vendor_id": item.vendor_id, "category_id": item.category_id, "reference": item.reference}
    changes = payload.model_dump(exclude_unset=True)
    if "vendor_id" in changes and changes["vendor_id"]:
        vendor = db.scalar(select(Vendor).where(Vendor.id == changes["vendor_id"], Vendor.organization_id == tenant.organization_id, Vendor.is_active.is_(True)))
        if vendor is None:
            raise HTTPException(status_code=404, detail="Active vendor not found")
    if "category_id" in changes and changes["category_id"]:
        category = db.scalar(select(ExpenseCategory).where(ExpenseCategory.id == changes["category_id"], ExpenseCategory.organization_id == tenant.organization_id, ExpenseCategory.is_active.is_(True)))
        if category is None:
            raise HTTPException(status_code=404, detail="Active expense category not found")
    for field, value in changes.items():
        if isinstance(value, str):
            value = _clean(value)
        if field == "description" and not value:
            raise HTTPException(status_code=400, detail="Expense description cannot be empty")
        setattr(item, field, value)
    db.flush()
    record_activity(db, action="finance.expense.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="expense", entity_id=item.id,
        before=before, after={"description": item.description, "vendor_id": item.vendor_id, "category_id": item.category_id, "reference": item.reference},
        message=f"Expense {item.expense_number} metadata updated", request=request)
    db.commit()
    return _expense_detail(db, tenant.organization_id, item.id)


@router.post("/expenses/{expense_id}/void", response_model=ExpenseDetail)
def void_expense(expense_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(Expense).where(Expense.id == expense_id, Expense.organization_id == tenant.organization_id).with_for_update())
    if item is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    if item.status != "posted":
        raise HTTPException(status_code=409, detail="Only posted expenses can be voided")
    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == item.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())
    if account is None:
        raise HTTPException(status_code=409, detail="Expense account is no longer available")
    item.status = "voided"
    item.voided_at = datetime.now(timezone.utc)
    db.add(FinancialTransaction(
        organization_id=tenant.organization_id,
        account_id=account.id,
        transaction_date=_tenant_today(tenant.organization.timezone),
        direction="credit",
        amount=item.account_amount,
        currency=item.account_currency,
        source_type="expense_void",
        source_id=item.id,
        reference=item.reference or item.expense_number,
        description=f"Void reversal for expense {item.expense_number}",
        created_by_user_id=tenant.user_id,
    ))
    db.flush()
    record_activity(db, action="finance.expense.voided", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="expense", entity_id=item.id,
        before={"status": "posted"}, after={"status": "voided", "reversed_account_amount": str(item.account_amount), "account_currency": item.account_currency},
        metadata={"ledger_direction": "credit"}, message=f"Expense {item.expense_number} voided and ledger reversed", request=request)
    db.commit()
    return _expense_detail(db, tenant.organization_id, item.id)


@router.post("/expenses/{expense_id}/documents/upload", response_model=ExpenseDocumentRead, status_code=201)
def upload_expense_document(
    expense_id: str,
    request: Request,
    db: DbSession,
    tenant: FinanceManager,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(min_length=1, max_length=180)],
    document_type: Annotated[str | None, Form(min_length=1, max_length=64)] = "receipt",
    notes: Annotated[str | None, Form()] = None,
):
    expense = db.scalar(select(Expense).where(Expense.id == expense_id, Expense.organization_id == tenant.organization_id))
    if expense is None:
        raise HTTPException(status_code=404, detail="Expense not found")
    try:
        storage_key, size_bytes = storage.save(
            organization_id=tenant.organization_id,
            source=file.file,
            original_filename=file.filename or "receipt",
            content_type=file.content_type,
            namespace=f"expenses/{expense.id}/documents",
        )
    except HTTPException as exc:
        record_activity(db, action="finance.expense_document.upload_failed", scope="tenant", actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id, entity_type="expense_document", outcome="failure",
            message=str(exc.detail), metadata={"expense_id": expense.id, "original_filename": file.filename}, request=request)
        db.commit(); raise
    item = ExpenseDocument(
        organization_id=tenant.organization_id,
        expense_id=expense.id,
        title=title.strip(),
        document_type=(document_type or "receipt").strip().lower(),
        original_filename=file.filename or "receipt",
        content_type=file.content_type,
        size_bytes=size_bytes,
        storage_key=storage_key,
        notes=_clean(notes),
        uploaded_by_user_id=tenant.user_id,
    )
    db.add(item)
    try:
        db.flush()
        record_activity(db, action="finance.expense_document.uploaded", scope="tenant", actor_user_id=tenant.user_id,
            organization_id=tenant.organization_id, entity_type="expense_document", entity_id=item.id,
            after={"expense_id": expense.id, "title": item.title, "document_type": item.document_type, "size_bytes": item.size_bytes},
            message=f"Expense document uploaded for {expense.expense_number}: {item.title}", request=request)
        db.commit()
    except Exception:
        db.rollback(); storage.delete(storage_key); raise
    db.refresh(item)
    return ExpenseDocumentRead.model_validate(item, from_attributes=True)


def _expense_document_file(db: DbSession, organization_id: str, expense_id: str, document_id: str):
    item = db.scalar(select(ExpenseDocument).where(
        ExpenseDocument.id == document_id,
        ExpenseDocument.expense_id == expense_id,
        ExpenseDocument.organization_id == organization_id,
    ))
    if item is None:
        raise HTTPException(status_code=404, detail="Expense document not found")
    path = storage.resolve(item.storage_key)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", item.title).strip("-.") or "expense-document"
    suffix = Path(item.original_filename).suffix.lower()
    filename = f"{safe}{suffix}"
    media_type = item.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return item, path, filename, media_type


@router.get("/expenses/{expense_id}/documents/{document_id}/preview")
def preview_expense_document(expense_id: str, document_id: str, db: DbSession, tenant: FinanceViewer):
    _, path, filename, media_type = _expense_document_file(db, tenant.organization_id, expense_id, document_id)
    if media_type not in PREVIEW_MEDIA_TYPES:
        raise HTTPException(status_code=415, detail="Preview is not available for this file type. Please download the document.")
    return FileResponse(path, media_type=media_type, headers={
        "Content-Disposition": f'inline; filename="{filename}"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/expenses/{expense_id}/documents/{document_id}/file")
def download_expense_document(expense_id: str, document_id: str, db: DbSession, tenant: FinanceViewer):
    _, path, filename, media_type = _expense_document_file(db, tenant.organization_id, expense_id, document_id)
    return FileResponse(path, media_type=media_type, filename=filename)


@router.delete("/expenses/{expense_id}/documents/{document_id}", status_code=204)
def delete_expense_document(expense_id: str, document_id: str, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(ExpenseDocument).where(
        ExpenseDocument.id == document_id,
        ExpenseDocument.expense_id == expense_id,
        ExpenseDocument.organization_id == tenant.organization_id,
    ))
    if item is None:
        raise HTTPException(status_code=404, detail="Expense document not found")
    storage_key = item.storage_key
    before = {"expense_id": expense_id, "title": item.title, "document_type": item.document_type}
    db.delete(item)
    record_activity(db, action="finance.expense_document.deleted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="expense_document", entity_id=item.id,
        before=before, message=f"Expense document deleted: {item.title}", request=request)
    db.commit(); storage.delete(storage_key)
    return Response(status_code=204)


@router.get("/profitability", response_model=ProfitabilityReport)
def profitability_report(db: DbSession, tenant: FinanceViewer) -> ProfitabilityReport:
    invoices = db.scalars(select(Invoice).where(Invoice.organization_id == tenant.organization_id, Invoice.status != "cancelled")).all()
    expenses = db.scalars(select(Expense).where(Expense.organization_id == tenant.organization_id, Expense.status == "posted")).all()
    projects = db.scalars(select(Project).where(Project.organization_id == tenant.organization_id).order_by(Project.created_at.desc()).limit(500)).all()
    clients = db.scalars(select(Client).where(Client.organization_id == tenant.organization_id).order_by(Client.display_name.asc()).limit(1000)).all()
    client_names = {item.id: item.display_name for item in clients}

    company: dict[str, dict[str, Decimal]] = {}
    for invoice in invoices:
        row = company.setdefault(invoice.currency, {"revenue": Decimal("0"), "expenses": Decimal("0"), "fees": Decimal("0")})
        row["revenue"] += invoice.total
    for expense in expenses:
        row = company.setdefault(expense.expense_currency, {"revenue": Decimal("0"), "expenses": Decimal("0"), "fees": Decimal("0")})
        row["expenses"] += expense.expense_amount
    fee_rows = db.execute(
        select(FinancialTransaction.currency, func.coalesce(func.sum(FinancialTransaction.amount), 0))
        .where(
            FinancialTransaction.organization_id == tenant.organization_id,
            FinancialTransaction.source_type == "transfer_fee",
            FinancialTransaction.direction == "debit",
        )
        .group_by(FinancialTransaction.currency)
    ).all()
    for currency, amount in fee_rows:
        row = company.setdefault(currency, {"revenue": Decimal("0"), "expenses": Decimal("0"), "fees": Decimal("0")})
        row["fees"] += Decimal(amount)
    pnl = [
        ProfitLossCurrencyRow(
            currency=currency,
            invoice_revenue=_money(values["revenue"]),
            operating_expenses=_money(values["expenses"]),
            transfer_fees=_money(values["fees"]),
            net_profit=_money(values["revenue"] - values["expenses"] - values["fees"]),
        )
        for currency, values in sorted(company.items())
    ]

    project_rows: list[ProjectProfitabilityRow] = []
    for project in projects:
        project_invoices = [item for item in invoices if item.project_id == project.id and item.currency == project.currency]
        project_expenses = [item for item in expenses if item.project_id == project.id and item.profitability_currency == project.currency]
        invoiced = _money(sum((item.total for item in project_invoices), Decimal("0")))
        collected = _money(sum((item.amount_paid for item in project_invoices), Decimal("0")))
        costs = _money(sum((item.profitability_amount for item in project_expenses), Decimal("0")))
        profit = _money(invoiced - costs)
        margin = (profit * Decimal("100") / invoiced).quantize(PERCENT, rounding=ROUND_HALF_UP) if invoiced > 0 else None
        project_rows.append(ProjectProfitabilityRow(
            project_id=project.id,
            project_number=project.project_number,
            project_name=project.name,
            client_name=client_names.get(project.client_id, "—"),
            currency=project.currency,
            contract_value=project.contract_value,
            invoiced_revenue=invoiced,
            collected_revenue=collected,
            direct_expenses=costs,
            estimated_profit=profit,
            margin_percent=margin,
        ))

    client_groups: dict[tuple[str, str], dict[str, Decimal]] = {}
    for invoice in invoices:
        key = (invoice.client_id, invoice.currency)
        row = client_groups.setdefault(key, {"invoiced": Decimal("0"), "collected": Decimal("0"), "expenses": Decimal("0")})
        row["invoiced"] += invoice.total
        row["collected"] += invoice.amount_paid
    for expense in expenses:
        if not expense.client_id:
            continue
        key = (expense.client_id, expense.profitability_currency)
        row = client_groups.setdefault(key, {"invoiced": Decimal("0"), "collected": Decimal("0"), "expenses": Decimal("0")})
        row["expenses"] += expense.profitability_amount
    client_rows: list[ClientProfitabilityRow] = []
    for (client_id, currency), values in client_groups.items():
        invoiced = _money(values["invoiced"])
        collected = _money(values["collected"])
        costs = _money(values["expenses"])
        profit = _money(invoiced - costs)
        margin = (profit * Decimal("100") / invoiced).quantize(PERCENT, rounding=ROUND_HALF_UP) if invoiced > 0 else None
        client_rows.append(ClientProfitabilityRow(
            client_id=client_id,
            client_name=client_names.get(client_id, "—"),
            currency=currency,
            invoiced_revenue=invoiced,
            collected_revenue=collected,
            direct_expenses=costs,
            estimated_profit=profit,
            margin_percent=margin,
        ))
    client_rows.sort(key=lambda item: (item.client_name.lower(), item.currency))

    return ProfitabilityReport(profit_loss_by_currency=pnl, projects=project_rows, clients=client_rows)
