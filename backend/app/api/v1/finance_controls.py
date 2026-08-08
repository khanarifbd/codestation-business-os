from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.crm import Client
from app.models.expenses import Expense, ExpenseCategory, Vendor
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.finance_controls import AccountingPeriod, RecurringExpense
from app.models.projects import Project
from app.schemas.finance_controls import (
    AccountingPeriodClose,
    AccountingPeriodCreate,
    AccountingPeriodRead,
    AccountingPeriodReopen,
    RecurringExpenseCreate,
    RecurringExpensePost,
    RecurringExpensePostResult,
    RecurringExpenseRead,
    RecurringExpenseUpdate,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/finance", tags=["Finance Controls"])
FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
FinanceManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _rate(value: Decimal) -> Decimal:
    return Decimal(value).quantize(RATE, rounding=ROUND_HALF_UP)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _tenant_today(timezone_name: str) -> date:
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _account_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    credit = db.scalar(select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
        FinancialTransaction.organization_id == account.organization_id,
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "credit",
    )) or Decimal("0")
    debit = db.scalar(select(func.coalesce(func.sum(FinancialTransaction.amount), 0)).where(
        FinancialTransaction.organization_id == account.organization_id,
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "debit",
    )) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(credit) - Decimal(debit))


def _add_months(value: date, months: int) -> date:
    index = value.month - 1 + months
    year = value.year + index // 12
    month = index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _next_due(value: date, frequency: str, interval: int) -> date:
    if frequency == "weekly":
        return value + timedelta(days=7 * interval)
    if frequency == "monthly":
        return _add_months(value, interval)
    if frequency == "quarterly":
        return _add_months(value, 3 * interval)
    if frequency == "yearly":
        return _add_months(value, 12 * interval)
    raise HTTPException(status_code=400, detail="Unsupported recurring expense frequency")


def _ensure_open_period(db: DbSession, organization_id: str, finance_date: date) -> None:
    closed = db.scalar(select(AccountingPeriod.id).where(
        AccountingPeriod.organization_id == organization_id,
        AccountingPeriod.status == "closed",
        AccountingPeriod.start_date <= finance_date,
        AccountingPeriod.end_date >= finance_date,
    ))
    if closed:
        raise HTTPException(status_code=409, detail=f"Accounting period is closed for {finance_date.isoformat()}")


def _recurring_query(organization_id: str):
    return (
        select(
            RecurringExpense,
            Vendor.name.label("vendor_name"),
            ExpenseCategory.name.label("category_name"),
            FinancialAccount.name.label("account_name"),
            FinancialAccount.currency.label("account_currency"),
            Client.display_name.label("client_name"),
            Project.name.label("project_name"),
        )
        .join(ExpenseCategory, ExpenseCategory.id == RecurringExpense.category_id)
        .join(FinancialAccount, FinancialAccount.id == RecurringExpense.account_id)
        .outerjoin(Vendor, Vendor.id == RecurringExpense.vendor_id)
        .outerjoin(Client, Client.id == RecurringExpense.client_id)
        .outerjoin(Project, Project.id == RecurringExpense.project_id)
        .where(RecurringExpense.organization_id == organization_id)
    )


