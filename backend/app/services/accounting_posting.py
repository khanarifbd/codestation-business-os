from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.company_defaults import OrganizationExchangeRate
from app.models.finance import FinancialAccount
from app.models.finance_controls import AccountingPeriod

MONEY = Decimal("0.01")
RATE = Decimal("0.00000001")

DEFAULT_LEDGER_ACCOUNTS = [
    ("1000", "Cash & Cash Equivalents", "asset", "cash_equivalents", "debit", "cash_equivalents", False),
    ("1100", "Accounts Receivable", "asset", "accounts_receivable", "debit", "accounts_receivable", True),
    ("1200", "Other Current Assets", "asset", "other_current_assets", "debit", "other_current_assets", True),
    ("1300", "Supplier Advances", "asset", "supplier_advances", "debit", "supplier_advances", False),
    ("1400", "Investments", "asset", "investments", "debit", "investments", False),
    ("1500", "Fixed Assets", "asset", "fixed_assets", "debit", "fixed_assets", True),
    ("1510", "Accumulated Depreciation", "asset", "accumulated_depreciation", "credit", "accumulated_depreciation", False),
    ("2000", "Accounts Payable", "liability", "accounts_payable", "credit", "accounts_payable", True),
    ("2100", "Loans Payable", "liability", "loans_payable", "credit", "loans_payable", True),
    ("2200", "Taxes Payable", "liability", "taxes_payable", "credit", "taxes_payable", True),
    ("2300", "Customer Advances", "liability", "customer_advances", "credit", "customer_advances", False),
    ("2400", "Payroll Withholdings Payable", "liability", "payroll_withholdings", "credit", "payroll_withholdings", False),
    ("2500", "Investor Funds Payable", "liability", "investor_funds_payable", "credit", "investor_funds_payable", False),
    ("3000", "Owner's Equity", "equity", "owners_equity", "credit", "owners_equity", True),
    ("3100", "Opening Balance Equity", "equity", "opening_balance_equity", "credit", "opening_balance_equity", True),
    ("4000", "Sales Revenue", "income", "sales_revenue", "credit", "sales_revenue", True),
    ("4100", "Service Revenue", "income", "service_revenue", "credit", "service_revenue", True),
    ("4900", "Other Income", "income", "other_income", "credit", "other_income", True),
    ("5000", "Cost of Sales", "expense", "cost_of_sales", "debit", "cost_of_sales", True),
    ("6000", "Operating Expenses", "expense", "operating_expenses", "debit", "operating_expenses", True),
    ("6050", "Payroll Expense", "expense", "payroll_expense", "debit", "payroll_expense", False),
    ("6100", "Interest Expense", "expense", "interest_expense", "debit", "interest_expense", True),
    ("6200", "Bank & Processing Fees", "expense", "bank_fees", "debit", "bank_fees", True),
    ("6300", "Investor Profit Share Expense", "expense", "investor_profit_share", "debit", "investor_profit_share", False),
    ("6400", "Depreciation Expense", "expense", "depreciation_expense", "debit", "depreciation_expense", False),
]


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def ensure_default_chart(db, organization_id: str, user_id: str | None = None) -> None:
    existing_keys = set(db.scalars(select(LedgerAccount.system_key).where(LedgerAccount.organization_id == organization_id, LedgerAccount.system_key.is_not(None))).all())
    existing_codes = {item.code: item for item in db.scalars(select(LedgerAccount).where(LedgerAccount.organization_id == organization_id)).all()}
    changed = False
    for code, name, category, subtype, normal, system_key, manual in DEFAULT_LEDGER_ACCOUNTS:
        if system_key in existing_keys:
            continue
        by_code = existing_codes.get(code)
        if by_code is not None:
            if by_code.category == category and by_code.system_key is None:
                by_code.system_key = system_key
                by_code.is_system = True
                by_code.normal_balance = normal
                by_code.subtype = by_code.subtype or subtype
                by_code.allow_manual_posting = manual
                existing_keys.add(system_key)
                changed = True
            continue
        item = LedgerAccount(
            organization_id=organization_id,
            code=code,
            name=name,
            category=category,
            subtype=subtype,
            normal_balance=normal,
            parent_id=None,
            system_key=system_key,
            is_system=True,
            is_active=True,
            allow_manual_posting=manual,
            notes="Default Business OS accounting account",
            created_by_user_id=user_id,
        )
        db.add(item)
        existing_codes[code] = item
        existing_keys.add(system_key)
        changed = True
    if changed:
        db.flush()


def to_base_amount(db, organization_id: str, base_currency: str, amount: Decimal, currency: str) -> tuple[Decimal, Decimal]:
    amount = Decimal(amount)
    base = base_currency.upper()
    source = currency.upper()
    if source == base:
        return money(amount), Decimal("1")
    direct = db.scalar(select(OrganizationExchangeRate).where(OrganizationExchangeRate.organization_id == organization_id, OrganizationExchangeRate.base_currency == source, OrganizationExchangeRate.quote_currency == base))
    if direct is not None:
        rate = Decimal(direct.effective_rate)
        return money(amount * rate), rate.quantize(RATE, rounding=ROUND_HALF_UP)
    inverse = db.scalar(select(OrganizationExchangeRate).where(OrganizationExchangeRate.organization_id == organization_id, OrganizationExchangeRate.base_currency == base, OrganizationExchangeRate.quote_currency == source))
    if inverse is not None:
        inverse_rate = Decimal(inverse.effective_rate)
        rate = Decimal("1") / inverse_rate
        return money(amount * rate), rate.quantize(RATE, rounding=ROUND_HALF_UP)
    raise HTTPException(status_code=409, detail=f"Accounting exchange rate is missing for {source}/{base}. Add the currency pair in Company Settings → Exchange Rates.")


