from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class AccountingMoneyEntryCreate(BaseModel):
    kind: Literal["income", "expense"]
    entry_date: date
    financial_account_id: str
    category_ledger_account_id: str
    amount: Decimal = Field(gt=0)
    description: str = Field(min_length=1, max_length=500)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    source_type: Literal["client", "order", "project", "other"] | None = None
    source_id: str | None = None

    @model_validator(mode="after")
    def validate_source(self):
        if self.source_type in {"client", "order", "project"} and not self.source_id:
            raise ValueError("source_id is required for a client, order or project source")
        if self.source_type in {None, "other"} and self.source_id:
            raise ValueError("source_id requires a client, order or project source type")
        return self


class AccountingMoneyEntryRead(BaseModel):
    id: str
    kind: str
    entry_date: date
    financial_account_id: str
    financial_account_name: str
    category_ledger_account_id: str
    category_ledger_account_name: str
    source_type: str | None
    source_id: str | None
    client_id: str | None
    order_id: str | None
    project_id: str | None
    expense_category_id: str | None
    vendor_id: str | None
    source_label: str | None
    currency: str
    amount: Decimal
    description: str
    reference: str | None
    notes: str | None
    created_at: datetime


class AccountingIncomeWithFeeCreate(BaseModel):
    entry_date: date
    financial_account_id: str
    income_category_ledger_account_id: str
    gross_amount: Decimal = Field(gt=0)
    fee_amount: Decimal = Field(default=Decimal("0"), ge=0)
    fee_expense_category_id: str | None = None
    fee_vendor_id: str | None = None
    fee_category_ledger_account_id: str | None = None
    description: str = Field(min_length=1, max_length=500)
    fee_description: str | None = Field(default=None, max_length=500)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    source_type: Literal["client", "order", "project", "other"] | None = None
    source_id: str | None = None

    @model_validator(mode="after")
    def validate_income_with_fee(self):
        if self.source_type in {"client", "order", "project"} and not self.source_id:
            raise ValueError("source_id is required for a client, order or project source")
        if self.source_type in {None, "other"} and self.source_id:
            raise ValueError("source_id requires a client, order or project source type")
        if self.fee_amount > self.gross_amount:
            raise ValueError("fee_amount cannot exceed gross_amount")
        if self.fee_amount > 0 and not (self.fee_expense_category_id or self.fee_category_ledger_account_id):
            raise ValueError("fee_expense_category_id is required when fee_amount is greater than zero")
        if self.fee_amount == 0 and (self.fee_expense_category_id or self.fee_vendor_id or self.fee_category_ledger_account_id):
            raise ValueError("fee classification can only be supplied when fee_amount is greater than zero")
        return self


class AccountingIncomeWithFeeRead(BaseModel):
    income_entry: AccountingMoneyEntryRead
    fee_entry: AccountingMoneyEntryRead | None
    currency: str
    gross_amount: Decimal
    fee_amount: Decimal
    net_amount: Decimal
