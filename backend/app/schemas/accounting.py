from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


AccountCategory = Literal["asset", "liability", "equity", "income", "expense"]
NormalBalance = Literal["debit", "credit"]


class LedgerAccountCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=180)
    category: AccountCategory
    subtype: str | None = Field(default=None, max_length=48)
    normal_balance: NormalBalance
    parent_id: str | None = None
    allow_manual_posting: bool = True
    notes: str | None = None


class LedgerAccountUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=180)
    subtype: str | None = Field(default=None, max_length=48)
    parent_id: str | None = None
    is_active: bool | None = None
    allow_manual_posting: bool | None = None
    notes: str | None = None


class LedgerAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    category: AccountCategory
    subtype: str | None
    normal_balance: NormalBalance
    parent_id: str | None
    system_key: str | None
    is_system: bool
    is_active: bool
    allow_manual_posting: bool
    notes: str | None
    created_at: datetime
    updated_at: datetime


class JournalLineCreate(BaseModel):
    ledger_account_id: str
    description: str | None = Field(default=None, max_length=500)
    currency: str = Field(min_length=3, max_length=3)
    exchange_rate_to_base: Decimal = Field(default=Decimal("1"), gt=0)
    debit: Decimal = Field(default=Decimal("0"), ge=0)
    credit: Decimal = Field(default=Decimal("0"), ge=0)
    original_amount: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def validate_side(self):
        if (self.debit > 0) == (self.credit > 0):
            raise ValueError("Exactly one of debit or credit must be greater than zero")
        return self


class JournalEntryCreate(BaseModel):
    entry_date: date
    reference: str | None = Field(default=None, max_length=180)
    memo: str | None = None
    lines: list[JournalLineCreate] = Field(min_length=2)


class JournalLineRead(BaseModel):
    id: str
    ledger_account_id: str
    account_code: str
    account_name: str
    description: str | None
    currency: str
    exchange_rate_to_base: Decimal
    debit: Decimal
    credit: Decimal
    original_amount: Decimal


class JournalEntryRead(BaseModel):
    id: str
    entry_number: str
    entry_date: date
    functional_currency: str
    status: str
    source_type: str
    source_id: str | None
    reference: str | None
    memo: str | None
    total_debit: Decimal
    total_credit: Decimal
    created_at: datetime
    posted_at: datetime
    lines: list[JournalLineRead]


class TrialBalanceRow(BaseModel):
    ledger_account_id: str
    code: str
    name: str
    category: AccountCategory
    debit: Decimal
    credit: Decimal
    balance: Decimal


class TrialBalanceRead(BaseModel):
    as_of: date | None
    accounting_currency: str
    functional_period_start: date
    total_debit: Decimal
    total_credit: Decimal
    rows: list[TrialBalanceRow]