@dataclass(frozen=True)
class PostingLine:
    ledger_account_id: str
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    description: str | None = None
    currency: str = "USD"
    exchange_rate_to_base: Decimal = Decimal("1")
    original_amount: Decimal | None = None


def ensure_open_period(db, organization_id: str, entry_date: date) -> None:
    closed = db.scalar(select(AccountingPeriod.id).where(AccountingPeriod.organization_id == organization_id, AccountingPeriod.status == "closed", AccountingPeriod.start_date <= entry_date, AccountingPeriod.end_date >= entry_date))
    if closed:
        raise HTTPException(status_code=409, detail=f"Accounting period is closed for {entry_date.isoformat()}")


def system_account(db, organization_id: str, system_key: str) -> LedgerAccount:
    item = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == organization_id, LedgerAccount.system_key == system_key, LedgerAccount.is_active.is_(True)))
    if item is None:
        ensure_default_chart(db, organization_id)
        item = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == organization_id, LedgerAccount.system_key == system_key, LedgerAccount.is_active.is_(True)))
    if item is None:
        raise HTTPException(status_code=409, detail=f"Required accounting account is missing: {system_key}")
    return item


def _create_financial_ledger_mapping(db, financial: FinancialAccount) -> LedgerAccount:
    suffix = financial.id.replace("-", "")[:12].upper()
    is_credit_card = financial.account_type == "credit_card"
    parent = None if is_credit_card else system_account(db, financial.organization_id, "cash_equivalents")
    item = LedgerAccount(
        organization_id=financial.organization_id,
        code=f"2050-{suffix}" if is_credit_card else f"1010-{suffix}",
        name=financial.name,
        category="liability" if is_credit_card else "asset",
        subtype=financial.account_type,
        normal_balance="credit" if is_credit_card else "debit",
        parent_id=parent.id if parent else None,
        system_key=f"financial_account:{financial.id}",
        is_system=False,
        is_active=True,
        allow_manual_posting=True,
        notes=f"Auto-mapped financial account: {financial.name}",
        created_by_user_id=financial.created_by_user_id,
    )
    db.add(item)
    db.flush()
    return item


def financial_ledger_account(db, organization_id: str, financial_account_id: str) -> tuple[FinancialAccount, LedgerAccount]:
    financial = db.scalar(select(FinancialAccount).where(FinancialAccount.id == financial_account_id, FinancialAccount.organization_id == organization_id, FinancialAccount.is_active.is_(True)))
    if financial is None:
        raise HTTPException(status_code=404, detail="Active financial account not found")
    ledger = db.scalar(select(LedgerAccount).where(LedgerAccount.organization_id == organization_id, LedgerAccount.system_key == f"financial_account:{financial.id}", LedgerAccount.is_active.is_(True)))
    if ledger is None:
        ledger = _create_financial_ledger_mapping(db, financial)
    return financial, ledger


def post_journal(db, *, organization_id: str, user_id: str, entry_date: date, source_type: str, source_id: str, lines: list[PostingLine], reference: str | None = None, memo: str | None = None) -> JournalEntry:
    ensure_open_period(db, organization_id, entry_date)
    existing = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == organization_id, JournalEntry.source_type == source_type, JournalEntry.source_id == source_id, JournalEntry.status == "posted"))
    if existing is not None:
        return existing
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="Accounting journal requires at least two lines")
    debit = money(sum((money(line.debit) for line in lines), Decimal("0")))
    credit = money(sum((money(line.credit) for line in lines), Decimal("0")))
    if debit <= 0 or debit != credit:
        raise HTTPException(status_code=400, detail="Accounting journal must have equal non-zero debit and credit totals")
    entry = JournalEntry(
        organization_id=organization_id,
        entry_number=f"JE-{entry_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}",
        entry_date=entry_date,
        status="posted",
        source_type=source_type,
        source_id=source_id,
        reference=reference.strip() if reference and reference.strip() else None,
        memo=memo.strip() if memo and memo.strip() else None,
        created_by_user_id=user_id,
        posted_by_user_id=user_id,
        posted_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()
    for source in lines:
        line_debit = money(source.debit)
        line_credit = money(source.credit)
        if (line_debit > 0) == (line_credit > 0):
            raise HTTPException(status_code=400, detail="Each journal line must contain either a debit or a credit")
        original = source.original_amount if source.original_amount is not None else max(line_debit, line_credit)
        db.add(JournalLine(
            organization_id=organization_id,
            journal_entry_id=entry.id,
            ledger_account_id=source.ledger_account_id,
            description=source.description,
            currency=source.currency.upper(),
            exchange_rate_to_base=source.exchange_rate_to_base,
            debit=line_debit,
            credit=line_credit,
            original_amount=money(original),
        ))
    db.flush()
    return entry