def _recurring_read(row) -> RecurringExpenseRead:
    item: RecurringExpense = row[0]
    return RecurringExpenseRead(
        id=item.id,
        name=item.name,
        description=item.description,
        vendor_id=item.vendor_id,
        vendor_name=row.vendor_name,
        category_id=item.category_id,
        category_name=row.category_name,
        account_id=item.account_id,
        account_name=row.account_name,
        account_currency=row.account_currency,
        client_id=item.client_id,
        client_name=row.client_name,
        project_id=item.project_id,
        project_name=row.project_name,
        expense_currency=item.expense_currency,
        expense_amount=item.expense_amount,
        frequency=item.frequency,
        interval_count=item.interval_count,
        next_due_date=item.next_due_date,
        end_date=item.end_date,
        tax_amount=item.tax_amount,
        payment_method=item.payment_method,
        reference=item.reference,
        notes=item.notes,
        is_active=item.is_active,
        last_posted_expense_id=item.last_posted_expense_id,
        last_posted_at=item.last_posted_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _load_recurring(db: DbSession, organization_id: str, recurring_id: str, *, lock: bool = False):
    query = _recurring_query(organization_id).where(RecurringExpense.id == recurring_id)
    if lock:
        query = query.with_for_update()
    row = db.execute(query).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Recurring expense not found")
    return row


@router.get("/recurring-expenses", response_model=list[RecurringExpenseRead])
def list_recurring_expenses(db: DbSession, tenant: FinanceViewer):
    rows = db.execute(_recurring_query(tenant.organization_id).order_by(
        RecurringExpense.is_active.desc(), RecurringExpense.next_due_date.asc(), RecurringExpense.name.asc()
    )).all()
    return [_recurring_read(row) for row in rows]


@router.post("/recurring-expenses", response_model=RecurringExpenseRead, status_code=status.HTTP_201_CREATED)
def create_recurring_expense(payload: RecurringExpenseCreate, request: Request, db: DbSession, tenant: FinanceManager):
    if payload.end_date and payload.end_date < payload.next_due_date:
        raise HTTPException(status_code=400, detail="End date cannot be before the next due date")
    category = db.scalar(select(ExpenseCategory).where(
        ExpenseCategory.id == payload.category_id,
        ExpenseCategory.organization_id == tenant.organization_id,
        ExpenseCategory.is_active.is_(True),
    ))
    account = db.scalar(select(FinancialAccount).where(
        FinancialAccount.id == payload.account_id,
        FinancialAccount.organization_id == tenant.organization_id,
        FinancialAccount.is_active.is_(True),
    ))
    if category is None: raise HTTPException(status_code=404, detail="Active expense category not found")
    if account is None: raise HTTPException(status_code=404, detail="Active financial account not found")
    if payload.vendor_id and db.scalar(select(Vendor.id).where(Vendor.id == payload.vendor_id, Vendor.organization_id == tenant.organization_id, Vendor.is_active.is_(True))) is None:
        raise HTTPException(status_code=404, detail="Active vendor not found")
    project = None
    client_id = payload.client_id
    if payload.project_id:
        project = db.scalar(select(Project).where(Project.id == payload.project_id, Project.organization_id == tenant.organization_id, Project.status != "cancelled"))
        if project is None: raise HTTPException(status_code=404, detail="Active project not found")
        if client_id and client_id != project.client_id: raise HTTPException(status_code=400, detail="Selected client does not match project client")
        client_id = project.client_id
    if client_id and db.scalar(select(Client.id).where(Client.id == client_id, Client.organization_id == tenant.organization_id, Client.status == "active")) is None:
        raise HTTPException(status_code=404, detail="Active client not found")
    item = RecurringExpense(
        organization_id=tenant.organization_id,
        name=payload.name.strip(), description=payload.description.strip(), vendor_id=payload.vendor_id,
        category_id=category.id, account_id=account.id, client_id=client_id, project_id=project.id if project else None,
        expense_currency=payload.expense_currency.upper(), expense_amount=_money(payload.expense_amount),
        frequency=payload.frequency, interval_count=payload.interval_count, next_due_date=payload.next_due_date,
        end_date=payload.end_date, payment_method=payload.payment_method, tax_amount=_money(payload.tax_amount),
        reference=_clean(payload.reference), notes=_clean(payload.notes), created_by_user_id=tenant.user_id,
    )
    db.add(item); db.flush()
    record_activity(db, action="finance.recurring_expense.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="recurring_expense", entity_id=item.id,
        after={"name": item.name, "amount": str(item.expense_amount), "currency": item.expense_currency,
               "frequency": item.frequency, "next_due_date": item.next_due_date.isoformat()},
        message=f"Recurring expense created: {item.name}", request=request)
    db.commit()
    return _recurring_read(_load_recurring(db, tenant.organization_id, item.id))


@router.patch("/recurring-expenses/{recurring_id}", response_model=RecurringExpenseRead)
def update_recurring_expense(recurring_id: str, payload: RecurringExpenseUpdate, request: Request, db: DbSession, tenant: FinanceManager):
    row = _load_recurring(db, tenant.organization_id, recurring_id, lock=True)
    item: RecurringExpense = row[0]
    before = {"name": item.name, "is_active": item.is_active, "next_due_date": item.next_due_date.isoformat()}
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in {"name", "description", "reference", "notes"} and isinstance(value, str): value = _clean(value)
        if field == "expense_currency" and value: value = value.upper()
        if field in {"expense_amount", "tax_amount"} and value is not None: value = _money(value)
        setattr(item, field, value)
    if item.end_date and item.end_date < item.next_due_date:
        raise HTTPException(status_code=400, detail="End date cannot be before the next due date")
    db.flush()
    record_activity(db, action="finance.recurring_expense.updated", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="recurring_expense", entity_id=item.id,
        before=before, after={"name": item.name, "is_active": item.is_active, "next_due_date": item.next_due_date.isoformat()},
        message=f"Recurring expense updated: {item.name}", request=request)
    db.commit()
    return _recurring_read(_load_recurring(db, tenant.organization_id, item.id))


@router.post("/recurring-expenses/{recurring_id}/post", response_model=RecurringExpensePostResult)
def post_recurring_expense(recurring_id: str, payload: RecurringExpensePost, request: Request, db: DbSession, tenant: FinanceManager):
    row = _load_recurring(db, tenant.organization_id, recurring_id, lock=True)
    recurring: RecurringExpense = row[0]
    if not recurring.is_active: raise HTTPException(status_code=409, detail="Recurring expense is inactive")
    expense_date = payload.expense_date or recurring.next_due_date
    if recurring.end_date and expense_date > recurring.end_date:
        raise HTTPException(status_code=409, detail="Recurring expense schedule has ended")
    _ensure_open_period(db, tenant.organization_id, expense_date)

    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == recurring.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())
    category = db.scalar(select(ExpenseCategory).where(ExpenseCategory.id == recurring.category_id, ExpenseCategory.organization_id == tenant.organization_id))
    if account is None or not account.is_active: raise HTTPException(status_code=409, detail="Recurring expense account is inactive or unavailable")
    if category is None or not category.is_active: raise HTTPException(status_code=409, detail="Recurring expense category is inactive or unavailable")

    project = db.get(Project, recurring.project_id) if recurring.project_id else None
    client = db.get(Client, recurring.client_id) if recurring.client_id else None
    amount = _money(payload.expense_amount or recurring.expense_amount)
    if account.currency == recurring.expense_currency:
        account_amount, exchange_rate = amount, Decimal("1.00000000")
    elif payload.account_amount is not None:
        account_amount = _money(payload.account_amount); exchange_rate = _rate(account_amount / amount)
    elif payload.exchange_rate is not None:
        exchange_rate = _rate(payload.exchange_rate); account_amount = _money(amount * exchange_rate)
    else:
        raise HTTPException(status_code=400, detail=f"Actual account amount or exchange rate is required for {recurring.expense_currency} to {account.currency}")

    profitability_currency = (project.currency if project else (client.currency if client and client.currency else recurring.expense_currency)).upper()
    if profitability_currency == recurring.expense_currency:
        profitability_amount, profitability_rate = amount, Decimal("1.00000000")
    elif payload.profitability_amount is not None:
        profitability_amount = _money(payload.profitability_amount); profitability_rate = _rate(profitability_amount / amount)
    elif payload.profitability_exchange_rate is not None:
        profitability_rate = _rate(payload.profitability_exchange_rate); profitability_amount = _money(amount * profitability_rate)
    else:
        raise HTTPException(status_code=400, detail=f"Profitability conversion is required to report this cost in {profitability_currency}")

    if account_amount > _account_balance(db, account):
        raise HTTPException(status_code=409, detail=f"Insufficient balance in {account.name}")

    expense = Expense(
        organization_id=tenant.organization_id, expense_number=next_sequence_code(db, tenant.organization_id, "expense"),
        vendor_id=recurring.vendor_id, category_id=recurring.category_id, account_id=recurring.account_id,
        client_id=recurring.client_id, project_id=recurring.project_id, description=recurring.description,
        expense_date=expense_date, expense_currency=recurring.expense_currency, expense_amount=amount,
        account_currency=account.currency, account_amount=account_amount, exchange_rate=exchange_rate,
        profitability_currency=profitability_currency, profitability_amount=profitability_amount,
        profitability_exchange_rate=profitability_rate, tax_amount=recurring.tax_amount,
        payment_method=recurring.payment_method, reference=_clean(payload.reference) or recurring.reference,
        notes=_clean(payload.notes) or recurring.notes, status="posted", created_by_user_id=tenant.user_id,
    )
    db.add(expense); db.flush()
    db.add(FinancialTransaction(
        organization_id=tenant.organization_id, account_id=account.id, transaction_date=expense_date,
        direction="debit", amount=account_amount, currency=account.currency, source_type="expense", source_id=expense.id,
        reference=expense.reference or expense.expense_number, description=f"Recurring expense {expense.expense_number}: {expense.description}",
        created_by_user_id=tenant.user_id,
    ))
    next_due = _next_due(recurring.next_due_date, recurring.frequency, recurring.interval_count)
    recurring.last_posted_expense_id = expense.id
    recurring.last_posted_at = datetime.now(timezone.utc)
    recurring.next_due_date = next_due
    if recurring.end_date and next_due > recurring.end_date: recurring.is_active = False
    db.flush()
    record_activity(db, action="finance.recurring_expense.posted", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="recurring_expense", entity_id=recurring.id,
        after={"expense_id": expense.id, "expense_number": expense.expense_number, "posted_date": expense_date.isoformat(),
               "amount": str(amount), "currency": recurring.expense_currency, "next_due_date": next_due.isoformat()},
        metadata={"ledger_direction": "debit", "category_cost_type": category.cost_type},
        message=f"Recurring expense {recurring.name} posted as {expense.expense_number}", request=request)
    db.commit()
    read = _recurring_read(_load_recurring(db, tenant.organization_id, recurring.id))
    return RecurringExpensePostResult(recurring_expense=read, expense_id=expense.id, expense_number=expense.expense_number,
        posted_date=expense_date, next_due_date=read.next_due_date, is_active=read.is_active)


