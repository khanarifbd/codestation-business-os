from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class CustomerAdvanceCreate(BaseModel):
    client_id: str
    financial_account_id: str
    advance_date: date
    amount: Decimal = Field(gt=0)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class CustomerAdvanceApply(BaseModel):
    invoice_id: str
    application_date: date
    amount: Decimal = Field(gt=0)


class CustomerAdvanceRead(BaseModel):
    id: str
    client_id: str
    client_name: str
    financial_account_id: str
    financial_account_name: str
    advance_date: date
    currency: str
    original_amount: Decimal
    remaining_amount: Decimal
    reference: str | None
    notes: str | None
    created_at: datetime
