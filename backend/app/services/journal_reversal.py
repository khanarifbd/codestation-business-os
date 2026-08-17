from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.models.accounting import JournalEntry, JournalLine
from app.services.accounting_posting import ensure_open_period
from app.services.functional_currency import (
    assert_current_functional_posting_period,
    current_functional_currency_period,
)


def reverse_source_journal(
    db,
    *,
    organization_id: str,
    user_id: str,
    source_type: str,
    source_id: str,
    reversal_date: date,
    reason: str,
) -> JournalEntry | None:
    original = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
        )
    )
    if original is None:
        return None
    if original.source_type == "functional_currency_transition":
        raise HTTPException(status_code=409, detail="Functional-currency transition journals cannot be reversed as ordinary transactions")

    current_period = current_functional_currency_period(db, organization_id)
    if original.functional_currency != current_period.currency or original.entry_date < current_period.effective_from:
        raise HTTPException(
            status_code=409,
            detail=(
                "This accounting entry belongs to a sealed functional-currency period. "
                "Create a current-period correction instead of reversing historical currency-period ledger values."
            ),
        )
    posting_period = assert_current_functional_posting_period(db, organization_id, reversal_date)
    if posting_period.currency != original.functional_currency:
        raise HTTPException(status_code=409, detail="Reversal date must use the same current functional currency as the original journal")

    existing = db.scalar(
        select(JournalEntry).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.reversed_entry_id == original.id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Accounting entry was already reversed by {existing.entry_number}")

    ensure_open_period(db, organization_id, reversal_date)
    source_lines = db.scalars(
        select(JournalLine).where(
            JournalLine.organization_id == organization_id,
            JournalLine.journal_entry_id == original.id,
        )
    ).all()
    if not source_lines:
        raise HTTPException(status_code=409, detail="Accounting entry has no lines to reverse")

    reversal = JournalEntry(
        organization_id=organization_id,
        entry_number=f"RV-{reversal_date.strftime('%Y%m%d')}-{uuid4().hex[:8].upper()}",
        entry_date=reversal_date,
        functional_currency=original.functional_currency,
        status="posted",
        source_type="reversal",
        source_id=original.id,
        reference=original.reference,
        memo=f"Reversal of {original.entry_number}: {reason.strip()}",
        reversed_entry_id=original.id,
        created_by_user_id=user_id,
        posted_by_user_id=user_id,
        posted_at=datetime.now(timezone.utc),
    )
    db.add(reversal)
    db.flush()

    for line in source_lines:
        db.add(
            JournalLine(
                organization_id=organization_id,
                journal_entry_id=reversal.id,
                ledger_account_id=line.ledger_account_id,
                description=f"Reversal: {line.description or original.entry_number}",
                currency=line.currency,
                exchange_rate_to_base=line.exchange_rate_to_base,
                debit=line.credit,
                credit=line.debit,
                original_amount=line.original_amount,
            )
        )
    db.flush()
    return reversal
