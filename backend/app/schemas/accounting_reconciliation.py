from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class ReconciliationAccountMetaRead(BaseModel):
    id: str
    name: str
    account_type: str
    currency: str
    last_reconciled_date: date | None = None
    last_statement_balance: Decimal | None = None


class ReconciliationMetaRead(BaseModel):
    accounts: list[ReconciliationAccountMetaRead]


class ReconciliationRead(BaseModel):
    id: str
    account_id: str
    account_name: str
    currency: str
    statement_start_date: date | None = None
    statement_end_date: date
    statement_ending_balance: Decimal
    cleared_book_balance: Decimal
    difference: Decimal
    status: str
    matched_transactions: int
    notes: str | None = None
    finalized_at: datetime | None = None
    created_at: datetime


class ReconciliationTransactionRead(BaseModel):
    id: str
    transaction_date: date
    direction: str
    amount: Decimal
    currency: str
    source_type: str
    reference: str | None = None
    description: str | None = None
    selected: bool


class ReconciliationDetailRead(ReconciliationRead):
    transactions: list[ReconciliationTransactionRead]
    unmatched_count: int
