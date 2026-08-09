from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import FinancialAccount
from app.models.finance_controls import AccountingPeriod

MONEY = Decimal("0.01")


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


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
    closed = db.scalar(
        select(AccountingPeriod.id).where(
            AccountingPeriod.organization_id == organization_id,
            AccountingPeriod.status == "closed",
            AccountingPeriod.start_date <= entry_date,
            AccountingPeriod.end_date >= entry_date,
        )
    )
    if closed:
        raise HTTPException(status_code=409, detail=f"Accounting period is closed for {entry_date.isoformat()}")


def system_account(db, organization_id: str, system_key: str) -> LedgerAccount:
    item = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key == system_key,
            LedgerAccount.is_active.is_(True),
        )
    )
    if item is None:
        raise HTTPException(status_code=409, detail=f"Required accounting account is missing: {system_key}")
    return item


def financial_ledger_account(db, organization_id: str, financial_account_id: str) -> tuple[FinancialAccount, LedgerAccount]:
    financial = db.scalar(
        select(FinancialAccount).where(
            FinancialAccount.id == financial_account_id,
            FinancialAccount.organization_id == organization_id,
            FinancialAccount.is_active.is_(True),
        )
    )
    if financial is None:
        raise HTTPException(status_code=404, detail="Active financial account not found")
    ledger = db.scalar(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key == f"financial_account:{financial.id}",
            LedgerAccount.is_active.is_(True),
        )
    )
    if ledger is None:
        raise HTTPException(status_code=409, detail="Financial account is not mapped to the Chart of Accounts")
    return financial, ledger


def post_journal(
    db,
    *,
    organization_id: str,
    user_id: str,
    entry_date: date,
    source_type: str,
    source_id: str,
    lines: list[PostingLine],
    reference: str | None = None,
    memo: str | None = None,
) -> JournalEntry:
    ensure_open_period(db, organization_id, entry_date)
    existing = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )
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
        db.add(
            JournalLine(
                organization_id=organization_id,
                journal_entry_id=entry.id,
                ledger_account_id=source.ledger_account_id,
                description=source.description,
                currency=source.currency.upper(),
                exchange_rate_to_base=source.exchange_rate_to_base,
                debit=line_debit,
                credit=line_credit,
                original_amount=money(original),
            )
        )
    db.flush()
    return entry
