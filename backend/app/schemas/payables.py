from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class PayableBillCreate(BaseModel):
    supplier_name: str = Field(min_length=1, max_length=220)
    bill_date: date
    due_date: date | None = None
    currency: str = Field(min_length=3, max_length=3)
    amount: Decimal = Field(gt=0)
    expense_ledger_account_id: str
    description: str = Field(min_length=1, max_length=500)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class PayableBillRead(BaseModel):
    id: str
    bill_number: str
    supplier_name: str
    bill_date: date
    due_date: date | None
    currency: str
    original_amount: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    expense_ledger_account_id: str
    expense_ledger_account_name: str
    description: str
    reference: str | None
    notes: str | None
    status: str
    created_at: datetime


class PayablePaymentCreate(BaseModel):
    financial_account_id: str
    payment_date: date
    amount: Decimal = Field(gt=0)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class PayablePaymentRead(BaseModel):
    id: str
    bill_id: str
    financial_account_id: str
    financial_account_name: str
    payment_date: date
    currency: str
    amount: Decimal
    reference: str | None
    notes: str | None
    created_at: datetime