@router.get("/accounting-periods", response_model=list[AccountingPeriodRead])
def list_accounting_periods(db: DbSession, tenant: FinanceViewer):
    items = db.scalars(select(AccountingPeriod).where(AccountingPeriod.organization_id == tenant.organization_id).order_by(AccountingPeriod.start_date.desc())).all()
    return [AccountingPeriodRead.model_validate(item, from_attributes=True) for item in items]


@router.post("/accounting-periods", response_model=AccountingPeriodRead, status_code=status.HTTP_201_CREATED)
def create_accounting_period(payload: AccountingPeriodCreate, request: Request, db: DbSession, tenant: FinanceManager):
    if payload.end_date < payload.start_date: raise HTTPException(status_code=400, detail="Period end date cannot be before start date")
    overlap = db.scalar(select(AccountingPeriod.id).where(
        AccountingPeriod.organization_id == tenant.organization_id,
        AccountingPeriod.start_date <= payload.end_date,
        AccountingPeriod.end_date >= payload.start_date,
    ))
    if overlap: raise HTTPException(status_code=409, detail="Accounting periods cannot overlap")
    item = AccountingPeriod(organization_id=tenant.organization_id, name=payload.name.strip(), start_date=payload.start_date,
        end_date=payload.end_date, status="open", created_by_user_id=tenant.user_id)
    db.add(item); db.flush()
    record_activity(db, action="finance.accounting_period.created", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="accounting_period", entity_id=item.id,
        after={"name": item.name, "start_date": item.start_date.isoformat(), "end_date": item.end_date.isoformat(), "status": "open"},
        message=f"Accounting period created: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return AccountingPeriodRead.model_validate(item, from_attributes=True)


@router.post("/accounting-periods/{period_id}/close", response_model=AccountingPeriodRead)
def close_accounting_period(period_id: str, payload: AccountingPeriodClose, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(AccountingPeriod).where(AccountingPeriod.id == period_id, AccountingPeriod.organization_id == tenant.organization_id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Accounting period not found")
    if item.status == "closed": raise HTTPException(status_code=409, detail="Accounting period is already closed")
    if item.end_date > _tenant_today(tenant.organization.timezone):
        raise HTTPException(status_code=409, detail="Future accounting periods cannot be closed")
    item.status = "closed"; item.close_notes = _clean(payload.notes); item.closed_by_user_id = tenant.user_id; item.closed_at = datetime.now(timezone.utc)
    db.flush()
    record_activity(db, action="finance.accounting_period.closed", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="accounting_period", entity_id=item.id,
        before={"status": "open"}, after={"status": "closed", "start_date": item.start_date.isoformat(), "end_date": item.end_date.isoformat()},
        message=f"Accounting period closed: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return AccountingPeriodRead.model_validate(item, from_attributes=True)


@router.post("/accounting-periods/{period_id}/reopen", response_model=AccountingPeriodRead)
def reopen_accounting_period(period_id: str, payload: AccountingPeriodReopen, request: Request, db: DbSession, tenant: FinanceManager):
    item = db.scalar(select(AccountingPeriod).where(AccountingPeriod.id == period_id, AccountingPeriod.organization_id == tenant.organization_id).with_for_update())
    if item is None: raise HTTPException(status_code=404, detail="Accounting period not found")
    if item.status != "closed": raise HTTPException(status_code=409, detail="Only closed accounting periods can be reopened")
    item.status = "open"; item.reopened_by_user_id = tenant.user_id; item.reopened_at = datetime.now(timezone.utc); item.reopen_reason = payload.reason.strip()
    db.flush()
    record_activity(db, action="finance.accounting_period.reopened", scope="tenant", actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id, entity_type="accounting_period", entity_id=item.id,
        before={"status": "closed"}, after={"status": "open", "reason": item.reopen_reason},
        message=f"Accounting period reopened: {item.name}", request=request)
    db.commit(); db.refresh(item)
    return AccountingPeriodRead.model_validate(item, from_attributes=True)
