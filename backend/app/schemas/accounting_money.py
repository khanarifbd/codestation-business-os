from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class AccountingMoneyEntryCreate(BaseModel):
    kind: Literal["income", "expense"]
    entry_date: date
    financial_account_id: str
    category_ledger_account_id: str
    amount: Decimal = Field(gt=0)
    description: str = Field(min_length=1, max_length=500)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class AccountingMoneyEntryRead(BaseModel):
    id: str
    kind: str
    entry_date: date
    financial_account_id: str
    financial_account_name: str
    category_ledger_account_id: str
    category_ledger_account_name: str
    currency: str
    amount: Decimal
    description: str
    reference: str | None
    notes: str | None
    created_at: datetime
