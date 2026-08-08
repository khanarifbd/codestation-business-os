from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

Frequency = Literal["weekly", "monthly", "quarterly", "yearly"]
PaymentMethod = Literal["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "fiverr", "other"]


class RecurringExpenseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str = Field(min_length=1, max_length=500)
    category_id: str
    account_id: str
    vendor_id: str | None = None
    client_id: str | None = None
    project_id: str | None = None
    expense_currency: str = Field(min_length=3, max_length=3)
    expense_amount: Decimal = Field(gt=0, le=Decimal("1000000000000"))
    frequency: Frequency
    interval_count: int = Field(default=1, ge=1, le=120)
    next_due_date: date
    end_date: date | None = None
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0)
    payment_method: PaymentMethod = "bank_transfer"
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    auto_post: bool = False


class RecurringExpenseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, min_length=1, max_length=500)
    category_id: str | None = None
    account_id: str | None = None
    vendor_id: str | None = None
    client_id: str | None = None
    project_id: str | None = None
    expense_currency: str | None = Field(default=None, min_length=3, max_length=3)
    expense_amount: Decimal | None = Field(default=None, gt=0)
    frequency: Frequency | None = None
    interval_count: int | None = Field(default=None, ge=1, le=120)
    next_due_date: date | None = None
    end_date: date | None = None
    tax_amount: Decimal | None = Field(default=None, ge=0)
    payment_method: PaymentMethod | None = None
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    is_active: bool | None = None
    auto_post: bool | None = None


class RecurringExpenseRead(BaseModel):
    id: str
    name: str
    description: str
    vendor_id: str | None
    vendor_name: str | None
    category_id: str
    category_name: str
    account_id: str
    account_name: str
    account_currency: str
    client_id: str | None
    client_name: str | None
    project_id: str | None
    project_name: str | None
    expense_currency: str
    expense_amount: Decimal
    frequency: str
    interval_count: int
    next_due_date: date
    end_date: date | None
    tax_amount: Decimal
    payment_method: str
    reference: str | None
    notes: str | None
    is_active: bool
    auto_post: bool = False
    auto_post_last_attempt_at: datetime | None = None
    auto_post_last_error: str | None = None
    last_posted_expense_id: str | None
    last_posted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class RecurringExpensePost(BaseModel):
    expense_date: date | None = None
    expense_amount: Decimal | None = Field(default=None, gt=0)
    account_amount: Decimal | None = Field(default=None, gt=0)
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    profitability_amount: Decimal | None = Field(default=None, gt=0)
    profitability_exchange_rate: Decimal | None = Field(default=None, gt=0)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class RecurringExpensePostResult(BaseModel):
    recurring_expense: RecurringExpenseRead
    expense_id: str
    expense_number: str
    posted_date: date
    next_due_date: date
    is_active: bool


class AccountingPeriodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date


class AccountingPeriodRead(BaseModel):
    id: str
    name: str
    start_date: date
    end_date: date
    status: str
    close_notes: str | None
    closed_by_user_id: str | None
    closed_at: datetime | None
    reopened_by_user_id: str | None
    reopened_at: datetime | None
    reopen_reason: str | None
    created_at: datetime
    updated_at: datetime


class AccountingPeriodClose(BaseModel):
    notes: str | None = None


class AccountingPeriodReopen(BaseModel):
    reason: str = Field(min_length=5, max_length=2000)
