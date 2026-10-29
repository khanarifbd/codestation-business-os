"""Narrow settlement/reversal coordination, not a global ledger locking protocol.

Participating writes acquire the tenant mutex FIRST, then source row (correction),
then financial accounts in ID order. No commit/retry here. Other tax producers,
manual journals, period closure and currency transitions still require integration
and global lock-order verification before a production concurrency claim.
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import hashlib
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func, select, text

from app.models.accounting import JournalEntry, JournalLine
from app.models.finance import FinancialAccount, FinancialTransaction


def lock_tax_settlements(db, organization_id: str) -> None:
    key = int.from_bytes(hashlib.sha256(("business-os:tax-settlement:v1:" + organization_id).encode()).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": key})


def minimum_date_capacity(rows, as_of: date, *, normal_balance: Literal["debit", "credit"]) -> Decimal:
    """Date-only capacity: include the as-of day's NET, then each later day's NET.

    No intraday order is defined by this API. Future credits cannot rescue an
    earlier negative prefix. A future reversal restores capacity from its date,
    not before it. Dates are grouped by SQL and defensively netted here too.
    """
    daily = {}
    for entry_date, debit, credit in rows:
        delta = Decimal(debit or 0) - Decimal(credit or 0)
        daily[entry_date] = daily.get(entry_date, Decimal(0)) + (delta if normal_balance == "debit" else -delta)
    running = sum((delta for day, delta in daily.items() if day <= as_of), Decimal(0))
    capacity = running
    for day in sorted(day for day in daily if day > as_of):
        running += daily[day]
        capacity = min(capacity, running)
    return capacity.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def tax_ledger_capacity(db, organization_id: str, ledger_account_id: str, as_of: date, *, period, normal_balance: Literal["debit", "credit"]) -> Decimal:
    query = select(JournalEntry.entry_date, func.coalesce(func.sum(JournalLine.debit), 0), func.coalesce(func.sum(JournalLine.credit), 0)).join(
        JournalEntry,
        (JournalEntry.id == JournalLine.journal_entry_id) & (JournalEntry.organization_id == JournalLine.organization_id),
    ).where(
        JournalLine.organization_id == organization_id,
        JournalEntry.organization_id == organization_id,
        JournalLine.ledger_account_id == ledger_account_id,
        JournalEntry.status == "posted",
        JournalEntry.functional_currency == period.currency.upper(),
        JournalEntry.entry_date >= period.effective_from,
    )
    if period.effective_to is not None:
        query = query.where(JournalEntry.entry_date <= period.effective_to)
    rows = db.execute(query.group_by(JournalEntry.entry_date).order_by(JournalEntry.entry_date)).all()
    return minimum_date_capacity(rows, as_of, normal_balance=normal_balance)


def lock_tax_reversal_accounts(db, organization_id: str, settlement_id: str) -> None:
    # Lock the actual saved movement accounts, not a guessed current metadata
    # account. Historical inactive/old-currency accounts remain reversible.
    ids = list(db.scalars(select(FinancialTransaction.account_id).where(
        FinancialTransaction.organization_id == organization_id,
        FinancialTransaction.source_type == "tax_settlement",
        FinancialTransaction.source_id == settlement_id,
    ).distinct().order_by(FinancialTransaction.account_id)).all())
    if not ids:
        return
    accounts = list(db.scalars(select(FinancialAccount).where(
        FinancialAccount.organization_id == organization_id,
        FinancialAccount.id.in_(ids),
    ).order_by(FinancialAccount.id).with_for_update().execution_options(populate_existing=True)).all())
    if {item.id for item in accounts} != set(ids):
        raise HTTPException(status_code=409, detail="A saved tax settlement account could not be verified")
