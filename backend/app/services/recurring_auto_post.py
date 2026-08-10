from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.crm import Client
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.finance_controls import AccountingPeriod, RecurringExpense
from app.models.organization import Organization
from app.models.projects import Project
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code

MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _add_months(value: date, months: int) -> date:
    index = value.month - 1 + months
    year = value.year + index // 12
    month = index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def next_due_date(value: date, frequency: str, interval_count: int) -> date:
    if frequency == "weekly":
        return value + timedelta(days=7 * interval_count)
    if frequency == "monthly":
        return _add_months(value, interval_count)
    if frequency == "quarterly":
        return _add_months(value, 3 * interval_count)
    if frequency == "yearly":
        return _add_months(value, 12 * interval_count)
    raise ValueError(f"Unsupported recurring frequency: {frequency}")


def account_balance(db: Session, account: FinancialAccount) -> Decimal:
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


def auto_post_eligibility(db: Session, recurring: RecurringExpense) -> tuple[bool, str | None]:
    account = db.get(FinancialAccount, recurring.account_id)
    if account is None or not account.is_active:
        return False, "Financial account is inactive or unavailable"
    if account.currency.upper() != recurring.expense_currency.upper():
        return False, "Auto Post requires expense currency to match the selected account currency"
    if recurring.project_id:
        project = db.get(Project, recurring.project_id)
        if project is None or project.status == "cancelled":
            return False, "Project is unavailable or cancelled"
        if project.currency.upper() != recurring.expense_currency.upper():
            return False, "Cross-currency project costs require Manual Post"
    elif recurring.client_id:
        client = db.get(Client, recurring.client_id)
        if client and client.currency and client.currency.upper() != recurring.expense_currency.upper():
            return False, "Cross-currency client costs require Manual Post"
    return True, None


def _closed_period(db: Session, recurring: RecurringExpense, expense_date: date) -> bool:
    return db.scalar(select(AccountingPeriod.id).where(
        AccountingPeriod.organization_id == recurring.organization_id,
        AccountingPeriod.status == "closed",
        AccountingPeriod.start_date <= expense_date,
        AccountingPeriod.end_date >= expense_date,
    )) is not None


def post_due_recurring_expense(db: Session, recurring: RecurringExpense, *, now: datetime | None = None) -> Expense:
    now = now or datetime.now(timezone.utc)
    expense_date = recurring.next_due_date
    recurring.auto_post_last_attempt_at = now
    recurring.auto_post_last_error = None

    if not recurring.is_active or not recurring.auto_post:
        raise ValueError("Recurring expense is not enabled for Auto Post")
    if recurring.end_date and expense_date > recurring.end_date:
        recurring.is_active = False
        raise ValueError("Recurring expense schedule has ended")
    if _closed_period(db, recurring, expense_date):
        raise ValueError(f"Accounting period is closed for {expense_date.isoformat()}")

    eligible, reason = auto_post_eligibility(db, recurring)
    if not eligible:
        raise ValueError(reason or "Recurring expense is not eligible for Auto Post")

    account = db.get(FinancialAccount, recurring.account_id)
    category = db.get(ExpenseCategory, recurring.category_id)
    if account is None or category is None or not category.is_active:
        raise ValueError("Recurring expense account/category is unavailable")
    amount = _money(recurring.expense_amount)
    if amount > account_balance(db, account):
        raise ValueError(f"Insufficient balance in {account.name}")

    expense = Expense(
        organization_id=recurring.organization_id,
        expense_number=next_sequence_code(db, recurring.organization_id, "expense"),
        vendor_id=recurring.vendor_id,
        category_id=recurring.category_id,
        account_id=recurring.account_id,
        client_id=recurring.client_id,
        project_id=recurring.project_id,
        description=recurring.description,
        expense_date=expense_date,
        expense_currency=recurring.expense_currency,
        expense_amount=amount,
        account_currency=account.currency,
        account_amount=amount,
        exchange_rate=Decimal("1.00000000"),
        profitability_currency=recurring.expense_currency,
        profitability_amount=amount,
        profitability_exchange_rate=Decimal("1.00000000"),
        tax_amount=recurring.tax_amount,
        payment_method=recurring.payment_method,
        reference=recurring.reference,
        notes=recurring.notes,
        status="posted",
        created_by_user_id=recurring.created_by_user_id,
    )
    db.add(expense)
    db.flush()
    db.add(FinancialTransaction(
        organization_id=recurring.organization_id,
        account_id=account.id,
        transaction_date=expense_date,
        direction="debit",
        amount=amount,
        currency=account.currency,
        source_type="expense",
        source_id=expense.id,
        reference=expense.reference or expense.expense_number,
        description=f"Auto-posted recurring expense {expense.expense_number}: {expense.description}",
        created_by_user_id=recurring.created_by_user_id,
    ))
    next_due = next_due_date(recurring.next_due_date, recurring.frequency, recurring.interval_count)
    recurring.last_posted_expense_id = expense.id
    recurring.last_posted_at = now
    recurring.next_due_date = next_due
    recurring.auto_post_last_error = None
    if recurring.end_date and next_due > recurring.end_date:
        recurring.is_active = False
    db.flush()
    record_activity(
        db,
        action="finance.recurring_expense.auto_posted",
        scope="tenant",
        actor_type="system",
        organization_id=recurring.organization_id,
        entity_type="recurring_expense",
        entity_id=recurring.id,
        after={
            "expense_id": expense.id,
            "expense_number": expense.expense_number,
            "posted_date": expense_date.isoformat(),
            "amount": str(amount),
            "currency": recurring.expense_currency,
            "next_due_date": next_due.isoformat(),
        },
        metadata={"mode": "auto_post", "ledger_direction": "debit"},
        message=f"Recurring expense {recurring.name} auto-posted as {expense.expense_number}",
    )
    return expense


def process_due_auto_posts(db: Session, *, now: datetime | None = None, limit: int = 100) -> tuple[int, int]:
    now = now or datetime.now(timezone.utc)
    today = now.date()
    ids = db.scalars(
        select(RecurringExpense.id)
        .join(Organization, Organization.id == RecurringExpense.organization_id)
        .where(
            RecurringExpense.auto_post.is_(True),
            RecurringExpense.is_active.is_(True),
            RecurringExpense.next_due_date <= today,
        )
        .order_by(RecurringExpense.next_due_date.asc())
        .limit(limit)
    ).all()
    posted = 0
    failed = 0
    for recurring_id in ids:
        try:
            recurring = db.scalar(
                select(RecurringExpense)
                .where(RecurringExpense.id == recurring_id)
                .with_for_update(skip_locked=True)
            )
            if recurring is None or not recurring.auto_post or not recurring.is_active or recurring.next_due_date > today:
                db.rollback()
                continue
            post_due_recurring_expense(db, recurring, now=now)
            db.commit()
            posted += 1
        except Exception as exc:
            db.rollback()
            recurring = db.get(RecurringExpense, recurring_id)
            if recurring is not None:
                recurring.auto_post_last_attempt_at = now
                recurring.auto_post_last_error = str(exc)[:2000]
                record_activity(
                    db,
                    action="finance.recurring_expense.auto_post_failed",
                    scope="tenant",
                    actor_type="system",
                    organization_id=recurring.organization_id,
                    entity_type="recurring_expense",
                    entity_id=recurring.id,
                    outcome="failure",
                    after={"due_date": recurring.next_due_date.isoformat(), "error": recurring.auto_post_last_error},
                    metadata={"mode": "auto_post"},
                    message=f"Auto Post failed for recurring expense {recurring.name}",
                )
                db.commit()
            failed += 1
    return posted, failed
