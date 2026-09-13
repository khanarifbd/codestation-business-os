from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import FinancialAccount
from app.models.finance_controls import AccountingPeriod
from app.services.exchange_rates import resolve_exchange_rate
from app.services.functional_currency import assert_current_functional_posting_period

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
    ("4910", "Realized Foreign Exchange Gain", "income", "realized_fx_gain", "credit", "realized_fx_gain", False),
    ("5000", "Cost of Sales", "expense", "cost_of_sales", "debit", "cost_of_sales", True),
    ("6000", "Operating Expenses", "expense", "operating_expenses", "debit", "operating_expenses", True),
    ("6050", "Payroll Expense", "expense", "payroll_expense", "debit", "payroll_expense", False),
    ("6100", "Interest Expense", "expense", "interest_expense", "debit", "interest_expense", True),
    ("6150", "Realized Foreign Exchange Loss", "expense", "realized_fx_loss", "debit", "realized_fx_loss", False),
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


def to_base_amount(
    db,
    organization_id: str,
    base_currency: str,
    amount: Decimal,
    currency: str,
    *,
    rate_date: date | None = None,
) -> tuple[Decimal, Decimal]:
    amount = Decimal(amount)
    base = base_currency.upper()
    source = currency.upper()
    resolved_rate = resolve_exchange_rate(
        db,
        organization_id=organization_id,
        source_currency=source,
        target_currency=base,
        as_of=rate_date,
    )
    return money(amount * resolved_rate), resolved_rate.quantize(RATE, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class PostingLine:
    ledger_account_id: str
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")
    description: str | None = None
    currency: str = "USD"
    exchange_rate_to_base: Decimal = Decimal("1")
    original_amount: Decimal | None = None


def _normalize_implicit_foreign_lines(
    db,
    organization_id: str,
    base_currency: str,
    entry_date: date,
    lines: list[PostingLine],
) -> list[PostingLine]:
    """Convert implicit source-currency lines using the rate valid on entry_date."""
    base_currency = base_currency.upper()

    implicit_indexes: list[int] = []
    implicit_currencies: set[str] = set()
    original_debit = Decimal("0")
    original_credit = Decimal("0")

    for index, line in enumerate(lines):
        currency = line.currency.upper()
        if currency == base_currency:
            continue
        if line.original_amount is not None or Decimal(line.exchange_rate_to_base) != Decimal("1"):
            continue
        line_debit = money(line.debit)
        line_credit = money(line.credit)
        implicit_indexes.append(index)
        implicit_currencies.add(currency)
        original_debit += line_debit
        original_credit += line_credit

    if not implicit_indexes:
        return lines
    if len(implicit_currencies) != 1:
        raise HTTPException(status_code=400, detail="Mixed-currency journal lines require explicit base amounts and exchange rates")

    source_currency = next(iter(implicit_currencies))
    _, resolved_rate = to_base_amount(
        db,
        organization_id,
        base_currency,
        Decimal("1"),
        source_currency,
        rate_date=entry_date,
    )
    normalized = list(lines)

    for index in implicit_indexes:
        source = normalized[index]
        source_debit = money(source.debit)
        source_credit = money(source.credit)
        if (source_debit > 0) == (source_credit > 0):
            raise HTTPException(status_code=400, detail="Each journal line must contain either a debit or a credit")
        original_amount = max(source_debit, source_credit)
        base_amount = money(original_amount * resolved_rate)
        normalized[index] = replace(
            source,
            debit=base_amount if source_debit > 0 else Decimal("0"),
            credit=base_amount if source_credit > 0 else Decimal("0"),
            currency=source_currency,
            exchange_rate_to_base=resolved_rate,
            original_amount=original_amount,
        )

    if money(original_debit) == money(original_credit):
        debit_total = money(sum((money(line.debit) for line in normalized), Decimal("0")))
        credit_total = money(sum((money(line.credit) for line in normalized), Decimal("0")))
        difference = money(debit_total - credit_total)
        maximum_rounding_residual = MONEY * Decimal(max(1, len(implicit_indexes)))
        if difference != 0 and abs(difference) <= maximum_rounding_residual:
            target_side = "credit" if difference > 0 else "debit"
            candidates = [index for index in implicit_indexes if money(getattr(normalized[index], target_side)) > 0]
            if candidates:
                target_index = max(candidates, key=lambda index: money(getattr(normalized[index], target_side)))
                target = normalized[target_index]
                adjustment = abs(difference)
                if target_side == "credit":
                    normalized[target_index] = replace(target, credit=money(target.credit + adjustment))
                else:
                    normalized[target_index] = replace(target, debit=money(target.debit + adjustment))

    return normalized


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
        allow_manual_posting=False,
        notes=f"Auto-mapped financial account: {financial.name}. Adjust through the financial account workflow so operational and GL balances remain identical.",
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
    elif ledger.allow_manual_posting:
        ledger.allow_manual_posting = False
        db.flush()
    return financial, ledger


def post_journal(db, *, organization_id: str, user_id: str, entry_date: date, source_type: str, source_id: str, lines: list[PostingLine], reference: str | None = None, memo: str | None = None) -> JournalEntry:
    ensure_open_period(db, organization_id, entry_date)
    existing = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == organization_id, JournalEntry.source_type == source_type, JournalEntry.source_id == source_id, JournalEntry.status == "posted"))
    if existing is not None:
        return existing
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="Accounting journal requires at least two lines")

    functional_period = assert_current_functional_posting_period(db, organization_id, entry_date)
    base_currency = functional_period.currency.upper()

    source_debit = money(sum((money(line.debit) for line in lines), Decimal("0")))
    source_credit = money(sum((money(line.credit) for line in lines), Decimal("0")))
    if source_debit <= 0 or source_debit != source_credit:
        raise HTTPException(status_code=400, detail="Accounting journal must have equal non-zero debit and credit totals")

    lines = _normalize_implicit_foreign_lines(db, organization_id, base_currency, entry_date, lines)
    debit = money(sum((money(line.debit) for line in lines), Decimal("0")))
    credit = money(sum((money(line.credit) for line in lines), Decimal("0")))
    if debit <= 0 or debit != credit:
        raise HTTPException(status_code=400, detail="Accounting journal must have equal non-zero debit and credit totals in functional currency")

    entry = JournalEntry(
        organization_id=organization_id,
        entry_number=f"JE-{entry_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}",
        entry_date=entry_date,
        functional_currency=base_currency,
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
